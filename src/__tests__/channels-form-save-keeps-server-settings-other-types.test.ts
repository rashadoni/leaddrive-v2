// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

/**
 * Saving the channel form on every row that is not Facebook/Instagram, carried through the real PUT route and read
 * back through the endpoints that own the settings. (The Facebook/Instagram half is
 * channels-form-save-keeps-server-settings.test.ts, #343.)
 *
 * Found 2026-09-21. The form rebuilds `settings` from its own fields and the PUT stored that object as it came, so
 * one Save:
 *  - switched AI back on for a WhatsApp channel an admin had set to "agent" (WhatsApp is default-on,
 *    lib/inbox/reply-mode) and dropped the draft/threshold gate with it;
 *  - dropped the WhatsApp notification templates and the social-lead group;
 *  - dropped the VK Callback `secret` and the SMS `inboundSecret`, after which both webhooks reject every inbound
 *    message — and the form has no field for either;
 *  - dropped the Vonage API key, whose field the API leaves empty on every edit;
 *  - wiped a workspace's Social Monitoring configuration when its row, listed under "Other connected channels",
 *    was opened in this form and saved.
 *
 * Nothing here is a hand-written settings object: rows come from the real create route fed the form's own payload,
 * settings from the real endpoints that own them, the save is the real form's submit handed to the real PUT handler,
 * and every check reads back through those endpoints — or, for the webhook secrets, knocks on the real webhook.
 */

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    variant: _variant,
    size: _size,
    ...props
  }: {
    asChild?: boolean
    children?: ReactNode
    variant?: string
    size?: string
    [key: string]: unknown
  }) => {
    void _variant
    void _size
    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<Record<string, unknown>>, props)
    }
    return createElement("button", props, children)
  },
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

// ---- Server side: one in-memory ChannelConfig table instead of Postgres. ------------------------------------

type StoredRow = {
  id: string
  organizationId: string
  channelType: string
  configName: string
  botToken: string | null
  webhookUrl: string | null
  apiKey: string | null
  phoneNumber: string | null
  appId: string | null
  appSecret: string | null
  pageId: string | null
  accessToken: string | null
  phoneNumberId: string | null
  businessAccountId: string | null
  verifyToken: string | null
  displayName: string | null
  isActive: boolean
  settings: unknown
  createdAt: Date
}

const store = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  clock: 0,
  /** Every body the form PUT, exactly as it left the browser. */
  puts: [] as Array<Record<string, unknown>>,
}))

/** A Json column holds JSON: what a writer hands over is stored, and read back, as a copy. */
function jsonCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function snapshot(row: StoredRow): StoredRow {
  return { ...row, settings: jsonCopy(row.settings) }
}

function rowMatches(row: StoredRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key]
    if (expected && typeof expected === "object" && "not" in expected) {
      return actual !== (expected as { not: unknown }).not
    }
    return actual === expected
  })
}

function applyWrite(row: StoredRow, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue // Prisma skips undefined fields
    ;(row as unknown as Record<string, unknown>)[key] = key === "settings" ? jsonCopy(value) : value
  }
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        [...store.rows.values()]
          .filter((row) => rowMatches(row, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(snapshot),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = [...store.rows.values()].find((candidate) => rowMatches(candidate, where))
        return row ? snapshot(row) : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.rows.get(where.id)
        if (!row) throw new Error(`no row ${where.id}`)
        applyWrite(row, data)
        return snapshot(row)
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matched = [...store.rows.values()].filter((row) => rowMatches(row, where))
        for (const row of matched) applyWrite(row, data)
        return { count: matched.length }
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.clock += 1
        const row: StoredRow = {
          id: `cc_${store.clock}`,
          organizationId: "",
          channelType: "",
          configName: "",
          botToken: null,
          webhookUrl: null,
          apiKey: null,
          phoneNumber: null,
          appId: null,
          appSecret: null,
          pageId: null,
          accessToken: null,
          phoneNumberId: null,
          businessAccountId: null,
          verifyToken: null,
          displayName: null,
          isActive: true,
          settings: null,
          createdAt: new Date(Date.UTC(2026, 8, 21, 12, 0, store.clock)),
        }
        applyWrite(row, data)
        store.rows.set(row.id, row)
        return snapshot(row)
      },
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === "org_1" ? { id: "org_1" } : null),
    },
  },
  logAudit: vi.fn(async () => undefined),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
