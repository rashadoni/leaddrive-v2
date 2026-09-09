import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

// GET — payment orders statistics
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const [draft, pending, approved, executed, totalAgg, executedAgg] = await Promise.all([
      prisma.paymentOrder.count({ where: { organizationId: orgId, status: "draft" } }),
      prisma.paymentOrder.count({ where: { organizationId: orgId, status: "pending_approval" } }),
      prisma.paymentOrder.count({ where: { organizationId: orgId, status: "approved" } }),
      prisma.paymentOrder.count({ where: { organizationId: orgId, status: "executed" } }),
      prisma.paymentOrder.aggregate({ where: { organizationId: orgId }, _sum: { amount: true } }),
      prisma.paymentOrder.aggregate({ where: { organizationId: orgId, status: "executed" }, _sum: { amount: true } }),
    ])

    return NextResponse.json({
      data: {
        totalDraft: draft,
        totalPending: pending,
        totalApproved: approved,
        totalExecuted: executed,
        totalAmount: totalAgg._sum.amount || 0,
        executedAmount: executedAgg._sum.amount || 0,
      },
    })
  })
}
