import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { prisma } from "@/lib/prisma"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"
import { isValidServiceType, isKnownOverheadCategory } from "@/lib/cost-model/types"

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
      const items = await prisma.overheadCost.findMany({
        where: { organizationId: orgId },
        orderBy: { sortOrder: "asc" },
      })

      return NextResponse.json({ success: true, data: items })
    })
  } catch (error) {
    console.error("Get overhead error:", error)
    return NextResponse.json({ error: "Failed to load overhead costs" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
      const body = await req.json()
      const { category, label, amount, isAnnual, hasVat, isAdmin, targetService, sortOrder, notes } = body

      if (!category || !label) {
        return NextResponse.json({ error: "Category and label are required" }, { status: 400 })
      }

      if (!isKnownOverheadCategory(category)) {
        return NextResponse.json({ error: `Unknown overhead category "${category}". Contact admin to add new categories.` }, { status: 400 })
      }

      if (targetService && !isValidServiceType(targetService)) {
        return NextResponse.json({ error: `Invalid targetService "${targetService}". Must be a valid service type.` }, { status: 400 })
      }

      const item = await prisma.overheadCost.create({
        data: {
          organizationId: orgId,
          category,
          label,
          amount: amount ?? 0,
          isAnnual: isAnnual ?? false,
          hasVat: hasVat ?? false,
          isAdmin: isAdmin ?? true,
          targetService: targetService ?? null,
          sortOrder: sortOrder ?? 0,
          notes: notes ?? null,
        },
      })

      await writeCostModelLog(orgId, "overhead_costs", item.id, "insert", null, item)
      invalidateAiCache()

      return NextResponse.json({ success: true, data: item }, { status: 201 })
    })
  } catch (error) {
    console.error("Create overhead error:", error)
    return NextResponse.json({ error: "Failed to create overhead cost" }, { status: 500 })
  }
}
