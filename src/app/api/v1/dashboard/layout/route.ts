import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { validateLayout, type DashboardLayoutPayload } from "@/lib/dashboard/widgets"
import { withRls } from "@/lib/with-rls"

/**
 * Per-user dashboard layout persistence. PRE-EXISTING BUG FIX (I2 slice 1):
 * previous version referenced `dashboardLayout.layoutConfig` which doesn't
 * exist in the schema — the real field is `layout` (`prisma/schema.prisma:1746`).
 * Calls to this route used to error silently; now they hit the correct column.
 *
 * I2 slice 1 also wires `validateLayout` so malformed payloads (unknown
 * widget types, missing required config, position overflow, overlapping
 * widgets, duplicate ids) are rejected with a 400 + structured issue list.
 */

export const GET = withRls(async (_req, { orgId, session }) => {
  const userId = session?.userId

  try {
    const layout = await prisma.dashboardLayout.findFirst({
      where: { organizationId: orgId, userId: userId || "" },
      select: { id: true, name: true, layout: true, isDefault: true },
    })
    return NextResponse.json({
      success: true,
      data: layout
        ? { id: layout.id, name: layout.name, isDefault: layout.isDefault, layout: layout.layout }
        : null,
    })
  } catch (e) {
    console.error("[dashboard/layout GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId, session }) => {
  const userId = session?.userId || ""

  let body: { layout?: DashboardLayoutPayload; name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.layout) {
    return NextResponse.json({ error: "layout payload required" }, { status: 400 })
  }

  // Validate via shared widget contracts. Reject malformed before write.
  const validation = validateLayout(body.layout)
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Invalid layout", issues: validation.issues },
      { status: 400 }
    )
  }

  try {
    const existing = await prisma.dashboardLayout.findFirst({
      where: { organizationId: orgId, userId },
    })

    if (existing) {
      await prisma.dashboardLayout.update({
        where: { id: existing.id },
        data: {
          layout: body.layout as unknown as object,
          ...(body.name ? { name: body.name } : {}),
        },
      })
    } else {
      await prisma.dashboardLayout.create({
        data: {
          organizationId: orgId,
          userId,
          name: body.name || "Default",
          layout: body.layout as unknown as object,
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[dashboard/layout PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
