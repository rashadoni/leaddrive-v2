/**
 * Projects group aggregator — NEW. Ranks project managers on delivery.
 *
 * volume        = projects managed (active + completed, excludes cancelled)
 * attainmentPct = on-time delivery % among completed projects
 *                 (actualEndDate ≤ endDate). Fallback when no completed project
 *                 had a planned endDate: completion rate (completed / managed).
 *
 * Window: a project counts as "completed in period" when its actualEndDate
 * falls in the window; `managed` is lifetime-to-date (the manager still owns
 * in-flight projects regardless of period).
 */
import { prisma } from "@/lib/prisma"
import {
  DEFAULT_STATUS_THRESHOLDS,
  type LeaderboardPeriod,
  type NormalizedAgent,
  periodStart,
  round1,
  statusFromAttainment,
  type StatusThresholds,
} from "./types"

export interface ProjectRow {
  managerId: string | null
  status: string
  endDate: Date | null
  actualEndDate: Date | null
  actualStartDate: Date | null
}

const DAY_MS = 86_400_000

export function buildProjectAgents(
  managers: { id: string; name: string; avatar: string | null }[],
  projects: ProjectRow[],
  windowStart: Date | undefined,
  now: Date = new Date(),
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): NormalizedAgent[] {
  const byManager = new Map<string, ProjectRow[]>()
  for (const p of projects) {
    if (!p.managerId) continue
    const arr = byManager.get(p.managerId) ?? []
    arr.push(p)
    byManager.set(p.managerId, arr)
  }

  const agents = managers.map((m) => {
    const rows = byManager.get(m.id) ?? []
    const managed = rows.filter((r) => r.status !== "cancelled").length

    const completedInWindow = rows.filter(
      (r) =>
        r.status === "completed" &&
        r.actualEndDate != null &&
        (!windowStart || r.actualEndDate >= windowStart),
    )
    const completed = completedInWindow.length

    const withPlan = completedInWindow.filter((r) => r.endDate != null)
    const onTime = withPlan.filter((r) => (r.actualEndDate as Date) <= (r.endDate as Date)).length
    const onTimeDelivery = withPlan.length > 0 ? round1((onTime / withPlan.length) * 100) : null

    const completionRate = managed > 0 ? round1((completed / managed) * 100) : 0
    const attainmentPct = onTimeDelivery ?? completionRate

    const overdue = rows.filter(
      (r) => r.status !== "completed" && r.status !== "cancelled" && r.endDate != null && r.endDate < now,
    ).length

    const durations = completedInWindow
      .filter((r) => r.actualStartDate != null && r.actualEndDate != null)
      .map((r) => ((r.actualEndDate as Date).getTime() - (r.actualStartDate as Date).getTime()) / DAY_MS)
      .filter((d) => d >= 0)
    const avgDurationDays = durations.length > 0 ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

    return {
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      rank: 0,
      volume: managed,
      volumeFormat: "count" as const,
      attainmentPct,
      status: statusFromAttainment(attainmentPct, thresholds),
      metrics: [
        { key: "completed", value: completed, format: "count" as const },
        { key: "totalManaged", value: managed, format: "count" as const },
        { key: "onTimeDelivery", value: onTimeDelivery ?? completionRate, format: "percent" as const },
        { key: "overdue", value: overdue, format: "count" as const },
        { key: "avgDurationDays", value: avgDurationDays, format: "days" as const },
      ],
    }
  })

  agents.sort((a, b) => b.attainmentPct - a.attainmentPct || b.volume - a.volume)
  return agents.map((a, i) => ({ ...a, rank: i + 1 }))
}

export async function computeProjectsLeaderboard(
  orgId: string,
  period: LeaderboardPeriod,
  now: Date = new Date(),
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
  timezone?: string,
): Promise<NormalizedAgent[]> {
  const windowStart = periodStart(period, now, timezone)

  const projects = (await prisma.project.findMany({
    where: { organizationId: orgId, managerId: { not: null } },
    select: {
      managerId: true,
      status: true,
      endDate: true,
      actualEndDate: true,
      actualStartDate: true,
      manager: { select: { id: true, name: true, avatar: true } },
    },
  })) as (ProjectRow & { manager: { id: string; name: string; avatar: string | null } | null })[]
  if (projects.length === 0) return []

  const managers = new Map<string, { id: string; name: string; avatar: string | null }>()
  for (const p of projects) {
    if (p.manager) managers.set(p.manager.id, p.manager)
  }

  return buildProjectAgents([...managers.values()], projects, windowStart, now, thresholds)
}
