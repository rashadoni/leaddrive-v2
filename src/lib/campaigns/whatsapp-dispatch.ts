import { randomUUID } from "node:crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"

export const WHATSAPP_DISPATCH_BATCH = 100
const LEASE_MS = 120_000
const MAX_ATTEMPTS = 3

export function normalizeCampaignPhone(value: string | null | undefined): string | null {
  const phone = (value || "").replace(/[\s()+.-]/g, "").replace(/^00/, "")
  return /^[1-9]\d{6,14}$/.test(phone) ? phone : null
}

const headerSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().min(1).max(60), parameter_name: z.string().optional() }),
  z.object({ type: z.enum(["image", "video", "document"]), link: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
  }, "Use a public HTTPS media URL without credentials") }),
])
const payloadSchema = z.object({
  body: z.string().max(4096),
  template: z.object({
    name: z.string().min(1).max(512),
    language: z.string().min(2).max(20),
    header: headerSchema.optional(),
    parameters: z.array(z.object({
      type: z.literal("text"), text: z.string().max(1024), parameter_name: z.string().optional(),
    })).max(100),
  }).optional(),
})
export type WhatsAppDispatchPayload = z.infer<typeof payloadSchema>
export type WhatsAppDispatchRecipient = {
  phone: string
  contactId?: string
  leadId?: string
  payload: WhatsAppDispatchPayload
}

/** Atomic snapshot: a crash cannot expose a partially-created audience to the worker. */
export async function enqueueWhatsAppCampaign(
  orgId: string, campaignId: string, channelConfigId: string, recipients: WhatsAppDispatchRecipient[],
) {
  const unique = new Map<string, WhatsAppDispatchRecipient>()
  for (const recipient of recipients) {
    const phone = normalizeCampaignPhone(recipient.phone)
    if (phone && !unique.has(phone)) unique.set(phone, { ...recipient, phone, payload: payloadSchema.parse(recipient.payload) })
  }
  if (!unique.size) throw new Error("No valid WhatsApp recipients")
  const rows = [...unique.values()]
  await prisma.$transaction(async (tx: typeof prisma) => {
    for (let offset = 0; offset < rows.length; offset += 250) {
      await tx.whatsAppCampaignDelivery.createMany({
        data: rows.slice(offset, offset + 250).map(row => ({
          id: randomUUID(), organizationId: orgId, campaignId, channelConfigId,
          recipientPhone: row.phone, contactId: row.contactId, leadId: row.leadId, payload: row.payload,
        })),
      })
    }
    const campaign = await tx.campaign.updateMany({
      where: { id: campaignId, organizationId: orgId, status: "sending" },
      data: { totalRecipients: rows.length, totalSent: 0 },
    })
    if (campaign.count !== 1) throw new Error("Campaign is no longer sending")
  }, { timeout: 30_000 })
  return rows.length
}

/** Read-only preflight also used immediately before each send, so a later opt-out wins. */
async function recipientIsSuppressed(orgId: string, phone: string, contactId?: string | null) {
  const conversationOptOut = await prisma.socialConversation.findFirst({
    where: { organizationId: orgId, platform: "whatsapp", metadata: { path: ["whatsappOptedOut"], equals: true },
      OR: [{ externalId: phone }, { externalId: `+${phone}` }] },
    select: { id: true },
  })
  if (conversationOptOut) return true
  const optedOut = await prisma.contact.findMany({
    where: {
      organizationId: orgId,
      channelPreferences: { some: { organizationId: orgId, channel: "whatsapp", isOptedIn: false } },
    },
    select: { id: true, phone: true, phones: true },
  })
  return optedOut.some((contact: { id: string; phone: string | null; phones?: string[] }) =>
    contact.id === contactId || [contact.phone, ...(contact.phones || [])].some(value => normalizeCampaignPhone(value) === phone))
}

export type DispatchOutcome = { status: "accepted" | "failed" | "unknown" | "pending" | "skipped"; messageId?: string; errorCode?: string }

