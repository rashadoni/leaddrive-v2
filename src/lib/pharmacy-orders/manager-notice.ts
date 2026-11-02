import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"

import { runWithTenant } from "@/lib/rls-context"
import { decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { phoneOrderPdf, type OrderPdfInput } from "@/lib/pharmacy-orders/order-pdf"
import { readableProductName } from "@/lib/pharmacy-orders/product-label"
import { PHONE_ORDERS_TABLE, phoneOrderLabel } from "@/lib/voice-agent/pharmacy/phone-orders"
import { resolveWhatsAppConfig, type WhatsAppConfig } from "@/lib/whatsapp"

/**
 * The manager's WhatsApp message about a new phone order. Owner, 2026-10-24
 * mockup («Вид подходит, делай карточку заказа и сообщение менеджеру») and
 * 2026-10-26 («от любого, мне главное показать клиенту»): sent from the
 * organization's own WhatsApp channel to the numbers it sets on its phone
 * orders page. Writing first needs a template Meta approved
 * (`phone_order_new`, Azerbaijani, utility: order, pharmacy, total, a button
 * to the order's card). One message per order; the order card shows how it went.
 */

export const PHONE_ORDER_NOTICE_TEMPLATE = "phone_order_new"
const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"
const SEND_TIMEOUT_MS = 8_000
const MAX_RECIPIENTS = 5

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/u)
export const managerNoticeSettingsSchema = z.strictObject({ phones: z.array(e164).max(MAX_RECIPIENTS) })
export type ManagerNoticeSettings = z.infer<typeof managerNoticeSettingsSchema>

/** A number as a person types it: spaces, brackets, a leading 00 or 0 for Azerbaijan. */
export function normalizeNoticePhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/gu, "")
  const candidate = compact.startsWith("00") ? `+${compact.slice(2)}`
    : /^0\d{9}$/u.test(compact) ? `+994${compact.slice(1)}`
    : /^994\d{9}$/u.test(compact) ? `+${compact}` : compact
  return e164.safeParse(candidate).success ? candidate : null
}

/** The organization's recipients, from `settings.pharmacyPhoneOrders.managerWhatsApp`. */
export function readManagerNoticeSettings(settings: unknown): ManagerNoticeSettings {
  const raw = (settings as { pharmacyPhoneOrders?: { managerWhatsApp?: unknown } } | null)?.pharmacyPhoneOrders?.managerWhatsApp
  const parsed = managerNoticeSettingsSchema.safeParse({ phones: Array.isArray(raw) ? raw : [] })
  return parsed.success ? parsed.data : { phones: [] }
}

export type ManagerNotice =
  | { status: "sent"; at: string; sent: number; messageIds: string[] }
  | { status: "failed"; at: string; error: string; sent: number }
  | { status: "not_connected" | "no_recipient"; at: string }

type Fetch = typeof fetch

