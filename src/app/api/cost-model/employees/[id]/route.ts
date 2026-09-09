import { NextRequest, NextResponse } from "next/server"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"
import { isValidDepartment, INCOME_TAX_RATE, DEPARTMENTS } from "@/lib/cost-model/types"
import { runWithTenant } from "@/lib/rls-context"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuth(req, "settings", "write")
    if (isAuthError(authResult)) return authResult
    const orgId = authResult.orgId

    return runWithTenant(orgId, async () => {
      const { id } = await params
      const body = await req.json()

      if (body.department && !isValidDepartment(body.department)) {
        return NextResponse.json({ error: `Invalid department "${body.department}". Must be one of: ${DEPARTMENTS.join(", ")}` }, { status: 400 })
      }

      const existing = await prisma.costEmployee.findFirst({
        where: { id, organizationId: orgId },
      })
      if (!existing) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 })
      }

      // Recalculate gross/superGross if netSalary changed
      if (body.netSalary !== undefined && body.netSalary !== existing.netSalary) {
        const params = await prisma.pricingParameters.findUnique({
          where: { organizationId: orgId },
        })
        const employerTaxRate = params?.employerTaxRate ?? 0.175

        body.grossSalary = body.netSalary / (1 - INCOME_TAX_RATE)
        body.superGross = body.grossSalary * (1 + employerTaxRate)
      }

      const updated = await prisma.costEmployee.update({
        where: { id },
        data: body,
      })

      await writeCostModelLog(orgId, "cost_employees", id, "update", existing, updated)
      invalidateAiCache()

      return NextResponse.json({ success: true, data: updated })
    })
  } catch (error) {
    console.error("Update employee error:", error)
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAuth(req, "settings", "delete")
    if (isAuthError(authResult)) return authResult
    const orgId = authResult.orgId

    return runWithTenant(orgId, async () => {
      const { id } = await params

      const existing = await prisma.costEmployee.findFirst({
        where: { id, organizationId: orgId },
      })
      if (!existing) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 })
      }

      await prisma.costEmployee.delete({ where: { id } })

      await writeCostModelLog(orgId, "cost_employees", id, "delete", existing, null)
      invalidateAiCache()

      return NextResponse.json({ success: true, data: { deleted: id } })
    })
  } catch (error) {
    console.error("Delete employee error:", error)
    return NextResponse.json({ error: "Failed to delete employee" }, { status: 500 })
  }
}
