import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

// GET — payment orders statistics
export const GET = withRlsAuth("finance", "read", async (_req, { orgId }) => {
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
