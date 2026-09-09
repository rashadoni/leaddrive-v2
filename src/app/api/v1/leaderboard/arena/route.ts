/**
 * GET /api/v1/leaderboard/arena?group=<g>&period=<p>
 *
 * The KPI Arena data feed. Returns one group's agents in the normalised
 * NormalizedAgent shape so the bubble UI can render any of the 5 groups
 * (sales / mtm / tickets / projects / tasks) identically.
 *
 * Auth: session required. RBAC — a non-manager may only pull their own
 * department's group (403 otherwise). Paid-feature gate via the group's module.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import type { ModuleId } from "@/lib/modules"
import { canViewGroup } from "@/lib/leaderboard/visibility"
import {
  GROUP_TO_MODULE,
  isLeaderboardGroup,
  isLeaderboardPeriod,
  periodStart,
  type LeaderboardGroup,
  type LeaderboardMeta,
  type LeaderboardPeriod,
  type NormalizedAgent,
} from "@/lib/leaderboard/types"
import { computeSalesLeaderboard } from "@/lib/leaderboard/sales"
import { computeMtmLeaderboard } from "@/lib/leaderboard/mtm"
import { computeTicketsLeaderboard } from "@/lib/leaderboard/tickets"
import { computeProjectsLeaderboard } from "@/lib/leaderboard/projects"
import { computeTasksLeaderboard } from "@/lib/leaderboard/tasks"
import { loadLeaderboardConfig } from "@/lib/leaderboard/config-loader"

const META: Record<LeaderboardGroup, LeaderboardMeta> = {
  sales: {
    volumeLabelKey: "leaderboard.vol.salesWon",
    attainmentLabelKey: "leaderboard.att.quota",
    noteKey: "leaderboard.note.salesQuarter",
  },
  mtm: { volumeLabelKey: "leaderboard.vol.visits", attainmentLabelKey: "leaderboard.att.compliance" },
  tickets: { volumeLabelKey: "leaderboard.vol.resolved", attainmentLabelKey: "leaderboard.att.sla" },
  projects: { volumeLabelKey: "leaderboard.vol.managed", attainmentLabelKey: "leaderboard.att.onTime" },
  tasks: { volumeLabelKey: "leaderboard.vol.completed", attainmentLabelKey: "leaderboard.att.onTime" },
}

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const groupParam = searchParams.get("group")
  if (!isLeaderboardGroup(groupParam)) {
    return NextResponse.json({ error: "Invalid or missing group" }, { status: 400 })
  }
  const group = groupParam

  // RBAC: non-managers can only see their own department's group.
  if (!canViewGroup(session.role, group)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Paid-feature gate (superadmin bypasses, mirroring requireAuth).
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
    const now = new Date()
    // Per-org KPI config (weights + status bands). No row → frozen defaults, so
    // this is a no-op for orgs that never opened the settings UI (Phase C4).
    const cfg = await loadLeaderboardConfig(orgId)
    let agents: NormalizedAgent[]
    switch (group) {
      case "sales":
        // Sales status comes from the quota engine's own pacing bands, not the
        // Arena statusThresholds — intentionally NOT config-driven here.
        agents = await computeSalesLeaderboard(orgId, period, now)
        break
      case "mtm":
        agents = await computeMtmLeaderboard(orgId, periodStart(period, now), now, cfg.mtmWeights, cfg.statusThresholds)
        break
      case "tickets":
        agents = await computeTicketsLeaderboard(orgId, period, now, cfg.statusThresholds)
        break
      case "projects":
        agents = await computeProjectsLeaderboard(orgId, period, now, cfg.statusThresholds)
        break
      case "tasks":
        agents = await computeTasksLeaderboard(orgId, period, now, cfg.statusThresholds)
        break
    }
    return NextResponse.json({ group, period, agents, meta: META[group] })
  } catch (e) {
    console.error("[leaderboard/arena GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
