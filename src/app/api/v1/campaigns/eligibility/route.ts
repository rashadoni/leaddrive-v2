import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { getTruthyString, isObjectRecord, parseWhatsAppTemplateConfig } from "@/lib/campaigns/social-broadcast"

const WHATSAPP_SESSION_WINDOW_HOURS = 23
const WHATSAPP_BATCH_CAP = 500
const TELEGRAM_BATCH_CAP = 1000

const eligibilitySchema = z.object({
  type: z.enum(["whatsapp", "telegram"]),
  recipientMode: z.enum(["all", "contacts", "leads", "segment", "source", "manual"]).optional().default("all"),
  recipientIds: z.array(z.string()).optional().default([]),
  recipientSource: z.string().optional(),
  segmentId: z.string().optional(),
  flowData: z.unknown().optional(),
})

type EligibilityInput = z.infer<typeof eligibilitySchema>
type SocialChannel = EligibilityInput["type"]
type ReasonCode =
  | "missing_phone"
  | "opted_out"
  | "outside_window_no_template"
  | "provider_missing"
  | "template_not_approved"
  | "missing_chat_id"
  | "missing_telegram_handle"
  | "batch_cap"

type PreviewReason = { code: ReasonCode; count: number }

type PreviewContact = {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  channelPreferences: { isOptedIn: boolean }[]
}

type PreviewLead = {
  id: string
  contactName: string
  email: string | null
  phone: string | null
  phoneWhatsApp: string | null
  telegramHandle: string | null
}

type TelegramMessageRow = {
  contactId: string | null
  metadata: unknown
}

function addReason(reasons: PreviewReason[], code: ReasonCode, count: number) {
  if (count > 0) reasons.push({ code, count })
}

function getDateValue(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function cleanPhone(value: string | null | undefined): string | null {
  const digits = String(value || "").replace(/[^0-9]/g, "")
  if (digits.length < 6) return null
  return digits.slice(-10)
}

function extractTelegramChatId(metadata: unknown): string | null {
  if (!isObjectRecord(metadata)) return null
  const chatId = metadata.chatId
  if (typeof chatId === "string" && chatId) return chatId
  if (typeof chatId === "number") return String(chatId)
  return null
}

function addCommonSegmentConditions(where: Prisma.ContactWhereInput, conditions: Record<string, unknown>, channel: SocialChannel) {
  const andConditions: Prisma.ContactWhereInput[] = []
  const source = getTruthyString(conditions.source)
  const name = getTruthyString(conditions.name)

  if (source) andConditions.push({ source })
  if (name) andConditions.push({ fullName: { contains: name, mode: "insensitive" } })

  const createdAfter = getDateValue(conditions.createdAfter)
  if (createdAfter) andConditions.push({ createdAt: { gte: createdAfter } })

  const createdBefore = getDateValue(conditions.createdBefore)
  if (createdBefore) andConditions.push({ createdAt: { lte: createdBefore } })

  if (channel === "whatsapp" && conditions.hasPhone) {
    andConditions.push({ phone: { not: null }, AND: [{ phone: { not: "" } }] })
  }

  if (andConditions.length > 0) where.AND = andConditions
}

async function contactWhereForPreview(orgId: string, input: EligibilityInput): Promise<Prisma.ContactWhereInput | null> {
  if (input.recipientMode === "leads") return null

  const where: Prisma.ContactWhereInput = { organizationId: orgId }

  if (input.recipientMode === "manual") {
    if (input.recipientIds.length === 0) return null
    where.id = { in: input.recipientIds }
  }

  if (input.recipientMode === "source" && input.recipientSource) {
    where.source = input.recipientSource
  }

  if (input.recipientMode === "segment" && input.segmentId) {
    const segment = await prisma.contactSegment.findFirst({
      where: { id: input.segmentId, organizationId: orgId },
      select: { conditions: true },
    })
    if (isObjectRecord(segment?.conditions)) addCommonSegmentConditions(where, segment.conditions, input.type)
  }

  return where
}

function shouldLoadLeads(input: EligibilityInput): boolean {
  return input.recipientMode === "all" || input.recipientMode === "leads"
}

async function loadPreviewAudience(orgId: string, input: EligibilityInput): Promise<{ contacts: PreviewContact[]; leads: PreviewLead[] }> {
  const contactWhere = await contactWhereForPreview(orgId, input)
  const [contacts, leads] = await Promise.all([
    contactWhere
      ? prisma.contact.findMany({
          where: contactWhere,
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            channelPreferences: {
              where: { organizationId: orgId, channel: input.type },
              select: { isOptedIn: true },
            },
          },
        })
      : Promise.resolve([]),
    shouldLoadLeads(input)
      ? prisma.lead.findMany({
          where: { organizationId: orgId },
          select: { id: true, contactName: true, email: true, phone: true, phoneWhatsApp: true, telegramHandle: true },
        })
      : Promise.resolve([]),
  ])

  return { contacts, leads }
}

