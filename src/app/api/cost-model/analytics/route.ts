import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { loadAndCompute } from "@/lib/cost-model/db"

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req)
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const result = await loadAndCompute(orgId)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error("Cost model analytics error:", error)
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 })
  }
}
