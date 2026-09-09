import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { predictDealWin } from "@/lib/ai/predictive"
import { getOrgModuleContext } from "@/lib/api-auth"
import { canRead } from "@/lib/permissions"
import { hasModule } from "@/lib/modules"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { prisma } from "@/lib/prisma"

export const GET = withRlsAuth("deals", "read", async (req, auth) => {
  const dealId = req.nextUrl.searchParams.get("dealId")
  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 })

  try {
    if (!canRead(auth.role, "deals")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const orgCtx = await getOrgModuleContext(auth.orgId)
    if (!hasModule(orgCtx, "sales") || !hasModule(orgCtx, "analytics")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const visibleDealWhere = await applyRecordFilter(
      auth.orgId,
      auth.userId,
      auth.role,
      "deal",
      { id: dealId, organizationId: auth.orgId },
    )
    const visibleDeal = await prisma.deal.findFirst({
      where: visibleDealWhere,
      select: { id: true },
    })
    if (!visibleDeal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    }

    const prediction = await predictDealWin(visibleDeal.id, auth.orgId)
    return NextResponse.json({ success: true, data: prediction })
  } catch (e: any) {
    console.error("Deal prediction error:", e)
    return NextResponse.json({ error: "Failed to predict deal" }, { status: 500 })
  }
})
