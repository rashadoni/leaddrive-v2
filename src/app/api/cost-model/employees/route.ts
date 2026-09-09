import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"
import { isValidDepartment, INCOME_TAX_RATE, DEPARTMENTS } from "@/lib/cost-model/types"

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
      const employees = await prisma.costEmployee.findMany({
        where: { organizationId: orgId },
        orderBy: { department: "asc" },
      })

      return NextResponse.json({ success: true, data: employees })
    })
  } catch (error) {
    console.error("Get employees error:", error)
    return NextResponse.json({ error: "Failed to load employees" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
      const body = await req.json()
      const { department, position, count, netSalary, inOverhead, notes } = body

      if (!department || !position) {
        return NextResponse.json({ error: "Department and position are required" }, { status: 400 })
      }

      if (!isValidDepartment(department)) {
        return NextResponse.json({ error: `Invalid department "${department}". Must be one of: ${DEPARTMENTS.join(", ")}` }, { status: 400 })
      }

      // Check for duplicate department + position
      const duplicate = await prisma.costEmployee.findFirst({
        where: { organizationId: orgId, department, position },
      })
      if (duplicate) {
        return NextResponse.json(
          { error: `Employee with department "${department}" and position "${position}" already exists` },
          { status: 409 },
        )
      }

      // Get employer tax rate from parameters
      const params = await prisma.pricingParameters.findUnique({
        where: { organizationId: orgId },
      })
      const employerTaxRate = params?.employerTaxRate ?? 0.175

      // Calculate gross and superGross from netSalary
      const net = netSalary ?? 0
      const grossSalary = net / (1 - INCOME_TAX_RATE)
      const superGross = grossSalary * (1 + employerTaxRate)

      const employee = await prisma.costEmployee.create({
        data: {
          organizationId: orgId,
          department,
          position,
          count: count ?? 1,
          netSalary: net,
          grossSalary,
          superGross,
          inOverhead: inOverhead ?? false,
          notes: notes ?? null,
        },
      })

      await writeCostModelLog(orgId, "cost_employees", employee.id, "insert", null, employee)
      invalidateAiCache()

      return NextResponse.json({ success: true, data: employee }, { status: 201 })
    })
  } catch (error) {
    console.error("Create employee error:", error)
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 })
  }
}
