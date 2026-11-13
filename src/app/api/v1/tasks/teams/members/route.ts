import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isTeamAdmin, TEAM_ROLES } from "@/lib/tasks/board-teams"

/**
 * PUT /api/v1/tasks/teams/members — a person's team and their role in it, set
 * by the admin: `teamId: null` takes the person out of their team. A person is
 * in one team, so moving them is one write, not a remove and an add.
 */
const schema = z.object({
  userId: z.string().min(1).max(64),
  teamId: z.string().min(1).max(64).nullable(),
  role: z.enum(TEAM_ROLES).optional(),
})

export const PUT = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isTeamAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { userId, teamId, role } = parsed.data

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: auth.orgId }, select: { id: true, name: true } })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  if (teamId === null) {
    await prisma.boardTeamMember.deleteMany({ where: { userId, organizationId: auth.orgId } })
    logAudit(auth.orgId, "update", "board_team_member", userId, user.name, { newValue: { teamId: null } })
    return NextResponse.json({ success: true, data: { userId, teamId: null, role: null } })
  }

  const team = await prisma.boardTeam.findFirst({ where: { id: teamId, organizationId: auth.orgId }, select: { id: true } })
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 })
  // Moved to another team: a member there unless told otherwise; in the same team the role stays.
  const current = await prisma.boardTeamMember.findFirst({ where: { userId, organizationId: auth.orgId }, select: { teamId: true, role: true } })
  const nextRole = role ?? (current && current.teamId === teamId ? current.role : "member")
  const row = await prisma.boardTeamMember.upsert({
    where: { userId },
    create: { organizationId: auth.orgId, teamId, userId, role: nextRole },
    update: { teamId, role: nextRole },
    select: { userId: true, teamId: true, role: true },
  })
  logAudit(auth.orgId, "update", "board_team_member", userId, user.name, { newValue: { teamId: row.teamId, role: row.role } })
  return NextResponse.json({ success: true, data: row })
})
