import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

export const GET = withRlsAuth("profitability", "read", async (_req, { orgId }) => {
  try {
    const logs = await prisma.costModelLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    return NextResponse.json({ success: true, data: logs })
  } catch (error) {
    console.error("Get cost model logs error:", error)
    return NextResponse.json({ error: "Failed to load logs" }, { status: 500 })
  }
})
