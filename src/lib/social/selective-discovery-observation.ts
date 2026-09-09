/**
 * Selective TikTok/YouTube discovery — daily-run observation invariants.
 *
 * This module encodes the observation checks required by
 * `docs/TIKTOK-SELECTIVE-DISCOVERY-PLAN.md` (`TT-SD-017`) and
 * `docs/YOUTUBE-SELECTIVE-DISCOVERY-PLAN.md` (`YT-SD-008`) as a pure,
 * deterministic evaluator over one tenant's persisted evidence for one UTC day.
 *
 * It is intentionally free of Prisma/RLS surface: callers collect the day's
 * rows inside their own tenant-scoped context and map them into the plain input
 * shapes below. That keeps every invariant unit-testable and keeps this module
 * usable both from an operator query and from the daily cron without adding a
 * new database read path.
 *
 * The invariants mirror the owner's daily-run verification checklist:
 *   1. tenant_isolation              — every row belongs to the observed tenant
 *   2. no_arbitrary_scanning         — runs originate from scenario-managed
 *                                       sources; no un-sourced enumeration
 *   3. no_apify_external_routes      — Apify appears only on explicitly
 *                                       approved platform/capability pairs
 *   4. comments_only_for_matched     — comment runs target ACCEPTED parents only
 *   5. no_review_rejected_dispatch   — REVIEW/REJECTED parents never dispatched
 *   6. dedup_and_watermark           — duplicates deduped; partial runs never
 *                                       advance the watermark
 *   7. external_replies_zero         — no external reply is dispatched
 */

import {
  BRIGHT_DATA_ONLY_PLATFORMS,
  isApifySocialReadRouteAllowed,
  isApifyRouteReference,
  isBrightDataOnlyPlatform,
} from "@/lib/social/bright-data-policy"

export type ObservationVerdict = "PASS" | "FAIL" | "NOT_APPLICABLE"

export { BRIGHT_DATA_ONLY_PLATFORMS }

/** Provider-run phases produced by the selective discovery pipeline. */
export const DISCOVERY_PHASE = "DISCOVER_CANDIDATE_POSTS"
export const COMMENT_PHASE = "EXTRACT_COMMENTS_FROM_CANDIDATES"

/** Envelope relevance status that authorizes selective comment collection. */
export const COMMENT_ELIGIBLE_RELEVANCE = "ACCEPTED"

/** Relevance statuses that must never reach the paid comment provider. */
const COMMENT_BLOCKED_RELEVANCE = new Set([
  "REVIEW",
  "REJECTED",
  "POLICY_DENIED",
  "PENDING",
])

const SUCCESS_RUN_STATUSES = new Set(["success", "succeeded", "imported"])
const INCOMPLETE_RUN_STATUSES = new Set(["partial", "failed", "blocked"])

export interface ObservationCollectorRunInput {
  id: string
  organizationId: string
  sourceId: string
  status: string
  duplicateCount?: number | null
}

export interface ObservationRoutePlanInput {
  id: string
  organizationId: string
  platform: string
  capability: string
  primaryAdapter: string
  fallbackAdapters?: string[] | null
  acquisitionMode: string
  replyMode?: string | null
  status?: string | null
}

export interface ObservationProviderRunInput {
  id: string
  organizationId: string
  sourceId: string | null
  routePlanId: string | null
  platform: string
  phase: string
  providerKey: string
  adapterKey: string
  status: string
  /**
   * Relevance status of the accepted parent publication a comment run was
   * dispatched for. Required for `COMMENT_PHASE` runs; the reader populates it
   * from the run's parent envelope / input snapshot.
   */
  parentRelevanceStatus?: string | null
  /** True when this run advanced the source watermark. */
  watermarkAdvanced?: boolean | null
  actualChargeUsd?: number | null
}

export interface ObservationEnvelopeInput {
  id: string
  organizationId: string
  sourceId?: string | null
  platform: string
  contentKind: string
  relevanceStatus: string
  externalId?: string | null
  providerItemId?: string | null
  acquisitionMode?: string | null
}

export interface ObservationExternalReplyInput {
  id: string
  organizationId: string
  platform: string
  status: string
}

export interface SelectiveDiscoveryObservationDay {
  /** Tenant we expect every row to belong to (e.g. the brandprotection org). */
  observedOrganizationId: string
  /** UTC calendar day, `YYYY-MM-DD`. */
  utcDay: string
  collectorRuns: ObservationCollectorRunInput[]
  routePlans: ObservationRoutePlanInput[]
  providerRuns: ObservationProviderRunInput[]
  envelopes: ObservationEnvelopeInput[]
  externalReplies: ObservationExternalReplyInput[]
}

export interface ObservationInvariantResult {
  id: string
  verdict: ObservationVerdict
  detail: string
  offenders: string[]
}

