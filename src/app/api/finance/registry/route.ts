import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

// GET — payment registry with filters and stats
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const { searchParams } = new URL(req.url)
    const direction = searchParams.get("direction")
    const dateFrom = searchParams.get("dateFrom")
    const dateTo = searchParams.get("dateTo")
    const category = searchParams.get("category")
    const counterparty = searchParams.get("counterparty")
    const sourceType = searchParams.get("sourceType")
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100)

    const where: any = { organizationId: orgId }
    if (direction) where.direction = direction
    if (category) where.category = category
    if (sourceType) where.sourceType = sourceType
    if (counterparty) where.counterpartyName = { contains: counterparty, mode: "insensitive" }
    if (dateFrom || dateTo) {
      where.paymentDate = {}
      if (dateFrom) where.paymentDate.gte = new Date(dateFrom)
      if (dateTo) where.paymentDate.lte = new Date(dateTo + "T23:59:59Z")
    }

    const [entries, total, incomingAgg, outgoingAgg, pendingOrders] = await Promise.all([
      prisma.paymentRegistryEntry.findMany({
        where,
        orderBy: { paymentDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.paymentRegistryEntry.count({ where }),
      prisma.paymentRegistryEntry.aggregate({
        where: { organizationId: orgId, direction: "incoming" },
        _sum: { amount: true },
      }),
      prisma.paymentRegistryEntry.aggregate({
        where: { organizationId: orgId, direction: "outgoing" },
        _sum: { amount: true },
      }),
      prisma.paymentOrder.count({
        where: { organizationId: orgId, status: { in: ["pending_approval", "approved"] } },
      }),
    ])

    const totalIncoming = incomingAgg._sum.amount || 0
    const totalOutgoing = outgoingAgg._sum.amount || 0

    return NextResponse.json({
      data: entries,
      stats: {
        totalIncoming,
        totalOutgoing,
        netFlow: totalIncoming - totalOutgoing,
        pendingOrdersCount: pendingOrders,
      },
      total,
      page,
      limit,
    })
  })
}
