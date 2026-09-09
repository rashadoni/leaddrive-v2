/**
 * GET /api/v1/leaderboard/agent-items?group=<g>&agentId=<id>&period=<p>
 *
 * The drill-down drawer's "completed work items" feed: the underlying deals /
 * tickets / tasks / projects / MTM tasks behind ONE agent's KPI %. Auth + RBAC +
 * paid-feature gate MIRROR the arena route exactly (a viewer can only pull a
 * group they're allowed to see; the org filter on every query isolates tenants,
 * so an agentId from another org simply returns no rows).
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import type { ModuleId } from "@/lib/modules"
import { canViewGroup } from "@/lib/leaderboard/visibility"
import { GROUP_TO_MODULE, isLeaderboardGroup, isLeaderboardPeriod, type LeaderboardPeriod } from "@/lib/leaderboard/types"
import { computeAgentItems, isAgentOnRoster } from "@/lib/leaderboard/agent-items"

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const groupParam = searchParams.get("group")
  if (!isLeaderboardGroup(groupParam)) {
    return NextResponse.json({ error: "Invalid or missing group" }, { status: 400 })
  }
  const group = groupParam

  const agentId = searchParams.get("agentId")?.trim()
  if (!agentId) {
    return NextResponse.json({ error: "Missing agentId" }, { status: 400 })
  }

  // RBAC: non-managers can only see their own department's group.
  if (!canViewGroup(session.role, group)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Paid-feature gate (superadmin bypasses, mirroring the arena route).
  if (session.role !== "superadmin") {
    const mod = GROUP_TO_MODULE[group] as ModuleId
    if (!(await orgHasModule(orgId, mod))) return moduleDisabledResponse(mod)
  }

  const periodParam = searchParams.get("period")
  const period: LeaderboardPeriod = isLeaderboardPeriod(periodParam)
    ? periodParam
    : group === "sales"
      ? "quarter"
      : "month"

  try {
    // Roster gate (Codex-flagged): only an agent ON this group's board may be
    // drilled into — blocks a same-org viewer from pulling a hidden/inactive
    // agent's items. Org-scoped, so a cross-tenant id also fails here.
    if (!(await isAgentOnRoster(orgId, group, agentId))) {
      return NextResponse.json({ error: "Agent not on this leaderboard" }, { status: 404 })
    }

    const result = await computeAgentItems(orgId, group, agentId, period)
    return NextResponse.json(result)
  } catch (e) {
    console.error("[leaderboard/agent-items GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
