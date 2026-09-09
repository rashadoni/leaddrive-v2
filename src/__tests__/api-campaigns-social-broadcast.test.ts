import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type TestCampaign = {
  id: string
  organizationId: string
  type: string
  name: string
  subject?: string | null
  recipientMode?: string
  recipientIds?: string[]
  recipientSource?: string | null
  segmentId?: string | null
  flowData?: unknown
  isAbTest?: boolean
  testPercentage?: number | null
  templateId?: string | null
}

type TestContact = {
  id: string
  fullName: string
  email?: string | null
  phone?: string | null
  source?: string | null
  channelPreferences?: { isOptedIn: boolean }[]
}

type TestLead = {
  id: string
  contactName: string
  email?: string | null
  phone?: string | null
  phoneWhatsApp?: string | null
  telegramHandle?: string | null
}

type TestTelegramMessage = {
  contactId: string | null
  metadata: unknown
}

type TestWhatsAppMessage = {
  from: string
  metadata: unknown
}

type TestChannelConfig = {
  id: string
  botToken?: string | null
}

type TestWhatsAppTemplate = {
  id: string
  name: string
  language: string
  status: string
}

type FindArgs = {
  where?: Record<string, unknown>
}

type WhatsAppTextCall = {
  to: string
  body: string
  organizationId: string
  contactId?: string
  leadId?: string
}

type WhatsAppTemplateCall = {
  to: string
  templateName: string
  languageCode?: string
  variables?: Record<string, string> | string[]
  organizationId: string
  contactId?: string
  leadId?: string
}

type TelegramTextCall = {
  organizationId: string
  to: string
  body: string
  channelConfigId?: string | null
  preferExplicitTo?: boolean
}

const campaignFindFirst = vi.hoisted(() => vi.fn())
const campaignUpdate = vi.hoisted(() => vi.fn())
const contactFindMany = vi.hoisted(() => vi.fn())
const leadFindMany = vi.hoisted(() => vi.fn())
const channelConfigFindFirst = vi.hoisted(() => vi.fn())
const channelMessageFindMany = vi.hoisted(() => vi.fn())
const whatsAppTemplateFindFirst = vi.hoisted(() => vi.fn())
const resolveWhatsAppConfig = vi.hoisted(() => vi.fn())
const sendWhatsAppText = vi.hoisted(() => vi.fn())
const sendWhatsAppTemplate = vi.hoisted(() => vi.fn())
const sendTelegramText = vi.hoisted(() => vi.fn())
const trackContactEvent = vi.hoisted(() => vi.fn(async () => {}))

const state: {
  campaign: TestCampaign | null
  contacts: TestContact[]
  leads: TestLead[]
  telegramMessages: TestTelegramMessage[]
  whatsAppMessages: TestWhatsAppMessage[]
  telegramConfig: TestChannelConfig | null
  whatsAppTemplate: TestWhatsAppTemplate | null
} = {
  campaign: null,
  contacts: [],
  leads: [],
  telegramMessages: [],
  whatsAppMessages: [],
  telegramConfig: null,
  whatsAppTemplate: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringIdsFromWhere(where: Record<string, unknown> | undefined): string[] | null {
  if (!where) return null
  const id = where.id
  if (!isRecord(id)) return null
  return Array.isArray(id.in) ? id.in.filter((item): item is string => typeof item === "string") : null
}

function hasNotNullFilter(where: Record<string, unknown> | undefined, key: string): boolean {
  if (!where) return false
  const filter = where[key]
  return isRecord(filter) && filter.not === null
}

function hasPhoneOrWhatsappFilter(where: Record<string, unknown> | undefined): boolean {
  const filters = where?.OR
  return Array.isArray(filters) && filters.some((filter) => {
    if (!isRecord(filter)) return false
    return hasNotNullFilter(filter, "phone") || hasNotNullFilter(filter, "phoneWhatsApp")
  })
}

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getSession: vi.fn(async () => ({ userId: "u1", orgId: "org_1", role: "admin" })),
  requireAuth: vi.fn(async () => ({
    userId: "u1",
    orgId: "org_1",
    role: "admin",
    email: "a@b.com",
    name: "Test",
  })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findFirst: campaignFindFirst,
      update: campaignUpdate,
    },
    contact: {
      findMany: contactFindMany,
    },
    lead: {
      findMany: leadFindMany,
    },
    contactSegment: {
      findFirst: vi.fn(async () => null),
    },
    campaignVariant: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    emailTemplate: {
      findFirst: vi.fn(async () => null),
    },
    channelConfig: {
      findFirst: channelConfigFindFirst,
    },
    channelMessage: {
      findMany: channelMessageFindMany,
    },
    whatsAppTemplate: {
      findFirst: whatsAppTemplateFindFirst,
    },
  },
}))

