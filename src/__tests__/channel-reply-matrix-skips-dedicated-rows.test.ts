// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The reply-policy matrix ("who replies on each channel", Inbox → AI agent) lists conversation channels only, and its
 * endpoint writes a reply policy into nothing else.
 *
 * Found 2026-09-21 while working on PR #360. `GET /api/v1/settings/channel-reply` listed every ChannelConfig row of the
 * workspace, and the matrix drew each one with a Human / Draft / Auto control. In production that included Social
 * Monitoring's settings rows — "Monitoring providers" and "Monitoring scenarios", 8 rows in 7 workspaces — and it
 * would include Slack/Teams notification hooks and VoIP. `PATCH` wrote replyMode/draftMode/… into such a row's
 * `settings`, where nothing reads them; Social Monitoring's writers replace `settings` whole on their next save, so the
 * matrix showed a policy that silently disappeared. On VoIP it would have shown "Human" while the voice agent, switched
 * on in the VoIP screen, kept answering calls.
 *
 * Rows come from their real writers (saveSocialMonitoringSettings, createMonitoringScenario, the Slack and Teams
 * integrations, the VoIP screen's save, the channel form's own create payload); the matrix is the real component fed by
 * the real GET and PATCH; and every refused row is read back through the reader its owner uses.
 */

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org_1" } }, status: "authenticated" }),
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
  createdBy: string | null
  createdAt: Date
}

const store = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  clock: 0,
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
    if (expected && typeof expected === "object" && "notIn" in expected) {
      return !(expected as { notIn: unknown[] }).notIn.includes(actual)
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

vi.mock("@/lib/prisma", () => {
  const client = {
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
          createdBy: null,
          createdAt: new Date(Date.UTC(2026, 8, 21, 12, 0, store.clock)),
        }
        applyWrite(row, data)
        store.rows.set(row.id, row)
        return snapshot(row)
      },
    },
    // A paused scenario runs no collectors, so creating one only looks for sources to switch off: there are none.
    monitoringSource: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    $executeRaw: async () => 1,
    $transaction: async (work: (tx: unknown) => unknown) => work(client),
  }
  return { prisma: client, logAudit: vi.fn(async () => undefined) }
})

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

import { ChannelReplyMatrix } from "@/components/settings/channel-reply-matrix"
import { GET as readReplyPolicies, PATCH as setReplyPolicy } from "@/app/api/v1/settings/channel-reply/route"
import { POST as createChannel } from "@/app/api/v1/channels/route"
import { buildChannelPayload, type ChannelConfigFormData } from "@/lib/channels/channel-config-payload"
import { GET as readSlackHooks, POST as connectSlackHook } from "@/app/api/v1/integrations/slack/route"
import { GET as readTeamsHooks, POST as connectTeamsHook } from "@/app/api/v1/integrations/teams/route"
import { GET as readVoipScreen, PUT as saveVoipScreen } from "@/app/api/v1/voip/config/route"
import { getSocialMonitoringSettings, saveSocialMonitoringSettings } from "@/lib/social/monitoring-settings"
import { createMonitoringScenario, getMonitoringScenariosUncached } from "@/lib/social/monitoring-scenarios"

const APP = "https://app.leaddrivecrm.org"
const REPLY_POLICY_PATH = "/api/v1/settings/channel-reply"

/** Every field the matrix's endpoint can set, off its defaults. */
const FULL_POLICY = {
  mode: "ai",
  afterHoursAi: true,
  draftMode: true,
  aiThreshold: 0.85,
  aiRolloutPercent: 40,
  outOfOffice: { enabled: true, message: "Back at 9:00" },
  escalateKeywords: ["оператор", "manager"],
}

