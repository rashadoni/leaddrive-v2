/**
 * MTM (Route & Field) group aggregator.
 *
 * The per-agent groupBy logic was EXTRACTED verbatim from
 * `src/app/api/v1/mtm/leaderboard/route.ts` (which now calls
 * `computeMtmRankings`) so the existing `/mtm/leaderboard` page keeps its exact
 * contract. Two derived rates — `photoApproval` and `routeCompletion` — are
 * ADDED (extra fields, non-breaking) to feed the Arena's composite attainment.
 *
 * Arena mapping:
 *   volume        = visits (raw work output → bubble radius)
 *   attainmentPct = 0.5·taskCompletion + 0.3·photoApproval + 0.2·routeCompletion
 *                   (a 0-100 compliance/quality index — no explicit per-agent
 *                    quota exists for field work, so weights are a documented
 *                    constant; org-configurable targets are a phase-2 tail).
 */
import { prisma } from "@/lib/prisma"
import { DEFAULT_STATUS_THRESHOLDS, type NormalizedAgent, round1, statusFromAttainment, type StatusThresholds } from "./types"
import { DEFAULT_MTM_WEIGHTS, type MtmWeightKey } from "./config-loader"

export interface MtmRanking {
  agentId: string
  name: string
  avatar: string | null
  score: number
  visits: number
  completedTasks: number
  approvedPhotos: number
  onTimeRoutes: number
  taskCompletion: number
  photoApproval: number
  routeCompletion: number
  achievements: { id: string; progress: number; total: number }[]
  rank: number
}

type CountRow = { agentId: string; _count: number | { _all?: number } }
function toMap(arr: CountRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const row of arr) {
    const c = typeof row._count === "number" ? row._count : (row._count as { _all?: number })?._all ?? 0
    m.set(row.agentId, c)
  }
  return m
}

/**
 * Per-agent MTM rankings. `startDate` undefined = all-time; otherwise filters
 * activity by `createdAt >= startDate`. Pure given (orgId, startDate, now) apart
 * from the DB reads. O(1) query count: 1 findMany + 8 groupBy + 1 bounded
 * findMany, independent of agent count.
 */
