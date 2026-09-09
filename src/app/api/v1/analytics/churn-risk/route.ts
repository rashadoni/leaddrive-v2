import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { calculateChurnRisk } from "@/lib/ai/predictive"
import { getOrgModuleContext } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { hasModule } from "@/lib/modules"

export const GET = withRlsAuth("reports", "read", async (req, auth) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const orgCtx = await getOrgModuleContext(auth.orgId)
  if (!hasModule(orgCtx, "analytics") || !hasModule(orgCtx, "sales")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "10")

  try {
    const risks = await calculateChurnRisk(auth.orgId)
    return NextResponse.json({ success: true, data: risks.slice(0, limit) })
  } catch (e: any) {
    console.error("Churn risk error:", e)
    return NextResponse.json({ error: "Failed to calculate churn risk" }, { status: 500 })
  }
})
