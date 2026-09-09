/**
 * M4-5 — MTM Region detail (GET / PATCH / DELETE).
 * Route: /api/v1/mtm/regions/[id]
 *
 * GET    — any authenticated caller may read a region's detail.
 * PATCH  — ADMIN or MANAGER only (mobile JWT); web admin panel unrestricted.
 * DELETE — ADMIN or MANAGER only (mobile JWT); web admin panel unrestricted.
 */
import { NextResponse } from "next/server"
import { assertMtmAdmin } from "@/lib/mtm/auth-gate"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const region = await prisma.mtmRegion.findFirst({
      where: { id, organizationId: orgId },
      include: {
        teams: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          include: { _count: { select: { agents: true } } },
        },
      },
    })
    if (!region) return NextResponse.json({ error: "Region not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { region } })
  } catch (e) {
    console.error("[MTM/regions/:id GET]", e)
    return NextResponse.json({ error: "Failed to load region" }, { status: 500 })
  }
})

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const forbidden = await assertMtmAdmin(req, orgId)
  if (forbidden) return forbidden

  const { id } = await params
  try {
    const body = await req.json() as Record<string, unknown>
    const data: Record<string, unknown> = {}
    if (typeof body.name === "string") data.name = body.name.trim()
    if ("code" in body) data.code = typeof body.code === "string" ? body.code.trim() || null : null
    if ("description" in body) data.description = typeof body.description === "string" ? body.description.trim() || null : null
    if (typeof body.isActive === "boolean") data.isActive = body.isActive

    const region = await prisma.mtmRegion.updateMany({
      where: { id, organizationId: orgId },
      data,
    })
    if (region.count === 0) return NextResponse.json({ error: "Region not found" }, { status: 404 })

    const updated = await prisma.mtmRegion.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: { region: updated } })
  } catch (e) {
    console.error("[MTM/regions/:id PATCH]", e)
    return NextResponse.json({ error: "Failed to update region" }, { status: 500 })
  }
})

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const forbidden = await assertMtmAdmin(req, orgId)
  if (forbidden) return forbidden

  const { id } = await params
  try {
    // Soft-delete: set isActive=false so teams retain their regionId FK.
    const result = await prisma.mtmRegion.updateMany({
      where: { id, organizationId: orgId },
      data: { isActive: false },
    })
    if (result.count === 0) return NextResponse.json({ error: "Region not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[MTM/regions/:id DELETE]", e)
    return NextResponse.json({ error: "Failed to delete region" }, { status: 500 })
  }
})
