import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
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
    })
  } catch (error) {
    console.error("Get snapshots error:", error)
    return NextResponse.json({ error: "Failed to load snapshots" }, { status: 500 })
  }
}
