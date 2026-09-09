/**
 * C5 Account Engagement — Phase 3: recompute an account's engagement score +
 * fit grade from its intent signals.
 *
 * Pure (no Prisma) — composes the slice-1 calculators so the cron and any
 * future on-demand trigger share one definition:
 *   • engagementScore ← calculateAccountScore (time-decayed signal weights)
 *   • grade           ← calculateAccountGrade (ICP / band / industry / revenue)
 * and derives the per-kind signalCounts + lastSignalAt for the snapshot.
 *
 * Defensive: signals are filtered to valid kinds, weights clamped to the
 * calculator's accepted 1..100, and future-dated signals dropped — so one bad
 * row can't error a whole batch.
 */
import { calculateAccountScore } from "./account-score-calculator"
import { calculateAccountGrade } from "./account-grade-calculator"
import { SIGNAL_KINDS } from "./types"
import type {
  SignalKind,
  IcpTier,
  EmployeeBand,
  Grade,
  ScoreSignal,
} from "./types"
import type { AccountGradeWeights } from "./config-loader"

const VALID_KINDS = new Set<string>(SIGNAL_KINDS)

export interface RecomputeAccountInput {
  icpTier: string
  employeeBand: string | null
  industrySlug: string | null
  /** annualRevenueUsd as a number (caller converts the BigInt column). */
  annualRevenueUsd: number | null
}

export interface RecomputeSignal {
  signalKind: string
  weight: number
  occurredAt: Date
}

export interface RecomputeResult {
  engagementScore: number
  grade: Grade
  /** Per-kind counts of the signals considered (drives the snapshot JSON). */
  signalCounts: Record<string, number>
  /** Most recent signal time (null when the account has no signals). */
  lastSignalAt: Date | null
  rationale: string
}

export function recomputeAccount(
  account: RecomputeAccountInput,
  signals: readonly RecomputeSignal[],
  weights: Pick<AccountGradeWeights, "targetIndustries" | "disqualifiedIndustries">,
  asOf: Date,
  opts?: { halfLifeDays?: number; minRevenueUsd?: number },
): RecomputeResult {
  const asOfMs = asOf.getTime()

  // Normalise signals for the score calculator (it rejects unknown kinds,
  // weight 0 / >100, and future-dated signals — so guard here).
  const scoreSignals: ScoreSignal[] = []
  const signalCounts: Record<string, number> = {}
  let lastSignalAt: Date | null = null

  for (const s of signals) {
    if (!VALID_KINDS.has(s.signalKind)) continue
    if (!(s.occurredAt instanceof Date) || !Number.isFinite(s.occurredAt.getTime())) continue
    if (s.occurredAt.getTime() > asOfMs) continue

    signalCounts[s.signalKind] = (signalCounts[s.signalKind] ?? 0) + 1
    if (!lastSignalAt || s.occurredAt > lastSignalAt) lastSignalAt = s.occurredAt

    const weight = Math.min(100, Math.max(1, Math.round(s.weight)))
    scoreSignals.push({
      signalKind: s.signalKind as SignalKind,
      weight,
      occurredAt: s.occurredAt,
    })
  }

  const scoreRes = calculateAccountScore({
    signals: scoreSignals,
    asOf,
    halfLifeDays: opts?.halfLifeDays,
  })
  const engagementScore = scoreRes.ok ? scoreRes.breakdown.score : 0

  const gradeRes = calculateAccountGrade({
    icpTier: account.icpTier as IcpTier,
    employeeBand: account.employeeBand as EmployeeBand | null,
    industrySlug: account.industrySlug,
    targetIndustries: weights.targetIndustries,
    disqualifiedIndustries: weights.disqualifiedIndustries,
    annualRevenueUsd: account.annualRevenueUsd,
    minRevenueUsd: opts?.minRevenueUsd,
  })
  const grade: Grade = gradeRes.ok ? gradeRes.breakdown.grade : "unassigned"

  const rationale = scoreRes.ok
    ? `score=${engagementScore} from ${scoreRes.breakdown.signalCount} signal(s) ` +
      `(${scoreRes.breakdown.droppedAncientSignals} aged out); grade=${grade}`
    : `score error: ${scoreRes.error}; grade=${grade}`

  return { engagementScore, grade, signalCounts, lastSignalAt, rationale }
}
