import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isTeamAdmin, sortTeamMembers, type TeamDTO, type TeamRole } from "@/lib/tasks/board-teams"

/**
 * GET /api/v1/tasks/teams — the organization's teams with their people, for
 * everyone who works on the boards (the sidebar and the team pages read it).
 * POST — a new team, by the admin. Rules: src/lib/tasks/board-teams.ts.
 */
const nameSchema = z.object({ name: z.string().trim().min(1).max(80) })

export const GET = withRlsAuth("tasks", "read", async (_req, auth) => {
  const rows = await prisma.boardTeam.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true,
      members: { where: { user: { isActive: true } }, select: { userId: true, role: true, user: { select: { name: true, avatar: true } } } },
    },
  })
  const teams: TeamDTO[] = rows.map((team: (typeof rows)[number]) => ({
    id: team.id,
    name: team.name,
    members: sortTeamMembers(team.members.map((m: (typeof team.members)[number]) => ({
      userId: m.userId, name: m.user.name, avatar: m.user.avatar, role: m.role as TeamRole,
    }))),
  }))
  return NextResponse.json({ success: true, data: { teams, canManage: isTeamAdmin(auth.role) } })
})

export const POST = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isTeamAdmin(auth.role)) return NextResponse.json({ error: "Forbidden", message: "Only an admin makes teams" }, { status: 403 })
  const parsed = nameSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const last = await prisma.boardTeam.aggregate({ where: { organizationId: auth.orgId }, _max: { sortOrder: true } })
    const team = await prisma.boardTeam.create({
      data: { organizationId: auth.orgId, name: parsed.data.name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true },
    })
    logAudit(auth.orgId, "create", "board_team", team.id, team.name)
    return NextResponse.json({ success: true, data: { ...team, members: [] } }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "A team of that name already exists", code: "TEAM_NAME_TAKEN" }, { status: 409 })
    }
    console.error("[tasks teams POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