// Session resolution has its own tests; here every request is the workspace admin.
vi.mock("@/lib/api-auth", () => {
  const admin = { orgId: "org_1", userId: "user_1", role: "admin", email: "admin@example.test", name: "Admin" }
  return {
    getOrgId: vi.fn(async () => "org_1"),
    getSession: vi.fn(async () => admin),
    requireAuth: vi.fn(async () => admin),
    requireSessionAuth: vi.fn(async () => admin),
    isAuthError: () => false,
  }
})
vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: vi.fn(async () => ({ orgId: "org_1", role: "admin", userId: "user_1" })),
}))
// Cross-workspace claims concern Facebook/Instagram only and have their own tests (channels-claimed-elsewhere).
vi.mock("@/lib/channels/inbound-claim", () => ({
  channelIdsClaimedElsewhere: vi.fn(async () => new Set<string>()),
}))

import { ChannelConfigForm } from "@/components/channel-config-form"
import { buildChannelPayload, type ChannelConfigFormData } from "@/lib/channels/channel-config-payload"
import { GET as listChannels, POST as createChannel } from "@/app/api/v1/channels/route"
import { PUT as updateChannel } from "@/app/api/v1/channels/[id]/route"
import { GET as readReplyPolicies, PATCH as setReplyPolicy } from "@/app/api/v1/settings/channel-reply/route"
import {
  GET as readNotificationTemplates,
  PUT as setNotificationTemplates,
} from "@/app/api/v1/whatsapp/notification-settings/route"
import { GET as readLeadGroup, PUT as setLeadGroup } from "@/app/api/v1/social/whatsapp-group-settings/route"
import { POST as vkWebhook } from "@/app/api/v1/webhooks/vkontakte/route"
import { POST as smsInboundWebhook } from "@/app/api/v1/webhooks/sms-inbound/route"
import { getSocialMonitoringSettings, saveSocialMonitoringSettings } from "@/lib/social/monitoring-settings"
import { aiReplyEnabled } from "@/lib/inbox/reply-mode"
import { REPLY_POLICY_SETTING_KEYS, serverOwnedSettingKeys } from "@/lib/channels/server-owned-settings"
import { META_SERVER_OWNED_SETTING_KEYS } from "@/lib/channels/meta-server-settings"

const APP = "https://app.leaddrivecrm.org"

// ---- Rows, created the way the product creates them. -------------------------------------------------------

function formData(overrides: Partial<ChannelConfigFormData>): ChannelConfigFormData {
  return {
    configName: "Channel",
    channelType: "email",
    botToken: "",
    webhookUrl: "",
    apiKey: "",
    phoneNumber: "",
    chatId: "",
    accountSid: "",
    appId: "",
    appSecret: "",
    pageId: "",
    confirmationCode: "",
    isActive: true,
    smsProvider: "atl",
    atlLogin: "",
    atlTitle: "",
    twilioAccountSid: "",
    twilioNumber: "",
    vonageApiKey: "",
    vonageFromName: "",
    smsSecret: "",
    smsEditing: false,
    verifyToken: "",
    displayName: "",
    igLogin: false,
    appReviewOnly: false,
    loginConfigId: "",
    chatwootBaseUrl: "",
    chatwootAccountId: "",
    chatwootWebhookSecret: "",
    emailTicketIntakeAddress: "",
    emailComplaintIntakeAddress: "",
    ...overrides,
  }
}

/** What the form POSTs when the channel is first set up. */
async function createThroughForm(overrides: Partial<ChannelConfigFormData>): Promise<string> {
  const res = await createChannel({
    json: async () => buildChannelPayload(formData(overrides)),
    headers: new Headers(),
  } as unknown as NextRequest)
  expect(res.status).toBe(201)
  const json = (await res.json()) as { data: { id: string } }
  return json.data.id
}

