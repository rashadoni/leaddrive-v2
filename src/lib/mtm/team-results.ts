/**
 * The manager's view of «Аналитика» (owner 2026-09-26: «аналитика нужна для
 * менеджеров»). The page opened on a formula registry — «версионный расчёт»,
 * «формула не утверждена», «числитель ÷ знаменатель» — and kept the numbers a
 * manager reads under a folded «Операционный обзор» headed «KPI Mars», counted
 * by a second, older formula on the server's clock.
 *
 * These rows are the registry's own facts (GET /api/v1/mtm/kpi, drilldown)
 * grouped by agent, so the manager's numbers and the auditable ones cannot
 * disagree: there is one calculation, shown two ways.
 */
type PlanFact = { agentId: string; agentName: string; completed: boolean }
type VisitFact = { agentId: string; agentName: string; gpsConfirmed: boolean }

export type MtmTeamResultsRow = {
  agentId: string
  agentName: string
  /** Planned stops of published routes in the period, and how many were visited. */
  planned: number
  done: number
  /** null when the agent had no plan — «0 %» would read as a failure. */
  planPercent: number | null
  /** Completed visits, and how many carry check-in and check-out coordinates. */
  visits: number
  withGps: number
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

export function mtmTeamResultsByAgent(drilldown: { planDenominator: readonly PlanFact[]; gpsDenominator: readonly VisitFact[] }): MtmTeamResultsRow[] {
  const rows = new Map<string, MtmTeamResultsRow>()
  const rowOf = (agentId: string, agentName: string) => {
    let row = rows.get(agentId)
    if (!row) {
      row = { agentId, agentName, planned: 0, done: 0, planPercent: null, visits: 0, withGps: 0 }
      rows.set(agentId, row)
    }
    return row
  }
  for (const point of drilldown.planDenominator) {
    const row = rowOf(point.agentId, point.agentName)
    row.planned += 1
    if (point.completed) row.done += 1
  }
  for (const visit of drilldown.gpsDenominator) {
    const row = rowOf(visit.agentId, visit.agentName)
    row.visits += 1
    if (visit.gpsConfirmed) row.withGps += 1
  }
  // Who is behind first: that is what the manager opens the page for. Agents
  // without a plan go last — there is nothing to be behind on.
  return [...rows.values()]
    .map((row) => ({ ...row, planPercent: percent(row.done, row.planned) }))
    .sort((a, b) => {
      if (a.planPercent === null || b.planPercent === null) {
        if (a.planPercent !== b.planPercent) return a.planPercent === null ? 1 : -1
      } else if (a.planPercent !== b.planPercent) {
        return a.planPercent - b.planPercent
      }
      return a.agentName.localeCompare(b.agentName)
    })
}

/** Green from 95 %, amber from 80 %, red below — the same bands for every row. */
export function mtmPlanTone(planPercent: number | null): "good" | "warn" | "bad" | "none" {
  if (planPercent === null) return "none"
  if (planPercent >= 95) return "good"
  if (planPercent >= 80) return "warn"
  return "bad"
}