/** A provider timeout/invalid response is ambiguous; never retry it automatically. */
export async function deliverWhatsAppCampaignRecipient(row: {
  id?: string; campaignId?: string;
  organizationId: string; channelConfigId: string; recipientPhone: string;
  contactId?: string | null; leadId?: string | null; payload: unknown; attempts: number;
}): Promise<DispatchOutcome> {
  const parsed = payloadSchema.safeParse(row.payload)
  if (!parsed.success) return { status: "failed", errorCode: "invalid_payload" }
  const organization = await prisma.organization.findFirst({ where: { id: row.organizationId, isActive: true }, select: { id: true } })
  if (!organization) return { status: "skipped", errorCode: "organization_inactive" }
  const config = await resolveWhatsAppConfig(row.organizationId, { channelConfigId: row.channelConfigId })
  if (!config) return { status: "skipped", errorCode: "channel_unavailable" }
  if (await recipientIsSuppressed(row.organizationId, row.recipientPhone, row.contactId)) {
    return { status: "skipped", errorCode: "recipient_opted_out" }
  }
  const payload = parsed.data
  if (!payload.template) {
    const inbound = await prisma.channelMessage.findFirst({
      where: {
        organizationId: row.organizationId, channelConfigId: row.channelConfigId,
        channelType: "whatsapp", direction: "inbound",
        createdAt: { gte: new Date(Date.now() - 23 * 60 * 60 * 1000) },
        OR: [{ from: row.recipientPhone }, { from: `+${row.recipientPhone}` },
          { metadata: { path: ["waPhone"], equals: row.recipientPhone } }],
      }, select: { id: true },
    })
    if (!inbound) return { status: "skipped", errorCode: "outside_window_no_template" }
  }
  const components: Array<Record<string, unknown>> = []
  if (payload.template?.header) {
    const header = payload.template.header
    components.push({ type: "header", parameters: [header.type === "text" ? header : { type: header.type, [header.type]: { link: header.link } }] })
  }
  if (payload.template?.parameters.length) components.push({ type: "body", parameters: payload.template.parameters })
  const message = payload.template ? {
    type: "template", template: {
      name: payload.template.name, language: { code: payload.template.language },
      ...(components.length ? { components } : {}),
    },
  } : { type: "text", text: { body: payload.body } }
  let outcome: DispatchOutcome
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
      method: "POST", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: row.recipientPhone,
        ...(row.id ? { biz_opaque_callback_data: `campaign:${row.id}` } : {}), ...message }),
    })
    const data = await res.json()
    if (!res.ok) {
      const code = Number(data?.error?.code)
      // Retry only explicit provider rejections for throughput, never a transport/server ambiguity.
      const retryable = res.status === 429 || [130429, 131056].includes(code)
      outcome = { status: res.status >= 500 ? "unknown" : retryable && row.attempts < MAX_ATTEMPTS ? "pending" : "failed", errorCode: Number.isFinite(code) ? `meta_${code}` : `http_${res.status}` }
    } else if (typeof data?.messages?.[0]?.id === "string") {
      outcome = { status: "accepted", messageId: data.messages[0].id }
    } else outcome = { status: "unknown", errorCode: "missing_provider_message_id" }
  } catch {
    return { status: "unknown", errorCode: "provider_outcome_unknown" }
  }
  if (outcome.status === "accepted") {
    const preview = payload.template ? `[template:${payload.template.name}]` : payload.body
    // Campaigns enter the shared inbox, but never mark an outbound message unread
    // or reopen a conversation that an operator already resolved.
    const conversation = await (async () => {
      const existing = await prisma.socialConversation.findFirst({
        where: { organizationId: row.organizationId, platform: "whatsapp",
          OR: [{ externalId: row.recipientPhone }, { externalId: `+${row.recipientPhone}` }] },
        select: { id: true, channelConfigId: true },
      })
      // The legacy inbox identity is unique per organization/phone, not per
      // sending number. Never attach B's message to a thread routed through A.
      if (existing && existing.channelConfigId !== config.id) return null
      if (existing) return prisma.socialConversation.update({ where: { id: existing.id },
        data: { lastMessage: preview.slice(0, 500), lastMessageAt: new Date() }, select: { id: true } })
      return prisma.socialConversation.upsert({
        where: { organizationId_platform_externalId: { organizationId: row.organizationId, platform: "whatsapp", externalId: row.recipientPhone } },
        create: { organizationId: row.organizationId, platform: "whatsapp", externalId: row.recipientPhone,
          channelConfigId: config.id, contactId: row.contactId || undefined, unreadCount: 0,
          lastMessage: preview.slice(0, 500), metadata: row.leadId ? { leadId: row.leadId } : {} },
        update: { lastMessage: preview.slice(0, 500), lastMessageAt: new Date() }, select: { id: true },
      })
    })().catch(() => null)
    // Logging failure cannot turn a provider-accepted send into a retry.
    await prisma.channelMessage.create({ data: {
      organizationId: row.organizationId, channelConfigId: config.id, channelType: "whatsapp",
      direction: "outbound", from: config.phoneNumberId, to: row.recipientPhone,
      contactId: row.contactId || undefined, leadId: row.leadId || undefined,
      conversationId: conversation?.id, body: preview,
      status: "sent", externalId: outcome.messageId,
      metadata: { waPhone: row.recipientPhone, waMessageId: outcome.messageId, campaignDispatch: true, campaignId: row.campaignId, dispatchId: row.id },
    } }).catch(() => {})
  }
  return outcome
}

export async function getWhatsAppCampaignProgress(orgId: string, campaignId: string, db: typeof prisma = prisma) {
  const groups = await db.whatsAppCampaignDelivery.groupBy({
    by: ["status"], where: { organizationId: orgId, campaignId }, _count: { _all: true },
  })
  const counts = Object.fromEntries(groups.map((g: { status: string; _count: { _all: number } }) => [g.status, g._count._all]))
  return counts as Record<string, number>
}

