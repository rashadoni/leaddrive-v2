/**
 * Quota engine — pure functions for sales quota attainment, pacing, and
 * leaderboard ranking. Consumed by `/api/v1/sales-quotas/*` routes.
 *
 * Part of A4 Quota Management deep + leaderboards (Phase 1 roadmap).
 *
 * Design: this file is intentionally Prisma-free. Routes fetch raw quota +
 * won-deal data and pass it in; engine returns enriched views. Keeps unit
 * tests trivial and the math auditable in isolation.
 */

export type AttainmentStatus =
  | "exceeding" // ≥110% of pace
  | "on_track" // 90-110% of pace
  | "behind" // 70-90% of pace
  | "at_risk" // 50-70% of pace
  | "critical" // <50% of pace
  | "exceeded" // ≥100% of full quota — period locked-in win
  | "not_started" // no actual yet AND period hasn't reached threshold

export interface Quota {
  id: string
  userId: string
  year: number
  quarter: number // 1-4
  amount: number
  currency: string
}

export interface AttainmentSummary {
  quotaId: string
  userId: string
  year: number
  quarter: number
  quotaAmount: number
  actualAmount: number
  /** Attainment as percentage (0-N, can exceed 100). */
  attainmentPercent: number
  /** Currency code (mirrors quota.currency for downstream display). */
  currency: string
}

export interface PacingResult {
  /** Expected amount at this point in the period if on perfect linear pace. */
  expectedToDate: number
  /** Days elapsed in the period (0 = period not started, N = ended). */
  daysElapsed: number
  /** Total days in the period. */
  totalDays: number
  /** Linear progress through the period as fraction 0-1. */
  periodProgress: number
  /** Pace index: actual / expected. >1 = ahead of pace, <1 = behind. */
  paceIndex: number
  /** Categorised status for UI badges. */
  status: AttainmentStatus
  /** Amount by which actual falls short of pace (>0 = behind). */
  behindBy: number
}

export interface LeaderboardEntry {
  rank: number
  userId: string
  userName?: string
  quotaAmount: number
  actualAmount: number
  attainmentPercent: number
  status: AttainmentStatus
}

/* ─── Quarter boundaries ──────────────────────────────────────────────── */

/**
 * Return `[start, end]` of a calendar quarter in the given year. End is the
 * last millisecond of the period so callers can use `gte: start, lte: end`.
 */
export function quarterBoundaries(year: number, quarter: number): { start: Date; end: Date } {
  const q = Math.max(1, Math.min(4, Math.floor(quarter)))
  const startMonth = (q - 1) * 3
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0)
  // End-of-quarter = first ms of next quarter minus 1ms
  const nextStart = new Date(year, startMonth + 3, 1, 0, 0, 0, 0)
  const end = new Date(nextStart.getTime() - 1)
  return { start, end }
}

/* ─── Attainment ──────────────────────────────────────────────────────── */

export function computeAttainment(quota: Quota, actualAmount: number): AttainmentSummary {
  const attainmentPercent = quota.amount > 0
    ? Math.round((actualAmount / quota.amount) * 1000) / 10 // 1 decimal place
    : 0
  return {
    quotaId: quota.id,
    userId: quota.userId,
    year: quota.year,
    quarter: quota.quarter,
    quotaAmount: quota.amount,
    actualAmount,
    attainmentPercent,
    currency: quota.currency,
  }
}

/* ─── Pacing ──────────────────────────────────────────────────────────── */

/**
 * Compute pacing — how the user is tracking against linear expectations
 * mid-period. After the period ends, pace is locked at 1.0 (you're judged
 * on final attainment, not pace).
 */
export function computePacing(
  quota: Quota,
  actualAmount: number,
  now: Date = new Date()
): PacingResult {
  const { start, end } = quarterBoundaries(quota.year, quota.quarter)
  const totalMs = end.getTime() - start.getTime()
  const totalDays = Math.max(1, Math.round(totalMs / 86400000))

  const elapsedMs = Math.max(0, Math.min(totalMs, now.getTime() - start.getTime()))
  const daysElapsed = Math.round(elapsedMs / 86400000)
  const periodProgress = totalMs > 0 ? elapsedMs / totalMs : 0

  const expectedToDate = quota.amount * periodProgress
  const paceIndex = expectedToDate > 0 ? actualAmount / expectedToDate : (actualAmount > 0 ? Infinity : 0)
  const behindBy = Math.max(0, expectedToDate - actualAmount)

  // Status resolution — period-end takes precedence (final attainment matters)
  let status: AttainmentStatus
  const attainmentRatio = quota.amount > 0 ? actualAmount / quota.amount : 0
  if (now.getTime() >= end.getTime()) {
    status = attainmentRatio >= 1 ? "exceeded" : (attainmentRatio >= 0.7 ? "behind" : "critical")
  } else if (now.getTime() < start.getTime()) {
    status = "not_started"
  } else if (attainmentRatio >= 1) {
    // Already hit full quota mid-period
    status = "exceeded"
  } else if (paceIndex >= 1.1) {
    status = "exceeding"
  } else if (paceIndex >= 0.9) {
    status = "on_track"
  } else if (paceIndex >= 0.7) {
    status = "behind"
  } else if (paceIndex >= 0.5) {
    status = "at_risk"
  } else {
    status = "critical"
  }

  return {
    expectedToDate: Math.round(expectedToDate * 100) / 100,
    daysElapsed,
    totalDays,
    periodProgress: Math.round(periodProgress * 1000) / 1000,
    paceIndex: Number.isFinite(paceIndex) ? Math.round(paceIndex * 100) / 100 : paceIndex,
    status,
    behindBy: Math.round(behindBy * 100) / 100,
  }
}

/* ─── Leaderboard ─────────────────────────────────────────────────────── */

export interface LeaderboardInput {
  quota: Quota
  actualAmount: number
  userName?: string
}

/**
 * Rank a slice of users by attainment percent. Ties broken by actualAmount
 * descending (so a rep with $100K @ 100% ranks above $50K @ 100%). Users
 * without quotas (quotaAmount = 0) are placed at the bottom regardless of
 * actual sales — they're not "competing" in this period.
 */
export function buildLeaderboard(rows: LeaderboardInput[], now: Date = new Date()): LeaderboardEntry[] {
  const enriched = rows.map(r => {
    const summary = computeAttainment(r.quota, r.actualAmount)
    const pacing = computePacing(r.quota, r.actualAmount, now)
    return {
      userId: r.quota.userId,
      userName: r.userName,
      quotaAmount: r.quota.amount,
      actualAmount: r.actualAmount,
      attainmentPercent: summary.attainmentPercent,
      status: pacing.status,
    }
  })

  enriched.sort((a, b) => {
    // No-quota rows always last
    const aHasQ = a.quotaAmount > 0
    const bHasQ = b.quotaAmount > 0
    if (aHasQ !== bHasQ) return aHasQ ? -1 : 1
    // Primary: attainment % desc
    if (b.attainmentPercent !== a.attainmentPercent) return b.attainmentPercent - a.attainmentPercent
    // Tiebreaker: actual amount desc
    return b.actualAmount - a.actualAmount
  })

  return enriched.map((row, idx) => ({ ...row, rank: idx + 1 }))
}
