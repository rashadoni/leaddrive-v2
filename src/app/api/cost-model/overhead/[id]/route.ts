import { NextRequest, NextResponse } from "next/server"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"
import { isValidServiceType, isKnownOverheadCategory } from "@/lib/cost-model/types"
import { runWithTenant } from "@/lib/rls-context"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuth(req, "settings", "write")
    if (isAuthError(authResult)) return authResult
    const orgId = authResult.orgId

    return runWithTenant(orgId, async () => {
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
    })
  } catch (error) {
    console.error("Update overhead error:", error)
    return NextResponse.json({ error: "Failed to update overhead cost" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuth(req, "settings", "delete")
    if (isAuthError(authResult)) return authResult
    const orgId = authResult.orgId

    return runWithTenant(orgId, async () => {
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
    })
  } catch (error) {
    console.error("Delete overhead error:", error)
    return NextResponse.json({ error: "Failed to delete overhead cost" }, { status: 500 })
  }
}
