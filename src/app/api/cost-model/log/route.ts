import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
      const logs = await prisma.costModelLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 100,
      })

      return NextResponse.json({ success: true, data: logs })
    })
  } catch (error) {
    console.error("Get cost model logs error:", error)
    return NextResponse.json({ error: "Failed to load logs" }, { status: 500 })
  }
}
