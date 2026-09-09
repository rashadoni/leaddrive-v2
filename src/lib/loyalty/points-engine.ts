/**
 * Loyalty points engine — D8 Phase 6 Block A slice 1.
 *
 * Pure helpers for the four mutation paths on LoyaltyAccount:
 *   • earnPoints — adds to both `points` AND `lifetimePoints` (capped
 *                  to `points` increment by default; partial-vesting
 *                  flows can pass a smaller `lifetimePoints` override
 *                  for non-tier-counting earns like signup bonus).
 *   • redeemPoints — subtracts from `points` only (lifetime untouched).
 *                    Caps at current balance (no overdraft).
 *   • expirePoints — same shape as redeem; emits `expire` audit row
 *                    instead of `redeem`. Used by slice-3 cron.
 *   • adjustPoints — signed delta. Positive = credit, negative = debit.
 *                    Lifetime UNTOUCHED regardless of sign (operator
 *                    adjustments correct accounting errors, not
 *                    earn-counted activity).
 *
 * Each helper returns the audit-row inputs (`type`, `delta`,
 * `lifetimeDelta`) AND the next balance — caller writes both inside
 * a transaction.
 */
import {
  LOYALTY_TYPE_RULES,
  type EarnPointsInput,
  type ExpirePointsInput,
  type RedeemPointsInput,
  type AdjustPointsInput,
  type PointsBalance,
  type PointsMutationResult,
} from "./types"

function validatePositiveInt(n: number, label: string): string | null {
  if (!Number.isInteger(n)) return `${label}: must be an integer; got ${n}`
  if (n <= 0) return `${label}: must be > 0; got ${n}`
  return null
}

function validateBalance(b: PointsBalance, label: string): string | null {
  if (!Number.isInteger(b.points)) return `${label}: balance.points not integer`
  if (!Number.isInteger(b.lifetimePoints)) return `${label}: balance.lifetimePoints not integer`
  if (b.points < 0) return `${label}: balance.points negative`
  if (b.lifetimePoints < 0) return `${label}: balance.lifetimePoints negative`
  if (b.lifetimePoints < b.points) {
    return `${label}: corrupted balance — lifetimePoints (${b.lifetimePoints}) < points (${b.points})`
  }
  return null
}

/* ─── earn ────────────────────────────────────────────────────────────── */

export function earnPoints(input: EarnPointsInput): PointsMutationResult {
  const { current, points } = input

  const ptsErr = validatePositiveInt(points, "earnPoints")
  if (ptsErr) return { ok: false, error: ptsErr }
  const balErr = validateBalance(current, "earnPoints")
  if (balErr) return { ok: false, error: balErr }

  // Default: full lifetime contribution (lifetimePoints += points).
  // Override path: caller passes a smaller value for non-tier-counting
  // earns (signup bonus, referral credit, etc.).
  const lifetimeContribution = input.lifetimePoints ?? points
  if (
    !Number.isInteger(lifetimeContribution) ||
    lifetimeContribution < 0 ||
    lifetimeContribution > points
  ) {
    return {
      ok: false,
      error: `earnPoints: lifetimePoints override ${lifetimeContribution} must be 0..${points}`,
    }
  }

  // Note: lifetimeContribution = 0 IS a valid (non-tier-counting earn)
  // but the DB CHECK `loyalty_transactions_lifetime_coherence_check`
  // requires `lifetimeDelta > 0` for type='earn'. We forbid the
  // zero-lifetime earn at the helper boundary so the audit-row write
  // never violates the CHECK. Slice-2 may introduce a separate
  // `earn_non_vesting` type if real demand emerges.
  if (lifetimeContribution === 0) {
    return {
      ok: false,
      error: `earnPoints: lifetimeContribution=0 is invalid — use adjustment_credit for non-vesting credits`,
    }
  }

  const next: PointsBalance = {
    points: current.points + points,
    lifetimePoints: current.lifetimePoints + lifetimeContribution,
  }
  return {
    ok: true,
    next,
    type: "earn",
    delta: points,
    lifetimeDelta: lifetimeContribution,
  }
}

/* ─── redeem ──────────────────────────────────────────────────────────── */

export function redeemPoints(input: RedeemPointsInput): PointsMutationResult {
  const { current, points } = input

  const ptsErr = validatePositiveInt(points, "redeemPoints")
  if (ptsErr) return { ok: false, error: ptsErr }
  const balErr = validateBalance(current, "redeemPoints")
  if (balErr) return { ok: false, error: balErr }

  if (points > current.points) {
    return {
      ok: false,
      error: `redeemPoints: requested ${points} but only ${current.points} available`,
    }
  }

  const next: PointsBalance = {
    points: current.points - points,
    lifetimePoints: current.lifetimePoints, // never decrement
  }
  return {
    ok: true,
    next,
    type: "redeem",
    delta: -points, // signed: negative
    lifetimeDelta: 0,
  }
}

/* ─── expire ──────────────────────────────────────────────────────────── */

export function expirePoints(input: ExpirePointsInput): PointsMutationResult {
  const { current, points } = input

  const ptsErr = validatePositiveInt(points, "expirePoints")
  if (ptsErr) return { ok: false, error: ptsErr }
  const balErr = validateBalance(current, "expirePoints")
  if (balErr) return { ok: false, error: balErr }

  if (points > current.points) {
    return {
      ok: false,
      error: `expirePoints: tried to expire ${points} but only ${current.points} on balance`,
    }
  }

  const next: PointsBalance = {
    points: current.points - points,
    lifetimePoints: current.lifetimePoints, // never decrement
  }
  // Type/sign rule check from the registry — defense in depth.
  if (LOYALTY_TYPE_RULES.expire.touchesLifetime) {
    return { ok: false, error: "expirePoints: registry corrupted — expire should not touch lifetime" }
  }
  return {
    ok: true,
    next,
    type: "expire",
    delta: -points,
    lifetimeDelta: 0,
  }
}

/* ─── adjust ──────────────────────────────────────────────────────────── */

export function adjustPoints(input: AdjustPointsInput): PointsMutationResult {
  const { current, delta } = input

  if (!Number.isInteger(delta)) {
    return { ok: false, error: `adjustPoints: delta must be an integer; got ${delta}` }
  }
  if (delta === 0) {
    return { ok: false, error: "adjustPoints: delta=0 is a no-op; zero-delta audit rows not allowed" }
  }
  const balErr = validateBalance(current, "adjustPoints")
  if (balErr) return { ok: false, error: balErr }

  if (delta < 0 && Math.abs(delta) > current.points) {
    return {
      ok: false,
      error: `adjustPoints: debit ${Math.abs(delta)} exceeds balance ${current.points}`,
    }
  }

  const next: PointsBalance = {
    points: current.points + delta,
    lifetimePoints: current.lifetimePoints, // adjustments NEVER touch lifetime
  }
  return {
    ok: true,
    next,
    type: delta > 0 ? "adjustment_credit" : "adjustment_debit",
    delta,
    lifetimeDelta: 0,
  }
}
