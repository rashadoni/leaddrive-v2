/**
 * Shared helper: log estimated Voyage embedding spend to AiInteractionLog.
 *
 * Voyage AI voyage-3-lite is billed by input tokens.
 * Exact token count is unavailable client-side; we estimate: chars / 4.
 * Conservative per-1M-input-token rate: $0.02 (voyage-3-lite, as of 2026-Q2).
 *
 * Usage: call AFTER a successful generateEmbedding() so that the budget gate
 * (checkAiBudget, which sums AiInteractionLog.costUsd) meters embedding spend.
 *
 * Fire-and-forget inside the route — a failed persist does NOT fail the request;
 * but the spend IS understated until the next call. Mirrors the existing CLM
 * pattern from extract/score-risk (prisma.aiInteractionLog.create inside a tx
 * per slice 6a/6b; here we use a standalone create to avoid coupling the caller
 * into a tx just for metering).
 */

import { prisma } from "@/lib/prisma"

const VOYAGE_USD_PER_1M_INPUT = 0.02   // voyage-3-lite conservative estimate
const MIN_COST_USD             = 0.000_01 // floor to avoid $0 records on tiny texts

/**
 * logEmbeddingSpend — write an AiInteractionLog row for a Voyage embedding call.
 *
 * @param orgId     - organization id (for budget gate sum)
 * @param text      - the text that was embedded (used to estimate token count)
 * @param latencyMs - wall-clock ms for the embedding call
 * @param context   - short label surfaced in userMessage, e.g. "[contract-search]"
 */
export async function logEmbeddingSpend(
  orgId: string,
  text: string,
  latencyMs: number,
  context: string,
): Promise<void> {
  const inputTokens = Math.max(1, Math.ceil(text.length / 4))
  const costUsd     = Math.max(MIN_COST_USD, (inputTokens / 1_000_000) * VOYAGE_USD_PER_1M_INPUT)

  try {
    await prisma.aiInteractionLog.create({
      data: {
        organizationId:  orgId,
        userMessage:     `${context} embed:${inputTokens}tok`.slice(0, 500),
        aiResponse:      `vector:voyage-3-lite chars:${text.length}`.slice(0, 1000),
        latencyMs,
        promptTokens:    inputTokens,
        completionTokens: 0,
        costUsd,
        model:           "voyage-3-lite",
        isCopilot:       false,
      },
    })
  } catch (err) {
    // Non-fatal: budget gate sees understated spend for this call.
    console.error("[embedding-spend] Failed to log AiInteractionLog:", err)
  }
}
