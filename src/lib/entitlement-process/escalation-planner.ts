/**
 * B10 escalation-planner — slice-1 pure helper.
 *
 * Given a milestone's overdueAt + current escalation level + ladder
 * config, plan which escalation steps should fire NOW and what's next.
 *
 * Pure function: no DB.
 *
 * The ladder defines a sequence of escalation steps, each with a delay
 * (in seconds) after the milestone went overdue. Slice-1 helper just
 * computes which level(s) should fire as of NOW — slice-2 cron worker
 * actually performs the side-effects (notify, page, etc.) and updates
 * `escalationLevel` + `lastEscalatedAt`.
 *
 * Multiple levels may fire in one tick if cron is delayed (e.g. cron
 * was paused for 10h and ladder has 3 levels at 30m/2h/8h — all three
 * would fire at once on the next tick). toFireNow contains all such
 * levels in order.
 */

import {
  DEFAULT_ESCALATION_LADDER,
  MILESTONE_TYPES,
  SEVERITY_TIERS,
  SUPPORT_LEVELS,
  type EscalationLevelConfig,
  type EscalationPlanInput,
  type EscalationPlanResult,
  type EscalationStep,
  type MilestoneType,
  type SeverityTier,
  type SupportLevel,
} from "./types"

/**
 * Build the escalation plan.
 *
 * Behavior:
 *   • overdueAt = null → no escalation needed. Empty plan.
 *   • currentLevel >= ladder.length → all steps already fired. Empty plan.
 *   • toFireNow contains every step at level > currentLevel where
 *     fireAt <= asOf. Sorted by level ASC for stable application.
 *   • `next` is the first ladder step with level > currentLevel that
 *     hasn't fired yet (slice-2 UI shows "next escalation at …").
 */
export function planEscalation(
  input: EscalationPlanInput,
): EscalationPlanResult {
  const ladder = normalizeLadder(input.ladder)
  const allSteps: EscalationStep[] = []
  const toFireNow: EscalationStep[] = []
  let next: EscalationStep | null = null

  if (input.overdueAt === null) {
    return {
      toFireNow,
      next: null,
      allSteps: ladder.map((cfg) => ({
        level: cfg.level,
        shouldFire: false,
        // fireAt placeholder — caller knows overdueAt is null.
        fireAt: new Date(0),
        action: cfg.action,
      })),
    }
  }

  const overdueMs = input.overdueAt.getTime()
  const asOfMs = input.asOf.getTime()
  const currentLevel = Math.max(0, Math.floor(input.currentLevel))

  for (const cfg of ladder) {
    const fireAt = new Date(overdueMs + cfg.delaySeconds * 1000)
    const shouldFire =
      cfg.level > currentLevel && fireAt.getTime() <= asOfMs
    const step: EscalationStep = {
      level: cfg.level,
      shouldFire,
      fireAt,
      action: cfg.action,
    }
    allSteps.push(step)
    if (shouldFire) {
      toFireNow.push(step)
    } else if (cfg.level > currentLevel && next === null) {
      // First non-fired future step.
      next = step
    }
  }

  // Sort toFireNow by level ASC for stable processing.
  toFireNow.sort((a, b) => a.level - b.level)

  return { toFireNow, next, allSteps }
}

/**
 * Pure helper for slice-2: given fired levels + asOf, compute the
 * effective escalation summary for UI display.
 */
export function summarizeEscalation(
  result: EscalationPlanResult,
): {
  firedCount: number
  /**
   * Steps strictly AFTER `next` that haven't fired yet. `next` is
   * exposed separately as `nextActionAt`. Architect pass-1 fix:
   * previously this used `>= next.level` which double-counted `next`.
   */
  upcomingCount: number
  nextActionAt: Date | null
} {
  const firedCount = result.toFireNow.length
  const upcomingCount =
    result.next === null
      ? 0
      : result.allSteps.filter(
          (s) => !s.shouldFire && s.level > result.next!.level,
        ).length
  return {
    firedCount,
    upcomingCount,
    nextActionAt: result.next?.fireAt ?? null,
  }
}

// ── Type guards ─────────────────────────────────────────────────

export function isMilestoneType(value: unknown): value is MilestoneType {
  return (
    typeof value === "string" &&
    MILESTONE_TYPES.includes(value as MilestoneType)
  )
}

export function isSeverityTier(value: unknown): value is SeverityTier {
  return (
    typeof value === "string" &&
    SEVERITY_TIERS.includes(value as SeverityTier)
  )
}

export function isSupportLevel(value: unknown): value is SupportLevel {
  return (
    typeof value === "string" &&
    SUPPORT_LEVELS.includes(value as SupportLevel)
  )
}

// ── Internals ───────────────────────────────────────────────────

function normalizeLadder(
  ladder: ReadonlyArray<EscalationLevelConfig> | undefined,
): ReadonlyArray<EscalationLevelConfig> {
  if (!ladder || ladder.length === 0) return DEFAULT_ESCALATION_LADDER
  // Filter defensively + sort by level ASC.
  const valid = ladder
    .filter(
      (cfg) =>
        typeof cfg.level === "number" &&
        Number.isInteger(cfg.level) &&
        cfg.level > 0 &&
        typeof cfg.delaySeconds === "number" &&
        Number.isFinite(cfg.delaySeconds) &&
        cfg.delaySeconds >= 0,
    )
    .sort((a, b) => a.level - b.level)
  if (valid.length === 0) return DEFAULT_ESCALATION_LADDER
  return valid
}
