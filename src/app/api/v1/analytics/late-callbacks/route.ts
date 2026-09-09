import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { getOrgModuleContext } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { hasModule } from "@/lib/modules"
import { buildLateCallbackReport } from "@/lib/commitments/late-callbacks"

/**
 * Which callbacks promised to customers on an AI call were kept, kept late, or
 * never made — read-only, manager-scoped, computed from evidence rather than
 * from whether anyone ticked the task.
 */
export const GET = withRlsAuth("reports", "read", async (req, auth) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const orgCtx = await getOrgModuleContext(auth.orgId)
  if (!hasModule(orgCtx, "analytics") || !hasModule(orgCtx, "sales")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const rawDays = parseInt(req.nextUrl.searchParams.get("days") || "7", 10)
  const days = Number.isFinite(rawDays) ? Math.min(90, Math.max(1, rawDays)) : 7
  const rawTolerance = parseInt(req.nextUrl.searchParams.get("toleranceMinutes") || "0", 10)
  const toleranceMinutes = Number.isFinite(rawTolerance)
    ? Math.min(240, Math.max(0, rawTolerance))
    : 0

  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 3600_000)

  try {
    const report = await buildLateCallbackReport({
      organizationId: auth.orgId,
      from,
      to,
      toleranceMinutes,
    })
    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    console.error("[analytics/late-callbacks] failed", error)
    return NextResponse.json({ error: "Report failed" }, { status: 500 })
  }
})