const whatsappRow = () => createThroughForm({
  configName: "WhatsApp Sales",
  channelType: "whatsapp",
  apiKey: "wa-access-token",
  phoneNumber: "105550001",
  webhookUrl: "205550001",
  verifyToken: "wa-verify",
  appSecret: "wa-app-secret",
  displayName: "Acme",
})

const telegramRow = () => createThroughForm({ configName: "Support bot", channelType: "telegram", botToken: "123:abc", chatId: "-100200300" })

const vkRow = () => createThroughForm({
  configName: "VK community",
  channelType: "vkontakte",
  pageId: "224466",
  apiKey: "vk1.a.token",
  confirmationCode: "c0nf1rm",
})

const vonageSmsRow = () => createThroughForm({
  configName: "SMS",
  channelType: "sms",
  smsProvider: "vonage",
  vonageApiKey: "VONAGE_KEY",
  smsSecret: "VONAGE_SECRET",
  vonageFromName: "Acme",
})

const emailRow = () => createThroughForm({
  configName: "Support mail",
  channelType: "email",
  apiKey: "smtp-password",
  emailTicketIntakeAddress: "support@acme.test",
})

/** Another admin client — not the form. */
async function putDirectly(id: string, body: Record<string, unknown>) {
  const res = await updateChannel(
    { json: async () => body, headers: new Headers() } as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )
  expect(res.status).toBe(200)
}

function request(path: string, init?: RequestInit): NextRequest {
  return new Request(`${APP}${path}`, init) as unknown as NextRequest
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

async function setPolicy(body: Record<string, unknown>) {
  const res = await setReplyPolicy(jsonRequest("/api/v1/settings/channel-reply", "PATCH", body))
  expect(res.status).toBe(200)
}

async function policyInMatrix(id: string) {
  const res = await readReplyPolicies(request("/api/v1/settings/channel-reply"))
  const json = (await res.json()) as { data: { channels: Array<{ id: string; reply: Record<string, unknown> }> } }
  return json.data.channels.find((channel) => channel.id === id)?.reply
}

/** Every field the reply matrix can set, off its defaults. */
const FULL_POLICY = {
  mode: "agent",
  afterHoursAi: true,
  draftMode: true,
  aiThreshold: 0.85,
  aiRolloutPercent: 40,
  outOfOffice: { enabled: true, message: "Back at 9:00" },
  escalateKeywords: ["оператор", "manager"],
}

async function notificationTemplates() {
  const res = await readNotificationTemplates(request("/api/v1/whatsapp/notification-settings"))
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: Record<string, unknown> }).data
}

async function leadGroup() {
  const res = await readLeadGroup(request("/api/v1/social/whatsapp-group-settings"))
  return ((await res.json()) as { data: Record<string, unknown> }).data
}

/** VK's confirmation handshake: answered with the code only when the callback carries the configured secret. */
async function vkHandshake(secret: string): Promise<string> {
  const res = await vkWebhook({ json: async () => ({ type: "confirmation", group_id: 224466, secret }) } as unknown as NextRequest)
  return res.text()
}

/** An inbound SMS delivery with no message in it: 200 once the secret checks out, 503 when none is configured. */
async function smsInboundStatus(secret: string): Promise<number> {
  const res = await smsInboundWebhook(request("/api/v1/webhooks/sms-inbound?orgId=org_1", {
    method: "POST",
    headers: { "x-webhook-secret": secret, "content-type": "application/x-www-form-urlencoded" },
    body: "",
  }))
  return res.status
}

function settingsOf(id: string): Record<string, unknown> {
  return jsonCopy((store.rows.get(id)?.settings || {}) as Record<string, unknown>)
}

let savedSmsInboundSecret: string | undefined

beforeEach(() => {
  store.rows.clear()
  store.clock = 0
  store.puts.length = 0
  // The inbound-SMS probe must see only the channel's own secret, never a deployment-wide fallback.
  savedSmsInboundSecret = process.env.SMS_INBOUND_SECRET
  delete process.env.SMS_INBOUND_SECRET
})

afterEach(() => {
  if (savedSmsInboundSecret !== undefined) process.env.SMS_INBOUND_SECRET = savedSmsInboundSecret
})

