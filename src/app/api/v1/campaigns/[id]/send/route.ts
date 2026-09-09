import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { sendEmail, renderTemplate } from "@/lib/email"
import { sendSms, isSmsConfigured } from "@/lib/sms"
import { withSignedRedirect } from "@/lib/tracking-link"
import { resolveWhatsAppConfig, sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/whatsapp"
import { sendTelegramText } from "@/lib/telegram"
import { createNotification } from "@/lib/notifications"
import { trackContactEvent } from "@/lib/contact-events"
import { recordTouchpointsSafe, touchpointSourceKey } from "@/lib/marketing-attribution/touchpoint-recorder"
import { parseWhatsAppTemplateConfig, type WhatsAppTemplateConfig } from "@/lib/campaigns/social-broadcast"

type CampaignSendChannel = "email" | "sms" | "whatsapp" | "telegram"

type CampaignRecord = {
  id: string
  name: string
  type: string
  subject: string | null
  templateId: string | null
  recipientMode: string
  recipientIds: unknown
  recipientSource: string | null
  segmentId: string | null
  flowData: unknown
  isAbTest: boolean
  testPercentage: number | null
}

type CampaignRecipient = {
  id: string
  fullName: string
  kind?: "contact" | "lead"
  email?: string | null
  phone?: string | null
  whatsAppTo?: string | null
  telegramTo?: string | null
}

type LeadRecipientRow = {
  id: string
  email: string | null
  contactName: string
  phone?: string | null
  phoneWhatsApp?: string | null
  telegramHandle?: string | null
}

type ContactRecipientRow = {
  id: string
  fullName: string
  email?: string | null
  phone?: string | null
}

type TelegramMessageRow = {
  contactId: string | null
  metadata: unknown
}

type CampaignVariantRow = {
  id: string
  subject: string | null
  templateId: string | null
  htmlBody: string | null
  percentage: number
}

type CampaignSendContext = {
  campaign: CampaignRecord
  campaignId: string
  orgId: string
}

type CampaignPreparedPayload = {
  htmlBody?: string
  smsBody?: string
  messageBody?: string
  whatsAppTemplate?: WhatsAppTemplateConfig | null
  telegramChannelConfigId?: string | null
}

type CampaignPrepareResult = { prepared: CampaignPreparedPayload } | { response: NextResponse }
type CampaignRecipientResult = { recipients: CampaignRecipient[] } | { response: NextResponse }

type CampaignChannelAdapter = {
  channel: CampaignSendChannel
  maxBatchSize: number
  prepare: (ctx: CampaignSendContext) => Promise<CampaignPrepareResult>
  resolveRecipients: (ctx: CampaignSendContext) => Promise<CampaignRecipientResult>
  send: (ctx: CampaignSendContext & {
    prepared: CampaignPreparedPayload
    recipients: CampaignRecipient[]
  }) => Promise<NextResponse>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function getRecipientIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}

function getDateValue(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    return new Date(value)
  }
  return null
}

function getTruthyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function renderCampaignText(template: string, campaign: CampaignRecord, recipient: CampaignRecipient): string {
  const values: Record<string, string> = {
    client_name: recipient.fullName,
    name: recipient.fullName,
    full_name: recipient.fullName,
    campaign_name: campaign.name,
    email: recipient.email || "",
    phone: recipient.phone || recipient.whatsAppTo || "",
    telegram: recipient.telegramTo || "",
  }

  let rendered = template
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value)
  }
  return rendered
}

function renderWhatsAppTemplateVariables(
  variables: Record<string, string> | string[] | undefined,
  campaign: CampaignRecord,
  recipient: CampaignRecipient,
): Record<string, string> | string[] | undefined {
  if (!variables) return undefined
  if (Array.isArray(variables)) {
    return variables.map((value) => renderCampaignText(value, campaign, recipient))
  }
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, renderCampaignText(value, campaign, recipient)]),
  )
}

function leadDisplayName(lead: LeadRecipientRow): string {
  return lead.contactName || lead.email || lead.phoneWhatsApp || lead.phone || lead.telegramHandle || "Lead"
}

function extractTelegramChatId(metadata: unknown): string | null {
  if (!isObjectRecord(metadata)) return null
  const chatId = metadata.chatId
  if (typeof chatId === "string" && chatId) return chatId
  if (typeof chatId === "number") return String(chatId)
  return null
}

function socialContactOptInWhere(orgId: string, channel: "whatsapp" | "telegram"): Prisma.ContactWhereInput {
  return {
    channelPreferences: {
      none: { organizationId: orgId, channel, isOptedIn: false },
    },
  }
}

function mapContactToWhatsAppRecipient(contact: ContactRecipientRow): CampaignRecipient {
  return {
    id: contact.id,
    kind: "contact",
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    whatsAppTo: contact.phone,
  }
}

