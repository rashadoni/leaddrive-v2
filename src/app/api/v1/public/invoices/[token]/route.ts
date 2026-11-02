/**
 * The invoice a customer opens from its link (`/portal/invoice/<viewToken>`):
 * what is owed and whether it can be paid by card here. The token is the
 * whole credential; the page shows what the e-mailed invoice already shows.
 */
import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { findInvoiceByViewToken, publicInvoiceView } from "@/lib/payments/kapitalbank/invoice-checkout"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findInvoiceByViewToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const view = await runWithTenant(found.orgId, () => publicInvoiceView(found.orgId, found.invoiceId))
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: view }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[public/invoices] view failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