export interface ObservationDayResult {
  utcDay: string
  observedOrganizationId: string
  /** True only when every applicable invariant passed. */
  ok: boolean
  /** True when at least one collector run completed successfully that day. */
  hasSuccessfulRun: boolean
  invariants: ObservationInvariantResult[]
}

function referencesApify(...values: Array<string | null | undefined>): boolean {
  return values.some(isApifyRouteReference)
}

function result(
  id: string,
  offenders: string[],
  passDetail: string,
  failDetail: string,
  applicable = true,
): ObservationInvariantResult {
  if (!applicable) {
    return { id, verdict: "NOT_APPLICABLE", detail: passDetail, offenders: [] }
  }
  return offenders.length === 0
    ? { id, verdict: "PASS", detail: passDetail, offenders: [] }
    : { id, verdict: "FAIL", detail: failDetail, offenders }
}

/** 1. Every observed row belongs to the single observed tenant. */
function checkTenantIsolation(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const expected = day.observedOrganizationId
  const offenders: string[] = []
  const scan = (rows: Array<{ id: string; organizationId: string }>, kind: string) => {
    for (const row of rows) {
      if (row.organizationId !== expected) offenders.push(`${kind}:${row.id}`)
    }
  }
  scan(day.collectorRuns, "collectorRun")
  scan(day.routePlans, "routePlan")
  scan(day.providerRuns, "providerRun")
  scan(day.envelopes, "envelope")
  scan(day.externalReplies, "externalReply")
  return result(
    "tenant_isolation",
    offenders,
    `All observed rows belong to ${expected}.`,
    "Rows from a different tenant were observed in this run.",
  )
}

/** 2. Discovery originates only from scenario-managed sources, never ad-hoc. */
function checkNoArbitraryScanning(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const offenders: string[] = []
  for (const run of day.providerRuns) {
    if (!run.sourceId || !run.routePlanId) offenders.push(`providerRun:${run.id}`)
  }
  for (const envelope of day.envelopes) {
    if (!envelope.sourceId) offenders.push(`envelope:${envelope.id}`)
  }
  return result(
    "no_arbitrary_scanning",
    offenders,
    "Every provider run and envelope is bound to a scenario-managed source.",
    "Un-sourced provider run or envelope indicates arbitrary scanning.",
  )
}

/** 3. Guarded social routes use Apify only for approved scoped reads. */
function checkNoApifyExternalRoutes(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const offenders: string[] = []
  let applicable = false
  for (const plan of day.routePlans) {
    if (!isBrightDataOnlyPlatform(plan.platform)) continue
    if (isApifySocialReadRouteAllowed(plan.platform, plan.capability)) continue
    applicable = true
    if (
      referencesApify(plan.primaryAdapter, plan.acquisitionMode, ...(plan.fallbackAdapters ?? []))
    ) {
      offenders.push(`routePlan:${plan.id}`)
    }
  }
  for (const run of day.providerRuns) {
    if (!isBrightDataOnlyPlatform(run.platform)) continue
    if (isApifySocialReadRouteAllowed(run.platform, run.phase)) continue
    applicable = true
    if (referencesApify(run.adapterKey, run.providerKey)) offenders.push(`providerRun:${run.id}`)
  }
  return result(
    "no_apify_external_routes",
    offenders,
    "Apify appeared only on approved Facebook/Instagram/TikTok discovery and scoped social comment routes.",
    "An Apify adapter was present outside approved Facebook/Instagram/TikTok discovery or scoped social comment routes.",
    applicable,
  )
}

/** 4. Comment runs only target ACCEPTED (MATCHED/opted-in PROBABLE) parents. */
function checkCommentsOnlyForMatched(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const commentRuns = day.providerRuns.filter(run => run.phase === COMMENT_PHASE)
  const offenders = commentRuns
    .filter(run => run.parentRelevanceStatus !== COMMENT_ELIGIBLE_RELEVANCE)
    .map(run => `providerRun:${run.id}`)
  return result(
    "comments_only_for_matched",
    offenders,
    "Comment collection ran only for ACCEPTED publications.",
    "A comment run targeted a non-ACCEPTED publication.",
    commentRuns.length > 0,
  )
}

/** 5. REVIEW/REJECTED/POLICY_DENIED/PENDING parents are never dispatched. */
function checkNoReviewRejectedDispatch(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const commentRuns = day.providerRuns.filter(run => run.phase === COMMENT_PHASE)
  const offenders = commentRuns
    .filter(run => COMMENT_BLOCKED_RELEVANCE.has(String(run.parentRelevanceStatus)))
    .map(run => `providerRun:${run.id}`)
  return result(
    "no_review_rejected_dispatch",
    offenders,
    "No REVIEW/REJECTED publication was sent to the comment provider.",
    "A REVIEW/REJECTED publication was dispatched for comment collection.",
    commentRuns.length > 0,
  )
}

