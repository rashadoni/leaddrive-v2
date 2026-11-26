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
 *   feature flag (ai_semantic_search — Settings → AI automation, copilot group)
 *   the daily AI limit — through the gateway (voyageEmbedding); without a
 *   Voyage vector the search goes by words, never by a made-up vector
 *   (src/lib/clm/contract-search-index.ts)
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
import { withRlsAuth } from "@/lib/with-rls"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { voyageEmbedding } from "@/lib/ai/voyage-embedding"
import { indexContracts, searchByMeaning, searchByWords } from "@/lib/clm/contract-search-index"

const bodySchema = z.object({
  query:     z.string().min(1, "query is required").max(2000),
  limit:     z.number().int().min(1).max(50).optional(),
  threshold: z.number().min(-1).max(1).optional(),
})

/** Contracts the search itself brings up to date, so the first search already finds something; the hourly job does the rest. */
const INDEX_ON_SEARCH = 10
const INDEX_ON_SEARCH_MS = 4000

export const POST = withRlsAuth("contracts", "read", async (req, auth) => {
  const { orgId } = auth

  if (!checkRateLimit(`ai:${orgId}`, RATE_LIMIT_CONFIG.ai)) {
    return NextResponse.json({ error: "Too many AI requests. Please try again later.", code: "RATE_LIMITED" }, { status: 429 })
  }

  // The switch lives in Settings → AI automation (copilot group); the page says so to the person.
  if (!(await isAiFeatureEnabled(orgId, "ai_semantic_search"))) {
    return NextResponse.json({ error: "Smart search is off for this organization.", code: "SEMANTIC_SEARCH_OFF", errorKey: "semanticSearchOff" }, { status: 403 })
  }

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

  // Voyage through the gateway: the organization's key or the platform's, under the daily limit.
  // No vector for the query — no key, limit spent, no answer — the search goes by words and says so.
  const queryVector = await voyageEmbedding(orgId, new PiiMasker().mask(query), "contracts")
  if (!queryVector) {
    const results = await searchByWords(orgId, query, limit)
    return NextResponse.json({ success: true, query, mode: "words", count: results.length, results })
  }

  const run = await indexContracts(orgId, { limit: INDEX_ON_SEARCH, deadline: Date.now() + INDEX_ON_SEARCH_MS })
  const results = await searchByMeaning(orgId, queryVector, limit, threshold)
  return NextResponse.json({ success: true, query, mode: "meaning", count: results.length, results, indexedNow: run.indexed })
})