function request(path: string, init?: RequestInit): NextRequest {
  return new Request(`${APP}${path}`, init) as unknown as NextRequest
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

// ---- Rows, created the way the product creates them. -------------------------------------------------------

function formData(overrides: Partial<ChannelConfigFormData>): ChannelConfigFormData {
  return {
    configName: "Channel",
    channelType: "telegram",
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

/** A channel POSTed exactly as the channel form sets it up. */
async function throughChannelForm(overrides: Partial<ChannelConfigFormData>): Promise<string> {
  const res = await createChannel({
    json: async () => buildChannelPayload(formData(overrides)),
    headers: new Headers(),
  } as unknown as NextRequest)
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: { id: string } }).data.id
}

/** Two conversation channels: a Telegram bot, whose policy the webhook enforces, and an SMS line, whose it does not yet. */
async function conversationChannels() {
  const bot = await throughChannelForm({ configName: "Support bot", channelType: "telegram", botToken: "111:aaa" })
  const sms = await throughChannelForm({
    configName: "Customer SMS",
    channelType: "sms",
    smsProvider: "vonage",
    vonageApiKey: "VONAGE_KEY",
    smsSecret: "VONAGE_SECRET",
    vonageFromName: "Acme",
  })
  return { bot, sms }
}

function rowNamed(channelType: string, configName: string): StoredRow {
  const rows = [...store.rows.values()].filter((row) => row.channelType === channelType && row.configName === configName)
  expect(rows).toHaveLength(1)
  return rows[0]
}

/** Social Monitoring's two rows, saved from its own screens: the provider settings and a (paused) scenario. */
async function socialMonitoring() {
  await saveSocialMonitoringSettings("org_1", {
    schedule: { enabled: false, cadenceMinutes: 90, reportWindowDays: 3, timeZone: "Asia/Baku" },
    searchIndex: { enabled: true, provider: "apify", limit: 25, token: "apify-workspace-token" },
  })
  await createMonitoringScenario("org_1", "user_1", {
    name: "Acme mentions",
    status: "paused",
    platforms: ["web"],
    keywords: ["acme"],
  })
  return {
    providers: rowNamed("social_monitoring", "Monitoring providers").id,
    scenarios: rowNamed("social_monitoring", "Monitoring scenarios").id,
  }
}

/** Slack and Teams notifications, connected where the product connects them: Settings → Integrations. */
async function notificationHooks() {
  const slackRes = await connectSlackHook(jsonRequest("/api/v1/integrations/slack", "POST", {
    configName: "Sales alerts",
    webhookUrl: "https://hooks.slack.com/services/T0000/B0000/XXXXXXXX",
  }))
  const teamsRes = await connectTeamsHook(jsonRequest("/api/v1/integrations/teams", "POST", {
    configName: "Contract alerts",
    webhookUrl: "https://acme.webhook.office.com/webhookb2/0000/IncomingWebhook/1111/2222",
  }))
  expect([slackRes.status, teamsRes.status]).toEqual([201, 201])
  return {
    slack: ((await slackRes.json()) as { data: { id: string } }).data.id,
    teams: ((await teamsRes.json()) as { data: { id: string } }).data.id,
  }
}

/** The VoIP screen's save: a Twilio line whose voice agent answers inbound calls. */
async function voipLine(): Promise<string> {
  const res = await saveVoipScreen(jsonRequest("/api/v1/voip/config", "PUT", {
    configName: "Office line",
    phoneNumber: "+994125550100",
    isActive: true,
    settings: {
      provider: "twilio",
      accountSid: "AC0000",
      authToken: "twilio-auth-token",
      twilioNumber: "+994125550100",
      voiceAgentEnabled: true,
      voiceAgentMode: "inbound",
      voiceAgentPrompt: "Greet the caller and take a message.",
    },
  }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: { id: string } }).data.id
}

// ---- The readers. -------------------------------------------------------------------------------------------

/** What the matrix is given: the real GET. */
async function matrixChannels(): Promise<Array<{ id: string; configName: string; reply: Record<string, unknown> }>> {
  const res = await readReplyPolicies(request(REPLY_POLICY_PATH))
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: { channels: Array<{ id: string; configName: string; reply: Record<string, unknown> }> } })
    .data.channels
}

/** A reply policy sent straight to the endpoint — another admin client, not the matrix. */
async function setPolicy(body: Record<string, unknown>) {
  const res = await setReplyPolicy(jsonRequest(REPLY_POLICY_PATH, "PATCH", body))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function hooksInIntegrations() {
  const slack = await readSlackHooks(request("/api/v1/integrations/slack"))
  const teams = await readTeamsHooks(request("/api/v1/integrations/teams"))
  return {
    slack: ((await slack.json()) as { data: unknown[] }).data,
    teams: ((await teams.json()) as { data: unknown[] }).data,
  }
}

async function voipScreen(): Promise<Record<string, unknown>> {
  const res = await readVoipScreen(request("/api/v1/voip/config"))
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: Record<string, unknown> }).data
}

function storedRows(ids: string[]): Array<StoredRow | undefined> {
  return ids.map((id) => {
    const row = store.rows.get(id)
    return row ? snapshot(row) : undefined
  })
}

beforeEach(() => {
  store.rows.clear()
  store.clock = 0
})