function mapLeadToWhatsAppRecipient(lead: LeadRecipientRow): CampaignRecipient {
  const to = lead.phoneWhatsApp || lead.phone || null
  return {
    id: lead.id,
    kind: "lead",
    fullName: leadDisplayName(lead),
    email: lead.email,
    phone: lead.phone || lead.phoneWhatsApp || null,
    whatsAppTo: to,
  }
}

function mapLeadToTelegramRecipient(lead: LeadRecipientRow): CampaignRecipient {
  return {
    id: lead.id,
    kind: "lead",
    fullName: leadDisplayName(lead),
    email: lead.email,
    phone: lead.phone,
    telegramTo: lead.telegramHandle || null,
  }
}

function addCommonSegmentConditions(where: Prisma.ContactWhereInput, conditions: Record<string, unknown>, channel: CampaignSendChannel) {
  const andConditions: Prisma.ContactWhereInput[] = []
  const company = getTruthyString(conditions.company)
  const source = getTruthyString(conditions.source)
  const role = getTruthyString(conditions.role)
  const name = getTruthyString(conditions.name)

  if (channel === "email" && company) {
    andConditions.push({ company: { name: { contains: company, mode: "insensitive" } } })
  }
  if (source) andConditions.push({ source })
  if (channel === "email" && role) {
    andConditions.push({ position: { contains: role, mode: "insensitive" } })
  }
  if (name) {
    andConditions.push({ fullName: { contains: name, mode: "insensitive" } })
  }

  const createdAfter = getDateValue(conditions.createdAfter)
  if (createdAfter) andConditions.push({ createdAt: { gte: createdAfter } })

  const createdBefore = getDateValue(conditions.createdBefore)
  if (createdBefore) andConditions.push({ createdAt: { lte: createdBefore } })

  if (channel === "email" && conditions.hasEmail) {
    andConditions.push({ email: { not: null }, AND: [{ email: { not: "" } }] })
  }
  if (channel === "email" && conditions.hasPhone) {
    andConditions.push({ phone: { not: null }, AND: [{ phone: { not: "" } }] })
  }

  if (andConditions.length > 0) where.AND = andConditions
}

async function prepareSmsCampaign({ orgId, campaign }: CampaignSendContext): Promise<CampaignPrepareResult> {
  const smsOk = await isSmsConfigured(orgId)
  if (!smsOk) {
    return {
      response: NextResponse.json(
        { error: "SMS provider not configured. Go to Settings → VoIP to set up Twilio, Vonage or ATL first." },
        { status: 422 }
      ),
    }
  }

  return { prepared: { smsBody: campaign.subject || campaign.name } }
}

async function resolveSmsRecipients({ campaign, orgId }: CampaignSendContext): Promise<CampaignRecipientResult> {
  const mode = campaign.recipientMode || "all"

  if (mode === "manual") {
    const ids = getRecipientIds(campaign.recipientIds)
    if (ids.length === 0) return { response: NextResponse.json({ error: "No recipients selected" }, { status: 400 }) }
    const recipients = await prisma.contact.findMany({
      where: { organizationId: orgId, id: { in: ids }, phone: { not: null } },
      select: { id: true, phone: true, fullName: true },
    })
    return { recipients }
  }

  if (mode === "segment" && campaign.segmentId) {
    // Reuse segment resolution but require phone instead of email.
    const segment = await prisma.contactSegment.findFirst({
      where: { id: campaign.segmentId, organizationId: orgId },
    })
    const where: Prisma.ContactWhereInput = { organizationId: orgId, phone: { not: null } }
    if (isObjectRecord(segment?.conditions)) addCommonSegmentConditions(where, segment.conditions, "sms")

    const recipients = await prisma.contact.findMany({
      where,
      select: { id: true, phone: true, fullName: true },
    })
    return { recipients }
  }

  if (mode === "source" && campaign.recipientSource) {
    const recipients = await prisma.contact.findMany({
      where: { organizationId: orgId, phone: { not: null }, source: campaign.recipientSource },
      select: { id: true, phone: true, fullName: true },
    })
    return { recipients }
  }

  // "all" / "contacts" / default — contacts with phones. This intentionally
  // preserves the old SMS behavior: SMS does not include leads yet.
  const recipients = await prisma.contact.findMany({
    where: { organizationId: orgId, phone: { not: null } },
    select: { id: true, phone: true, fullName: true },
  })
  return { recipients }
}

