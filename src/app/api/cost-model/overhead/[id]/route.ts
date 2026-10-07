import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"
import { isValidServiceType, isKnownOverheadCategory } from "@/lib/cost-model/types"

type RouteContext = { params: Promise<{ id: string }> }

export const PUT = withRlsAuth<RouteContext>("profitability", "write", async (req, { orgId }, { params }) => {
  try {
    const { id } = await params
    const body = await req.json()

    // Validate if category or targetService are being changed
    if (body.category && !isKnownOverheadCategory(body.category)) {
      return NextResponse.json({ error: `Unknown overhead category "${body.category}"` }, { status: 400 })
    }
    if (body.targetService && !isValidServiceType(body.targetService)) {
      return NextResponse.json({ error: `Invalid targetService "${body.targetService}"` }, { status: 400 })
    }

    const existing = await prisma.overheadCost.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) {
      return NextResponse.json({ error: "Overhead cost not found" }, { status: 404 })
    }

    const updated = await prisma.overheadCost.update({
      where: { id },
      data: body,
    })

    await writeCostModelLog(orgId, "overhead_costs", id, "update", existing, updated)
    invalidateAiCache()

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error("Update overhead error:", error)
    return NextResponse.json({ error: "Failed to update overhead cost" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth<RouteContext>("profitability", "delete", async (_req, { orgId }, { params }) => {
  try {
    const { id } = await params

    const existing = await prisma.overheadCost.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) {
      return NextResponse.json({ error: "Overhead cost not found" }, { status: 404 })
    }

    await prisma.overheadCost.delete({ where: { id } })

    await writeCostModelLog(orgId, "overhead_costs", id, "delete", existing, null)
    invalidateAiCache()

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (error) {
    console.error("Delete overhead error:", error)
    return NextResponse.json({ error: "Failed to delete overhead cost" }, { status: 500 })
  }
})
