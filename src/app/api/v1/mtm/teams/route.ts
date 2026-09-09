/**
 * M4-5 — MTM Teams CRUD (list + create).
 * Route: GET/POST /api/v1/mtm/teams
 *
 * Teams are the mid-level unit in the Region → Team → Agent hierarchy.
 * Optionally scoped by regionId query param for region-scoped dashboards.
 *
 * GET  — any authenticated caller may list teams.
 * POST — ADMIN or MANAGER only (mobile JWT); web admin panel unrestricted.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { assertMtmAdmin } from "@/lib/mtm/auth-gate"
import { prisma } from "@/lib/prisma"

export const GET = withRls(async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const regionId = searchParams.get("regionId") || undefined
  const includeInactive = searchParams.get("includeInactive") === "true"

  try {
    const where: Record<string, unknown> = { organizationId: orgId }
    if (regionId) where.regionId = regionId
    if (!includeInactive) where.isActive = true

    const teams = await prisma.mtmTeam.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        region: { select: { id: true, name: true } },
        _count: { select: { agents: true } },
      },
    })

    return NextResponse.json({ success: true, data: { teams, total: teams.length } })
  } catch (e) {
    console.error("[MTM/teams GET]", e)
    return NextResponse.json({ error: "Failed to load teams" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {

  const forbidden = await assertMtmAdmin(req, orgId)
  if (forbidden) return forbidden

  try {
    const body = await req.json() as Record<string, unknown>
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    // If a regionId is given, verify it belongs to the same org.
    if (body.regionId) {
      const region = await prisma.mtmRegion.findFirst({
        where: { id: body.regionId as string, organizationId: orgId },
        select: { id: true },
      })
      if (!region) return NextResponse.json({ error: "regionId not found in this organization" }, { status: 400 })
    }

    const team = await prisma.mtmTeam.create({
      data: {
        organizationId: orgId,
        name,
        code: typeof body.code === "string" ? body.code.trim() || null : null,
        regionId: typeof body.regionId === "string" ? body.regionId : null,
        isActive: body.isActive !== false,
      },
      include: { region: { select: { id: true, name: true } } },
    })

    return NextResponse.json({ success: true, data: { team } }, { status: 201 })
  } catch (e) {
    console.error("[MTM/teams POST]", e)
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 })
  }
})
