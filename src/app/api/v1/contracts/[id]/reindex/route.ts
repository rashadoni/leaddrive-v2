/**
 * CLM Slice 6c — Reindex: generate + upsert embedding for a single contract.
 *
 * POST /api/v1/contracts/[id]/reindex
 *   Makes this contract's vector now, from what a person searches by (title,
 *   number, counterparty, text with personal data masked) — the same text the
 *   search and the hourly job use: src/lib/clm/contract-search-index.ts.
 *
 * Guards: requireAuth(contracts, write), org scope, the AI rate limit, the
 * switch (ai_semantic_search — Settings → AI automation), and the daily AI
 * limit through the gateway. No Voyage for the organization → 503
 * VOYAGE_UNAVAILABLE and nothing stored (until 2026-11-26 a «vector» made of
 * character codes was stored instead, and searched as if it meant something).
 *
 * NOTE: embeddings are NOT an LLM chat call (Voyage embeds text, doesn't follow
 * instructions) → low prompt-injection risk. We still mask PII before external
 * embedding egress and store masked content in ContractEmbedding.
 */

import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { indexOneContract } from "@/lib/clm/contract-search-index"

export const POST = withRlsAuth("contracts", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id: contractId } = await params

  if (!checkRateLimit(`ai:${orgId}`, RATE_LIMIT_CONFIG.ai)) {
    return NextResponse.json({ error: "Too many AI requests. Please try again later.", code: "RATE_LIMITED" }, { status: 429 })
  }
  if (!(await isAiFeatureEnabled(orgId, "ai_semantic_search"))) {
    return NextResponse.json({ error: "Smart search is off for this organization.", code: "SEMANTIC_SEARCH_OFF", errorKey: "semanticSearchOff" }, { status: 403 })
  }

  // Through the gateway: the organization's Voyage key or the platform's, under the daily limit.
  // Without one nothing is stored — a made-up vector would only look like an index.
  const outcome = await indexOneContract(orgId, contractId)
  if (outcome === "not_found") return NextResponse.json({ error: "Contract not found." }, { status: 404 })
  if (outcome === "unavailable") {
    return NextResponse.json({ error: "Voyage is not available to this organization now (no key, or the daily limit is spent).", code: "VOYAGE_UNAVAILABLE", errorKey: "semanticVoyageUnavailable" }, { status: 503 })
  }
  return NextResponse.json({ success: true, contractId })
})
