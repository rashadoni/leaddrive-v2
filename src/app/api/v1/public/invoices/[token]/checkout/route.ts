/**
 * «Pay» on the public invoice page: opens a Kapital Bank order for the
 * balance due and answers with the bank's payment page to go to.
 */
import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { findInvoiceByViewToken, startInvoiceCheckout } from "@/lib/payments/kapitalbank/invoice-checkout"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findInvoiceByViewToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const result = await runWithTenant(found.orgId, () =>
      startInvoiceCheckout({ orgId: found.orgId, invoiceId: found.invoiceId, viewToken: token }),
    )
    if (result.ok) return NextResponse.json({ success: true, data: { url: result.url } })
    if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.reason === "bank_error") {
      return NextResponse.json({ error: "Bank is unavailable", code: "BANK_ERROR" }, { status: 502 })
    }
    return NextResponse.json({ error: "Online payment is unavailable", code: result.reason.toUpperCase() }, { status: 409 })
  } catch (e) {
    console.error("[public/invoices] checkout failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
