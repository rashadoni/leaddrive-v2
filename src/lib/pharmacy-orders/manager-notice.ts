import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"

import { runWithTenant } from "@/lib/rls-context"
import { phoneOrderLabel } from "@/lib/voice-agent/pharmacy/phone-orders"
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
async function sendOne(sender: WhatsAppConfig, to: string, values: { label: string; pharmacy: string; total: string; orderId: string },
  doFetch: Fetch): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  let response: Response
  try {
    response = await doFetch(`${GRAPH_API_BASE}/${sender.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: to.replace(/\D/gu, ""), type: "template",
        template: {
          name: process.env.PHONE_ORDER_NOTICE_TEMPLATE?.trim() || PHONE_ORDER_NOTICE_TEMPLATE,
          language: { code: "az" },
          components: [
            { type: "body", parameters: [values.label, values.pharmacy, values.total].map(text => ({ type: "text", text })) },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: values.orderId }] },
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
      const result = await sendOne(sender, phone, values, deps.fetch ?? fetch)
      if (result.ok) { sent++; if (result.id) ids.push(result.id) } else error ??= result.error
    }
    // Any number that did not get it makes the notice failed: the manager may not know.
    return record(error ? { status: "failed", at: at(), error, sent } : { status: "sent", at: at(), sent, messageIds: ids })
  })
}
