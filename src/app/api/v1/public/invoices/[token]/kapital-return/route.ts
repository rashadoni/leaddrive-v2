/**
 * Where Kapital Bank sends the customer back after its payment page, with
 * `?ID=<order id>&STATUS=<status>`. STATUS is not trusted — the bank calls it
 * temporary; the order's status is read from the bank before anything is
 * recorded. The customer lands on the invoice page with the outcome.
 */
import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import {
  findInvoiceByViewToken,
  invoicePageUrl,
  settleKapitalOrder,
} from "@/lib/payments/kapitalbank/invoice-checkout"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findInvoiceByViewToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const orderId = (req.nextUrl.searchParams.get("ID") || "").trim()
  let outcome: string = "open"
  let documentLanguage: string | null = null
  try {
    await runWithTenant(found.orgId, async () => {
      if (/^\d{1,20}$/.test(orderId)) {
        outcome = await settleKapitalOrder({ orgId: found.orgId, orderId, invoiceId: found.invoiceId })
      }
      const invoice = await prisma.invoice.findFirst({
        where: { id: found.invoiceId, organizationId: found.orgId },
        select: { documentLanguage: true },
      })
      documentLanguage = invoice?.documentLanguage ?? null
    })
  } catch (e) {
    console.error("[public/invoices] kapital return failed", e)
  }

  const page = new URL(invoicePageUrl(token, documentLanguage), req.nextUrl.origin)
  page.searchParams.set("payment", outcome === "paid" ? "paid" : outcome === "failed" ? "failed" : "pending")
  return NextResponse.redirect(page, 303)
}