async function sendSmsCampaign({
  campaign,
  orgId,
  prepared,
  recipients,
}: CampaignSendContext & { prepared: CampaignPreparedPayload; recipients: CampaignRecipient[] }): Promise<NextResponse> {
  const smsBody = prepared.smsBody || campaign.subject || campaign.name
  let sentSms = 0
  const smsErrors: string[] = []
  const deliveredContactIds: string[] = []

  // C9 #16 — wrap the first link in the body with the sms-click tracker so a
  // click records an `sms_clicked` touchpoint. Per-recipient (contactId in
  // the link). No link in the body → nothing to wrap (no sms_clicked).
  // Trim trailing punctuation the greedy match would otherwise swallow
  // (e.g. "visit https://x.com/y." → drop the period from the link).
  const firstUrl = smsBody.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[.,;:!?)\]}]+$/, "") ?? null
  const trackBase = (process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org").replace(/\/$/, "")
  const wrapSmsBody = (contactId: string) =>
    firstUrl
      ? smsBody.replace(
          firstUrl,
          withSignedRedirect(`${trackBase}/api/v1/tracking/sms-click?c=${campaign.id}&k=${contactId}&url=${encodeURIComponent(firstUrl)}`, firstUrl),
        )
      : smsBody

  for (const recipient of recipients) {
    if (!recipient.phone) continue
    const res = await sendSms({ to: recipient.phone, message: wrapSmsBody(recipient.id), organizationId: orgId })
    if (res.success) {
      sentSms++
      deliveredContactIds.push(recipient.id)
      trackContactEvent(orgId, recipient.id, "sms_sent", { campaignId: campaign.id, messageId: res.messageId }).catch(() => {})
    } else if (smsErrors.length < 3) {
      smsErrors.push(`${recipient.phone}: ${res.error}`)
    }
  }

  // SMS attribution for segmentation (TT §3.3 "SMS kampaniyaları" source).
  // Stamps lastSmsCampaignId + lastSmsAt on every contact that successfully
  // received this blast so segments can filter "received SMS campaign X".
  if (deliveredContactIds.length > 0) {
    await prisma.contact.updateMany({
      where: { organizationId: orgId, id: { in: deliveredContactIds } },
      data: { lastSmsCampaignId: campaign.id, lastSmsAt: new Date() },
    }).catch((e: unknown) => console.error("[campaigns/send] SMS attribution update failed:", e))

    // C9 #16 — sms_sent attribution touchpoints, one per delivered contact.
    // Idempotent per (campaign, contact); fire-and-forget so a touchpoint
    // failure can't break the send response. (sms_sent carries engagement
    // weight 0.2 from #12 — a delivery is a weak signal vs a click.)
    const now = new Date()
    void recordTouchpointsSafe(orgId, deliveredContactIds.map((contactId) => ({
      contactId,
      campaignId: campaign.id,
      channel: "sms",
      touchpointType: "sms_sent",
      occurredAt: now,
      sourceKey: touchpointSourceKey.smsSent(campaign.id, contactId),
      metadata: { campaignName: campaign.name },
    })))
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: sentSms > 0 ? "sent" : "draft",
      sentAt: sentSms > 0 ? new Date() : undefined,
      totalSent: sentSms,
      totalRecipients: recipients.length,
    },
  })

  createNotification({
    organizationId: orgId,
    userId: "",
    type: sentSms > 0 ? "success" : "warning",
    title: `SMS campaign sent: ${campaign.name}`,
    message: `${sentSms} / ${recipients.length} SMS delivered`,
    entityType: "campaign",
    entityId: campaign.id,
  }).catch(() => {})

  return NextResponse.json({
    success: sentSms > 0,
    data: { sent: sentSms, total: recipients.length, errors: smsErrors, channel: "sms" },
  })
}

async function prepareEmailCampaign({ campaign, orgId }: CampaignSendContext): Promise<CampaignPrepareResult> {
  // Load template before recipient resolution to preserve the old route order.
  let htmlBody = `<p>${campaign.subject || campaign.name}</p>`
  if (campaign.templateId) {
    const template = await prisma.emailTemplate.findFirst({
      where: { id: campaign.templateId, organizationId: orgId },
    })
    if (template) htmlBody = template.htmlBody
  }

  return { prepared: { htmlBody } }
}