describe("saving the channel form keeps what other screens and endpoints wrote", () => {
  let container: HTMLDivElement
  let root: Root
  let onSaved: Mock<() => void>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  /** The browser side: the form's PUT handed to the real route handler. */
  function stubBrowserFetch() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const match = String(input).match(/^\/api\/v1\/channels\/([^/?]+)$/)
      if (match && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        store.puts.push(body)
        return updateChannel(
          { json: async () => body, headers: new Headers(init.headers) } as unknown as NextRequest,
          { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) },
        )
      }
      return new Response(JSON.stringify({ providers: {} }), { status: 200 })
    }))
  }

  /** Every await in the routes is a resolved in-memory promise, so one macrotask turn drains them all. */
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  /** Opened the way the catalog opens a row: with the channel as GET /api/v1/channels ships it. */
  async function openForm(id: string) {
    const res = await listChannels({ nextUrl: new URL(`${APP}/api/v1/channels`), headers: new Headers() } as unknown as NextRequest)
    const channels = ((await res.json()) as { data: Array<Record<string, unknown>> }).data
    const initialData = channels.find((channel) => channel.id === id)
    if (!initialData) throw new Error(`no channel ${id} in the list`)
    stubBrowserFetch()
    onSaved = vi.fn<() => void>()
    await act(async () => {
      root.render(createElement(ChannelConfigForm, {
        open: true,
        variant: "inline",
        onOpenChange: vi.fn(),
        onSaved,
        orgId: "org_1",
        lockChannelType: true,
        initialData,
      }))
    })
    await settle()
  }

  function field<T extends Element = HTMLInputElement>(selector: string): T {
    const element = container.querySelector<T>(selector)
    if (!element) throw new Error(`missing ${selector}`)
    return element
  }

  /** React tracks the value on the node, so a plain assignment is swallowed; go through the native setter. */
  async function typeInto(selector: string, value: string) {
    const input = field(selector)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  async function choose(selector: string, value: string) {
    const select = field<HTMLSelectElement>(selector)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value)
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
  }

  async function save() {
    const form = container.querySelector("form")
    if (!form) throw new Error("missing form")
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await settle()
    // The save went all the way through: the route answered and the form handed control back.
    expect(onSaved).toHaveBeenCalledTimes(1)
  }

  it("does not switch AI back on for a WhatsApp channel an admin set to agent", async () => {
    const id = await whatsappRow()
    await setPolicy({ configId: id, mode: "agent", draftMode: true, aiThreshold: 0.85 })
    expect(aiReplyEnabled(settingsOf(id).replyMode as string | undefined, true)).toBe(false)

    await openForm(id)
    await typeInto("#configName", "WhatsApp Sales — main")
    await save()

    expect(store.rows.get(id)?.configName).toBe("WhatsApp Sales — main")
    // The gate webhooks/whatsapp applies: WhatsApp answers with AI unless replyMode is explicitly "agent".
    expect(aiReplyEnabled(settingsOf(id).replyMode as string | undefined, true)).toBe(false)
    expect(await policyInMatrix(id)).toMatchObject({ mode: "agent", modeSource: "explicit", draftMode: true, aiThreshold: 0.85 })
    // The form sent only its own fields; the route is what kept the policy.
    expect(store.puts[0]?.settings).not.toHaveProperty("replyMode")
  })

  it("keeps the WhatsApp notification templates and the social-lead group", async () => {
    const id = await whatsappRow()
    const templates = {
      whatsappTicketStatusTemplates: { resolved: "ticket_resolved", closed: "ticket_closed" },
      whatsappSurveyTemplate: "csat_survey",
      whatsappJourneyDefaultTemplate: "journey_default",
    }
    expect((await setNotificationTemplates(jsonRequest("/api/v1/whatsapp/notification-settings", "PUT", templates))).status).toBe(200)
    expect((await setLeadGroup(jsonRequest("/api/v1/social/whatsapp-group-settings", "PUT", { groupId: "120363@g.us", groupName: "Sales leads" }))).status).toBe(200)
    const before = { templates: await notificationTemplates(), group: await leadGroup() }
    expect(before.templates).toEqual(templates)
    expect(before.group).toMatchObject({ groupId: "120363@g.us", groupName: "Sales leads" })

    await openForm(id)
    await save()

    expect({ templates: await notificationTemplates(), group: await leadGroup() }).toEqual(before)
  })

  it("keeps the reply policy on Telegram, and still lets the form clear the chat id it owns", async () => {
    const id = await telegramRow()
    await setPolicy({ configId: id, mode: "ai", afterHoursAi: true })

    await openForm(id)
    expect(field("#chatId").value).toBe("-100200300")
    await typeInto("#chatId", "")
    await save()

    expect(settingsOf(id)).not.toHaveProperty("chatId")
    expect(await policyInMatrix(id)).toMatchObject({ mode: "ai", afterHoursAi: true })
  })

  it("keeps VK answering its callbacks after a save, and still takes a new confirmation code", async () => {
    const id = await vkRow()
    // The form has no field for the Callback secret; an admin sets it through the API.
    await putDirectly(id, { settings: { confirmationCode: "c0nf1rm", secret: "vk-callback-secret" } })
    expect(await vkHandshake("vk-callback-secret")).toBe("c0nf1rm")

    await openForm(id)
    await typeInto("#configName", "VK community — support")
    await save()
    expect(await vkHandshake("vk-callback-secret")).toBe("c0nf1rm")

    await openForm(id)
    await typeInto("#confirmationCode", "n3wc0de")
    await save()
    expect(await vkHandshake("vk-callback-secret")).toBe("n3wc0de")
    expect(await vkHandshake("a-wrong-secret")).toBe("ok")
  })

  it("keeps inbound SMS authenticated and the Vonage API key after a save", async () => {
    const id = await vonageSmsRow()
    // No form field for the inbound secret either. This API client also leaves the Vonage key out of its settings:
    // the API never returned it, so the absence cannot mean "remove".
    await putDirectly(id, { settings: { smsProvider: "vonage", fromName: "Acme", inboundSecret: "sms-in-secret" } })
    expect(await smsInboundStatus("sms-in-secret")).toBe(200)

    await openForm(id)
    expect(field("#vonageApiKey").value).toBe("")
    await save()

    expect(await smsInboundStatus("sms-in-secret")).toBe(200)
    expect(settingsOf(id)).toEqual({ smsProvider: "vonage", fromName: "Acme", apiKey: "VONAGE_KEY", inboundSecret: "sms-in-secret" })

    // Switching provider is the form's call: the Vonage-only fields it owns go, the webhook secret stays.
    await openForm(id)
    await choose("#smsProvider", "atl")
    await typeInto("#atlLogin", "acme")
    await typeInto("#atlTitle", "ACME")
    await typeInto("#smsSecret", "atl-password")
    await save()
    expect(settingsOf(id)).toMatchObject({ smsProvider: "atl", atlLogin: "acme", atlTitle: "ACME" })
    expect(settingsOf(id)).not.toHaveProperty("fromName")
    expect(await smsInboundStatus("sms-in-secret")).toBe(200)
  })

  it("keeps the reply policy on an email channel while the form clears its intake route", async () => {
    const id = await emailRow()
    await setPolicy({ configId: id, mode: "ai", escalateKeywords: ["refund"] })

    await openForm(id)
    await typeInto("#emailTicketIntakeAddress", "")
    await save()

    expect(settingsOf(id)).not.toHaveProperty("emailIntake")
    expect(await policyInMatrix(id)).toMatchObject({ mode: "ai", escalateKeywords: ["refund"] })
  })

  it("keeps every reply-policy field on every type the form configures", async () => {
    // One list serves all types because one endpoint writes the same keys on any row.
    for (const create of [whatsappRow, telegramRow, vkRow, vonageSmsRow, emailRow]) {
      store.rows.clear()
      const id = await create()
      await setPolicy({ configId: id, ...FULL_POLICY })
      const before = await policyInMatrix(id)
      expect(before).toMatchObject({ mode: "agent", aiRolloutPercent: 40, outOfOffice: { enabled: true } })

      await openForm(id)
      await save()

      expect(await policyInMatrix(id)).toEqual(before)
    }
  })

  it("leaves a Social Monitoring row's configuration alone when the catalog opens it in this form", async () => {
    // "Other connected channels" lists every row of the workspace — this one included — with an Edit button.
    await saveSocialMonitoringSettings("org_1", {
      schedule: { enabled: false, cadenceMinutes: 90, reportWindowDays: 3 },
      searchIndex: { enabled: true, limit: 25 },
    })
    const before = await getSocialMonitoringSettings("org_1")
    expect(before.schedule).toMatchObject({ enabled: false, cadenceMinutes: 90, reportWindowDays: 3 })
    const id = [...store.rows.values()].find((row) => row.channelType === "social_monitoring")!.id

    await openForm(id)
    await save()

    expect(await getSocialMonitoringSettings("org_1")).toEqual(before)
  })

  it("does not let any other client write or erase what those endpoints own", async () => {
    const id = await whatsappRow()
    await setPolicy({ configId: id, mode: "agent", draftMode: true })
    await setNotificationTemplates(jsonRequest("/api/v1/whatsapp/notification-settings", "PUT", { whatsappSurveyTemplate: "csat_survey" }))

    await putDirectly(id, { settings: { replyMode: "ai", draftMode: false, whatsappSurveyTemplate: "spoofed" } })
    expect(await policyInMatrix(id)).toMatchObject({ mode: "agent", draftMode: true })
    expect(await notificationTemplates()).toMatchObject({ whatsappSurveyTemplate: "csat_survey" })

    await putDirectly(id, { settings: {} })
    expect(await policyInMatrix(id)).toMatchObject({ mode: "agent", draftMode: true })
    expect(await notificationTemplates()).toMatchObject({ whatsappSurveyTemplate: "csat_survey" })

    // Nor switch on a policy the matrix never set: that endpoint is admin-only, validated and audited.
    const telegram = await telegramRow()
    await putDirectly(telegram, { settings: { chatId: "-100200300", replyMode: "ai" } })
    expect(await policyInMatrix(telegram)).toMatchObject({ mode: "agent", modeDefaulted: true })
    expect(settingsOf(telegram)).toEqual({ chatId: "-100200300" })
  })

  it("leaves settings alone when a request does not send any", async () => {
    const id = await telegramRow()
    await setPolicy({ configId: id, mode: "ai" })
    const before = settingsOf(id)
    await putDirectly(id, { isActive: false })
    expect(settingsOf(id)).toEqual(before)
    expect(store.rows.get(id)?.isActive).toBe(false)
  })
})

