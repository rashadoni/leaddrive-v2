/**
 * GET /api/v1/leaderboard/groups
 *
 * Which KPI-Arena groups the current viewer may see — drives the page's tab
 * list. Combines RBAC visibility (own department vs. manager-sees-all) with the
 * org's paid-module gate, so the UI only ever offers reachable tabs.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { orgHasModule } from "@/lib/api-auth"
import type { ModuleId } from "@/lib/modules"
import { isManager, visibleGroups } from "@/lib/leaderboard/visibility"
import { GROUP_TO_MODULE, type LeaderboardGroup } from "@/lib/leaderboard/types"

export const GET = withRls(async (_req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const candidate = visibleGroups(session.role)
  const groups: LeaderboardGroup[] = []
  for (const g of candidate) {
    if (session.role === "superadmin" || (await orgHasModule(orgId, GROUP_TO_MODULE[g] as ModuleId))) {
      groups.push(g)
    }
  }

  return NextResponse.json({ groups, isManager: isManager(session.role) })
})