async function resolveEmailRecipients({ campaign, orgId }: CampaignSendContext): Promise<CampaignRecipientResult> {
  const mode = campaign.recipientMode || "all"

  if (mode === "manual") {
    // Only selected contacts by IDs.
    const ids = getRecipientIds(campaign.recipientIds)
    if (ids.length === 0) {
      return { response: NextResponse.json({ error: "Не выбраны получатели" }, { status: 400 }) }
    }
    const recipients = await prisma.contact.findMany({
      where: { organizationId: orgId, id: { in: ids }, email: { not: null } },
      select: { id: true, email: true, fullName: true },
    })
    return { recipients }
  }

  if (mode === "segment" && campaign.segmentId) {
    // Contacts matching segment conditions.
    const segment = await prisma.contactSegment.findFirst({
      where: { id: campaign.segmentId, organizationId: orgId },
    })
    if (segment && isObjectRecord(segment.conditions)) {
      const where: Prisma.ContactWhereInput = { organizationId: orgId, email: { not: null } }
      addCommonSegmentConditions(where, segment.conditions, "email")
      const recipients = await prisma.contact.findMany({
        where,
        select: { id: true, email: true, fullName: true },
      })
      return { recipients }
    }

    // Segment not found or no conditions — fall back to all contacts.
    const recipients = await prisma.contact.findMany({
      where: { organizationId: orgId, email: { not: null } },
      select: { id: true, email: true, fullName: true },
    })
    return { recipients }
  }

  if (mode === "contacts") {
    // Only contacts (no leads).
    const recipients = await prisma.contact.findMany({
      where: { organizationId: orgId, email: { not: null } },
      select: { id: true, email: true, fullName: true },
    })
    return { recipients }
  }

  if (mode === "leads") {
    // Only leads with email.
    const leads: LeadRecipientRow[] = await prisma.lead.findMany({
      where: { organizationId: orgId, email: { not: null } },
      select: { id: true, email: true, contactName: true },
    })
    return { recipients: leads.map((lead) => ({ id: lead.id, email: lead.email, fullName: lead.contactName })) }
  }

  if (mode === "source" && campaign.recipientSource) {
    // Contacts from specific source.
    const recipients = await prisma.contact.findMany({
      where: { organizationId: orgId, email: { not: null }, source: campaign.recipientSource },
      select: { id: true, email: true, fullName: true },
    })
    return { recipients }
  }

  // "all" — all contacts + leads with email.
  const allContacts = await prisma.contact.findMany({
    where: { organizationId: orgId, email: { not: null } },
    select: { id: true, email: true, fullName: true },
  })
  const allLeads: LeadRecipientRow[] = await prisma.lead.findMany({
    where: { organizationId: orgId, email: { not: null } },
    select: { id: true, email: true, contactName: true },
  })
  return {
    recipients: [
      ...allContacts,
      ...allLeads.map((lead) => ({ id: lead.id, email: lead.email, fullName: lead.contactName })),
    ],
  }
}