vi.mock("@/lib/whatsapp", () => ({
  resolveWhatsAppConfig,
  sendWhatsAppText,
  sendWhatsAppTemplate,
}))

vi.mock("@/lib/telegram", () => ({
  sendTelegramText,
}))

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async () => ({ success: true })),
  isSmsConfigured: vi.fn(async () => true),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  renderTemplate: vi.fn((template: string) => template),
}))

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent }))
vi.mock("@/lib/marketing-attribution/touchpoint-recorder", () => ({
  recordTouchpointsSafe: vi.fn(),
  touchpointSourceKey: { smsSent: (campaignId: string, contactId: string) => `sms:${campaignId}:${contactId}:sent` },
}))

import { POST as SEND_POST } from "@/app/api/v1/campaigns/[id]/send/route"
import { POST as ELIGIBILITY_POST } from "@/app/api/v1/campaigns/eligibility/route"

function makeReq(): NextRequest {
  return new NextRequest("https://example.com/api/v1/campaigns/c1/send", { method: "POST" })
}

function makePreviewReq(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/v1/campaigns/eligibility", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.campaign = null
  state.contacts = []
  state.leads = []
  state.telegramMessages = []
  state.whatsAppMessages = []
  state.telegramConfig = { id: "tg_cfg_1", botToken: "bot-token" }
  state.whatsAppTemplate = null

  campaignFindFirst.mockImplementation(async () => state.campaign)
  campaignUpdate.mockImplementation(async () => state.campaign)
  contactFindMany.mockImplementation(async ({ where }: FindArgs = {}) => {
    let rows = [...state.contacts]
    const ids = stringIdsFromWhere(where)
    if (ids) rows = rows.filter((contact) => ids.includes(contact.id))
    if (hasNotNullFilter(where, "phone")) rows = rows.filter((contact) => Boolean(contact.phone))
    if (hasNotNullFilter(where, "email")) rows = rows.filter((contact) => Boolean(contact.email))
    if (typeof where?.source === "string") rows = rows.filter((contact) => contact.source === where.source)
    return rows
  })
  leadFindMany.mockImplementation(async ({ where }: FindArgs = {}) => {
    let rows = [...state.leads]
    if (hasNotNullFilter(where, "email")) rows = rows.filter((lead) => Boolean(lead.email))
    if (hasNotNullFilter(where, "telegramHandle")) rows = rows.filter((lead) => Boolean(lead.telegramHandle))
    if (hasPhoneOrWhatsappFilter(where)) rows = rows.filter((lead) => Boolean(lead.phoneWhatsApp || lead.phone))
    return rows
  })
  channelConfigFindFirst.mockImplementation(async () => state.telegramConfig)
  channelMessageFindMany.mockImplementation(async ({ where }: FindArgs = {}) => {
    if (where?.channelType === "whatsapp") return state.whatsAppMessages
    return state.telegramMessages
  })
  whatsAppTemplateFindFirst.mockImplementation(async () => state.whatsAppTemplate)
  resolveWhatsAppConfig.mockResolvedValue({ id: "wa_cfg_1", phoneNumberId: "phone_id", accessToken: "token" })
  sendWhatsAppText.mockResolvedValue({ success: true, messageId: "wamid_text_1" })
  sendWhatsAppTemplate.mockResolvedValue({ success: true, messageId: "wamid_tpl_1" })
  sendTelegramText.mockResolvedValue({ success: true, messageId: "tg_msg_1" })
})