export async function computeMtmRankings(
  orgId: string,
  startDate: Date | undefined,
  now: Date = new Date(),
): Promise<MtmRanking[]> {
  const dateFilter = startDate ? { createdAt: { gte: startDate } } : {}

  const agents = await prisma.mtmAgent.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { id: true, name: true, avatar: true },
  })
  if (agents.length === 0) return []
  const agentIds = agents.map((a: { id: string; name: string; avatar: string | null }) => a.id)

  const baseWhere = { organizationId: orgId, agentId: { in: agentIds }, ...dateFilter }
  const [
    visitAgg,
    tasksAllAgg,
    tasksDoneAgg,
    photosAllAgg,
    photosApprovedAgg,
    routesAllAgg,
    routesDoneAgg,
    alertsAgg,
    recentVisitDays,
  ] = await Promise.all([
    prisma.mtmVisit.groupBy({ by: ["agentId"], where: { ...baseWhere, deletedAt: null }, _count: true }),
    prisma.mtmTask.groupBy({ by: ["agentId"], where: { ...baseWhere, deletedAt: null }, _count: true }),
    prisma.mtmTask.groupBy({ by: ["agentId"], where: { ...baseWhere, status: "COMPLETED", deletedAt: null }, _count: true }),
    prisma.mtmPhoto.groupBy({ by: ["agentId"], where: baseWhere, _count: true }),
    prisma.mtmPhoto.groupBy({ by: ["agentId"], where: { ...baseWhere, status: "APPROVED" }, _count: true }),
    prisma.mtmRoute.groupBy({ by: ["agentId"], where: { ...baseWhere, deletedAt: null }, _count: true }),
    prisma.mtmRoute.groupBy({ by: ["agentId"], where: { ...baseWhere, status: "COMPLETED", deletedAt: null }, _count: true }),
    startDate
      ? prisma.mtmAlert.groupBy({
          by: ["agentId"],
          where: { organizationId: orgId, agentId: { in: agentIds }, category: "WARNING", createdAt: { gte: startDate } },
          _count: true,
        })
      : Promise.resolve([] as CountRow[]),
    prisma.mtmVisit.findMany({
      where: {
        organizationId: orgId,
        agentId: { in: agentIds },
        createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
      select: { agentId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: agentIds.length * 30,
    }),
  ])

  const visits = toMap(visitAgg as CountRow[])
  const tasksAll = toMap(tasksAllAgg as CountRow[])
  const tasksDone = toMap(tasksDoneAgg as CountRow[])
  const photosAll = toMap(photosAllAgg as CountRow[])
  const photosApproved = toMap(photosApprovedAgg as CountRow[])
  const routesAll = toMap(routesAllAgg as CountRow[])
  const routesDone = toMap(routesDoneAgg as CountRow[])
  const alerts = toMap(alertsAgg as CountRow[])

  const daysByAgent = new Map<string, Set<string>>()
  for (const v of recentVisitDays) {
    const day = v.createdAt.toISOString().slice(0, 10)
    const set = daysByAgent.get(v.agentId) ?? new Set<string>()
    set.add(day)
    daysByAgent.set(v.agentId, set)
  }

  const rankings: MtmRanking[] = agents.map((agent: { id: string; name: string; avatar: string | null }) => {
    const visitsCount = visits.get(agent.id) ?? 0
    const totalTasks = tasksAll.get(agent.id) ?? 0
    const completedTasks = tasksDone.get(agent.id) ?? 0
    const totalPhotos = photosAll.get(agent.id) ?? 0
    const approvedPhotos = photosApproved.get(agent.id) ?? 0
    const totalRoutes = routesAll.get(agent.id) ?? 0
    const onTimeRoutes = routesDone.get(agent.id) ?? 0
    const warningAlerts = alerts.get(agent.id) ?? 0

    const score = visitsCount * 10 + completedTasks * 15 + approvedPhotos * 5 + onTimeRoutes * 20
    const taskCompletion = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    const photoApproval = totalPhotos > 0 ? Math.round((approvedPhotos / totalPhotos) * 100) : 0
    const routeCompletion = totalRoutes > 0 ? Math.round((onTimeRoutes / totalRoutes) * 100) : 0
    const uniqueDays = daysByAgent.get(agent.id)?.size ?? 0

    const achievements = [
      { id: "speed_master", progress: onTimeRoutes, total: Math.max(totalRoutes, 1) },
      { id: "photo_champion", progress: approvedPhotos, total: 100 },
      { id: "consistent_success", progress: Math.min(uniqueDays, 10), total: 10 },
      { id: "customer_friend", progress: photoApproval >= 95 ? 1 : 0, total: 1 },
      { id: "perfect_week", progress: startDate && warningAlerts === 0 ? 1 : 0, total: 1 },
    ]

    return {
      agentId: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      score,
      visits: visitsCount,
      completedTasks,
      approvedPhotos,
      onTimeRoutes,
      taskCompletion,
      photoApproval,
      routeCompletion,
      achievements,
      rank: 0,
    }
  })

  rankings.sort((a, b) => b.score - a.score)
  return rankings.map((r, i) => ({ ...r, rank: i + 1 }))
}

/**
 * Composite KPI index for a single agent's rates (exported for unit tests).
 * Weighted average, NORMALISED by the weight sum so a partial per-org override
 * (e.g. only `task` bumped) can't push attainment past 100 — defaults sum to 1.0
 * so the normalisation is a no-op for the out-of-the-box weights.
 */
export function mtmAttainment(
  r: Pick<MtmRanking, "taskCompletion" | "photoApproval" | "routeCompletion">,
  weights: Readonly<Record<MtmWeightKey, number>> = DEFAULT_MTM_WEIGHTS,
): number {
  const sum = weights.task + weights.photo + weights.route
  if (sum <= 0) return 0
  const raw = r.taskCompletion * weights.task + r.photoApproval * weights.photo + r.routeCompletion * weights.route
  return round1(raw / sum)
}

export function mtmToNormalized(
  rankings: MtmRanking[],
  weights: Readonly<Record<MtmWeightKey, number>> = DEFAULT_MTM_WEIGHTS,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): NormalizedAgent[] {
  // Re-rank by the composite attainment (Arena ranks by KPI, not the raw score).
  const withAttainment = rankings.map((r) => ({ r, attainmentPct: mtmAttainment(r, weights) }))
  withAttainment.sort((a, b) => b.attainmentPct - a.attainmentPct || b.r.visits - a.r.visits)
  return withAttainment.map(({ r, attainmentPct }, i) => ({
    id: r.agentId,
    name: r.name,
    avatar: r.avatar,
    rank: i + 1,
    volume: r.visits,
    volumeFormat: "count" as const,
    attainmentPct,
    status: statusFromAttainment(attainmentPct, thresholds),
    metrics: [
      { key: "visits", value: r.visits, format: "count" as const },
      { key: "completedTasks", value: r.completedTasks, format: "count" as const },
      { key: "taskCompletion", value: r.taskCompletion, format: "percent" as const },
      { key: "photoApproval", value: r.photoApproval, format: "percent" as const },
      { key: "routeCompletion", value: r.routeCompletion, format: "percent" as const },
      { key: "score", value: r.score, format: "count" as const },
    ],
  }))
}

export async function computeMtmLeaderboard(
  orgId: string,
  startDate: Date | undefined,
  now: Date = new Date(),
  weights: Readonly<Record<MtmWeightKey, number>> = DEFAULT_MTM_WEIGHTS,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): Promise<NormalizedAgent[]> {
  return mtmToNormalized(await computeMtmRankings(orgId, startDate, now), weights, thresholds)
}