async function sendEmailCampaign({
  campaign,
  orgId,
  prepared,
  recipients,
}: CampaignSendContext & { prepared: CampaignPreparedPayload; recipients: CampaignRecipient[] }): Promise<NextResponse> {
  const htmlBody = prepared.htmlBody || `<p>${campaign.subject || campaign.name}</p>`
  let sentCount = 0
  let unsubscribedCount = 0
  const errors: string[] = []

  // Check if A/B test.
  const variants: CampaignVariantRow[] = campaign.isAbTest
    ? await prisma.campaignVariant.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: "asc" } })
    : []

  if (campaign.isAbTest && variants.length >= 2) {
    // === A/B TEST MODE ===
    const testPct = campaign.testPercentage ?? 20
    const testSize = Math.max(2, Math.floor(recipients.length * testPct / 100))

    // Shuffle contacts.
    for (let i = recipients.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [recipients[i], recipients[j]] = [recipients[j], recipients[i]]
    }

    const testContacts = recipients.slice(0, testSize)
    const holdoutContacts = recipients.slice(testSize)

    // Distribute test contacts among variants by percentage.
    const totalPct = variants.reduce((sum, variant) => sum + variant.percentage, 0) || 100
    let offset = 0

    for (const variant of variants) {
      const variantSize = Math.max(1, Math.floor(testContacts.length * variant.percentage / totalPct))
      const variantContacts = testContacts.slice(offset, offset + variantSize)
      offset += variantSize

      // Load variant template if specified.
      let variantHtml = htmlBody
      if (variant.htmlBody) {
        variantHtml = variant.htmlBody
      } else if (variant.templateId) {
        const vTemplate = await prisma.emailTemplate.findFirst({ where: { id: variant.templateId, organizationId: orgId } })
        if (vTemplate?.htmlBody) variantHtml = vTemplate.htmlBody
      }

      let variantSentCount = 0
      for (const contact of variantContacts) {
        if (!contact.email) continue
        const rendered = renderTemplate(variantHtml, {
          client_name: contact.fullName,
          manager_name: "LeadDrive Team",
        })
        const result = await sendEmail({
          to: contact.email,
          subject: variant.subject ?? campaign.subject ?? campaign.name,
          html: rendered,
          organizationId: orgId,
          campaignId: campaign.id,
          templateId: variant.templateId ?? campaign.templateId ?? undefined,
          contactId: contact.id,
          variantId: variant.id,
        })
        if (result.success) {
          sentCount++
          variantSentCount++
          trackContactEvent(orgId, contact.id, "email_sent", { campaignId: campaign.id, variantId: variant.id }).catch(() => {})
        } else if (result.error === "Recipient unsubscribed") {
          unsubscribedCount++
        } else if (errors.length < 3) {
          errors.push(`${contact.email}: ${result.error}`)
        }
      }

      // Accurate variant stats — actually-delivered count, not attempted.
      await prisma.campaignVariant.update({
        where: { id: variant.id },
        data: { totalSent: variantSentCount },
      })
    }

    // Store holdout contact IDs for later winner send.
    const holdoutIds = holdoutContacts.map((contact) => contact.id)

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "ab_testing",
        sentAt: new Date(),
        totalSent: sentCount,
        totalRecipients: recipients.length,
        totalUnsubscribed: unsubscribedCount,
        holdoutIds,
      },
    })
  } else {
    // === NORMAL MODE ===
    for (const contact of recipients) {
      if (!contact.email) continue
      const rendered = renderTemplate(htmlBody, {
        client_name: contact.fullName,
        manager_name: "LeadDrive Team",
      })
      const result = await sendEmail({
        to: contact.email,
        subject: campaign.subject || campaign.name,
        html: rendered,
        organizationId: orgId,
        campaignId: campaign.id,
        templateId: campaign.templateId || undefined,
        contactId: contact.id,
      })
      if (result.success) {
        sentCount++
        trackContactEvent(orgId, contact.id, "email_sent", { campaignId: campaign.id }).catch(() => {})
      } else if (result.error === "Recipient unsubscribed") {
        unsubscribedCount++
      } else if (errors.length < 3) {
        errors.push(`${contact.email}: ${result.error}`)
      }
    }

    // Update campaign stats — totalUnsubscribed reflects how many recipients
    // had a global opt-out and were skipped by sendEmail's compliance layer.
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: sentCount > 0 ? "sent" : "draft",
        sentAt: sentCount > 0 ? new Date() : undefined,
        totalSent: sentCount,
        totalRecipients: recipients.length,
        totalUnsubscribed: unsubscribedCount,
      },
    })
  }

  // Notify org about campaign sent.
  createNotification({
    organizationId: orgId,
    userId: "",
    type: sentCount > 0 ? "success" : "warning",
    title: `Kampaniya göndərildi: ${campaign.name}`,
    message: `${sentCount} / ${recipients.length} alıcıya göndərildi`,
    entityType: "campaign",
    entityId: campaign.id,
  }).catch(() => {})

  return NextResponse.json({
    success: sentCount > 0,
    data: { sent: sentCount, total: recipients.length, unsubscribed: unsubscribedCount, errors },
  })
}

async function prepareWhatsAppCampaign({ orgId, campaign }: CampaignSendContext): Promise<CampaignPrepareResult> {
  const config = await resolveWhatsAppConfig(orgId)
  if (!config) {
    return {
      response: NextResponse.json(
        { error: "WhatsApp provider not configured. Go to Settings → Channels → WhatsApp first." },
        { status: 422 },
      ),
    }
  }

  return {
    prepared: {
      messageBody: campaign.subject || campaign.name,
      whatsAppTemplate: parseWhatsAppTemplateConfig(campaign.flowData),
    },
  }
}