describe("the reply-policy matrix lists conversation channels only", () => {
  let container: HTMLDivElement
  let root: Root

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

  /** Every await in the routes is a resolved in-memory promise, so a few macrotask turns drain them all. */
  async function settle() {
    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }

  /** The matrix, fed by the real GET and saving through the real PATCH. */
  async function openMatrix() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      if (String(input) === REPLY_POLICY_PATH && method === "GET") return readReplyPolicies(request(REPLY_POLICY_PATH))
      if (String(input) === REPLY_POLICY_PATH && method === "PATCH") {
        return setReplyPolicy(jsonRequest(REPLY_POLICY_PATH, "PATCH", JSON.parse(String(init?.body))))
      }
      throw new Error(`unexpected request ${method} ${String(input)}`)
    }))
    await act(async () => {
      root.render(createElement(ChannelReplyMatrix))
    })
    await settle()
  }

  /** One Human / Draft / Auto control per listed channel. */
  const controls = () => [...container.querySelectorAll("button")].filter((button) => button.textContent === "aiModeHuman")

  /** The matrix line that names a channel, holding its Human / Draft / Auto buttons. */
  function matrixLine(configName: string): HTMLElement {
    const name = [...container.querySelectorAll("p")].find((candidate) => candidate.textContent === configName)
    let line = name?.parentElement ?? null
    while (line && !line.querySelector("button")) line = line.parentElement
    if (!line) throw new Error(`no matrix line for ${configName}`)
    return line
  }

  it("shows the workspace's channels, and none of the rows Social Monitoring, Integrations and VoIP keep", async () => {
    const { bot, sms } = await conversationChannels()
    await socialMonitoring()
    await notificationHooks()
    await voipLine()
    // Seven rows in the table, two of them conversation channels.
    expect(store.rows.size).toBe(7)

    expect((await matrixChannels()).map((channel) => channel.id).sort()).toEqual([bot, sms].sort())

    await openMatrix()
    expect(controls()).toHaveLength(2)
    const text = container.textContent || ""
    for (const name of ["Support bot", "Customer SMS"]) expect(text).toContain(name)
    for (const name of ["Monitoring providers", "Monitoring scenarios", "Sales alerts", "Contract alerts", "Office line"]) {
      expect(text).not.toContain(name)
    }
  })

  it("shows no channel at all to a workspace that has only Social Monitoring", async () => {
    await socialMonitoring()

    expect(await matrixChannels()).toEqual([])
    await openMatrix()
    expect(controls()).toHaveLength(0)
    expect(container.textContent).toContain("noChannels")
  })

  it("still sets a conversation channel's policy from the matrix", async () => {
    const { bot } = await conversationChannels()
    await socialMonitoring()

    await openMatrix()
    const auto = [...matrixLine("Support bot").querySelectorAll("button")].find((button) => button.textContent === "aiModeAuto")
    if (!auto) throw new Error("no Auto button on the bot's line")
    await act(async () => {
      auto.click()
    })
    await settle()

    expect(store.rows.get(bot)?.settings).toMatchObject({ replyMode: "ai", draftMode: false })
    expect((await matrixChannels()).find((channel) => channel.id === bot)?.reply).toMatchObject({ mode: "ai", draftMode: false })
  })
})

describe("the reply-policy endpoint writes into no row that belongs to another screen", () => {
  it("refuses Social Monitoring's rows, which read back as Social Monitoring saved them", async () => {
    const monitoring = await socialMonitoring()
    const settings = await getSocialMonitoringSettings("org_1")
    const scenarios = await getMonitoringScenariosUncached("org_1")
    expect(settings.searchIndex).toMatchObject({ enabled: true, provider: "apify", hasToken: true })
    expect(scenarios.map((scenario) => scenario.name)).toEqual(["Acme mentions"])
    const before = storedRows([monitoring.providers, monitoring.scenarios])

    for (const configId of [monitoring.providers, monitoring.scenarios]) {
      expect(await setPolicy({ configId, ...FULL_POLICY })).toEqual({
        status: 403,
        body: { error: "Social Monitoring configuration must be managed in Social Monitoring" },
      })
    }

    expect(storedRows([monitoring.providers, monitoring.scenarios])).toEqual(before)
    expect(await getSocialMonitoringSettings("org_1")).toEqual(settings)
    expect(await getMonitoringScenariosUncached("org_1")).toEqual(scenarios)
  })

  it("refuses the Slack and Teams hooks, which Integrations reads unchanged", async () => {
    const hooks = await notificationHooks()
    const inIntegrations = await hooksInIntegrations()
    expect(inIntegrations.slack).toEqual([expect.objectContaining({ id: hooks.slack, configName: "Sales alerts", isActive: true })])
    expect(inIntegrations.teams).toEqual([expect.objectContaining({ id: hooks.teams, configName: "Contract alerts", isActive: true })])
    const before = storedRows([hooks.slack, hooks.teams])

    expect(await setPolicy({ configId: hooks.slack, ...FULL_POLICY })).toEqual({
      status: 403,
      body: { error: "Slack configuration must be managed in Integrations" },
    })
    expect(await setPolicy({ configId: hooks.teams, escalateKeywords: ["refund"] })).toEqual({
      status: 403,
      body: { error: "Microsoft Teams configuration must be managed in Integrations" },
    })

    expect(storedRows([hooks.slack, hooks.teams])).toEqual(before)
    expect(await hooksInIntegrations()).toEqual(inIntegrations)
  })

  it("refuses VoIP, whose voice agent keeps the switches the VoIP screen saved", async () => {
    const voip = await voipLine()
    const screen = await voipScreen()
    expect(screen.settings).toMatchObject({ voiceAgentEnabled: true, voiceAgentMode: "inbound" })
    const before = storedRows([voip])

    // "Human" in the matrix while the voice agent keeps answering — the endpoint turns it down instead.
    expect(await setPolicy({ configId: voip, mode: "agent", draftMode: true })).toEqual({
      status: 403,
      body: { error: "VoIP configuration must be managed through the dedicated VoIP endpoint" },
    })

    expect(storedRows([voip])).toEqual(before)
    expect(await voipScreen()).toEqual(screen)
  })
})
