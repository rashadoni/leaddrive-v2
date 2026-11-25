/**
 * POST /api/v1/invoices/:id/protocol-deviation { reason }
 *
 * An invoice of a contract may price a line differently from the contract's
 * price protocol — but not silently (owner 2026-11-25, mock «Протокол цены и
 * акт»). The person writes why; the reason and the lines it covers go to the
 * invoice's history. Refused when nothing deviates: a reason for nothing would
 * read as if something did.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { activeProtocol, priceDeviations, toNumber, type ProtocolRow } from "@/lib/clm/contract-documents"

const bodySchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict()

export const POST = withRlsAuth("invoices", "write", async (req, { orgId, userId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, invoiceNumber: true, contractId: true, items: { orderBy: { sortOrder: "asc" }, select: { productId: true, name: true, unitPrice: true } } },
    })
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!invoice.contractId) return NextResponse.json({ error: "No contract", code: "NO_PROTOCOL" }, { status: 409 })
    const protocols: Array<ProtocolRow & { lines: Array<{ productId: string | null; name: string; unitPrice: unknown }> }> = await prisma.contractDocument.findMany({
      where: { organizationId: orgId, contractId: invoice.contractId, kind: "price_protocol", status: { not: "cancelled" } },
      select: {
        id: true, number: true, status: true, validFrom: true, validTo: true, documentDate: true,
        lines: { orderBy: { position: "asc" }, select: { productId: true, name: true, unitPrice: true } },
      },
    })
    const active = activeProtocol(protocols, new Date())
    if (!active) return NextResponse.json({ error: "No price protocol", code: "NO_PROTOCOL" }, { status: 409 })
    const deviations = priceDeviations(
      invoice.items,
      active.protocol.lines.map((l: { productId: string | null; name: string; unitPrice: unknown }) => ({ productId: l.productId, name: l.name, unitPrice: toNumber(l.unitPrice) ?? 0 })),
    )
    if (deviations.length === 0) return NextResponse.json({ error: "Prices match the protocol", code: "NO_DEVIATION" }, { status: 409 })
    await logAudit(orgId, "price_deviation", "invoice", invoice.id, invoice.invoiceNumber, {
      newValue: { reason: parsed.data.reason, protocolNumber: active.protocol.number, deviations },
      ...(userId ? { userId } : {}),
    })
    return NextResponse.json({ success: true, data: { deviations } })
  } catch (e) {
    console.error("[invoices/:id/protocol-deviation POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
