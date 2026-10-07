import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

type RouteContext = { params: Promise<{ month: string }> }

export const GET = withRlsAuth<RouteContext>("profitability", "read", async (_req, { orgId }, { params }) => {
  try {
    const { month } = await params

    const snapshot = await prisma.costModelSnapshot.findUnique({
      where: {
        organizationId_snapshotMonth: {
          organizationId: orgId,
          snapshotMonth: month,
        },
      },
    })

    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 })
    }

    // Parse dataJson and return the full data
    let data: unknown = null
    try {
      data = typeof snapshot.dataJson === "string" ? JSON.parse(snapshot.dataJson) : snapshot.dataJson
    } catch {
      data = snapshot.dataJson
    }

    return NextResponse.json({
      success: true,
      data: {
        ...snapshot,
        dataJson: data,
      },
    })
  } catch (error) {
    console.error("Get snapshot error:", error)
    return NextResponse.json({ error: "Failed to load snapshot" }, { status: 500 })
  }
})
