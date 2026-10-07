import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { loadAndCompute } from "@/lib/cost-model/db"

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRlsAuth<RouteContext>("profitability", "read", async (_req, { orgId }, { params }) => {
  try {
    const { id } = await params
    const result = await loadAndCompute(orgId)

    const client = result.clients?.find((c) => (c as any).companyId === id || c.id === id)
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: client })
  } catch (error) {
    console.error("Client analytics error:", error)
    return NextResponse.json({ error: "Failed to load client analytics" }, { status: 500 })
  }
})
