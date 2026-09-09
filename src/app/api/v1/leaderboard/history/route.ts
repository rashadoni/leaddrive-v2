/**
 * GET /api/v1/leaderboard/history?group=<g>&agentId=<id>&window=1h|1d|1m|1y
 *
 * One agent's attainment-over-time, read from the hourly LeaderboardSnapshot rows
 * (Phase D). Powers the sparkline in the agent drill-down. RBAC mirrors the arena
 * feed — a non-manager may only read their own department's group. History starts
 * at the first snapshot (deploy of the cron); sparse early is expected.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import type { ModuleId } from "@/lib/modules"
import { canViewGroup } from "@/lib/leaderboard/visibility"
import { GROUP_TO_MODULE, isLeaderboardGroup } from "@/lib/leaderboard/types"
import { HISTORY_WINDOW_MS, isHistoryWindow, extractAgentSeries, downsample } from "@/lib/leaderboard/snapshots"

const MAX_POINTS = 80

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const group = searchParams.get("group")
  const agentId = searchParams.get("agentId")
  const windowParam = searchParams.get("window")

  if (!isLeaderboardGroup(group)) return NextResponse.json({ error: "Invalid or missing group" }, { status: 400 })
  if (!agentId) return NextResponse.json({ error: "Missing agentId" }, { status: 400 })
  if (!canViewGroup(session.role, group)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Paid-feature gate — mirror the arena feed exactly (superadmin bypasses).
  if (session.role !== "superadmin") {
    const mod = GROUP_TO_MODULE[group] as ModuleId
    if (!(await orgHasModule(orgId, mod))) return moduleDisabledResponse(mod)
  }

  const window = isHistoryWindow(windowParam) ? windowParam : "1d"
  const since = new Date(Date.now() - HISTORY_WINDOW_MS[window])

  try {
    const snaps = await prisma.leaderboardSnapshot.findMany({
      where: { organizationId: orgId, group, capturedAt: { gte: since } },
      orderBy: { capturedAt: "asc" },
      take: 9000, // defensive bound: ≥ the max hourly rows a 1y window can hold (~8760)
      select: { capturedAt: true, standings: true },
    })
    const points = downsample(extractAgentSeries(snaps, agentId), MAX_POINTS)
    return NextResponse.json({ group, agentId, window, points })
  } catch (e) {
    console.error("[leaderboard/history GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