describe("POST /api/v1/campaigns/[id]/send — WhatsApp + Telegram broadcasts", () => {
  it("sends WhatsApp free-text broadcasts to opted-in contacts with phones", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "whatsapp",
      name: "WA promo",
      subject: "Hi {{client_name}}",
      recipientMode: "contacts",
      flowData: null,
    }
    state.contacts = [{ id: "ct_1", fullName: "Aysel", phone: "+994501112233", email: "a@example.com" }]

    const res = await SEND_POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ channel: "whatsapp", sent: 1, total: 1, textSent: 1, templateSent: 0 })
    expect(sendWhatsAppText).toHaveBeenCalledWith({
      to: "+994501112233",
      body: "Hi Aysel",
      organizationId: "org_1",
      contactId: "ct_1",
    } satisfies WhatsAppTextCall)
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(trackContactEvent).toHaveBeenCalledWith("org_1", "ct_1", "whatsapp_sent", expect.objectContaining({ campaignId: "c1", mode: "text" }))
  })

  it("falls back to the configured WhatsApp template outside the 24h window", async () => {
    sendWhatsAppText.mockResolvedValue({ success: false, error: "outside_window_no_template" })
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "whatsapp",
      name: "Template promo",
      subject: "Fallback text",
      recipientMode: "contacts",
      flowData: {
        whatsappTemplate: {
          name: "promo_update",
          languageCode: "en_US",
          variables: { customer: "{{client_name}}", campaign: "{{campaign_name}}" },
        },
      },
    }
    state.contacts = [{ id: "ct_1", fullName: "Leyla", phone: "+994507778899", email: "l@example.com" }]

    const res = await SEND_POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ channel: "whatsapp", sent: 1, total: 1, textSent: 0, templateSent: 1 })
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: "+994507778899",
      templateName: "promo_update",
      languageCode: "en_US",
      variables: { customer: "Leyla", campaign: "Template promo" },
      organizationId: "org_1",
      contactId: "ct_1",
    } satisfies WhatsAppTemplateCall)
  })

  it("returns 422 before recipient resolution when WhatsApp is not configured", async () => {
    resolveWhatsAppConfig.mockResolvedValue(null)
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "whatsapp",
      name: "No provider",
      subject: "Hi",
      recipientMode: "contacts",
    }

    const res = await SEND_POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/WhatsApp provider not configured/)
    expect(contactFindMany).not.toHaveBeenCalled()
    expect(sendWhatsAppText).not.toHaveBeenCalled()
  })

  it("sends Telegram broadcasts to contacts with prior chat ids and leads with telegram handles", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "telegram",
      name: "TG promo",
      subject: "Hello {{client_name}} via {{telegram}}",
      recipientMode: "all",
    }
    state.contacts = [
      { id: "ct_1", fullName: "Nigar", email: "n@example.com", phone: "+994501111111" },
      { id: "ct_2", fullName: "No Chat", email: "no@example.com", phone: "+994502222222" },
    ]
    state.telegramMessages = [{ contactId: "ct_1", metadata: { chatId: "-100123" } }]
    state.leads = [
      { id: "ld_1", contactName: "Murad Lead", telegramHandle: "@murad", phone: "+994503333333" },
      { id: "ld_2", contactName: "No Telegram", telegramHandle: null },
    ]

    const res = await SEND_POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ channel: "telegram", sent: 2, total: 2 })
    expect(sendTelegramText).toHaveBeenCalledTimes(2)
    expect(sendTelegramText).toHaveBeenCalledWith({
      organizationId: "org_1",
      to: "-100123",
      body: "Hello Nigar via -100123",
      channelConfigId: "tg_cfg_1",
      preferExplicitTo: true,
    } satisfies TelegramTextCall)
    expect(sendTelegramText).toHaveBeenCalledWith({
      organizationId: "org_1",
      to: "@murad",
      body: "Hello Murad Lead via @murad",
      channelConfigId: "tg_cfg_1",
      preferExplicitTo: true,
    } satisfies TelegramTextCall)
    expect(trackContactEvent).toHaveBeenCalledWith("org_1", "ct_1", "telegram_sent", expect.objectContaining({ campaignId: "c1" }))
  })

  it("returns 422 before recipient resolution when Telegram bot is not configured", async () => {
    state.telegramConfig = null
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "telegram",
      name: "No bot",
      subject: "Hi",
      recipientMode: "all",
    }

    const res = await SEND_POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/Telegram бот не настроен/)
    expect(contactFindMany).not.toHaveBeenCalled()
    expect(sendTelegramText).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/campaigns/eligibility — social broadcast preview", () => {
  it("previews WhatsApp eligibility with session window, approved template and skipped reasons", async () => {
    state.whatsAppTemplate = { id: "tpl_1", name: "promo_update", language: "en_US", status: "APPROVED" }
    state.contacts = [
      { id: "ct_1", fullName: "Aysel", phone: "+994501112233", email: "a@example.com", channelPreferences: [] },
      { id: "ct_2", fullName: "No Phone", phone: null, email: "no@example.com", channelPreferences: [] },
      { id: "ct_3", fullName: "Opted Out", phone: "+994502224466", email: "out@example.com", channelPreferences: [{ isOptedIn: false }] },
    ]
    state.leads = [
      { id: "ld_1", contactName: "Murad Lead", phoneWhatsApp: "+994507778899", phone: null },
      { id: "ld_2", contactName: "No Phone Lead", phoneWhatsApp: null, phone: null },
    ]
    state.whatsAppMessages = [{ from: "+994501112233", metadata: { waPhone: "+994501112233" } }]

    const res = await ELIGIBILITY_POST(makePreviewReq({
      type: "whatsapp",
      recipientMode: "all",
      flowData: {
        whatsappTemplate: { name: "promo_update", languageCode: "en_US" },
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      channel: "whatsapp",
      providerConfigured: true,
      totalAudience: 5,
      eligible: 2,
      skipped: 3,
      reachable: 2,
      whatsapp: {
        sessionWindow: 1,
        requiresTemplate: 1,
        templateApproved: true,
        templateName: "promo_update",
      },
    })
    expect(body.data.reasons).toEqual(expect.arrayContaining([
      { code: "missing_phone", count: 2 },
      { code: "opted_out", count: 1 },
    ]))
  })

  it("previews Telegram eligibility using known chat ids, lead handles and opt-out state", async () => {
    state.contacts = [
      { id: "ct_1", fullName: "Nigar", email: "n@example.com", phone: "+994501111111", channelPreferences: [] },
      { id: "ct_2", fullName: "No Chat", email: "no@example.com", phone: "+994502222222", channelPreferences: [] },
      { id: "ct_3", fullName: "Opted Out", email: "out@example.com", phone: "+994503333333", channelPreferences: [{ isOptedIn: false }] },
    ]
    state.telegramMessages = [{ contactId: "ct_1", metadata: { chatId: "-100123" } }]
    state.leads = [
      { id: "ld_1", contactName: "Murad Lead", telegramHandle: "@murad" },
      { id: "ld_2", contactName: "No Telegram", telegramHandle: null },
    ]

    const res = await ELIGIBILITY_POST(makePreviewReq({ type: "telegram", recipientMode: "all" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      channel: "telegram",
      providerConfigured: true,
      totalAudience: 5,
      eligible: 2,
      skipped: 3,
      reachable: 2,
    })
    expect(body.data.reasons).toEqual(expect.arrayContaining([
      { code: "opted_out", count: 1 },
      { code: "missing_chat_id", count: 1 },
      { code: "missing_telegram_handle", count: 1 },
    ]))
  })
})
