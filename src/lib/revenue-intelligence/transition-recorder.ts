/**
 * A12 transition-recorder — slice-2 hook helper.
 *
 * Bridges the existing Deal update flow with the slice-1 pipeline_
 * stage_transitions table. Pure classification + a thin Prisma write
 * wrapper. Called fire-and-forget from `/api/v1/deals/[id]` PUT
 * handler whenever a stage actually changes.
 */
import {
  DEFAULT_STAGE_PROBABILITIES,
  type StageProbabilityMap,
  type TransitionType,
} from "./types"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

/**
 * Classify a stage transition into one of the 7 canonical types.
 *
 * Pure function — no DB, no clock.
 *
 * Rules (evaluated in order, first match wins):
 *   • toStage === 'WON' → won
 *   • toStage === 'LOST' → lost
 *   • fromStage IN [WON, LOST] (closed) → reopened
 *   • prob(to) > prob(from) → advanced
 *   • prob(to) < prob(from) → regressed
 *   • prob(to) === prob(from) → advanced (default; same-tier rename)
 *
 * Note: 'created' is NOT returned here because this helper handles
 * UPDATE flows (fromStage is always known). The Deal CREATE flow
 * uses a separate path (recordCreatedTransition).
 *
 * Note: 'reassigned' is NOT returned here either. Reassigned semantics
 * are owner-change-not-stage-change; this helper only fires when
 * stage changes.
 */
export function classifyStageTransition(
  fromStage: string,
  toStage: string,
  probabilities: StageProbabilityMap = DEFAULT_STAGE_PROBABILITIES,
  wonStageNames: Iterable<string> = [],
  lostStageNames: Iterable<string> = [],
): TransitionType {
  /*
   * Compare meaning, not spelling. The waterfall on /forecast is built from
   * these buckets, and against the two literals a deal closed as CLOSED_WON
   * landed in «Продвинуто» instead of «Выиграно», a CLOSED_LOST one never
   * reduced the pipeline, and reopening either was not recognised as reopened.
   *
   * Configured names are optional because four of the five callers do not have
   * them at hand; without them the built-in aliases still cover CLOSED_WON,
   * Qazandı and the rest. Passing them in is strictly better, not required.
   */
  const canon = (stage: string) => canonicalDealStage(stage, wonStageNames, lostStageNames)
  const from = canon(fromStage)
  const to = canon(toStage)
  const TERMINAL = new Set(["WON", "LOST"])

  if (to === "WON") return "won"
  if (to === "LOST") return "lost"
  if (TERMINAL.has(from) && !TERMINAL.has(to)) return "reopened"

  const fromProb = probabilities[fromStage] ?? probabilities[from]
  const toProb = probabilities[toStage] ?? probabilities[to]
  if (typeof fromProb === "number" && typeof toProb === "number") {
    if (toProb > fromProb) return "advanced"
    if (toProb < fromProb) return "regressed"
  }
  // Unknown probabilities OR equal probability → default to advanced.
  return "advanced"
}

/**
 * Compute how many seconds the deal sat in fromStage before this
 * transition. NULL when the prior stageChangedAt is unavailable
 * (e.g. legacy deals that pre-date the stageChangedAt column).
 */
export function computeDurationSeconds(
  priorStageChangedAt: Date | null | undefined,
  transitionedAt: Date,
): number | null {
  if (!priorStageChangedAt) return null
  const ms = transitionedAt.getTime() - priorStageChangedAt.getTime()
  if (ms < 0) return null
  return Math.floor(ms / 1000)
}

/**
 * Thin Prisma write wrapper — called fire-and-forget from deal update
 * route. Returns the created row id or null on error (caller doesn't
 * need to handle).
 *
 * Imports `prisma` lazily so this module can be referenced from edge
 * runtimes without dragging the Prisma client into bundles that don't
 * need it.
 */
export interface RecordTransitionInput {
  organizationId: string
  dealId: string
  pipelineId?: string | null
  fromStage: string
  toStage: string
  fromAmount: number
  toAmount: number
  currency?: string
  reason?: string | null
  actorUserId?: string | null
  priorStageChangedAt?: Date | null
  /**
   * Stage names this org declared won/lost. Optional: without them the
   * built-in aliases still fold CLOSED_WON and friends, so a caller that has
   * no cheap way to look them up simply gets a slightly narrower match.
   */
  wonStageNames?: string[]
  lostStageNames?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordStageTransition(
  prisma: any,
  input: RecordTransitionInput,
): Promise<string | null> {
  try {
    const transitionType = classifyStageTransition(
      input.fromStage,
      input.toStage,
      DEFAULT_STAGE_PROBABILITIES,
      input.wonStageNames ?? [],
      input.lostStageNames ?? [],
    )
    const transitionedAt = new Date()
    const durationInPrevStageSeconds = computeDurationSeconds(
      input.priorStageChangedAt,
      transitionedAt,
    )
    const row = await prisma.pipelineStageTransition.create({
      data: {
        organizationId: input.organizationId,
        dealId: input.dealId,
        pipelineId: input.pipelineId ?? null,
        fromStage: input.fromStage,
        toStage: input.toStage,
        fromAmount: input.fromAmount,
        toAmount: input.toAmount,
        // Schema default Deal.currency = "AZN"; route always passes a string,
        // fallback is defense-in-depth.
        currency: input.currency ?? "AZN",
        transitionedAt,
        transitionType,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId ?? null,
        durationInPrevStageSeconds,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    // Fire-and-forget — log but don't throw. Slice-2 cron may later
    // backfill missing transitions; for now just don't block the
    // caller's Deal UPDATE on transition-recording failures.
    console.error("[A12/transition-recorder] failed to record:", err)
    return null
  }
}

/**
 * One deal in a bulk stage move. A stage move does not change the deal
 * value, so the amount before/after is identical — a single `amount`
 * captures both sides of the waterfall.
 */
export interface BulkStageTransitionDeal {
  id: string
  fromStage: string
  amount: number
  currency?: string
  pipelineId?: string | null
  priorStageChangedAt?: Date | null
}

export interface RecordBulkStageTransitionsInput {
  organizationId: string
  toStage: string
  deals: BulkStageTransitionDeal[]
  actorUserId?: string | null
}

/**
 * Record stage transitions for a batch of deals moved to the SAME target
 * stage in one operation (bulk-bar move, sandbox script, …). Mirrors the
 * single-deal `recordStageTransition` semantics:
 *   • only deals whose stage actually changes get a row (no-op moves skipped)
 *   • fire-and-forget — individual failures are logged, never thrown
 *
 * The caller must have already persisted the stage change; this only
 * appends the analytics/audit rows. Returns the number of rows written.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordStageTransitionsForDeals(
  prisma: any,
  input: RecordBulkStageTransitionsInput,
): Promise<number> {
  let recorded = 0
  for (const d of input.deals) {
    if (d.fromStage === input.toStage) continue // no-op move
    const id = await recordStageTransition(prisma, {
      organizationId: input.organizationId,
      dealId: d.id,
      pipelineId: d.pipelineId ?? null,
      fromStage: d.fromStage,
      toStage: input.toStage,
      fromAmount: d.amount,
      toAmount: d.amount,
      currency: d.currency,
      actorUserId: input.actorUserId ?? null,
      priorStageChangedAt: d.priorStageChangedAt ?? null,
    })
    if (id) recorded++
  }
  return recorded
}