async function resolveWhatsAppRecipients({ campaign, orgId }: CampaignSendContext): Promise<CampaignRecipientResult> {
  const mode = campaign.recipientMode || "all"
  const contactBaseWhere = {
    organizationId: orgId,
    phone: { not: null },
    ...socialContactOptInWhere(orgId, "whatsapp"),
  } satisfies Prisma.ContactWhereInput

  if (mode === "manual") {
    const ids = getRecipientIds(campaign.recipientIds)
    if (ids.length === 0) return { response: NextResponse.json({ error: "No recipients selected" }, { status: 400 }) }
    const contacts = await prisma.contact.findMany({
      where: { ...contactBaseWhere, id: { in: ids } },
      select: { id: true, phone: true, fullName: true, email: true },
    })
    return { recipients: contacts.map(mapContactToWhatsAppRecipient) }
  }

  if (mode === "segment" && campaign.segmentId) {
    const segment = await prisma.contactSegment.findFirst({
      where: { id: campaign.segmentId, organizationId: orgId },
    })
    const where: Prisma.ContactWhereInput = { ...contactBaseWhere }
    if (isObjectRecord(segment?.conditions)) addCommonSegmentConditions(where, segment.conditions, "whatsapp")

    const contacts = await prisma.contact.findMany({
      where,
      select: { id: true, phone: true, fullName: true, email: true },
    })
    return { recipients: contacts.map(mapContactToWhatsAppRecipient) }
  }

  if (mode === "source" && campaign.recipientSource) {
    const contacts = await prisma.contact.findMany({
      where: { ...contactBaseWhere, source: campaign.recipientSource },
      select: { id: true, phone: true, fullName: true, email: true },
    })
    return { recipients: contacts.map(mapContactToWhatsAppRecipient) }
  }

  if (mode === "contacts") {
    const contacts = await prisma.contact.findMany({
      where: contactBaseWhere,
      select: { id: true, phone: true, fullName: true, email: true },
    })
    return { recipients: contacts.map(mapContactToWhatsAppRecipient) }
  }

  if (mode === "leads") {
    const leads: LeadRecipientRow[] = await prisma.lead.findMany({
      where: { organizationId: orgId, OR: [{ phoneWhatsApp: { not: null } }, { phone: { not: null } }] },
      select: { id: true, email: true, contactName: true, phone: true, phoneWhatsApp: true },
    })
    return { recipients: leads.map(mapLeadToWhatsAppRecipient).filter((recipient) => recipient.whatsAppTo) }
  }

  const [contacts, leads] = await Promise.all([
    prisma.contact.findMany({
      where: contactBaseWhere,
      select: { id: true, phone: true, fullName: true, email: true },
    }),
    prisma.lead.findMany({
      where: { organizationId: orgId, OR: [{ phoneWhatsApp: { not: null } }, { phone: { not: null } }] },
      select: { id: true, email: true, contactName: true, phone: true, phoneWhatsApp: true },
    }),
  ])
  const leadRecipients: CampaignRecipient[] = leads
    .map(mapLeadToWhatsAppRecipient)
    .filter((recipient: CampaignRecipient) => Boolean(recipient.whatsAppTo))

  return {
    recipients: [
      ...contacts.map(mapContactToWhatsAppRecipient),
      ...leadRecipients,
    ],
  }
}

async function sendWhatsAppCampaign({
  campaign,
  orgId,
  prepared,
  recipients,
}: CampaignSendContext & { prepared: CampaignPreparedPayload; recipients: CampaignRecipient[] }): Promise<NextResponse> {
  const bodyTemplate = prepared.messageBody || campaign.subject || campaign.name
  const template = prepared.whatsAppTemplate
  let sent = 0
  let skipped = 0
  let textSent = 0
  let templateSent = 0
  const errors: string[] = []

  for (const recipient of recipients) {
    if (!recipient.whatsAppTo) {
      skipped++
      continue
    }

    const body = renderCampaignText(bodyTemplate, campaign, recipient)
    const idFields = recipient.kind === "lead" ? { leadId: recipient.id } : { contactId: recipient.id }
    const textResult = await sendWhatsAppText({
      to: recipient.whatsAppTo,
      body,
      organizationId: orgId,
      ...idFields,
    })

    if (textResult.success) {
      sent++
      textSent++
      if (recipient.kind !== "lead") {
        trackContactEvent(orgId, recipient.id, "whatsapp_sent", {
          campaignId: campaign.id,
          messageId: textResult.messageId,
          mode: "text",
        }).catch(() => {})
      }
      continue
    }

    if (textResult.error === "outside_window_no_template" && template?.name) {
      const templateResult = await sendWhatsAppTemplate({
        to: recipient.whatsAppTo,
        templateName: template.name,
        languageCode: template.languageCode,
        variables: renderWhatsAppTemplateVariables(template.variables, campaign, recipient),
        organizationId: orgId,
        ...idFields,
      })
      if (templateResult.success) {
        sent++
        templateSent++
        if (recipient.kind !== "lead") {
          trackContactEvent(orgId, recipient.id, "whatsapp_sent", {
            campaignId: campaign.id,
            messageId: templateResult.messageId,
            mode: "template",
            templateName: template.name,
          }).catch(() => {})
        }
      } else {
        skipped++
        if (errors.length < 3) errors.push(`${recipient.whatsAppTo}: ${templateResult.error || "WhatsApp template send failed"}`)
      }
      continue
    }

    skipped++
    if (errors.length < 3) {
      errors.push(
        textResult.error === "outside_window_no_template"
          ? `${recipient.whatsAppTo}: outside 24h window and no template configured`
          : `${recipient.whatsAppTo}: ${textResult.error || "WhatsApp send failed"}`,
      )
    }
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: sent > 0 ? "sent" : "draft",
      sentAt: sent > 0 ? new Date() : undefined,
      totalSent: sent,
      totalRecipients: recipients.length,
    },
  })

  createNotification({
    organizationId: orgId,
    userId: "",
    type: sent > 0 ? "success" : "warning",
    title: `WhatsApp campaign sent: ${campaign.name}`,
    message: `${sent} / ${recipients.length} WhatsApp messages delivered`,
    entityType: "campaign",
    entityId: campaign.id,
  }).catch(() => {})

  return NextResponse.json({
    success: sent > 0,
    data: { sent, total: recipients.length, skipped, errors, channel: "whatsapp", textSent, templateSent },
  })
}

