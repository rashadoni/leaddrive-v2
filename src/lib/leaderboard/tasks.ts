/**
 * Tasks group aggregator — NEW. Ranks task assignees on delivery, merging the
 * CRM `Task` table and project-scoped `ProjectTask` table (same `assignedTo`
 * semantics). Both feed the same person's bubble.
 *
 * volume        = tasks completed in the window (→ bubble radius)
 * attainmentPct = on-time completion % among completed-with-dueDate
 *                 (completedAt ≤ dueDate). Fallback when none had a dueDate: 100
 *                 if anything was completed, else 0.
 *
 * "Completed" keys off `completedAt != null` (canonical signal — the Task.status
 * column still mixes legacy + Kanban values, see schema note). Soft-deleted
 * Tasks are excluded (`deletedAt: null`).
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

export interface CompletedTaskRow {
  assignedTo: string | null
  completedAt: Date | null
  dueDate: Date | null
}

export function buildTaskAgents(
  users: { id: string; name: string; avatar: string | null }[],
  completed: CompletedTaskRow[],
  overdueByUser: Map<string, number>,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): NormalizedAgent[] {
  const byUser = new Map<string, CompletedTaskRow[]>()
  for (const t of completed) {
    if (!t.assignedTo) continue
    const arr = byUser.get(t.assignedTo) ?? []
    arr.push(t)
    byUser.set(t.assignedTo, arr)
  }

  const agents = users.map((u) => {
    const rows = byUser.get(u.id) ?? []
    const completedCount = rows.length

    const withDue = rows.filter((r) => r.dueDate != null && r.completedAt != null)
    const onTime = withDue.filter((r) => (r.completedAt as Date) <= (r.dueDate as Date)).length
    const onTimeCompletion =
      withDue.length > 0 ? round1((onTime / withDue.length) * 100) : completedCount > 0 ? 100 : 0

    const overdue = overdueByUser.get(u.id) ?? 0

    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      rank: 0,
      volume: completedCount,
      volumeFormat: "count" as const,
      attainmentPct: onTimeCompletion,
      status: statusFromAttainment(onTimeCompletion, thresholds),
      metrics: [
        { key: "completed", value: completedCount, format: "count" as const },
        { key: "onTimeCompletion", value: onTimeCompletion, format: "percent" as const },
        { key: "overdue", value: overdue, format: "count" as const },
      ],
    }
  })

  agents.sort((a, b) => b.attainmentPct - a.attainmentPct || b.volume - a.volume)
  return agents.map((a, i) => ({ ...a, rank: i + 1 }))
}

export async function computeTasksLeaderboard(
  orgId: string,
  period: LeaderboardPeriod,
  now: Date = new Date(),
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
  timezone?: string,
): Promise<NormalizedAgent[]> {
  const start = periodStart(period, now, timezone)

  const [taskRows, projectTaskRows, taskOverdue, projectTaskOverdue] = await Promise.all([
    prisma.task.findMany({
      where: {
        organizationId: orgId,
        assignedTo: { not: null },
        deletedAt: null,
        completedAt: start ? { gte: start } : { not: null },
      },
      select: { assignedTo: true, completedAt: true, dueDate: true },
    }),
    prisma.projectTask.findMany({
      where: {
        organizationId: orgId,
        assignedTo: { not: null },
        completedAt: start ? { gte: start } : { not: null },
      },
      select: { assignedTo: true, completedAt: true, dueDate: true },
    }),
    prisma.task.groupBy({
      by: ["assignedTo"],
      where: {
        organizationId: orgId,
        assignedTo: { not: null },
        deletedAt: null,
        completedAt: null,
        dueDate: { lt: now },
      },
      _count: true,
    }),
    prisma.projectTask.groupBy({
      by: ["assignedTo"],
      where: {
        organizationId: orgId,
        assignedTo: { not: null },
        completedAt: null,
        dueDate: { lt: now },
      },
      _count: true,
    }),
  ])

  const completed: CompletedTaskRow[] = [...(taskRows as CompletedTaskRow[]), ...(projectTaskRows as CompletedTaskRow[])]

  const overdueByUser = new Map<string, number>()
  for (const g of [...(taskOverdue as { assignedTo: string | null; _count: number }[]),
    ...(projectTaskOverdue as { assignedTo: string | null; _count: number }[])]) {
    if (g.assignedTo) overdueByUser.set(g.assignedTo, (overdueByUser.get(g.assignedTo) ?? 0) + g._count)
  }

  // Roster = anyone who completed work in-window OR has overdue work.
  const userIds = new Set<string>()
  for (const r of completed) if (r.assignedTo) userIds.add(r.assignedTo)
  for (const id of overdueByUser.keys()) userIds.add(id)
  if (userIds.size === 0) return []

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, id: { in: [...userIds] }, isActive: true },
    select: { id: true, name: true, avatar: true },
  })
  if (users.length === 0) return []

  return buildTaskAgents(users, completed, overdueByUser, thresholds)
}
