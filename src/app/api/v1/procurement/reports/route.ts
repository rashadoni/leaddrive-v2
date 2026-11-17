import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { procurementReport, reportPeriod } from "@/lib/procurement/reports"
import { badRequest } from "@/lib/procurement/access"

/** Purchasing reports for a period (task 7.1). Spend and margins: the `procurement-costs` scope. */
export const GET = withRlsAuth("procurement-costs", "read", async (req, { orgId }) => {
  const period = reportPeriod(new URL(req.url).searchParams)
  if (!period) return badRequest("Invalid period", "INVALID_PERIOD")
  return NextResponse.json({ success: true, data: await procurementReport(orgId, period.from, period.to) })
})