/** 6. Duplicates are deduped and partial/failed runs never advance a watermark. */
function checkDedupAndWatermark(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const offenders: string[] = []
  for (const run of day.providerRuns) {
    if (run.watermarkAdvanced && INCOMPLETE_RUN_STATUSES.has(run.status.toLowerCase())) {
      offenders.push(`watermark:${run.id}`)
    }
  }
  // Accepted publications must be unique per platform+externalId within the day.
  const seen = new Set<string>()
  for (const envelope of day.envelopes) {
    if (envelope.relevanceStatus !== COMMENT_ELIGIBLE_RELEVANCE) continue
    if (!envelope.externalId) continue
    const key = `${envelope.platform.toLowerCase()}:${envelope.externalId}`
    if (seen.has(key)) offenders.push(`duplicate:${envelope.id}`)
    else seen.add(key)
  }
  return result(
    "dedup_and_watermark",
    offenders,
    "Duplicates were deduped and no incomplete run advanced the watermark.",
    "An incomplete run advanced the watermark or an accepted duplicate slipped through.",
  )
}

/** 7. No external reply is dispatched and no live external reply route is active. */
function checkExternalRepliesZero(day: SelectiveDiscoveryObservationDay): ObservationInvariantResult {
  const offenders: string[] = []
  for (const reply of day.externalReplies) {
    offenders.push(`externalReply:${reply.id}`)
  }
  for (const plan of day.routePlans) {
    if (plan.capability !== "REPLY_EXTERNAL") continue
    if ((plan.status ?? "ACTIVE") === "BLOCKED") continue
    const mode = (plan.replyMode ?? "NO_ACTION").toUpperCase()
    if (mode !== "NO_ACTION") offenders.push(`routePlan:${plan.id}`)
  }
  return result(
    "external_replies_zero",
    offenders,
    "No external reply was dispatched and no live external reply route was active.",
    "An external reply was dispatched or a live external reply route was active.",
  )
}

/** Evaluate all invariants for one observed tenant-day. */
export function evaluateSelectiveDiscoveryObservationDay(
  day: SelectiveDiscoveryObservationDay,
): ObservationDayResult {
  const invariants = [
    checkTenantIsolation(day),
    checkNoArbitraryScanning(day),
    checkNoApifyExternalRoutes(day),
    checkCommentsOnlyForMatched(day),
    checkNoReviewRejectedDispatch(day),
    checkDedupAndWatermark(day),
    checkExternalRepliesZero(day),
  ]
  const hasSuccessfulRun = day.collectorRuns.some(run =>
    SUCCESS_RUN_STATUSES.has(run.status.toLowerCase()),
  )
  return {
    utcDay: day.utcDay,
    observedOrganizationId: day.observedOrganizationId,
    ok: invariants.every(invariant => invariant.verdict !== "FAIL"),
    hasSuccessfulRun,
    invariants,
  }
}

export interface ObservationWindowSummary {
  requiredConsecutiveDays: number
  totalObservedDays: number
  /** Consecutive counting days ending at the most recent observed day. */
  consecutivePassingDays: number
  /** True once the trailing streak meets the required window. */
  windowSatisfied: boolean
  firstDay: string | null
  lastDay: string | null
  /** Earliest observed day that is not a passing observation day, if any. */
  firstFailingDay: string | null
}

/** A day counts toward the window only when clean AND it actually ran. */
function isCountingDay(result: ObservationDayResult): boolean {
  return result.ok && result.hasSuccessfulRun
}

/**
 * Summarize a sequence of observed days into a trailing-streak window result.
 * `requiredConsecutiveDays` defaults to 14 per TT-SD-017.
 */
export function summarizeSelectiveDiscoveryObservationWindow(
  results: ObservationDayResult[],
  options: { requiredConsecutiveDays?: number } = {},
): ObservationWindowSummary {
  const requiredConsecutiveDays = options.requiredConsecutiveDays ?? 14
  const ordered = [...results].sort((a, b) => a.utcDay.localeCompare(b.utcDay))

  let consecutivePassingDays = 0
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (isCountingDay(ordered[i])) consecutivePassingDays += 1
    else break
  }

  const firstFailing = ordered.find(result => !isCountingDay(result))

  return {
    requiredConsecutiveDays,
    totalObservedDays: ordered.length,
    consecutivePassingDays,
    windowSatisfied: consecutivePassingDays >= requiredConsecutiveDays,
    firstDay: ordered[0]?.utcDay ?? null,
    lastDay: ordered[ordered.length - 1]?.utcDay ?? null,
    firstFailingDay: firstFailing?.utcDay ?? null,
  }
}
