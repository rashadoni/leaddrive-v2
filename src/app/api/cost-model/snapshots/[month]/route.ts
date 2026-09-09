import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

export async function GET(req: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    return runWithTenant(orgId, async () => {
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
    })
  } catch (error) {
    console.error("Get snapshot error:", error)
    return NextResponse.json({ error: "Failed to load snapshot" }, { status: 500 })
  }
}
