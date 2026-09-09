import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const offer = await prisma.offer.findFirst({
    where: { id, organizationId: orgId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      company: { select: { name: true, address: true, email: true, phone: true } },
      contact: { select: { fullName: true, email: true, phone: true } },
      organization: { select: { name: true } },
    },
  })

  if (!offer) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const doc = new jsPDF()
  const FONT = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = 20

  // Header
  doc.setFontSize(20)
  doc.setFont(FONT, "bold")
  doc.text(offer.organization?.name || "LeadDrive CRM", 14, y)
  y += 10

  doc.setFontSize(14)
  doc.text(`Offer #${offer.offerNumber || offer.id.slice(0, 8)}`, 14, y)
  y += 8

  // Status & Date
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.text(`Status: ${(offer.status || "draft").toUpperCase()}`, 14, y)
  doc.text(`Date: ${new Date(offer.createdAt).toLocaleDateString()}`, pageWidth - 60, y)
  y += 6

  if (offer.validUntil) {
    doc.text(`Valid until: ${new Date(offer.validUntil).toLocaleDateString()}`, 14, y)
    y += 6
  }

  y += 4

  // Divider
  doc.setDrawColor(200)
  doc.line(14, y, pageWidth - 14, y)
  y += 8

  // Client info
  doc.setFont(FONT, "bold")
  doc.setFontSize(11)
  doc.text("Bill To:", 14, y)
  y += 6

  doc.setFont(FONT, "normal")
  doc.setFontSize(10)
  if (offer.company) {
    doc.text(offer.company.name, 14, y); y += 5
    if (offer.company.address) { doc.text(offer.company.address, 14, y); y += 5 }
    if (offer.company.email) { doc.text(offer.company.email, 14, y); y += 5 }
    if (offer.company.phone) { doc.text(offer.company.phone, 14, y); y += 5 }
  }
  if (offer.contact) {
    doc.text(`Attn: ${offer.contact.fullName}`, 14, y); y += 5
    if (offer.contact.email) { doc.text(offer.contact.email, 14, y); y += 5 }
  }
  if (offer.clientName && !offer.company) {
    doc.text(offer.clientName, 14, y); y += 5
    if (offer.clientEmail) { doc.text(offer.clientEmail, 14, y); y += 5 }
  }

  y += 6

  // Items table header
  const colX = [14, 100, 125, 150, pageWidth - 14]
  doc.setFillColor(245, 245, 245)
  doc.rect(14, y - 4, pageWidth - 28, 8, "F")
  doc.setFont(FONT, "bold")
  doc.setFontSize(9)
  doc.text("Item", colX[0] + 2, y)
  doc.text("Qty", colX[1], y)
  doc.text("Price", colX[2], y)
  doc.text("Disc %", colX[3], y)
  doc.text("Total", colX[4] - 30, y, { align: "right" })
  y += 8

  // Items
  doc.setFont(FONT, "normal")
  const items = offer.items || []
  const currency = offer.currency || DEFAULT_CURRENCY

  for (const item of items) {
    if (y > 260) { doc.addPage(); y = 20 }
    const itemTotal = (item as any).total || (item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100))
    doc.text((item as any).name || (item as any).description || "Item", colX[0] + 2, y, { maxWidth: 80 })
    doc.text(String(item.quantity), colX[1], y)
    doc.text(`${item.unitPrice.toLocaleString()}`, colX[2], y)
    doc.text(`${item.discount || 0}%`, colX[3], y)
    doc.text(`${itemTotal.toLocaleString()} ${currency}`, colX[4] - 30, y, { align: "right" })
    y += 7
  }

  y += 4
  doc.line(14, y, pageWidth - 14, y)
  y += 8

  // Totals
  const subtotal = (offer as any).subtotal || items.reduce((s: number, i: any) => s + (i.total || i.quantity * i.unitPrice * (1 - (i.discount || 0) / 100)), 0)
  const vatRate = (offer as any).vatRate || 18
  const vatAmount = (offer as any).vatAmount || subtotal * vatRate / 100
  const totalAmount = (offer as any).totalAmount || subtotal + vatAmount
  const discount = (offer as any).discountAmount || 0

  doc.setFont(FONT, "normal")
  doc.text("Subtotal:", pageWidth - 80, y)
  doc.text(`${subtotal.toLocaleString()} ${currency}`, pageWidth - 14, y, { align: "right" })
  y += 6

  if (discount > 0) {
    doc.text("Discount:", pageWidth - 80, y)
    doc.text(`-${discount.toLocaleString()} ${currency}`, pageWidth - 14, y, { align: "right" })
    y += 6
  }

  doc.text(`VAT (${vatRate}%):`, pageWidth - 80, y)
  doc.text(`${vatAmount.toLocaleString()} ${currency}`, pageWidth - 14, y, { align: "right" })
  y += 8

  doc.setFont(FONT, "bold")
  doc.setFontSize(12)
  doc.text("TOTAL:", pageWidth - 80, y)
  doc.text(`${totalAmount.toLocaleString()} ${currency}`, pageWidth - 14, y, { align: "right" })

  y += 12

  // Notes
  if (offer.notes) {
    doc.setFont(FONT, "normal")
    doc.setFontSize(9)
    doc.text("Notes:", 14, y); y += 5
    const noteLines = doc.splitTextToSize(offer.notes, pageWidth - 28)
    doc.text(noteLines, 14, y)
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFontSize(8)
  doc.setFont(FONT, "normal")
  doc.setTextColor(150)
  doc.text(`Generated by ${offer.organization?.name || "LeadDrive CRM"} on ${new Date().toLocaleDateString()}`, 14, pageH - 10)

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"))

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="offer-${offer.offerNumber || offer.id.slice(0, 8)}.pdf"`,
    },
  })
})
