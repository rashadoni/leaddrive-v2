import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { resolveOrgDefaultCurrency } from "@/lib/org-default-currency"

/**
 * GET — the currency new records start in for the caller's organisation
 * (src/lib/org-default-currency.ts). Any signed-in member may read it: a
 * seller creating a deal or an offer needs it as much as an admin does, and
 * a currency code discloses nothing. It sits outside /api/v1/settings on
 * purpose — that prefix maps to the settings module, which sales, support and
 * ticketing roles cannot read, and they would silently keep the old default.
 */
export const GET = withRls(async (_req, { orgId }) => {
  try {
    return NextResponse.json({ success: true, data: { defaultCurrency: await resolveOrgDefaultCurrency(orgId) } })
  } catch (e) {
    console.error("Organization default currency GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
