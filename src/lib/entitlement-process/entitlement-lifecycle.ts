/**
 * B10 entitlement-lifecycle — slice-1 pure helper.
 *
 * State-machine + validity-window logic for entitlement rows.
 *
 *   isEntitlementHonored() — is the entitlement actively enforceable RIGHT NOW?
 *   canTransitionEntitlementStatus() — mirror of DB lifecycle trigger
 *   shouldAutoExpire() — slice-2 cron uses this to flip active → expired
 *
 * Pure function: no DB.
 */

import {
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_STATUS_TRANSITIONS,
  SUPPORT_LEVELS,
  type EntitlementStatus,
  type EntitlementValidityInput,
  type EntitlementValidityResult,
  type SupportLevel,
} from "./types"

/**
 * Decide if an entitlement is honored at a point in time.
 *
 * Honored = status === 'active' AND validFrom <= asOf < validTo
 * (or validTo is null = open-ended).
 *
 * Returns a structured result with diagnostic `reason` for slice-2 UI.
 */
export function isEntitlementHonored(
  input: EntitlementValidityInput,
): EntitlementValidityResult {
  const { entitlement, asOf } = input
  const asOfMs = asOf.getTime()
  const fromMs = entitlement.validFrom.getTime()
  const toMs = entitlement.validTo?.getTime() ?? null

  // Architect pass-1 fix: for terminal/non-active statuses,
  // `secondsUntilExpiry` is meaningless — return null instead of
  // negative seconds (which slice-2 UI would render as "expires in
  // -5184000 seconds"). For active+open-ended (toMs null), still null.
  // For active+in-window, compute the positive countdown.
  const secondsUntilExpiry =
    entitlement.status === "active" && toMs !== null && asOfMs < toMs
      ? Math.round((toMs - asOfMs) / 1000)
      : null

  if (entitlement.status === "draft") {
    return { isHonored: false, reason: "draft", secondsUntilExpiry: null }
  }
  if (entitlement.status === "suspended") {
    return { isHonored: false, reason: "suspended", secondsUntilExpiry: null }
  }
  if (entitlement.status === "cancelled") {
    return { isHonored: false, reason: "cancelled", secondsUntilExpiry: null }
  }
  if (entitlement.status === "expired") {
    return { isHonored: false, reason: "expired", secondsUntilExpiry: null }
  }
  // status === 'active'
  if (asOfMs < fromMs) {
    // Not yet started — secondsUntilExpiry doesn't make sense; expose
    // the countdown via a different field in slice-2 if needed.
    return { isHonored: false, reason: "not_yet_active", secondsUntilExpiry: null }
  }
  if (toMs !== null && asOfMs >= toMs) {
    return {
      isHonored: false,
      reason: "outside_validity_window",
      secondsUntilExpiry: null,
    }
  }
  return { isHonored: true, reason: "honored", secondsUntilExpiry }
}

/**
 * Slice-2 cron uses this nightly: returns true if the entitlement is
 * `active` but its `validTo` is in the past — meaning the cron should
 * transition to `expired` and set expiredAt.
 */
export function shouldAutoExpire(
  entitlement: { status: EntitlementStatus; validTo: Date | null },
  asOf: Date,
): boolean {
  if (entitlement.status !== "active") return false
  if (entitlement.validTo === null) return false
  return entitlement.validTo.getTime() <= asOf.getTime()
}

// ── State machine helpers ───────────────────────────────────────

export function isEntitlementStatus(
  value: unknown,
): value is EntitlementStatus {
  return (
    typeof value === "string" &&
    ENTITLEMENT_STATUSES.includes(value as EntitlementStatus)
  )
}

export function canTransitionEntitlementStatus(
  current: EntitlementStatus,
  next: EntitlementStatus,
): boolean {
  if (current === next) return true
  return ENTITLEMENT_STATUS_TRANSITIONS[current].includes(next)
}

export function isSupportLevel(value: unknown): value is SupportLevel {
  return (
    typeof value === "string" && SUPPORT_LEVELS.includes(value as SupportLevel)
  )
}
