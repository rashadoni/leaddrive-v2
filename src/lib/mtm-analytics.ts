/**
 * Shared types and helpers for MTM analytics routes.
 *
 * Extracted to avoid verbatim duplication across:
 *   - /api/v1/mtm/analytics/route.ts
 *   - /api/v1/mtm/analytics/export/route.ts
 */

// ── Raw Prisma row shapes ─────────────────────────────────────────────────────

export type AgentVisitRow = {
  agentId: string
  _count: number
  _avg: { duration: number | null } | null
}

export type AgentRouteRow = {
  agentId: string
  _sum: { totalPoints: number | null; visitedPoints: number | null } | null
}

// ── Computed output shape ─────────────────────────────────────────────────────

export interface AgentKpiRow {
  agentId: string
  name: string
  totalVisits: number
  avgTimeInStore: number
  visitPlanFulfillment: number
}

// ── Shared builder ────────────────────────────────────────────────────────────

/**
 * Builds per-agent KPI rows from Prisma groupBy results and an agent
 * name lookup map.
 *
 * Fixes applied here:
 *   - `_avg.duration != null` (not truthy) so that duration=0 is preserved.
 */
export function buildAgentKpis(
  agentVisitStats: AgentVisitRow[],
  agentRouteStats: AgentRouteRow[],
  agentMap: Record<string, string>,
): AgentKpiRow[] {
  return agentVisitStats.map((av) => {
    const totalAgentVisits = av._count
    // av._avg is `{ duration: number | null } | null` — optional chain gives
    // undefined when av._avg is null, and undefined != null is false, so the
    // guard correctly handles both null and 0.
    const agentAvgTimeInStore =
      av._avg != null && av._avg.duration != null ? Math.round(av._avg.duration) : 0

    const routeStats = agentRouteStats.find((x) => x.agentId === av.agentId)
    const tp = routeStats?._sum?.totalPoints   ?? 0
    const vp = routeStats?._sum?.visitedPoints ?? 0
    const agentVisitPlanFulfillment = tp > 0 ? Math.round((vp / tp) * 100) : 0

    return {
      agentId:              av.agentId,
      name:                 agentMap[av.agentId] ?? "Unknown",
      totalVisits:          totalAgentVisits,
      avgTimeInStore:       agentAvgTimeInStore,
      visitPlanFulfillment: agentVisitPlanFulfillment,
    }
  })
}
