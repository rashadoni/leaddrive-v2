import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { withRls } from "@/lib/with-rls"

const sendSchema = z.object({
  recipientEmail: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
})

export const POST = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const offer = await prisma.offer.findFirst({
      where: { id, organizationId: orgId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    })
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 })

    const sentBy = session?.userId

    // Build HTML email with offer details
    const itemsHtml = offer.items.map((item: any, idx: number) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd">${idx + 1}</td>
        <td style="padding:8px;border:1px solid #ddd">${item.name}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${item.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right">${item.unitPrice.toFixed(2)} ${offer.currency}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${item.discount}%</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right">${item.total.toFixed(2)} ${offer.currency}</td>
      </tr>
    `).join("")

    const vatAmount = offer.includeVat ? (offer.totalAmount || 0) * 0.18 : 0
    const grandTotal = (offer.totalAmount || 0) + vatAmount

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <p>${parsed.data.message.replace(/\n/g, "<br>")}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <h3 style="color:#333">Offer ${offer.offerNumber}</h3>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:8px;border:1px solid #ddd;text-align:left">#</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Item</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:center">Qty</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:right">Unit Price</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:center">Discount</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="text-align:right;margin-top:12px">
          <p style="margin:4px 0"><strong>Subtotal:</strong> ${(offer.totalAmount || 0).toFixed(2)} ${offer.currency}</p>
          ${offer.includeVat ? `<p style="margin:4px 0"><strong>VAT (18%):</strong> ${vatAmount.toFixed(2)} ${offer.currency}</p>` : ""}
          <p style="margin:4px 0;font-size:18px"><strong>Total: ${grandTotal.toFixed(2)} ${offer.currency}</strong></p>
        </div>
        ${offer.validUntil ? `<p style="color:#666;font-size:13px;margin-top:16px">Valid until: ${new Date(offer.validUntil).toLocaleDateString()}</p>` : ""}
        ${offer.notes ? `<p style="color:#666;font-size:13px">Notes: ${offer.notes}</p>` : ""}
      </div>
    `

    const result = await sendEmail({
      to: parsed.data.recipientEmail,
      subject: parsed.data.subject,
      html,
      organizationId: orgId,
      contactId: offer.contactId || undefined,
      sentBy,
    })

    if (result.success) {
      await prisma.offer.update({
        where: { id },
        data: {
          status: "sent",
          sentAt: new Date(),
          recipientEmail: parsed.data.recipientEmail,
        },
      })
    }

    return NextResponse.json({ success: result.success, error: result.error })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