function isOptedOut(contact: PreviewContact): boolean {
  return contact.channelPreferences.some((pref) => pref.isOptedIn === false)
}

function metadataDigits(value: unknown): string {
  try {
    return JSON.stringify(value)?.replace(/[^0-9]/g, "") || ""
  } catch {
    return ""
  }
}

async function resolveWhatsAppSessionPhones(orgId: string, phones: string[]): Promise<Set<string>> {
  const cleanPhones = Array.from(new Set(phones.map(cleanPhone).filter((phone): phone is string => Boolean(phone)))).slice(0, WHATSAPP_BATCH_CAP)
  if (cleanPhones.length === 0) return new Set()

  const since = new Date(Date.now() - WHATSAPP_SESSION_WINDOW_HOURS * 60 * 60 * 1000)
  const inbound = await prisma.channelMessage.findMany({
    where: {
      organizationId: orgId,
      direction: "inbound",
      channelType: "whatsapp",
      createdAt: { gte: since },
      OR: cleanPhones.flatMap((phone) => [
        { from: { contains: phone } },
        { metadata: { path: ["waPhone"], string_contains: phone } as Prisma.JsonFilter },
      ]),
    },
    select: { from: true, metadata: true },
  })

  const inWindow = new Set<string>()
  for (const message of inbound) {
    const haystack = `${cleanPhone(message.from) || ""} ${metadataDigits(message.metadata)}`
    for (const phone of cleanPhones) {
      if (haystack.includes(phone)) inWindow.add(phone)
    }
  }
  return inWindow
}

async function previewWhatsApp(orgId: string, input: EligibilityInput) {
  const [{ contacts, leads }, providerConfig] = await Promise.all([
    loadPreviewAudience(orgId, input),
    resolveWhatsAppConfig(orgId).catch(() => null),
  ])

  const optedOut = contacts.filter(isOptedOut).length
  const optedInContacts = contacts.filter((contact) => !isOptedOut(contact))
  const contactMissingPhone = optedInContacts.filter((contact) => !contact.phone).length
  const reachableContacts = optedInContacts.filter((contact) => Boolean(contact.phone))
  const leadMissingPhone = leads.filter((lead) => !lead.phoneWhatsApp && !lead.phone).length
  const reachableLeads = leads.filter((lead) => Boolean(lead.phoneWhatsApp || lead.phone))
  const reachablePhones = [
    ...reachableContacts.map((contact) => contact.phone).filter((phone): phone is string => Boolean(phone)),
    ...reachableLeads.map((lead) => lead.phoneWhatsApp || lead.phone).filter((phone): phone is string => Boolean(phone)),
  ]

  const templateConfig = parseWhatsAppTemplateConfig(input.flowData)
  const approvedTemplate = templateConfig?.name
    ? await prisma.whatsAppTemplate.findFirst({
        where: {
          organizationId: orgId,
          name: templateConfig.name,
          status: "APPROVED",
          ...(templateConfig.languageCode ? { language: templateConfig.languageCode } : {}),
        },
        select: { id: true, name: true, language: true, status: true },
      })
    : null

  const attemptPhones = reachablePhones.slice(0, WHATSAPP_BATCH_CAP)
  const inWindow = await resolveWhatsAppSessionPhones(orgId, attemptPhones)
  const sessionWindow = attemptPhones.filter((phone) => {
    const clean = cleanPhone(phone)
    return clean ? inWindow.has(clean) : false
  }).length
  const requiresTemplate = attemptPhones.length - sessionWindow
  const templateApproved = Boolean(approvedTemplate)
  const providerConfigured = Boolean(providerConfig)
  const sendableBeforeProvider = sessionWindow + (templateApproved ? requiresTemplate : 0)
  const eligible = providerConfigured ? sendableBeforeProvider : 0
  const totalAudience = contacts.length + leads.length
  const batchCap = Math.max(0, reachablePhones.length - WHATSAPP_BATCH_CAP)
  const reasons: PreviewReason[] = []

  addReason(reasons, "missing_phone", contactMissingPhone + leadMissingPhone)
  addReason(reasons, "opted_out", optedOut)
  if (!providerConfigured) {
    addReason(reasons, "provider_missing", attemptPhones.length)
  } else if (requiresTemplate > 0 && !templateApproved) {
    addReason(reasons, templateConfig?.name ? "template_not_approved" : "outside_window_no_template", requiresTemplate)
  }
  addReason(reasons, "batch_cap", batchCap)

  return {
    channel: "whatsapp" as const,
    providerConfigured,
    totalAudience,
    eligible,
    skipped: Math.max(0, totalAudience - eligible),
    sendCap: WHATSAPP_BATCH_CAP,
    capped: batchCap > 0,
    reachable: reachablePhones.length,
    contacts: {
      total: contacts.length,
      eligible: reachableContacts.length,
      skipped: contacts.length - reachableContacts.length,
    },
    leads: {
      total: leads.length,
      eligible: reachableLeads.length,
      skipped: leads.length - reachableLeads.length,
    },
    whatsapp: {
      sessionWindow,
      requiresTemplate,
      templateSelected: Boolean(templateConfig?.name),
      templateApproved,
      templateName: templateConfig?.name || null,
      templateLanguage: templateConfig?.languageCode || approvedTemplate?.language || null,
    },
    reasons,
  }
}

