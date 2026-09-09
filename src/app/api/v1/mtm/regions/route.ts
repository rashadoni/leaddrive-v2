/**
 * M4-5 — MTM Regions CRUD (list + create).
 * Route: GET/POST /api/v1/mtm/regions
 *
 * Regions are the top-level geographic unit in the Region → Team → Agent
 * hierarchy. Each region belongs to one organization (multi-tenant).
 *
 * GET   — any authenticated caller (web admin or mobile JWT) may list regions.
 * POST  — restricted to ADMIN or MANAGER role.
 *         Web admin panel (cookie session) has no mobile JWT → passes through.
 *         Mobile JWT callers must carry role=ADMIN or role=MANAGER.
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { assertMtmAdmin } from "@/lib/mtm/auth-gate"
import { prisma } from "@/lib/prisma"

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const includeInactive = searchParams.get("includeInactive") === "true"

  try {
    const where: Record<string, unknown> = { organizationId: orgId }
    if (!includeInactive) where.isActive = true

    const regions = await prisma.mtmRegion.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { teams: true } },
      },
    })

    return NextResponse.json({ success: true, data: { regions, total: regions.length } })
  } catch (e) {
    console.error("[MTM/regions GET]", e)
    return NextResponse.json({ error: "Failed to load regions" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {
  const forbidden = await assertMtmAdmin(req, orgId)
  if (forbidden) return forbidden

  try {
    const body = await req.json() as Record<string, unknown>
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    const region = await prisma.mtmRegion.create({
      data: {
        organizationId: orgId,
        name,
        code: typeof body.code === "string" ? body.code.trim() || null : null,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        isActive: body.isActive !== false,
      },
    })

    return NextResponse.json({ success: true, data: { region } }, { status: 201 })
  } catch (e) {
    console.error("[MTM/regions POST]", e)
    return NextResponse.json({ error: "Failed to create region" }, { status: 500 })
  }
})
