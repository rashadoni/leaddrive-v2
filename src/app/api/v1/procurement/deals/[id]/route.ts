import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { dealProcurementSummary } from "@/lib/procurement/deal-summary"
import { canSeeProcurementCosts, notFound, withoutPrices } from "@/lib/procurement/access"

/** The purchasing of one deal — its «Purchasing» tab (tasks 4.3, 6.1). */
export const GET = withRlsAuth("purchase-requests", "read", async (_req, { orgId, role }, { params }: { params: Promise<{ id: string }> }) => {
  if (!checkPermission(role, "deals", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const summary = await dealProcurementSummary(orgId, id)
  if (!summary) return notFound()
  return NextResponse.json({ success: true, data: canSeeProcurementCosts(role) ? summary : withoutPrices(summary) })
})
