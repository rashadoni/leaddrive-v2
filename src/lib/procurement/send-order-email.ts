import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { procurementNumber } from "@/lib/procurement/numbering"
import { generatePurchaseOrderPdf } from "@/lib/procurement/order-pdf"

/**
 * The purchase order to the supplier by e-mail, its PDF attached (task 3.3).
 * The PDF is written to a private temporary folder only for the hand-off to the
 * mailer and removed right after. The outcome is a row in the order's history;
 * a failed send leaves the order «sent» — purchasing sees it and can send again.
 */
const SUBJECT: Record<string, (number: string, buyer: string) => string> = {
  az: (number, buyer) => `Satınalma sifarişi ${number} — ${buyer}`,
  ru: (number, buyer) => `Заказ поставщику ${number} — ${buyer}`,
  en: (number, buyer) => `Purchase order ${number} — ${buyer}`,
}
const BODY: Record<string, (number: string) => string> = {
  az: (number) => `Salam,<br><br>${number} nömrəli sifarişimiz əlavədədir. Zəhmət olmasa, təsdiq edin və çatdırılma tarixini bildirin.`,
  ru: (number) => `Здравствуйте,<br><br>Во вложении наш заказ ${number}. Пожалуйста, подтвердите его и сообщите срок поставки.`,
  en: (number) => `Hello,<br><br>Please find our purchase order ${number} attached. Kindly confirm it and let us know the delivery date.`,
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export async function emailPurchaseOrder(input: { orgId: string; orderId: string; actorId: string; to: string; lang?: string | null; message?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const lang = input.lang === "ru" || input.lang === "en" ? input.lang : "az"
  const [order, organization] = await Promise.all([
    prisma.purchaseOrder.findFirst({
      where: { id: input.orderId, organizationId: input.orgId },
      include: { items: { orderBy: { sortOrder: "asc" } }, supplier: { select: { name: true, voen: true, address: true, phone: true, email: true } } },
    }),
    prisma.organization.findUnique({ where: { id: input.orgId }, select: { name: true } }),
  ])
  if (!order || !organization) return { ok: false, error: "not_found" }
  const number = procurementNumber("order", order.seq)
  const pdf = generatePurchaseOrderPdf({
    lang,
    number,
    createdAt: order.createdAt,
    expectedDeliveryAt: order.expectedDeliveryAt,
    currency: order.currency,
    totalAmount: order.totalAmount.toString(),
    note: order.note,
    buyer: { name: organization.name },
    supplier: order.supplier,
    items: order.items.map((item: { name: string; unit: string | null; quantity: { toString(): string }; unitPrice: { toString(): string }; total: { toString(): string } }) => ({
      name: item.name, unit: item.unit, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), total: item.total.toString(),
    })),
  })
  const folder = await mkdtemp(path.join(tmpdir(), "purchase-order-"))
  const file = path.join(folder, `${number}.pdf`)
  let result: { success?: boolean; error?: string } = {}
  try {
    await writeFile(file, pdf, { mode: 0o600 })
    const message = input.message?.trim() ? `${escapeHtml(input.message.trim()).replace(/\n/g, "<br>")}<br><br>` : ""
    result = await sendEmail({
      to: input.to,
      subject: SUBJECT[lang](number, organization.name),
      html: `${message}${BODY[lang](number)}<br><br>${escapeHtml(organization.name)}`,
      organizationId: input.orgId,
      sentBy: input.actorId,
      attachments: [{ filename: `${number}.pdf`, path: file }],
      transactional: true,
    })
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : "send failed" }
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }
  const ok = result.success === true
  await prisma.purchaseOrderEvent.create({
    data: { organizationId: input.orgId, orderId: order.id, type: "emailed", actorId: input.actorId, data: { to: input.to, lang, ok, ...(ok ? {} : { error: String(result.error ?? "unknown").slice(0, 200) }) } },
  })
  return ok ? { ok } : { ok, error: String(result.error ?? "unknown") }
}
