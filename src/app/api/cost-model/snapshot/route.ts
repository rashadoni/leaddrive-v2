import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { loadAndCompute, writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
    const result = await loadAndCompute(orgId)
    const summary = result.summary as any

    const now = new Date()
    const snapshotMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    const snapshot = await prisma.costModelSnapshot.upsert({
      where: {
        organizationId_snapshotMonth: {
          organizationId: orgId,
          snapshotMonth,
        },
      },
      update: {
        totalCost: summary?.totalCost ?? 0,
        totalRevenue: summary?.totalRevenue ?? 0,
        margin: summary?.margin ?? 0,
        marginPct: summary?.marginPct ?? 0,
        overheadTotal: summary?.overheadTotal ?? 0,
        employeeCost: summary?.employeeCost ?? 0,
        profitableClients: summary?.profitableClients ?? 0,
        lossClients: summary?.lossClients ?? 0,
        dataJson: JSON.stringify(result),
      },
      create: {
        organizationId: orgId,
        snapshotMonth,
        totalCost: summary?.totalCost ?? 0,
        totalRevenue: summary?.totalRevenue ?? 0,
        margin: summary?.margin ?? 0,
        marginPct: summary?.marginPct ?? 0,
        overheadTotal: summary?.overheadTotal ?? 0,
        employeeCost: summary?.employeeCost ?? 0,
        profitableClients: summary?.profitableClients ?? 0,
        lossClients: summary?.lossClients ?? 0,
        dataJson: JSON.stringify(result),
      },
    })

    await writeCostModelLog(orgId, "cost_model_snapshots", snapshot.id, "insert", null, { snapshotMonth })
    invalidateAiCache()

    return NextResponse.json({ success: true, data: snapshot }, { status: 201 })
    })
  } catch (error) {
    console.error("Create snapshot error:", error)
    return NextResponse.json({ error: "Failed to create snapshot" }, { status: 500 })
  }
}