async function prepareTelegramCampaign({ orgId, campaign }: CampaignSendContext): Promise<CampaignPrepareResult> {
  const channel = await prisma.channelConfig.findFirst({
    where: { organizationId: orgId, channelType: "telegram", isActive: true },
    select: { id: true, botToken: true },
  })
  if (!channel?.botToken) {
    return {
      response: NextResponse.json({ error: "Telegram бот не настроен" }, { status: 422 }),
    }
  }

  return { prepared: { messageBody: campaign.subject || campaign.name, telegramChannelConfigId: channel.id } }
}

async function hydrateTelegramContactRecipients(
  orgId: string,
  contacts: ContactRecipientRow[],
): Promise<CampaignRecipient[]> {
  if (contacts.length === 0) return []

  const messages: TelegramMessageRow[] = await prisma.channelMessage.findMany({
    where: {
      organizationId: orgId,
      channelType: "telegram",
      contactId: { in: contacts.map((contact) => contact.id) },
    },
    orderBy: { createdAt: "desc" },
    select: { contactId: true, metadata: true },
  })
  const chatByContact = new Map<string, string>()
  for (const message of messages) {
    if (!message.contactId || chatByContact.has(message.contactId)) continue
    const chatId = extractTelegramChatId(message.metadata)
    if (chatId) chatByContact.set(message.contactId, chatId)
  }

  return contacts.flatMap((contact) => {
    const chatId = chatByContact.get(contact.id)
    if (!chatId) return []
    return [{
      id: contact.id,
      kind: "contact" as const,
      fullName: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      telegramTo: chatId,
    }]
  })
}

async function resolveTelegramRecipients({ campaign, orgId }: CampaignSendContext): Promise<CampaignRecipientResult> {
  const mode = campaign.recipientMode || "all"
  const contactBaseWhere = {
    organizationId: orgId,
    ...socialContactOptInWhere(orgId, "telegram"),
  } satisfies Prisma.ContactWhereInput

  if (mode === "manual") {
    const ids = getRecipientIds(campaign.recipientIds)
    if (ids.length === 0) return { response: NextResponse.json({ error: "No recipients selected" }, { status: 400 }) }
    const contacts = await prisma.contact.findMany({
      where: { ...contactBaseWhere, id: { in: ids } },
      select: { id: true, fullName: true, email: true, phone: true },
    })
    return { recipients: await hydrateTelegramContactRecipients(orgId, contacts) }
  }

  if (mode === "segment" && campaign.segmentId) {
    const segment = await prisma.contactSegment.findFirst({
      where: { id: campaign.segmentId, organizationId: orgId },
    })
    const where: Prisma.ContactWhereInput = { ...contactBaseWhere }
    if (isObjectRecord(segment?.conditions)) addCommonSegmentConditions(where, segment.conditions, "telegram")

    const contacts = await prisma.contact.findMany({
      where,
      select: { id: true, fullName: true, email: true, phone: true },
    })
    return { recipients: await hydrateTelegramContactRecipients(orgId, contacts) }
  }

  if (mode === "source" && campaign.recipientSource) {
    const contacts = await prisma.contact.findMany({
      where: { ...contactBaseWhere, source: campaign.recipientSource },
      select: { id: true, fullName: true, email: true, phone: true },
    })
    return { recipients: await hydrateTelegramContactRecipients(orgId, contacts) }
  }

  if (mode === "contacts") {
    const contacts = await prisma.contact.findMany({
      where: contactBaseWhere,
      select: { id: true, fullName: true, email: true, phone: true },
    })
    return { recipients: await hydrateTelegramContactRecipients(orgId, contacts) }
  }

  if (mode === "leads") {
    const leads: LeadRecipientRow[] = await prisma.lead.findMany({
      where: { organizationId: orgId, telegramHandle: { not: null } },
      select: { id: true, email: true, contactName: true, phone: true, telegramHandle: true },
    })
    return { recipients: leads.map(mapLeadToTelegramRecipient).filter((recipient) => recipient.telegramTo) }
  }

  const [contacts, leads] = await Promise.all([
    prisma.contact.findMany({
      where: contactBaseWhere,
      select: { id: true, fullName: true, email: true, phone: true },
    }),
    prisma.lead.findMany({
      where: { organizationId: orgId, telegramHandle: { not: null } },
      select: { id: true, email: true, contactName: true, phone: true, telegramHandle: true },
    }),
  ])
  const contactRecipients = await hydrateTelegramContactRecipients(orgId, contacts)
  const leadRecipients: CampaignRecipient[] = leads
    .map(mapLeadToTelegramRecipient)
    .filter((recipient: CampaignRecipient) => Boolean(recipient.telegramTo))

  return {
    recipients: [
      ...contactRecipients,
      ...leadRecipients,
    ],
  }
}