/** One template message to one number; Meta's error code, never its text (it can quote the number). */
async function sendTemplate(sender: WhatsAppConfig, to: string,
  template: { name: string; body: string[]; urlSuffix?: string; document?: { id: string; filename: string } },
  doFetch: Fetch): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  let response: Response
  try {
    response = await doFetch(`${GRAPH_API_BASE}/${sender.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: to.replace(/\D/gu, ""), type: "template",
        template: {
          name: template.name,
          language: { code: "az" },
          components: [
            ...(template.document ? [{ type: "header", parameters: [{ type: "document", document: template.document }] }] : []),
            { type: "body", parameters: template.body.map(text => ({ type: "text", text })) },
            ...(template.urlSuffix ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: template.urlSuffix }] }] : []),
          ],
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" }
  }
  const body = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { code?: number } } | null
  if (response.ok) return { ok: true, id: body?.messages?.[0]?.id ?? null }
  return { ok: false, error: body?.error?.code ? `meta_${body.error.code}` : `http_${response.status}` }
}

/* ─── The order document: only as a utility message ────────────────── */

/**
 * Owner, 2026-10-29: the pharmacy gets its order as a PDF like Zeytun's 1C
 * printout («делай, если точно уверен, что это не будет маркетинговое и не
 * по цене маркетинговых»). Meta decides a template's category and may change
 * it; the PDF template is used only while Meta reports it APPROVED and
 * UTILITY at send time, and otherwise the plain utility template goes out
 * as before. A PDF that cannot be built or uploaded falls back the same way.
 */
export const PDF_TEMPLATES = { received: "phone_order_received_pdf", confirmed: "phone_order_confirmed_pdf" } as const
const TEMPLATE_CHECK_MS = 10 * 60_000
const templateChecks = new Map<string, { at: number; utility: boolean }>()

export async function templateIsUtility(sender: WhatsAppConfig, name: string, doFetch: Fetch, now = Date.now()): Promise<boolean> {
  if (!sender.businessAccountId) return false
  const key = `${sender.businessAccountId}:${name}`
  const cached = templateChecks.get(key)
  if (cached && now - cached.at < TEMPLATE_CHECK_MS) return cached.utility
  try {
    const response = await doFetch(`${GRAPH_API_BASE}/${sender.businessAccountId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,category,language&limit=20`,
      { headers: { Authorization: `Bearer ${sender.accessToken}` }, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) })
    const body = await response.json().catch(() => null) as { data?: Array<{ name?: string; status?: string; category?: string; language?: string }> } | null
    // A failed look is not remembered: the next message asks again.
    if (!response.ok || !body?.data) return false
    const utility = body.data.some(t => t.name === name && t.language === "az" && t.status === "APPROVED" && t.category === "UTILITY")
    templateChecks.set(key, { at: now, utility })
    return utility
  } catch { return false }
}

async function uploadPdf(sender: WhatsAppConfig, bytes: Uint8Array<ArrayBuffer>, filename: string, doFetch: Fetch): Promise<string | null> {
  try {
    const form = new FormData()
    form.append("messaging_product", "whatsapp")
    form.append("type", "application/pdf")
    // The upload's own name stays ASCII (multipart headers); the pharmacy sees the message's filename.
    form.append("file", new Blob([bytes], { type: "application/pdf" }), filename.normalize("NFKD").replace(/[^\x20-\x7e]/gu, "").replace(/\s+/gu, "-"))
    const response = await doFetch(`${GRAPH_API_BASE}/${sender.phoneNumberId}/media`, { method: "POST",
      headers: { Authorization: `Bearer ${sender.accessToken}` }, body: form, signal: AbortSignal.timeout(20_000) })
    const body = await response.json().catch(() => null) as { id?: string } | null
    return response.ok && typeof body?.id === "string" ? body.id : null
  } catch { return null }
}

type DocumentLine = { status: string; productName: string | null; sourceName: string | null; spokenText: string; quantity: number; unit: string
  unitPrice: Prisma.Decimal | null; lineTotal: Prisma.Decimal | null }

/** The order document as the pharmacy reads it: 1C's own name when the line is found, the caller's words when not. */
export function orderDocument(order: { number: number; callStartedAt: Date; totalAmount: Prisma.Decimal; pharmacyName: string | null
  company: { name: string } | null; lines: DocumentLine[] }, status: OrderPdfInput["status"]): OrderPdfInput {
  return { company: "ZEYTUN PHARMACEUTICALS", label: phoneOrderLabel(order.number), takenAt: order.callStartedAt,
    pharmacy: order.company?.name ?? order.pharmacyName, status, total: order.totalAmount.toFixed(2),
    lines: order.lines.map(line => {
      const found = line.status === "resolved"
      const name = found ? (line.sourceName ?? (line.productName ? readableProductName(line.productName) : line.spokenText)) : line.spokenText
      return { name, found, quantity: line.quantity, unit: line.unit,
        price: line.unitPrice ? line.unitPrice.toFixed(2) : null, total: line.lineTotal ? line.lineTotal.toFixed(2) : null }
    }) }
}

const DOCUMENT_SELECT = { number: true, status: true, callStartedAt: true, confirmedAt: true, rejectedAt: true, totalAmount: true,
  pharmacyName: true, company: { select: { name: true } },
  lines: { orderBy: { position: "asc" }, select: { status: true, productName: true, sourceName: true, spokenText: true, quantity: true,
    unit: true, unitPrice: true, lineTotal: true } } } satisfies Prisma.PharmacyPhoneOrderSelect

/**
 * The same file the pharmacy gets, for the manager to download from the
 * order's card (owner, 2026-10-30: to forward it by hand, say when the
 * pharmacy called from a landline). The status line follows the order now.
 */
export async function phoneOrderPdfFile(db: PrismaClient, orgId: string, orderId: string): Promise<{ filename: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  const order = await runWithTenant(orgId, () => db.pharmacyPhoneOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: DOCUMENT_SELECT }))
  if (!order) return null
  const status: OrderPdfInput["status"] = order.status === "confirmed" ? { kind: "confirmed", at: order.confirmedAt ?? order.callStartedAt }
    : order.status === "rejected" ? { kind: "rejected", at: order.rejectedAt ?? order.callStartedAt } : { kind: "received" }
  const document = orderDocument(order, status)
  return { filename: `Sifariş ${document.label}.pdf`, bytes: phoneOrderPdf(document) }
}

/**
 * The PDF template when Meta still holds it for utility and the file uploads.
 * Otherwise why not, kept on the order next to the plain message that went
 * instead: a PDF that never goes must show on the card, not only in a log.
 */
async function sendOrderDocument(sender: WhatsAppConfig, phone: string, template: string, document: OrderPdfInput, doFetch: Fetch)
  : Promise<{ ok: true; id: string | null } | { ok: false; pdfSkipped: string }> {
  if (!(await templateIsUtility(sender, template, doFetch))) return { ok: false, pdfSkipped: "not_utility" }
  const filename = `Sifariş ${document.label}.pdf`
  let bytes: Uint8Array<ArrayBuffer>
  try { bytes = phoneOrderPdf(document) } catch { return { ok: false, pdfSkipped: "build_failed" } }
  const media = await uploadPdf(sender, bytes, filename, doFetch)
  if (!media) return { ok: false, pdfSkipped: "upload_failed" }
  const result = await sendTemplate(sender, phone, { name: template, body: [document.label, document.total],
    document: { id: media, filename } }, doFetch)
  return result.ok ? result : { ok: false, pdfSkipped: result.error }
}

function logPdfSkipped(orderId: string, template: string, reason: string) {
  if (reason !== "not_utility") console.warn(`[phone-order] pdf not sent ${JSON.stringify({ orderId, template, reason })}`)
}

/**
 * Tell the organization's managers about a new phone order, once. The order
 * is claimed for the notice first (its managerNotice is still empty), so two
 * saves of one call never send twice; a failure is recorded, not retried.
 */
export async function notifyManagersOfPhoneOrder(db: PrismaClient, orgId: string, orderId: string,
  deps: { fetch?: Fetch; now?: () => Date; sender?: (orgId: string) => Promise<WhatsAppConfig | null> } = {}): Promise<ManagerNotice | null> {
  const now = deps.now ?? (() => new Date())
  return runWithTenant(orgId, async () => {
    const claimed = await db.pharmacyPhoneOrder.updateMany({
      where: { id: orderId, organizationId: orgId, managerNotice: { equals: Prisma.DbNull } },
      data: { managerNotice: { status: "sending", at: now().toISOString() } },
    })
    if (claimed.count !== 1) return null
    const [order, org] = await Promise.all([
      db.pharmacyPhoneOrder.findFirst({ where: { id: orderId, organizationId: orgId },
        select: { number: true, pharmacyName: true, totalAmount: true, company: { select: { name: true } } } }),
      db.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
    ])
    const record = async (notice: ManagerNotice) => {
      await db.pharmacyPhoneOrder.updateMany({ where: { id: orderId, organizationId: orgId }, data: { managerNotice: notice } })
      return notice
    }
    const at = () => now().toISOString()
    if (!order) return null
    const { phones } = readManagerNoticeSettings(org?.settings)
    if (!phones.length) return record({ status: "no_recipient", at: at() })
    const sender = await (deps.sender ?? ((id: string) => resolveWhatsAppConfig(id)))(orgId)
    if (!sender) return record({ status: "not_connected", at: at() })
    const values = { label: phoneOrderLabel(order.number), pharmacy: order.company?.name ?? order.pharmacyName ?? "—",
      total: order.totalAmount.toFixed(2), orderId }
    const ids: string[] = []
    let sent = 0, error: string | null = null
    for (const phone of phones) {
      const result = await sendTemplate(sender, phone, { name: process.env.PHONE_ORDER_NOTICE_TEMPLATE?.trim() || PHONE_ORDER_NOTICE_TEMPLATE,
        body: [values.label, values.pharmacy, values.total], urlSuffix: values.orderId }, deps.fetch ?? fetch)
      if (result.ok) { sent++; if (result.id) ids.push(result.id) } else error ??= result.error
    }
    // Any number that did not get it makes the notice failed: the manager may not know.
    return record(error ? { status: "failed", at: at(), error, sent } : { status: "sent", at: at(), sent, messageIds: ids })
  })
}

/**
 * The call is over: tell the managers about the order it left, if any, and
 * send the pharmacy its list. The agent saves the list after every line
 * (owner, 2026-10-27: a long order must not be lost), so both wait for the end
 * of the call instead of its first line. The order is the call's own: same
 * organization, same call id. Each message claims its own column, so a
 * repeated end of call sends neither twice.
 */
export async function announceCallOrder(db: PrismaClient, orgId: string, providerCallId: string,
  deps: Parameters<typeof notifyManagersOfPhoneOrder>[3] = {}): Promise<{ manager: ManagerNotice | null; pharmacy: PharmacyReceipt | null } | null> {
  const order = await runWithTenant(orgId, () => db.pharmacyPhoneOrder.findFirst({
    where: { organizationId: orgId, providerCallId }, select: { id: true, status: true } }))
  // An order the pharmacy cancelled on the call (owner's call 2026-10-31) is
  // nobody's to process: neither the managers nor the pharmacy hear of it.
  if (!order || order.status !== "pending_review") return null
  const manager = await notifyManagersOfPhoneOrder(db, orgId, order.id, deps)
  const pharmacy = await sendPharmacyReceipt(db, orgId, order.id, deps)
  return { manager, pharmacy }
}

/* ─── The pharmacy gets its list when the call is over ─────────────── */

/**
 * Owner, 2026-10-27 («Да, подавай шаблон с составом заказа по этому тексту»):
 * the order number, every line on one line (a template parameter cannot hold
 * a line break) and the total, to the number that called.
 */
export const PHARMACY_RECEIPT_TEMPLATE = "phone_order_received"
/** Room for the lines inside Meta's 1024-character body, next to the template's own words. */
const RECEIPT_LINES_MAX = 700

export type PharmacyReceipt =
  | { status: "sent"; at: string; messageId: string | null; format?: "pdf"; pdfSkipped?: string }
  | { status: "failed"; at: string; error: string; pdfSkipped?: string }
  | { status: "not_connected" | "no_number"; at: string }

type ReceiptLine = { status: string; productName: string | null; spokenText: string; quantity: number; unit: string }

/**
 * The order's lines as the pharmacy reads them: the catalog name of a found
 * line, the caller's own words for one the manager still has to find. Whole
 * lines only; what does not fit is counted, not cut in the middle.
 */
export function receiptLines(lines: ReceiptLine[]): string {
  const items = lines.map(line => oneLine(`${line.status === "resolved" && line.productName ? readableProductName(line.productName)
    : `${line.spokenText} (yoxlanılır)`} — ${line.quantity} ${line.unit}`, RECEIPT_LINES_MAX - 40))
  let text = ""
  for (const [index, item] of items.entries()) {
    const rest = items.length - index - 1
    const next = text ? `${text}; ${item}` : item
    const tail = rest ? `; və daha ${rest} mövqe` : ""
    if (text && `${next}${tail}`.length > RECEIPT_LINES_MAX) return `${text}; və daha ${items.length - index} mövqe`
    text = next
  }
  return text || "—"
}

type PharmacyDeps = { fetch?: Fetch; now?: () => Date; sender?: (orgId: string) => Promise<WhatsAppConfig | null>
  /** Meta refused the PDF after accepting it: send the plain message, and say why on the order. */
  pdfFailed?: string }

/** Send the pharmacy its list once, on the number it called from; claimed first (pharmacyReceipt still empty). */
export async function sendPharmacyReceipt(db: PrismaClient, orgId: string, orderId: string,
  deps: PharmacyDeps = {}): Promise<PharmacyReceipt | null> {
  const now = deps.now ?? (() => new Date())
  return runWithTenant(orgId, async () => {
    const claimed = await db.pharmacyPhoneOrder.updateMany({
      where: { id: orderId, organizationId: orgId, pharmacyReceipt: { equals: Prisma.DbNull } },
      data: { pharmacyReceipt: { status: "sending", at: now().toISOString() } },
    })
    if (claimed.count !== 1) return null
    const order = await db.pharmacyPhoneOrder.findFirst({ where: { id: orderId, organizationId: orgId },
      select: { number: true, totalAmount: true, callerPhone: true, callStartedAt: true, pharmacyName: true, company: { select: { name: true } },
        lines: { orderBy: { position: "asc" }, select: { status: true, productName: true, sourceName: true, spokenText: true, quantity: true,
          unit: true, unitPrice: true, lineTotal: true } } } })
    if (!order) return null
    const record = async (receipt: PharmacyReceipt) => {
      await db.pharmacyPhoneOrder.updateMany({ where: { id: orderId, organizationId: orgId }, data: { pharmacyReceipt: receipt } })
      return receipt
    }
    const at = () => now().toISOString()
    const phone = decryptForTenantBound(orgId, PHONE_ORDERS_TABLE, "callerPhone", order.callerPhone)
    if (!/^\+[1-9]\d{7,14}$/u.test(phone)) return record({ status: "no_number", at: at() })
    const sender = await (deps.sender ?? ((id: string) => resolveWhatsAppConfig(id)))(orgId)
    if (!sender) return record({ status: "not_connected", at: at() })
    const withPdf = deps.pdfFailed ? { ok: false as const, pdfSkipped: deps.pdfFailed }
      : await sendOrderDocument(sender, phone, PDF_TEMPLATES.received, orderDocument(order, { kind: "received" }), deps.fetch ?? fetch)
    if (withPdf.ok) return record({ status: "sent", at: at(), messageId: withPdf.id, format: "pdf" })
    logPdfSkipped(orderId, PDF_TEMPLATES.received, withPdf.pdfSkipped)
    const result = await sendTemplate(sender, phone, { name: PHARMACY_RECEIPT_TEMPLATE,
      body: [phoneOrderLabel(order.number), receiptLines(order.lines), order.totalAmount.toFixed(2)] }, deps.fetch ?? fetch)
    const pdfSkipped = withPdf.pdfSkipped
    return record(result.ok ? { status: "sent", at: at(), messageId: result.id, pdfSkipped } : { status: "failed", at: at(), error: result.error, pdfSkipped })
  })
}

/* ─── The pharmacy hears the manager's decision ────────────────────── */

/** Owner, 2026-10-27 («подходит»): confirmed or rejected, to the number that called. */
export const PHARMACY_DECISION_TEMPLATES = { confirmed: "phone_order_confirmed", rejected: "phone_order_rejected" } as const

export type PharmacyNotice =
  | { status: "sent"; kind: "confirmed" | "rejected"; at: string; messageId: string | null; format?: "pdf"; pdfSkipped?: string }
  | { status: "failed"; kind: "confirmed" | "rejected"; at: string; error: string; pdfSkipped?: string }
  | { status: "not_connected" | "no_number"; kind: "confirmed" | "rejected"; at: string }

/** A template text parameter: one line, no tabs or runs of spaces (Meta refuses them), at most `max` characters. */
function oneLine(text: string, max: number) {
  return text.replace(/\s+/gu, " ").trim().slice(0, max) || "—"
}

/**
 * Tell the pharmacy that its order was confirmed or rejected, once, on the
 * number it called from — a landline in 1C has no WhatsApp. Claimed first
 * (pharmacyNotice still empty), so a repeated decision never sends twice.
 */
export async function notifyPharmacyOfDecision(db: PrismaClient, orgId: string, orderId: string,
  deps: PharmacyDeps = {}): Promise<PharmacyNotice | null> {
  const now = deps.now ?? (() => new Date())
  return runWithTenant(orgId, async () => {
    const order = await db.pharmacyPhoneOrder.findFirst({ where: { id: orderId, organizationId: orgId },
      select: { number: true, status: true, totalAmount: true, rejectReason: true, callerPhone: true, callStartedAt: true, confirmedAt: true,
        pharmacyName: true, company: { select: { name: true } },
        lines: { orderBy: { position: "asc" }, select: { status: true, productName: true, sourceName: true, spokenText: true, quantity: true,
          unit: true, unitPrice: true, lineTotal: true } } } })
    if (!order || (order.status !== "confirmed" && order.status !== "rejected")) return null
    const kind = order.status
    const claimed = await db.pharmacyPhoneOrder.updateMany({
      where: { id: orderId, organizationId: orgId, pharmacyNotice: { equals: Prisma.DbNull } },
      data: { pharmacyNotice: { status: "sending", kind, at: now().toISOString() } },
    })
    if (claimed.count !== 1) return null
    const record = async (notice: PharmacyNotice) => {
      await db.pharmacyPhoneOrder.updateMany({ where: { id: orderId, organizationId: orgId }, data: { pharmacyNotice: notice } })
      return notice
    }
    const at = () => now().toISOString()
    const phone = decryptForTenantBound(orgId, PHONE_ORDERS_TABLE, "callerPhone", order.callerPhone)
    if (!/^\+[1-9]\d{7,14}$/u.test(phone)) return record({ status: "no_number", kind, at: at() })
    const sender = await (deps.sender ?? ((id: string) => resolveWhatsAppConfig(id)))(orgId)
    if (!sender) return record({ status: "not_connected", kind, at: at() })
    const label = phoneOrderLabel(order.number)
    let pdfSkipped: string | undefined
    if (kind === "confirmed") {
      const withPdf = deps.pdfFailed ? { ok: false as const, pdfSkipped: deps.pdfFailed }
        : await sendOrderDocument(sender, phone, PDF_TEMPLATES.confirmed,
          orderDocument(order, { kind: "confirmed", at: order.confirmedAt ?? now() }), deps.fetch ?? fetch)
      if (withPdf.ok) return record({ status: "sent", kind, at: at(), messageId: withPdf.id, format: "pdf" })
      logPdfSkipped(orderId, PDF_TEMPLATES.confirmed, withPdf.pdfSkipped)
      pdfSkipped = withPdf.pdfSkipped
    }
    const result = await sendTemplate(sender, phone, {
      name: PHARMACY_DECISION_TEMPLATES[kind],
      body: kind === "confirmed" ? [label, order.totalAmount.toFixed(2)] : [label, oneLine(order.rejectReason ?? "", 300)],
    }, deps.fetch ?? fetch)
    return record(result.ok ? { status: "sent", kind, at: at(), messageId: result.id, pdfSkipped }
      : { status: "failed", kind, at: at(), error: result.error, pdfSkipped })
  })
}

/* ─── Meta refuses a message after accepting it ────────────────────── */

/**
 * Meta answers a send with a message id and only later, on the webhook, says
 * whether it was delivered. Owner's call 2026-10-29: both messages of TS-1005
 * were accepted, then failed 10 s later («Business eligibility payment
 * issue», 131042), and the card kept saying "sent". A failure for a message
 * one of the order's notices sent turns that notice into failed, with Meta's
 * code; the card shows it in red like any other failure.
 */
export async function recordPhoneOrderMessageFailure(db: PrismaClient, orgId: string, messageId: string, code: unknown, now = new Date(),
  deps: Omit<PharmacyDeps, "pdfFailed" | "now"> = {}) {
  const error = `meta_${typeof code === "number" || typeof code === "string" ? String(code).slice(0, 16) : "unknown"}`
  return runWithTenant(orgId, async () => {
    let changed = 0
    const managers = await db.pharmacyPhoneOrder.findMany({
      where: { organizationId: orgId, managerNotice: { path: ["messageIds"], array_contains: [messageId] } },
      select: { id: true, managerNotice: true },
    })
    for (const order of managers) {
      const notice = order.managerNotice as { status?: unknown; sent?: unknown } | null
      if (notice?.status !== "sent") continue
      const sent = typeof notice.sent === "number" ? Math.max(0, notice.sent - 1) : 0
      changed += (await db.pharmacyPhoneOrder.updateMany({ where: { id: order.id, organizationId: orgId },
        data: { managerNotice: { status: "failed", at: now.toISOString(), error, sent } } })).count
    }
    for (const column of ["pharmacyReceipt", "pharmacyNotice"] as const) {
      const orders = await db.pharmacyPhoneOrder.findMany({
        where: { organizationId: orgId, [column]: { path: ["messageId"], equals: messageId } },
        select: { id: true, [column]: true },
      }) as Array<{ id: string } & Record<typeof column, unknown>>
      for (const order of orders) {
        const previous = order[column] as { status?: unknown; kind?: unknown; format?: unknown } | null
        if (previous?.status !== "sent") continue
        if (previous.format === "pdf") {
          // The PDF itself was refused (its file, its template): the pharmacy
          // still gets the plain message, once — the column is freed only
          // while it still names this message, and the send claims it again.
          const freed = await db.pharmacyPhoneOrder.updateMany({ where: { id: order.id, organizationId: orgId,
            [column]: { path: ["messageId"], equals: messageId } }, data: { [column]: Prisma.DbNull } })
          if (freed.count !== 1) continue
          const resend = { ...deps, pdfFailed: error, now: () => now }
          await (column === "pharmacyReceipt" ? sendPharmacyReceipt(db, orgId, order.id, resend) : notifyPharmacyOfDecision(db, orgId, order.id, resend))
          changed += 1
          continue
        }
        changed += (await db.pharmacyPhoneOrder.updateMany({ where: { id: order.id, organizationId: orgId },
          data: { [column]: { status: "failed", at: now.toISOString(), error, ...(previous.kind ? { kind: previous.kind } : {}) } } })).count
      }
    }
    return changed
  })
}
