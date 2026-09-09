import { featureFlagValue } from "@/lib/modules"

/**
 * What a tenant decides about the tasks its calls create.
 *
 * Two knobs, both per organization: which board the work lands on (see
 * `salesBoard.ts` — it is the same flag the inbox already used, so nothing
 * migrates) and how long a promise gets when the customer named no date.
 *
 * The due window lives in `Organization.features` beside the board rather than
 * in a settings JSON, because value-carrying flags are how this codebase
 * already stores per-tenant choices of exactly this shape, and because one
 * storage for one settings page means one atomic write instead of two that can
 * half-fail.
 */

export const COMMITMENT_DUE_DAYS_PREFIX = "commitmentDueDays:"

/** Used when a tenant has chosen nothing. Two days, by the owner's decision. */
export const DEFAULT_COMMITMENT_DUE_DAYS = 2

/**
 * A day is the shortest window that survives a weekend badly and the longest
 * that still reads as "soon"; 30 is where a due date stops being a deadline and
 * becomes a wish. Values outside the range are a mistake, not a preference.
 */
export const MIN_COMMITMENT_DUE_DAYS = 1
export const MAX_COMMITMENT_DUE_DAYS = 30

export function isValidCommitmentDueDays(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_COMMITMENT_DUE_DAYS
    && value <= MAX_COMMITMENT_DUE_DAYS
}

/**
 * The tenant's due window in days, or the default.
 *
 * A stored value that no longer parses — hand-edited, or written by an older
 * build — falls back rather than throwing: a settings typo must never stop a
 * promise from being written down.
 */
export function commitmentDueDays(features: unknown): number {
  const raw = featureFlagValue(features, COMMITMENT_DUE_DAYS_PREFIX)
  if (!raw) return DEFAULT_COMMITMENT_DUE_DAYS
  const parsed = Number(raw)
  return isValidCommitmentDueDays(parsed) ? parsed : DEFAULT_COMMITMENT_DUE_DAYS
}
