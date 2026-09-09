import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, isAuthError, getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"

const parametersSchema = z.object({
  totalUsers: z.number().int().min(0).max(999999).nullish(),
  totalEmployees: z.number().int().min(0).max(999999).optional(),
  technicalStaff: z.number().int().min(0).max(999999).optional(),
  backOfficeStaff: z.number().int().min(0).max(999999).optional(),
  monthlyWorkHours: z.number().int().min(1).max(744).optional(),
  vatRate: z.number().min(0).max(1).optional(),
  employerTaxRate: z.number().min(0).max(1).optional(),
  riskRate: z.number().min(0).max(1).optional(),
  miscExpenseRate: z.number().min(0).max(1).optional(),
  fixedOverheadRatio: z.number().min(0).max(1).optional(),
  updatedBy: z.string().max(100).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
      const params = await prisma.pricingParameters.findUnique({
        where: { organizationId: orgId },
      })

      return NextResponse.json({ success: true, data: params })
    })
  } catch (error) {
    console.error("Get parameters error:", error)
    return NextResponse.json({ error: "Failed to load parameters" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authResult = await requireAuth(req, "settings", "write")
    if (isAuthError(authResult)) return authResult
    const orgId = authResult.orgId

    const body = await req.json()
    const parsed = parametersSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const validData = { ...parsed.data }

    return runWithTenant(orgId, async () => {
      const oldParams = await prisma.pricingParameters.findUnique({
        where: { organizationId: orgId },
      })

      // If totalUsers not manually set, recalculate from companies
      if (validData.totalUsers === undefined || validData.totalUsers === null) {
        const agg = await prisma.company.aggregate({
          where: { organizationId: orgId, category: "client" },
          _sum: { userCount: true },
        })
        validData.totalUsers = agg._sum.userCount ?? oldParams?.totalUsers ?? 0
      }

      const updated = await prisma.pricingParameters.upsert({
        where: { organizationId: orgId },
        update: { ...validData, updatedAt: new Date() },
        create: { organizationId: orgId, ...validData },
      })

      await writeCostModelLog(orgId, "pricing_parameters", updated.id, "update", oldParams, updated)
      invalidateAiCache()

      return NextResponse.json({ success: true, data: updated })
    })
  } catch (error) {
    console.error("Update parameters error:", error)
    return NextResponse.json({ error: "Failed to update parameters" }, { status: 500 })
  }
}
