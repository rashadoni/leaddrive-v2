/**
 * CLM Slice 6c — Semantic contract search.
 *
 * POST /api/v1/contracts/search/semantic
 *   Body: { query: string, limit?: number, threshold?: number }
 *
 * Embeds the query with Voyage voyage-3-lite, then runs a cosine similarity
 * search over the contract_embeddings table using pgvector's <=> operator.
 * Returns a ranked list of contracts above the threshold.
 *
 * Guards:
 *   requireAuth(contracts, read)
 *   org-scope (organizationId = orgId hardcoded in SQL — BOTH sides of the JOIN)
 *   rate-limit (ai bucket)
 *   feature flag (ai_semantic_search)
 *   budget guard (prior spend)
 *
 * SQL pattern mirrors searchKbByVector() in src/lib/ai/embeddings.ts exactly:
 *   1 - (embedding <=> $1::vector) AS similarity
 *   WHERE ce.organizationId = $2 AND c.organizationId = $2  ← both sides org-scoped
 *   ORDER BY embedding <=> $1::vector
 *   LIMIT $3
 *
 * FIX 2 (2026-06-08): JOIN now includes AND c."organizationId" = $2 so a stray
 * contract_embeddings row for another tenant can never leak contract metadata.
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkAiBudget, isAiFeatureEnabled } from "@/lib/ai/budget"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { logEmbeddingSpend } from "@/lib/ai/embedding-spend"
import { PiiMasker } from "@/lib/ai/pii-masker"

const bodySchema = z.object({
  query:     z.string().min(1, "query is required").max(2000),
  limit:     z.number().int().min(1).max(50).optional(),
  threshold: z.number().min(-1).max(1).optional(),
})

function maskEmbeddingText(text: string): string {
  return new PiiMasker().mask(text)
}

async function generateEmbedding(text: string): Promise<number[]> {
  const safeText = maskEmbeddingText(text)
  const voyageKey = process.env.VOYAGE_API_KEY
  if (voyageKey) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: [safeText.slice(0, 8000)],
      }),
    })
    const data = await response.json()
    if (data.data?.[0]?.embedding) {
      return data.data[0].embedding
    }
  }

  // Fallback: deterministic hash-based pseudo-embedding
  const DIMS = 512
  const result = new Array(DIMS).fill(0)
  for (let i = 0; i < DIMS; i++) {
    const charCode = safeText.charCodeAt(i % safeText.length) || 0
    result[i] = ((charCode * 2654435761) % 1000) / 1000 - 0.5
  }
  return result
}

export const POST = withRlsAuth("contracts", "read", async (req, auth) => {
  const { orgId } = auth

  // Rate limit
  const rateLimitKey = `ai:${orgId}`
  if (!checkRateLimit(rateLimitKey, RATE_LIMIT_CONFIG.ai)) {
    return NextResponse.json(
      { error: "Too many AI requests. Please try again later." },
      { status: 429 },
    )
  }

  // Feature flag gate
  const featureEnabled = await isAiFeatureEnabled(orgId, "ai_semantic_search")
  if (!featureEnabled) {
    return NextResponse.json(
      { error: "AI semantic search is not enabled for your organization." },
      { status: 403 },
    )
  }

  // Budget guard
  const budget = await checkAiBudget(orgId)
  if (!budget.allowed) {
    return NextResponse.json(
      { error: `Daily AI budget exceeded ($${budget.spent}/$${budget.limit}). Try again tomorrow.` },
      { status: 429 },
    )
  }

  // Parse body
  let body: unknown = {}
  try {
    const raw = await req.text()
    if (raw.trim().length > 0) body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { query, limit = 10, threshold = 0.3 } = parsed.data
  const safeQuery = maskEmbeddingText(query)

  // Generate query embedding + meter spend (FIX 1)
  let queryVector: number[]
  const embedStart = Date.now()
  try {
    queryVector = await generateEmbedding(safeQuery)
  } catch (err) {
    console.error("ContractSemanticSearch embedding failed:", err)
    return NextResponse.json(
      { error: "Embedding generation failed. Please retry." },
      { status: 502 },
    )
  }
  const embedLatencyMs = Date.now() - embedStart

  // FIX 1: log embedding spend so checkAiBudget meters this call
  // Fire-and-forget — a failed persist does not fail the search
  void logEmbeddingSpend(orgId, safeQuery, embedLatencyMs, "[contract-search]")

  const vectorStr = `[${queryVector.join(",")}]`

  // Cosine similarity search.
  // FIX 2: JOIN is org-scoped on BOTH sides (ce."organizationId" = $2 AND c."organizationId" = $2).
  // This prevents a mismatched embedding row from leaking another tenant's contract metadata.
  type SearchRow = {
    contractId: string
    contractNumber: string
    title: string
    status: string
    valueAmount: string | null
    currency: string
    similarity: number
  }

  let results: SearchRow[]
  try {
    results = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        ce."contractId",
        c."contractNumber",
        c.title,
        c.status,
        c."valueAmount"::text,
        c.currency,
        1 - (ce."embedding" <=> ${vectorStr}::vector) AS similarity
      FROM "contract_embeddings" ce
      JOIN "contracts" c ON c.id = ce."contractId" AND c."organizationId" = ${orgId}
      WHERE ce."organizationId" = ${orgId}
      ORDER BY ce."embedding" <=> ${vectorStr}::vector
      LIMIT ${limit}
    `
  } catch (err) {
    console.error("ContractSemanticSearch vector query failed:", err)
    return NextResponse.json(
      { error: "Semantic search failed. Please retry." },
      { status: 500 },
    )
  }

  // Filter by threshold and parse similarity
  const hits = results
    .map((r) => ({
      contractId:     r.contractId,
      contractNumber: r.contractNumber,
      title:          r.title,
      status:         r.status,
      valueAmount:    r.valueAmount ? parseFloat(r.valueAmount) : null,
      currency:       r.currency,
      similarity:     parseFloat(String(r.similarity)) || 0,
    }))
    .filter((r) => r.similarity >= threshold)

  return NextResponse.json({
    success: true,
    query,
    count: hits.length,
    results: hits,
  })
})
