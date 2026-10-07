import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

export const GET = withRlsAuth("profitability", "read", async (_req, { orgId }) => {
  try {
    const snapshots = await prisma.costModelSnapshot.findMany({
      where: { organizationId: orgId },
      orderBy: { snapshotMonth: "desc" },
      select: {
        id: true,
        snapshotMonth: true,
        totalCost: true,
        totalRevenue: true,
        margin: true,
        marginPct: true,
        overheadTotal: true,
        employeeCost: true,
        profitableClients: true,
        lossClients: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ success: true, data: snapshots })
  } catch (error) {
    console.error("Get snapshots error:", error)
    return NextResponse.json({ error: "Failed to load snapshots" }, { status: 500 })
  }
})
