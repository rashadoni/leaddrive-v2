/**
 * GET /api/v1/ps-cloud/utilization
 *
 * Per-user + firm-rollup utilization summary for the active period.
 *
 * Query: `?weeklyHours=40` (default 40 for all users, slice 2 reads from
 * `User.weeklyHours` once that column lands; slice 1 ships the org-wide
 * override). `?periodWeeks=1` (default 1 week).
 *
 * Response: `{ users: UtilizationSummary[], status: UtilizationStatus[],
 *              firm: FirmUtilizationRollup }`
 *
 * Part of R12 Professional Services Cloud (Phase 2 slice 1).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  computeUtilization,
  classifyUtilization,
  rollupFirm,
  type UserCapacity,
  type ProjectMemberHoursRow,
} from "@/lib/ps-cloud/utilization"

export const GET = withRlsAuth("settings", "read", async (req, auth) => {
  const weeklyHoursParam = parseInt(req.nextUrl.searchParams.get("weeklyHours") || "40", 10)
  const periodWeeksParam = parseInt(req.nextUrl.searchParams.get("periodWeeks") || "1", 10)
  if (!Number.isFinite(weeklyHoursParam) || weeklyHoursParam <= 0 || weeklyHoursParam > 168) {
    return NextResponse.json({ error: "weeklyHours must be in (0, 168]" }, { status: 400 })
  }
  if (!Number.isFinite(periodWeeksParam) || periodWeeksParam <= 0 || periodWeeksParam > 52) {
    return NextResponse.json({ error: "periodWeeks must be in (0, 52]" }, { status: 400 })
  }

  // Narrow row types — prisma's select payload is wide at the include seam.
  type UserRow = { id: string; name: string }
  type PmRow = {
    userId: string; projectId: string
    hoursLogged: number; hourlyRate: number | null
    project: { id: string; status: string } | null
  }

  const users: UserRow[] = await prisma.user.findMany({
    where: { organizationId: auth.orgId, isActive: true },
    select: { id: true, name: true },
  })
  const userIds = users.map((u: UserRow) => u.id)

  const projectMembers: PmRow[] = await prisma.projectMember.findMany({
    where: { organizationId: auth.orgId, userId: { in: userIds } },
    select: {
      userId: true,
      projectId: true,
      hoursLogged: true,
      hourlyRate: true,
      project: { select: { id: true, status: true } },
    },
  })

  // Slice 1 billability heuristic: only `active` + `planning` projects count.
  // Allowlist (not denylist) so `completed` projects — whose hours have
  // already been revenue-recognised — don't double-count toward current
  // utilization. Slice 2 adds an explicit `Project.isBillable` column for
  // time-and-materials vs internal R&D distinction.
  const isBillableProject = (status: string) =>
    ["active", "planning"].includes(status)

  const rows: ProjectMemberHoursRow[] = projectMembers.map((pm: PmRow) => ({
    userId: pm.userId,
    projectId: pm.projectId,
    hoursLogged: pm.hoursLogged ?? 0,
    hourlyRate: pm.hourlyRate,
    isBillable: pm.project ? isBillableProject(pm.project.status) : false,
  }))

  const capacities: UserCapacity[] = users.map((u: UserRow) => ({
    userId: u.id,
    weeklyHours: weeklyHoursParam,
  }))

  const summaries = computeUtilization(capacities, rows, periodWeeksParam)
  const status = summaries.map(classifyUtilization)
  const firm = rollupFirm(summaries)

  // Build display map once — was O(n²) via Array.find inside .map.
  const userNameById = new Map(users.map((u: UserRow) => [u.id, u.name]))
  const statusByUser = new Map(status.map(st => [st.userId, st.status]))
  const usersOut = summaries.map(s => ({
    ...s,
    name: userNameById.get(s.userId) ?? s.userId,
    statusBand: statusByUser.get(s.userId) ?? "bench",
  }))

  return NextResponse.json({
    period: {
      weeklyHours: weeklyHoursParam,
      periodWeeks: periodWeeksParam,
      /**
       * IMPORTANT semantic disclosure: slice 1 sources `billableHours` from
       * `ProjectMember.hoursLogged` which is **cumulative lifetime-to-date**,
       * not period-windowed. A user with 1000h over 6 months on a periodWeeks=13
       * query will read as ~192% utilization. Slice 2 adds a daily `TimeEntry`
       * table for true period-window utilization. Until then, callers should
       * treat `periodWeeks` as a capacity scaler only and either set it large
       * enough to encompass lifetime (e.g. 52) or filter projects upstream.
       */
      basis: "lifetime",
    },
    users: usersOut,
    firm,
  })
})