async function updateCampaignProgress(orgId: string, campaignId: string) {
  // Serialize recomputation before reading aggregates: a slower worker must not
  // overwrite a later receipt's counters or terminal state with an old snapshot.
  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${campaignId} AND "organizationId" = ${orgId} FOR UPDATE`
    const counts = await getWhatsAppCampaignProgress(orgId, campaignId, tx)
    const totalSent = await tx.whatsAppCampaignDelivery.count({
      where: { organizationId: orgId, campaignId, acceptedAt: { not: null } },
    })
    const active = (counts.pending || 0) + (counts.sending || 0)
    await tx.campaign.updateMany({
      where: { id: campaignId, organizationId: orgId, status: "cancelled" }, data: { totalSent },
    })
    await tx.campaign.updateMany({
      where: { id: campaignId, organizationId: orgId, status: { in: ["sending", "sent", "failed"] } },
      data: { totalSent, ...(active === 0 ? { status: totalSent ? "sent" : "failed" } : {}) },
    })
    if (active === 0) await tx.campaign.updateMany({
      where: { id: campaignId, organizationId: orgId, sentAt: null, status: { in: ["sent", "failed"] } }, data: { sentAt: new Date() },
    })
  })
}

export async function recordWhatsAppCampaignStatus(orgId: string, externalId: string, status: string, callbackData?: string) {
  const deliveryId = callbackData?.match(/^campaign:([a-f\d-]{36})$/i)?.[1]
  const from: Record<string, string[]> = {
    sent: ["sending", "unknown"], delivered: ["sending", "unknown", "accepted"],
    read: ["sending", "unknown", "accepted", "delivered"], failed: ["sending", "unknown", "accepted"],
  }
  if (!from[status]) return
  const match = { organizationId: orgId, ...(deliveryId ? { id: deliveryId } : { externalId }) }
  await prisma.whatsAppCampaignDelivery.updateMany({
    where: { ...match, status: { in: from[status] } },
    data: { status: status === "sent" ? "accepted" : status, externalId, acceptedAt: new Date(),
      errorCode: status === "failed" ? "provider_delivery_failed" : null },
  })
  const row = await prisma.whatsAppCampaignDelivery.findFirst({ where: match, select: { campaignId: true } })
  if (row) await updateCampaignProgress(orgId, row.campaignId)
}

/** Bounded work, claimed per recipient. Restart resumes pending rows; expired claims become unknown. */
export async function runWhatsAppCampaignDispatch(now = new Date()) {
  const rows = await runWithRlsBypass(() => prisma.whatsAppCampaignDelivery.findMany({
    where: { OR: [{ status: "pending", nextAttemptAt: { lte: now } }, { status: "sending", claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: WHATSAPP_DISPATCH_BATCH,
  }))
  const summary = { processed: 0, accepted: 0, failed: 0, unknown: 0, retried: 0, skipped: 0 }
  const startedAt = Date.now()
  for (const row of rows) {
    if (Date.now() - startedAt > 40_000) break
    await runWithTenant(row.organizationId, async () => {
      if (row.status === "sending") {
        const expired = await prisma.whatsAppCampaignDelivery.updateMany({
          where: { id: row.id, organizationId: row.organizationId, status: "sending", claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
          data: { status: "unknown", errorCode: "worker_interrupted" },
        })
        if (expired.count) { summary.unknown++; await updateCampaignProgress(row.organizationId, row.campaignId) }
        return
      }
      const claim = await prisma.whatsAppCampaignDelivery.updateMany({
        where: { id: row.id, organizationId: row.organizationId, status: "pending", nextAttemptAt: { lte: now } },
        data: { status: "sending", claimedAt: now, attempts: { increment: 1 } },
      })
      if (!claim.count) return
      let outcome: DispatchOutcome
      try {
        const campaign = await prisma.campaign.findFirst({ where: { id: row.campaignId, organizationId: row.organizationId }, select: { status: true } })
        outcome = campaign?.status === "sending"
          ? await deliverWhatsAppCampaignRecipient({ ...row, attempts: row.attempts + 1 })
          : { status: "skipped", errorCode: "campaign_inactive" }
      } catch {
        outcome = { status: "unknown", errorCode: "dispatch_interrupted" }
      }
      await prisma.whatsAppCampaignDelivery.updateMany({
        where: { id: row.id, organizationId: row.organizationId, status: "sending", claimedAt: now },
        data: { status: outcome.status, externalId: outcome.messageId, errorCode: outcome.errorCode,
          ...(outcome.status === "accepted" ? { acceptedAt: new Date() } : {}),
          ...(outcome.status === "pending" ? { nextAttemptAt: new Date(now.getTime() + 60_000 * 2 ** row.attempts) } : {}) },
      })
      summary.processed++
      summary[outcome.status === "pending" ? "retried" : outcome.status]++
      await updateCampaignProgress(row.organizationId, row.campaignId)
    })
  }
  return summary
}