async function hydrateTelegramContactChats(orgId: string, contacts: PreviewContact[]): Promise<Map<string, string>> {
  if (contacts.length === 0) return new Map()

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
  return chatByContact
}

async function previewTelegram(orgId: string, input: EligibilityInput) {
  const [{ contacts, leads }, telegramConfig] = await Promise.all([
    loadPreviewAudience(orgId, input),
    prisma.channelConfig.findFirst({
      where: { organizationId: orgId, channelType: "telegram", isActive: true },
      select: { id: true, botToken: true },
    }),
  ])

  const optedOut = contacts.filter(isOptedOut).length
  const optedInContacts = contacts.filter((contact) => !isOptedOut(contact))
  const chatByContact = await hydrateTelegramContactChats(orgId, optedInContacts)
  const contactsWithChat = optedInContacts.filter((contact) => chatByContact.has(contact.id)).length
  const missingChat = optedInContacts.length - contactsWithChat
  const leadsWithHandle = leads.filter((lead) => Boolean(lead.telegramHandle)).length
  const missingHandle = leads.length - leadsWithHandle
  const reachable = contactsWithChat + leadsWithHandle
  const providerConfigured = Boolean(telegramConfig?.botToken)
  const batchCap = Math.max(0, reachable - TELEGRAM_BATCH_CAP)
  const eligibleBeforeProvider = Math.min(reachable, TELEGRAM_BATCH_CAP)
  const eligible = providerConfigured ? eligibleBeforeProvider : 0
  const totalAudience = contacts.length + leads.length
  const reasons: PreviewReason[] = []

  addReason(reasons, "opted_out", optedOut)
  addReason(reasons, "missing_chat_id", missingChat)
  addReason(reasons, "missing_telegram_handle", missingHandle)
  if (!providerConfigured) addReason(reasons, "provider_missing", eligibleBeforeProvider)
  addReason(reasons, "batch_cap", batchCap)

  return {
    channel: "telegram" as const,
    providerConfigured,
    totalAudience,
    eligible,
    skipped: Math.max(0, totalAudience - eligible),
    sendCap: TELEGRAM_BATCH_CAP,
    capped: batchCap > 0,
    reachable,
    contacts: {
      total: contacts.length,
      eligible: contactsWithChat,
      skipped: contacts.length - contactsWithChat,
    },
    leads: {
      total: leads.length,
      eligible: leadsWithHandle,
      skipped: leads.length - leadsWithHandle,
    },
    reasons,
  }
}

export const POST = withRlsAuth("campaigns", "read", async (req, { orgId }) => {
  const body = await req.json().catch(() => ({}))
  const parsed = eligibilitySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const data = parsed.data.type === "whatsapp"
      ? await previewWhatsApp(orgId, parsed.data)
      : await previewTelegram(orgId, parsed.data)

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error("[campaigns/eligibility]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
