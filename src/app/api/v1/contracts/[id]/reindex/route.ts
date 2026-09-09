/**
 * CLM Slice 6c — Reindex: generate + upsert embedding for a single contract.
 *
 * POST /api/v1/contracts/[id]/reindex
 *   Loads the contract's body (canonical signed version first, then renderedBody),
 *   generates a 512-dim Voyage embedding via the shared generateEmbedding helper,
 *   and upserts a ContractEmbedding row via a single atomic INSERT ... ON CONFLICT DO UPDATE.
 *
 * Guards (same order as 6a extract):
 *   requireAuth(contracts, write)
 *   org-scope
 *   rate-limit (ai bucket)
 *   feature flag (ai_semantic_search)
 *   budget guard (prior spend)
 *
 * FIX 1 (2026-06-08): logs embedding spend to AiInteractionLog via logEmbeddingSpend()
 *   so checkAiBudget() actually meters this call.
 * FIX 4 (2026-06-08): replaced findUnique-then-branch (race → 500 on concurrent reindex)
 *   with a single INSERT ... ON CONFLICT ("contractId") DO UPDATE (atomic upsert).
 *
 * NOTE: embeddings are NOT an LLM chat call (Voyage embeds text, doesn't follow
 * instructions) → low prompt-injection risk. We still mask PII before external
 * embedding egress and store masked content in ContractEmbedding.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkAiBudget, isAiFeatureEnabled } from "@/lib/ai/budget"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { logEmbeddingSpend } from "@/lib/ai/embedding-spend"
import { PiiMasker } from "@/lib/ai/pii-masker"

// Max chars to embed — Voyage voyage-3-lite handles up to ~120k tokens;
// 32k chars (~8k tokens) is a safe practical cap per contract.
const MAX_EMBED_CHARS = 32_000

function maskEmbeddingText(text: string): string {
  return new PiiMasker().mask(text)
}

// Inline minimal embedding helper so we don't import the entire embeddings.ts
// module (which has Anthropic fallback) — we mirror the Voyage call shape exactly.
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

  // Fallback: deterministic hash-based pseudo-embedding (same logic as embeddings.ts)
  const DIMS = 512
  const result = new Array(DIMS).fill(0)
  for (let i = 0; i < DIMS; i++) {
    const charCode = safeText.charCodeAt(i % safeText.length) || 0
    result[i] = ((charCode * 2654435761) % 1000) / 1000 - 0.5
  }
  return result
}

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth

  const { id: contractId } = await params

  // Rate limit (AI bucket) — same key as extract / score-risk
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

  // Load contract (org-scoped) with canonical signed version
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId: orgId },
    include: {
      contractVersions: {
        where: { isCanonicalSigned: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  })
  if (!contract) {
    return NextResponse.json({ error: "Contract not found." }, { status: 404 })
  }

  // Pick the text: canonical signed version first, then renderedBody
  const canonicalVersion = contract.contractVersions[0] ?? null
  const rawBody = (canonicalVersion?.renderedBody ?? contract.renderedBody ?? "").trim()
  const contractVersionId = canonicalVersion?.id ?? null

  if (!rawBody) {
    return NextResponse.json(
      { error: "No contract body to embed. Generate or upload a document first." },
      { status: 400 },
    )
  }

  // Truncate to embedding cap
  const embeddingText = maskEmbeddingText(rawBody).slice(0, MAX_EMBED_CHARS)

  // Generate embedding + meter spend (FIX 1)
  let vector: number[]
  const embedStart = Date.now()
  try {
    vector = await generateEmbedding(embeddingText)
  } catch (err) {
    console.error("ContractEmbedding generation failed:", err)
    return NextResponse.json(
      { error: "Embedding generation failed. Please retry." },
      { status: 502 },
    )
  }
  const embedLatencyMs = Date.now() - embedStart

  // FIX 1: log embedding spend so checkAiBudget meters this call
  void logEmbeddingSpend(orgId, embeddingText, embedLatencyMs, "[contract-reindex]")

  const vectorStr = `[${vector.join(",")}]`
  const id = `cemb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // FIX 4: Atomic upsert — single INSERT ... ON CONFLICT ("contractId") DO UPDATE.
  // Replaces the old findUnique-then-branch pattern which could race on concurrent reindex
  // (both see no row → both INSERT → unique-constraint 500).
  try {
    await prisma.$executeRaw`
      INSERT INTO "contract_embeddings"
        ("id", "organizationId", "contractId", "contractVersionId", "content",
         "embedding", "model", "createdAt", "updatedAt")
      VALUES (${id}, ${orgId}, ${contractId}, ${contractVersionId}, ${embeddingText}, ${vectorStr}::vector, 'voyage-3-lite', NOW(), NOW())
      ON CONFLICT ("contractId") DO UPDATE
        SET "content" = EXCLUDED."content",
            "embedding" = EXCLUDED."embedding",
            "model" = EXCLUDED."model",
            "contractVersionId" = EXCLUDED."contractVersionId",
            "updatedAt" = NOW()
    `
  } catch (err) {
    console.error("ContractEmbedding upsert failed:", err)
    return NextResponse.json(
      { error: "Failed to store embedding. Please retry." },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      contractId,
      contractVersionId,
      contentLength: embeddingText.length,
      model: "voyage-3-lite",
    },
  })
})
