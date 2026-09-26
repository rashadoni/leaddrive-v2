import { combineMtmDayRoutes } from "@/lib/mtm/live-field-status"
import { mtmManagerWorkdayState, type MtmManagerWorkdayState } from "@/lib/mtm/workday-open-anomaly"

/**
 * The Panel's default view for a supervisor: the scoped team, today.
 *
 * Prod 2026-09-14: /mtm opened blank — «Həftə məlumatlarını yükləmək üçün
 * işçi seçin» — and the hint above it told the office manager to "complete
 * visits". A manager opens the Panel to see who is out, how far along the
 * routes are, and where something went wrong. One row per person answers
 * that; a click opens the existing per-agent week.
 *
 * Pure: the route does the (bulk, scoped) reads, this shapes them.
 */

export type MtmTeamTodayInput = {
  now: Date
  todayKey: string
  workforceEnabled: boolean
  agents: ReadonlyArray<{ id: string; name: string; team?: { id: string; name: string } | null }>
  latestLocations: ReadonlyArray<{ agentId: string; recordedAt: Date }>
  routes: ReadonlyArray<{
    agentId: string
    status: string
    totalPoints: number
    visitedPoints: number
    /** The first stop still pending, in route order (at most one per route). */
    points?: ReadonlyArray<{ orderIndex: number; plannedTime: Date | null; customer?: { name: string | null } | null }>
  }>
  visits: ReadonlyArray<{
    id: string
    agentId: string
    status: string
    checkInAt: Date
    checkOutAt: Date | null
    customer?: { name: string | null } | null
  }>
  openAlertCounts: ReadonlyArray<{ agentId: string; count: number }>
  workdays: ReadonlyArray<{
    agentId: string
    status: string
    workDate: Date
    startedAt: Date | null
    pausedAt: Date | null
    completedAt: Date | null
  }>
}

export type MtmTeamTodayRow = {
  agent: { id: string; name: string; teamName: string | null }
  lastGpsAt: string | null
  route: { visited: number; total: number; state: "FINISHED" | "ACTIVE" | "NOT_STARTED" } | null
  /** The newest {@link MTM_TEAM_TODAY_VISITS_PER_ROW} visits, shown in time order. */
  visits: Array<{ id: string; customerName: string | null; status: string; checkInAt: string; checkOutAt: string | null }>
  /** All of today's visits read for this agent; `visitCount - visits.length` is the "+N". */
  visitCount: number
  openAlerts: number
  workday: MtmManagerWorkdayState | null
  /**
   * Where the agent is headed next: the first pending stop of today's
   * published route (owner 2026-09-22: «кто куда собирается»).
   */
  nextStop: { customerName: string | null; plannedAt: string | null } | null
}

/** Visits per row in the table; the per-agent week holds the rest. */
export const MTM_TEAM_TODAY_VISITS_PER_ROW = 6

function dateKeyOf(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function buildMtmTeamTodayRows(input: MtmTeamTodayInput): MtmTeamTodayRow[] {
  const latestByAgent = new Map<string, Date>()
  for (const location of input.latestLocations) {
    const current = latestByAgent.get(location.agentId)
    if (!current || location.recordedAt > current) latestByAgent.set(location.agentId, location.recordedAt)
  }
  const routesByAgent = new Map<string, Array<MtmTeamTodayInput["routes"][number]>>()
  for (const route of input.routes) {
    routesByAgent.set(route.agentId, [...(routesByAgent.get(route.agentId) ?? []), route])
  }
  const visitsByAgent = new Map<string, Array<MtmTeamTodayInput["visits"][number]>>()
  for (const visit of input.visits) {
    visitsByAgent.set(visit.agentId, [...(visitsByAgent.get(visit.agentId) ?? []), visit])
  }
  const alertsByAgent = new Map(input.openAlertCounts.map((row) => [row.agentId, row.count]))
  const workdaysByAgent = new Map<string, Array<MtmTeamTodayInput["workdays"][number]>>()
  for (const workday of input.workdays) {
    workdaysByAgent.set(workday.agentId, [...(workdaysByAgent.get(workday.agentId) ?? []), workday])
  }

  return input.agents.map((agent) => {
    const combined = combineMtmDayRoutes(routesByAgent.get(agent.id) ?? [])
    // Review of #210: keeping the FIRST six showed a 17:00 manager only the
    // morning. Keep the newest six, then show them in time order.
    const allVisits = [...(visitsByAgent.get(agent.id) ?? [])]
      .sort((left, right) => right.checkInAt.getTime() - left.checkInAt.getTime() || right.id.localeCompare(left.id))
    const visits = allVisits.slice(0, MTM_TEAM_TODAY_VISITS_PER_ROW).reverse()
    const days = workdaysByAgent.get(agent.id) ?? []
    const today = days.find((day) => dateKeyOf(day.workDate) === input.todayKey) ?? null
    const active = days
      .filter((day) => day.status === "STARTED" || day.status === "PAUSED")
      .sort((left, right) => (right.startedAt?.getTime() ?? 0) - (left.startedAt?.getTime() ?? 0))[0] ?? null
    const lastGps = latestByAgent.get(agent.id) ?? null
    const pending = (routesByAgent.get(agent.id) ?? [])
      .flatMap((route) => route.points ?? [])
      .sort((left, right) =>
        (left.plannedTime?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.plannedTime?.getTime() ?? Number.MAX_SAFE_INTEGER)
        || left.orderIndex - right.orderIndex)[0] ?? null
    return {
      agent: { id: agent.id, name: agent.name, teamName: agent.team?.name ?? null },
      lastGpsAt: lastGps ? lastGps.toISOString() : null,
      route: combined ? { visited: Math.min(combined.visitedPoints, combined.totalPoints), total: combined.totalPoints, state: combined.state } : null,
      visitCount: allVisits.length,
      visits: visits.map((visit) => ({
        id: visit.id,
        customerName: visit.customer?.name ?? null,
        status: visit.status,
        checkInAt: visit.checkInAt.toISOString(),
        checkOutAt: visit.checkOutAt ? visit.checkOutAt.toISOString() : null,
      })),
      openAlerts: alertsByAgent.get(agent.id) ?? 0,
      workday: input.workforceEnabled
        ? mtmManagerWorkdayState({ today, active, now: input.now, todayKey: input.todayKey })
        : null,
      nextStop: pending
        ? { customerName: pending.customer?.name ?? null, plannedAt: pending.plannedTime ? pending.plannedTime.toISOString() : null }
        : null,
    }
  })
}

const AUDIT_DEDUPE_MAX_ENTRIES = 5_000
/**
 * Review of #210: the Panel polls every 60 s, and one audit row per poll buried
 * the reads that matter. One row per reader + scope + tenant-local day is
 * enough to answer "who looked at whose GPS, when". Per-instance memory: a
 * restart can write one more row for the same day, which errs on the side of
 * recording.
 */
const auditedTeamReads = new Set<string>()

export function rememberMtmTeamGpsRead(key: string): boolean {
  if (auditedTeamReads.has(key)) return false
  if (auditedTeamReads.size >= AUDIT_DEDUPE_MAX_ENTRIES) auditedTeamReads.clear()
  auditedTeamReads.add(key)
  return true
}

/** Test hook: forget which reads were already audited. */
export function __resetTeamReadAuditForTests(): void {
  auditedTeamReads.clear()
}
