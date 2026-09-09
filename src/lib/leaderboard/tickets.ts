/**
 * Tickets (Support) group aggregator — NEW (no per-agent ticket leaderboard
 * existed). Ranks support reps on SLA-resolution quality.
 *
 * volume        = tickets resolved in the window (→ bubble radius)
 * attainmentPct = SLA-adherence % among resolved-with-SLA tickets
 *                 (resolvedAt ≤ slaDueAt). Fallback when no resolved ticket
 *                 carried an SLA target: resolution rate (resolved / assigned).
 *
 * Drill-down also surfaces reopen-rate (tickets reopened ÷ resolved) and
 * escalation-rate (tickets with escalationLevel>0 ÷ resolved) — lower is better;
 * not folded into the attainment score.
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

export interface TicketRow {
  assignedTo: string | null
  resolvedAt: Date | null
  slaDueAt: Date | null
  firstResponseAt: Date | null
  satisfactionRating: number | null
  handleTimeSeconds: number
  escalationLevel: number
  reopenCount: number
  createdAt: Date
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Pure ranking math. `users` is the candidate roster (support reps),
 * `resolved` are their resolved tickets in-window. The fallback resolution rate
 * (used only when no resolved ticket carried an SLA) is computed over a SINGLE
 * cohort — tickets CREATED in-window — to avoid the old resolved-in-window ÷
 * created-in-window cross-cohort mismatch: `cohortByUser` = created-in-window
 * count, `cohortResolvedByUser` = how many of that cohort are resolved.
 */
export function buildTicketAgents(
  users: { id: string; name: string; avatar: string | null }[],
  resolved: TicketRow[],
  cohortByUser: Map<string, number>,
  cohortResolvedByUser: Map<string, number>,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): NormalizedAgent[] {
  const byUser = new Map<string, TicketRow[]>()
  for (const t of resolved) {
    if (!t.assignedTo) continue
    const arr = byUser.get(t.assignedTo) ?? []
    arr.push(t)
    byUser.set(t.assignedTo, arr)
  }

  const agents = users.map((u) => {
    const rows = byUser.get(u.id) ?? []
    const resolvedCount = rows.length
    const cohort = cohortByUser.get(u.id) ?? 0
    const cohortResolved = cohortResolvedByUser.get(u.id) ?? 0

    const withSla = rows.filter((r) => r.slaDueAt != null)
    const metSla = withSla.filter((r) => r.resolvedAt != null && r.resolvedAt <= (r.slaDueAt as Date)).length
    const slaAdherence = withSla.length > 0 ? round1((metSla / withSla.length) * 100) : null

    // Fallback resolution rate over a single cohort (tickets created in-window):
    // numerator ⊆ denominator → naturally ≤100, no cross-cohort clamp needed.
    // SLA adherence is already ≤100 by construction.
    const resolutionRate = cohort > 0 ? round1((cohortResolved / cohort) * 100) : 0
    const attainmentPct = slaAdherence ?? resolutionRate

    // Reopen + escalation rates over the resolved-in-window tickets (lower = better;
    // surfaced as drill-down metrics, not folded into the attainment score).
    const reopened = rows.filter((r) => r.reopenCount > 0).length
    const escalated = rows.filter((r) => r.escalationLevel > 0).length
    const reopenRate = resolvedCount > 0 ? round1((reopened / resolvedCount) * 100) : 0
    const escalationRate = resolvedCount > 0 ? round1((escalated / resolvedCount) * 100) : 0

    const rated = rows.filter((r) => r.satisfactionRating != null).map((r) => r.satisfactionRating as number)
    const csat = rated.length > 0 ? round1(rated.reduce((a, b) => a + b, 0) / rated.length) : 0

    const frtMins = rows
      .filter((r) => r.firstResponseAt != null)
      .map((r) => ((r.firstResponseAt as Date).getTime() - r.createdAt.getTime()) / 60000)
      .filter((m) => m >= 0)
    const frtMedianMin = round1(median(frtMins))

    const handled = rows.filter((r) => r.handleTimeSeconds > 0).map((r) => r.handleTimeSeconds)
    const avgHandleMin = handled.length > 0 ? round1(handled.reduce((a, b) => a + b, 0) / handled.length / 60) : 0

    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      rank: 0,
      volume: resolvedCount,
      volumeFormat: "count" as const,
      attainmentPct,
      status: statusFromAttainment(attainmentPct, thresholds),
      metrics: [
        { key: "resolved", value: resolvedCount, format: "count" as const },
        { key: "slaAdherence", value: slaAdherence ?? resolutionRate, format: "percent" as const },
        { key: "csat", value: csat, format: "count" as const },
        { key: "frtMedianMin", value: frtMedianMin, format: "minutes" as const },
        { key: "avgHandleMin", value: avgHandleMin, format: "minutes" as const },
        { key: "reopenRate", value: reopenRate, format: "percent" as const },
        { key: "escalationRate", value: escalationRate, format: "percent" as const },
      ],
    }
  })

  agents.sort((a, b) => b.attainmentPct - a.attainmentPct || b.volume - a.volume)
  return agents.map((a, i) => ({ ...a, rank: i + 1 }))
}

export async function computeTicketsLeaderboard(
  orgId: string,
  period: LeaderboardPeriod,
  now: Date = new Date(),
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
  timezone?: string,
): Promise<NormalizedAgent[]> {
  const start = periodStart(period, now, timezone)

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, role: "support", isActive: true },
    select: { id: true, name: true, avatar: true },
  })
  if (users.length === 0) return []
  const ids = users.map((u: { id: string; name: string; avatar: string | null }) => u.id)

  const resolvedWhere = {
    organizationId: orgId,
    assignedTo: { in: ids },
    resolvedAt: start ? { not: null, gte: start } : { not: null },
  }
  // Single fallback cohort = tickets CREATED in-window (same filter for total + resolved-subset).
  const cohortWhere = {
    organizationId: orgId,
    assignedTo: { in: ids },
    ...(start ? { createdAt: { gte: start } } : {}),
  }
  const [resolved, cohortAgg, cohortResolvedAgg] = await Promise.all([
    prisma.ticket.findMany({
      where: resolvedWhere,
      select: {
        assignedTo: true,
        resolvedAt: true,
        slaDueAt: true,
        firstResponseAt: true,
        satisfactionRating: true,
        handleTimeSeconds: true,
        escalationLevel: true,
        reopenCount: true,
        createdAt: true,
      },
    }),
    prisma.ticket.groupBy({ by: ["assignedTo"], where: cohortWhere, _count: true }),
    prisma.ticket.groupBy({ by: ["assignedTo"], where: { ...cohortWhere, resolvedAt: { not: null } }, _count: true }),
  ])

  const toMap = (agg: { assignedTo: string | null; _count: number }[]) => {
    const m = new Map<string, number>()
    for (const g of agg) if (g.assignedTo) m.set(g.assignedTo, g._count)
    return m
  }

  return buildTicketAgents(
    users,
    resolved as TicketRow[],
    toMap(cohortAgg as { assignedTo: string | null; _count: number }[]),
    toMap(cohortResolvedAgg as { assignedTo: string | null; _count: number }[]),
    thresholds,
  )
}