/**
 * Ratchets on the lists themselves. The behaviour above only covers the keys the tests send; these fail when a
 * writer starts storing a key the PUT would still erase.
 */
describe("the protected lists keep up with their writers", () => {
  function keysWritten(file: string, pattern: RegExp): string[] {
    const source = readFileSync(join(process.cwd(), file), "utf8")
    return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort()
  }

  it("covers every key the reply-policy endpoint writes", () => {
    const written = keysWritten("src/app/api/v1/settings/channel-reply/route.ts", /\b(?:delete\s+)?next\.(\w+)(?:\s*=[^=]|\s*$)/gm)
    expect(written.length).toBeGreaterThan(0)
    expect(written.filter((key) => !(REPLY_POLICY_SETTING_KEYS as readonly string[]).includes(key))).toEqual([])
  })

  it("covers every key the WhatsApp endpoints write", () => {
    const whatsapp = serverOwnedSettingKeys("whatsapp")
    const templates = keysWritten("src/app/api/v1/whatsapp/notification-settings/route.ts", /\bpatch\.(\w+)\s*=[^=]/g)
    const group = keysWritten("src/app/api/v1/social/whatsapp-group-settings/route.ts", /\b(?:delete\s+)?next\.(\w+)(?:\s*=[^=]|\s*$)/gm)
    expect(templates.length).toBeGreaterThan(0)
    expect(group.length).toBeGreaterThan(0)
    expect([...templates, ...group].filter((key) => !whatsapp.includes(key))).toEqual([])
  })

  it("keeps the Facebook/Instagram list carrying the same reply policy", () => {
    expect(REPLY_POLICY_SETTING_KEYS.filter((key) => !(META_SERVER_OWNED_SETTING_KEYS as readonly string[]).includes(key))).toEqual([])
  })
})