async function sendTelegramCampaign({
  campaign,
  orgId,
  prepared,
  recipients,
}: CampaignSendContext & { prepared: CampaignPreparedPayload; recipients: CampaignRecipient[] }): Promise<NextResponse> {
  const bodyTemplate = prepared.messageBody || campaign.subject || campaign.name
  let sent = 0
  let skipped = 0
  const errors: string[] = []

  for (const recipient of recipients) {
    if (!recipient.telegramTo) {
      skipped++
      continue
    }
    const body = renderCampaignText(bodyTemplate, campaign, recipient)
    const result = await sendTelegramText({
      organizationId: orgId,
      to: recipient.telegramTo,
      body,
      channelConfigId: prepared.telegramChannelConfigId,
      preferExplicitTo: true,
    })

    if (result.success) {
      sent++
      if (recipient.kind !== "lead") {
        trackContactEvent(orgId, recipient.id, "telegram_sent", {
          campaignId: campaign.id,
          messageId: result.messageId,
        }).catch(() => {})
      }
    } else {
      skipped++
      if (errors.length < 3) errors.push(`${recipient.telegramTo}: ${result.error || "Telegram send failed"}`)
    }
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: sent > 0 ? "sent" : "draft",
      sentAt: sent > 0 ? new Date() : undefined,
      totalSent: sent,
      totalRecipients: recipients.length,
    },
  })

  createNotification({
    organizationId: orgId,
    userId: "",
    type: sent > 0 ? "success" : "warning",
    title: `Telegram campaign sent: ${campaign.name}`,
    message: `${sent} / ${recipients.length} Telegram messages delivered`,
    entityType: "campaign",
    entityId: campaign.id,
  }).catch(() => {})

  return NextResponse.json({
    success: sent > 0,
    data: { sent, total: recipients.length, skipped, errors, channel: "telegram" },
  })
}

const emailCampaignAdapter: CampaignChannelAdapter = {
  channel: "email",
  maxBatchSize: 5000,
  prepare: prepareEmailCampaign,
  resolveRecipients: resolveEmailRecipients,
  send: sendEmailCampaign,
}

const smsCampaignAdapter: CampaignChannelAdapter = {
  channel: "sms",
  maxBatchSize: 1000,
  prepare: prepareSmsCampaign,
  resolveRecipients: resolveSmsRecipients,
  send: sendSmsCampaign,
}

const whatsAppCampaignAdapter: CampaignChannelAdapter = {
  channel: "whatsapp",
  maxBatchSize: 500,
  prepare: prepareWhatsAppCampaign,
  resolveRecipients: resolveWhatsAppRecipients,
  send: sendWhatsAppCampaign,
}

const telegramCampaignAdapter: CampaignChannelAdapter = {
  channel: "telegram",
  maxBatchSize: 1000,
  prepare: prepareTelegramCampaign,
  resolveRecipients: resolveTelegramRecipients,
  send: sendTelegramCampaign,
}

const campaignChannelAdapters = {
  email: emailCampaignAdapter,
  sms: smsCampaignAdapter,
  whatsapp: whatsAppCampaignAdapter,
  telegram: telegramCampaignAdapter,
} satisfies Record<CampaignSendChannel, CampaignChannelAdapter>

function getCampaignChannelAdapter(campaign: CampaignRecord): CampaignChannelAdapter {
  if (campaign.type === "sms") return campaignChannelAdapters.sms
  if (campaign.type === "whatsapp") return campaignChannelAdapters.whatsapp
  if (campaign.type === "telegram") return campaignChannelAdapters.telegram
  return campaignChannelAdapters.email
}

async function executeCampaignChannel(adapter: CampaignChannelAdapter, ctx: CampaignSendContext): Promise<NextResponse> {
  const preparedResult = await adapter.prepare(ctx)
  if ("response" in preparedResult) return preparedResult.response

  const recipientResult = await adapter.resolveRecipients(ctx)
  if ("response" in recipientResult) return recipientResult.response

  const recipients = recipientResult.recipients.length > adapter.maxBatchSize
    ? recipientResult.recipients.slice(0, adapter.maxBatchSize)
    : recipientResult.recipients

  return adapter.send({ ...ctx, prepared: preparedResult.prepared, recipients })
}

export const POST = withRlsAuth("campaigns", "write", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 })

    const adapter = getCampaignChannelAdapter(campaign)
    return executeCampaignChannel(adapter, { campaign, campaignId: id, orgId })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
