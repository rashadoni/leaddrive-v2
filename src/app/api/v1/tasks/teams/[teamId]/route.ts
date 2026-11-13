import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isTeamAdmin } from "@/lib/tasks/board-teams"

/**
 * One team: the admin renames it or removes it. Removing a team removes only
 * the grouping — its people, their tasks and the boards stay as they are.
 */
type Ctx = { params: Promise<{ teamId: string }> }
const nameSchema = z.object({ name: z.string().trim().min(1).max(80) })

export const PATCH = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  if (!isTeamAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { teamId } = await params
  const parsed = nameSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const changed = await prisma.boardTeam.updateMany({ where: { id: teamId, organizationId: auth.orgId }, data: { name: parsed.data.name } })
    if (changed.count === 0) return NextResponse.json({ error: "Team not found" }, { status: 404 })
    logAudit(auth.orgId, "update", "board_team", teamId, parsed.data.name)
    return NextResponse.json({ success: true, data: { id: teamId, name: parsed.data.name } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "A team of that name already exists", code: "TEAM_NAME_TAKEN" }, { status: 409 })
    }
    console.error("[tasks teams PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("tasks", "write", async (_req, auth, { params }: Ctx) => {
  if (!isTeamAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { teamId } = await params
  const team = await prisma.boardTeam.findFirst({ where: { id: teamId, organizationId: auth.orgId }, select: { id: true, name: true } })
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 })
  await prisma.boardTeam.deleteMany({ where: { id: teamId, organizationId: auth.orgId } })
  logAudit(auth.orgId, "delete", "board_team", teamId, team.name)
  return NextResponse.json({ success: true })
})
