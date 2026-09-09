/**
 * Care plan progress calculator — R2 slice 1.
 *
 * Given a CarePlan's goals + per-source observations from the caller,
 * compute progress per goal and aggregate to an overall %.
 *
 * Observation semantics:
 *   • Caller (slice-2 worker) queries medical records / medication
 *     adherence stats from DB and passes per-kpiSource numeric values.
 *   • This helper does NOT touch DB — it's pure arithmetic.
 *
 * Progress arithmetic:
 *   • gte (e.g. "≥ 10 visits"):
 *       progressPct = clamp(observed / target * 100, 0, 100)
 *       met = observed ≥ target
 *   • lte (e.g. "≤ 3 missed doses"):
 *       progressPct = clamp((1 − observed / target) * 100, 0, 100)
 *       met = observed ≤ target
 *       — when target == 0, observed == 0 ⇒ 100, observed > 0 ⇒ 0
 *   • eq (e.g. "exactly 4 follow-ups"):
 *       met = observed == target
 *       progressPct = met ? 100 : 0
 *
 * Drift guards:
 *   • Unknown comparator → ok:false
 *   • Non-finite numbers → ok:false
 *   • Negative target / observed → ok:false (semantically clinical
 *     metrics are non-negative; if a real metric is signed, slice-2
 *     adjusts here)
 *   • Empty goals → overallPct = NaN (caller decides UI text)
 *   • Duplicate goal ids → ok:false (would conflate progress)
 */
import {
  GOAL_COMPARATORS,
  GOAL_KPI_SOURCES,
  type CarePlanGoal,
  type CarePlanProgressInput,
  type CarePlanProgressResult,
  type GoalKpiSource,
  type GoalProgress,
} from "./types"

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

/**
 * Walk goals + observations → per-goal progress + overall %.
 *
 * `goals` is read-only; this helper never mutates input. Caller is free
 * to share the same `goals` array across multiple computes.
 */
export function calculateCarePlanProgress(
  input: CarePlanProgressInput
): CarePlanProgressResult {
  if (!Array.isArray(input.goals)) {
    return { ok: false, error: "goals must be an array" }
  }

  // Duplicate-id guard
  const seenIds = new Set<string>()
  for (const g of input.goals) {
    if (
      g === null ||
      typeof g !== "object" ||
      typeof g.id !== "string" ||
      g.id.length === 0
    ) {
      return { ok: false, error: "every goal must have a non-empty string id" }
    }
    if (seenIds.has(g.id)) {
      return { ok: false, error: `duplicate goal id "${g.id}"` }
    }
    seenIds.add(g.id)
  }

  const perGoal: GoalProgress[] = []
  let goalsMet = 0

  for (const goal of input.goals) {
    const validatedGoal = validateCarePlanGoal(goal)
    if (!validatedGoal.ok) {
      return { ok: false, error: validatedGoal.error }
    }
    // validateGoal narrows the runtime shape; index the observations
    // bag through the validated literal-union type.
    const kpiSource: GoalKpiSource = goal.kpiSource
    const observed = input.observations[kpiSource]
    if (!isFiniteNonNegative(observed)) {
      return {
        ok: false,
        error: `observation for kpiSource "${kpiSource}" must be a finite non-negative number; got ${String(observed)}`,
      }
    }

    let met = false
    let progressPct = 0

    switch (goal.comparator) {
      case "gte": {
        if (goal.targetValue === 0) {
          // Trivially met at zero target — observed ≥ 0 always true.
          met = true
          progressPct = 100
        } else {
          met = observed >= goal.targetValue
          progressPct = clamp((observed / goal.targetValue) * 100, 0, 100)
        }
        break
      }
      case "lte": {
        if (goal.targetValue === 0) {
          met = observed === 0
          progressPct = met ? 100 : 0
        } else {
          met = observed <= goal.targetValue
          // For lte, lower observed = higher progress.
          progressPct = clamp(
            (1 - observed / goal.targetValue) * 100,
            0,
            100
          )
        }
        break
      }
      case "eq": {
        met = observed === goal.targetValue
        progressPct = met ? 100 : 0
        break
      }
      default:
        // exhaustive check — unreachable thanks to validateGoal
        return {
          ok: false,
          error: `unknown comparator "${String(goal.comparator)}"`,
        }
    }

    if (met) goalsMet += 1
    perGoal.push({
      goalId: goal.id,
      observedValue: observed,
      targetValue: goal.targetValue,
      comparator: goal.comparator,
      met,
      progressPct,
    })
  }

  const goalsTotal = input.goals.length
  const overallPct =
    goalsTotal === 0
      ? Number.NaN
      : perGoal.reduce((sum, p) => sum + p.progressPct, 0) / goalsTotal

  return {
    ok: true,
    summary: { perGoal, overallPct, goalsMet, goalsTotal },
  }
}

/**
 * Validate one care-plan goal entry. Exported so slice-2-mini routes
 * can pre-check JSON payloads before the INSERT/UPDATE — schema-level
 * `goals` column is generic JSONB and the per-row shape check lives
 * here, not at the DB layer.
 */
export function validateCarePlanGoal(
  goal: CarePlanGoal
): { ok: true } | { ok: false; error: string } {
  if (typeof goal.label !== "string" || goal.label.length === 0) {
    return { ok: false, error: `goal "${goal.id}": label must be non-empty` }
  }
  if (typeof goal.metric !== "string" || goal.metric.length === 0) {
    return { ok: false, error: `goal "${goal.id}": metric must be non-empty` }
  }
  if (!isFiniteNonNegative(goal.targetValue)) {
    return {
      ok: false,
      error: `goal "${goal.id}": targetValue must be a finite non-negative number`,
    }
  }
  if (!(GOAL_COMPARATORS as readonly string[]).includes(goal.comparator)) {
    return {
      ok: false,
      error: `goal "${goal.id}": unknown comparator "${String(goal.comparator)}"`,
    }
  }
  if (!(GOAL_KPI_SOURCES as readonly string[]).includes(goal.kpiSource)) {
    return {
      ok: false,
      error: `goal "${goal.id}": unknown kpiSource "${String(goal.kpiSource)}"`,
    }
  }
  return { ok: true }
}
