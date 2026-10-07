import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { loadAndCompute } from "@/lib/cost-model/db"

export const GET = withRlsAuth("profitability", "read", async (_req, { orgId }) => {
  try {
    const result = await loadAndCompute(orgId)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error("Cost model analytics error:", error)
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 })
  }
})
