/**
 * M4-5 — MTM Team detail (GET / PATCH / DELETE).
 * Route: /api/v1/mtm/teams/[id]
 *
 * GET    — team detail; the member list follows the caller's field scope
 *          (names and emails are people data, same rule as GET /mtm/agents).
 * PATCH  — administrators only (web admin/superadmin or MTM ADMIN; see auth-gate.ts):
 *          a team's region decides whose territory its agents fall into.
 * DELETE — administrators only.
 */
import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"
import { assertMtmAdmin } from "@/lib/mtm/auth-gate"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    // Members are people data: a web user sees only the members inside their
    // field scope, exactly like GET /mtm/agents. API keys stay organization-wide.
    let memberScope: Prisma.MtmAgentWhereInput = {}
    if (session) {
      const scope = await resolveMtmFieldScope(prisma, {
        organizationId: orgId,
        userId: session.userId,
        webRole: session.role,
      })
      if (scope.kind === "none") return mtmFieldScopeRequiredResponse()
      if (scope.kind === "agents") memberScope = { id: { in: scope.agentIds } }
    }
    const team = await prisma.mtmTeam.findFirst({
      where: { id, organizationId: orgId },
      include: {
        region: { select: { id: true, name: true, code: true } },
        agents: {
          where: { status: "ACTIVE", ...memberScope },
          orderBy: { name: "asc" },
          select: { id: true, name: true, role: true, email: true, avatar: true },
        },
      },
    })
    if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { team } })
  } catch (e) {
    console.error("[MTM/teams/:id GET]", e)
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 })
  }
})

export const PATCH = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const forbidden = await assertMtmAdmin(req, auth)
  if (forbidden) return forbidden

  const { id } = await params
  try {
    const body = await req.json() as Record<string, unknown>
    const data: Record<string, unknown> = {}
    if (typeof body.name === "string") data.name = body.name.trim()
    if ("code" in body) data.code = typeof body.code === "string" ? body.code.trim() || null : null
    if (typeof body.isActive === "boolean") data.isActive = body.isActive

    // regionId: null = detach from region; valid string = attach (with org check)
    if ("regionId" in body) {
      if (body.regionId === null || body.regionId === "") {
        data.regionId = null
      } else if (typeof body.regionId === "string") {
        const region = await prisma.mtmRegion.findFirst({
          where: { id: body.regionId, organizationId: orgId },
          select: { id: true },
        })
        if (!region) return NextResponse.json({ error: "regionId not found in this organization" }, { status: 400 })
        data.regionId = body.regionId
      }
    }

    const result = await prisma.mtmTeam.updateMany({
      where: { id, organizationId: orgId },
      data,
    })
    if (result.count === 0) return NextResponse.json({ error: "Team not found" }, { status: 404 })

    const updated = await prisma.mtmTeam.findFirst({
      where: { id, organizationId: orgId },
      include: { region: { select: { id: true, name: true } } },
    })
    return NextResponse.json({ success: true, data: { team: updated } })
  } catch (e) {
    console.error("[MTM/teams/:id PATCH]", e)
    return NextResponse.json({ error: "Failed to update team" }, { status: 500 })
  }
})

export const DELETE = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const forbidden = await assertMtmAdmin(req, auth)
  if (forbidden) return forbidden

  const { id } = await params
  try {
    // Soft-delete: set isActive=false. Agents retain their teamId FK.
    const result = await prisma.mtmTeam.updateMany({
      where: { id, organizationId: orgId },
      data: { isActive: false },
    })
    if (result.count === 0) return NextResponse.json({ error: "Team not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[MTM/teams/:id DELETE]", e)
    return NextResponse.json({ error: "Failed to delete team" }, { status: 500 })
  }
})
