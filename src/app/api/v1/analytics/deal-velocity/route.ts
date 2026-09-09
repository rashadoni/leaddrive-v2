import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { dealVelocityAnalysis } from "@/lib/ai/predictive"
import { getOrgModuleContext } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { hasModule } from "@/lib/modules"

export const GET = withRlsAuth("reports", "read", async (_req, auth) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const orgCtx = await getOrgModuleContext(auth.orgId)
  if (!hasModule(orgCtx, "analytics") || !hasModule(orgCtx, "sales")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const velocity = await dealVelocityAnalysis(auth.orgId)
    return NextResponse.json({ success: true, data: velocity })
  } catch (e: any) {
    console.error("Deal velocity error:", e)
    return NextResponse.json({ error: "Failed to analyze deal velocity" }, { status: 500 })
  }
})
