import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { procurementNumber } from "@/lib/procurement/numbering"
import { generatePurchaseOrderPdf } from "@/lib/procurement/order-pdf"

/**
 * The purchase order as a PDF for the supplier. It carries prices, so it is
 * the `procurement-costs` scope; `?lang=ru|en` changes its language,
 * `?download=1` saves instead of opening.
 */
export const GET = withRlsAuth("procurement-costs", "read", async (req: NextRequest, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const [order, organization] = await Promise.all([
    prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      include: { items: { orderBy: { sortOrder: "asc" } }, supplier: { select: { name: true, voen: true, address: true, phone: true, email: true } } },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
  ])
  if (!order || !organization) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const { searchParams } = new URL(req.url)
  const number = procurementNumber("order", order.seq)
  const pdf = generatePurchaseOrderPdf({
    lang: searchParams.get("lang"),
    number,
    createdAt: order.createdAt,
    expectedDeliveryAt: order.expectedDeliveryAt,
    currency: order.currency,
    totalAmount: order.totalAmount.toString(),
    note: order.note,
    buyer: { name: organization.name },
    supplier: order.supplier,
    items: order.items.map((item) => ({ name: item.name, unit: item.unit, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), total: item.total.toString() })),
  })
  const disposition = searchParams.get("download") === "1" ? "attachment" : "inline"
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
})
