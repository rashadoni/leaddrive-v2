// @vitest-environment jsdom

import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

/**
 * The rows Social Monitoring and Integrations keep in the channel table, carried through the channel catalog, the
 * channel form and the channels API, and read back the way their owners read them.
 *
 * Found 2026-09-21 (PR #352). The catalog listed every row `GET /api/v1/channels` returns under "Other connected
 * channels", with the channel form's Edit and a Delete; in production that was 8 Social Monitoring rows in 7
 * workspaces. Social Monitoring finds its provider settings and its scenarios by type AND name, so saving the row
 * renamed or retyped, or deleting it, lost the schedule, the search-index settings and the Apify token, or every
 * scenario — and the next save from Social Monitoring quietly started over in a new row.
 *
 * Rows come from their real writers (saveSocialMonitoringSettings, createMonitoringScenario, the Slack integration,
 * the channel form's own create payload); the catalog is the real page fed by the real list route; the form's save goes
 * to the real PUT; and every check reads back through the readers the owners use.
 */

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org_1", organizationSlug: "acme" } } }),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", props, children),
}))

vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }))

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
  createdBy: string | null
  createdAt: Date
}

const store = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  clock: 0,
  /** What the real PUT answered each save the form made. */
  putStatuses: [] as number[],
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
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const matched = [...store.rows.values()].filter((row) => rowMatches(row, where))
        for (const row of matched) store.rows.delete(row.id)
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
// Cross-workspace claims concern Facebook/Instagram only and have their own tests (channels-claimed-elsewhere).
vi.mock("@/lib/channels/inbound-claim", () => ({
  channelIdsClaimedElsewhere: vi.fn(async () => new Set<string>()),
}))

import ChannelsPage from "@/app/(dashboard)/settings/channels/page"
import { ChannelConfigForm } from "@/components/channel-config-form"
import { buildChannelPayload, type ChannelConfigFormData } from "@/lib/channels/channel-config-payload"
import { GET as listChannels, POST as createChannel } from "@/app/api/v1/channels/route"
import { DELETE as deleteChannel, PUT as updateChannel } from "@/app/api/v1/channels/[id]/route"
import { GET as readSlackHooks, POST as connectSlackHook } from "@/app/api/v1/integrations/slack/route"
import { getSocialMonitoringSettings, saveSocialMonitoringSettings } from "@/lib/social/monitoring-settings"
import { createMonitoringScenario, getMonitoringScenariosUncached } from "@/lib/social/monitoring-scenarios"

const APP = "https://app.leaddrivecrm.org"
const SLACK_HOOK = "https://hooks.slack.com/services/T0000/B0000/XXXXXXXX"
const SOCIAL_MONITORING_REFUSAL = "Social Monitoring configuration must be managed in Social Monitoring"

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

/** A Telegram bot, POSTed exactly as the channel form sets one up. */
async function telegramBot(configName: string, botToken: string): Promise<string> {
  const res = await createChannel({
    json: async () => buildChannelPayload(formData({ configName, botToken })),
    headers: new Headers(),
  } as unknown as NextRequest)
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: { id: string } }).data.id
}

/** A scenario as the Social Monitoring screen creates it; paused, so it starts no collection. */
function scenario(name: string, keyword: string) {
  return createMonitoringScenario("org_1", "user_1", { name, status: "paused", platforms: ["web"], keywords: [keyword] })
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return new Request(`${APP}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

/** Slack notifications, connected where the product connects them: Settings → Integrations. */
async function connectSlack(): Promise<string> {
  const res = await connectSlackHook(jsonRequest("/api/v1/integrations/slack", "POST", {
    configName: "Sales alerts",
    webhookUrl: SLACK_HOOK,
  }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: { id: string } }).data.id
}

async function slackHooksInIntegrations() {
  const res = await readSlackHooks(new Request(`${APP}/api/v1/integrations/slack`) as unknown as NextRequest)
  return ((await res.json()) as { data: Array<Record<string, unknown>> }).data
}

/** Another admin client of the channels API — not the form. */
async function putThroughApi(id: string, body: Record<string, unknown>): Promise<number> {
  const res = await updateChannel(
    { json: async () => body, headers: new Headers() } as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )
  return res.status
}

/** What the catalog's trash button sends. */
async function deleteThroughApi(id: string): Promise<number> {
  const res = await deleteChannel(
    { headers: new Headers() } as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )
  return res.status
}

function socialMonitoringRows(configName: string): StoredRow[] {
  return [...store.rows.values()].filter((row) => row.channelType === "social_monitoring" && row.configName === configName)
}

let savedApifyToken: string | undefined

beforeEach(() => {
  store.rows.clear()
  store.clock = 0
  store.putStatuses.length = 0
  // Only the workspace's own Apify token may count: a deployment-wide one would hide a lost row.
  savedApifyToken = process.env.APIFY_API_TOKEN
  delete process.env.APIFY_API_TOKEN
})

afterEach(() => {
  if (savedApifyToken !== undefined) process.env.APIFY_API_TOKEN = savedApifyToken
})

describe("rows that belong to Social Monitoring and Integrations stay theirs", () => {
  let container: HTMLDivElement
  let root: Root
  let onSaved: Mock<() => void>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    // jsdom ships no matchMedia; the catalog reads prefers-reduced-motion for its tutorial autoplay.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
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

  function listRequest(): NextRequest {
    return { nextUrl: new URL(`${APP}/api/v1/channels`), headers: new Headers() } as unknown as NextRequest
  }

  /** The catalog, fed by the real list route. */
  async function openCatalog() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/channels" && (init?.method ?? "GET") === "GET") return listChannels(listRequest())
      throw new Error(`unexpected request ${init?.method ?? "GET"} ${String(input)}`)
    }))
    await act(async () => {
      root.render(createElement(ChannelsPage))
    })
    await settle()
  }

  /**
   * The channel form on a row, handed the row as `GET /api/v1/channels` ships it — as the catalog's Edit used to, and as a
   * connect page still does for a hand-typed `?channelId=`. Its saves go to the real PUT.
   */
  async function openForm(id: string) {
    const res = await listChannels(listRequest())
    const channels = ((await res.json()) as { data: Array<Record<string, unknown>> }).data
    const initialData = channels.find((channel) => channel.id === id)
    if (!initialData) throw new Error(`no channel ${id} in the list`)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const match = String(input).match(/^\/api\/v1\/channels\/([^/?]+)$/)
      if (!match || init?.method !== "PUT") throw new Error(`unexpected request ${init?.method ?? "GET"} ${String(input)}`)
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      const answer = await updateChannel(
        { json: async () => body, headers: new Headers(init.headers) } as unknown as NextRequest,
        { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) },
      )
      store.putStatuses.push(answer.status)
      return answer
    }))
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

  async function click(element: HTMLElement) {
    await act(async () => {
      element.click()
    })
  }

  /** The form offers its type picker for a row of a type it does not know. */
  function typeButton(label: string): HTMLButtonElement {
    const button = [...field("#channelTypeSelector").querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === label)
    if (!button) throw new Error(`no type button ${label}`)
    return button
  }

  function activeSwitch(): HTMLInputElement {
    const label = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes("channelActive"))
    const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!input) throw new Error("missing the active switch")
    return input
  }

  async function submit() {
    const form = container.querySelector("form")
    if (!form) throw new Error("missing form")
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await settle()
  }

  const catalogRow = (id: string) => container.querySelector(`[data-testid="channel-row-${id}"]`)
  const activeCount = () => container.querySelector('[data-testid="channels-active-count"]')?.textContent || ""

  it("lists neither Social Monitoring's rows nor a Slack hook as channels, and does not count them", async () => {
    await scenario("Acme mentions", "acme")
    await saveSocialMonitoringSettings("org_1", { schedule: { cadenceMinutes: 90 } })
    const slack = await connectSlack()
    const internal = [...socialMonitoringRows("Monitoring scenarios"), ...socialMonitoringRows("Monitoring providers")]
    expect(internal).toHaveLength(2)
    await telegramBot("Support bot", "111:aaa")
    const nightBot = await telegramBot("Night shift bot", "222:bbb")

    await openCatalog()

    // The Telegram card shows one bot; the second bot is still listed where a row no card shows goes.
    expect(container.querySelector('[data-testid="channel-card-telegram"]')?.textContent).toContain("Support bot")
    expect(catalogRow(nightBot)?.textContent).toContain("Night shift bot")
    for (const id of [...internal.map((row) => row.id), slack]) expect(catalogRow(id)).toBeNull()
    const text = container.textContent || ""
    for (const name of ["Monitoring scenarios", "Monitoring providers", "Sales alerts"]) expect(text).not.toContain(name)
    // "N active" counts the two bots, not the settings rows and the hook.
    expect(activeCount()).toContain("2 active")
  })

  it("refuses to rename, retype, switch off or delete Social Monitoring's settings row, which stays where it is read", async () => {
    await saveSocialMonitoringSettings("org_1", {
      schedule: { enabled: false, cadenceMinutes: 90, reportWindowDays: 3, timeZone: "Asia/Baku" },
      searchIndex: { enabled: true, provider: "apify", limit: 25, token: "apify-workspace-token" },
    })
    const before = await getSocialMonitoringSettings("org_1")
    expect(before.schedule).toEqual({ enabled: false, cadenceMinutes: 90, reportWindowDays: 3, timeZone: "Asia/Baku" })
    expect(before.searchIndex).toMatchObject({ enabled: true, provider: "apify", limit: 25, hasToken: true })
    const [row] = socialMonitoringRows("Monitoring providers")
    const stored = { ...row }

    await openForm(row.id)
    await typeInto("#configName", "Old monitoring settings")
    await submit()
    await click(typeButton("Telegram"))
    await submit()
    await click(activeSwitch())
    await submit()

    // Each save reached the route and was turned down, and the form said so instead of closing.
    expect(store.putStatuses).toEqual([403, 403, 403])
    expect(container.textContent).toContain(SOCIAL_MONITORING_REFUSAL)
    expect(onSaved).not.toHaveBeenCalled()
    expect(await deleteThroughApi(row.id)).toBe(403)

    expect(store.rows.get(row.id)).toEqual(stored)
    expect(await getSocialMonitoringSettings("org_1")).toEqual(before)

    // The next save from Social Monitoring lands on the same row, beside the token it already holds.
    await saveSocialMonitoringSettings("org_1", { schedule: { cadenceMinutes: 120 } })
    expect(socialMonitoringRows("Monitoring providers").map((candidate) => candidate.id)).toEqual([row.id])
    const after = await getSocialMonitoringSettings("org_1")
    expect(after.schedule).toEqual({ ...before.schedule, cadenceMinutes: 120 })
    expect(after.searchIndex).toEqual(before.searchIndex)
  })

  it("keeps every monitoring scenario where Social Monitoring reads it", async () => {
    const first = await scenario("Acme mentions", "acme")
    const before = await getMonitoringScenariosUncached("org_1")
    expect(before.map((item) => item.name)).toEqual(["Acme mentions"])
    const [row] = socialMonitoringRows("Monitoring scenarios")

    await openForm(row.id)
    await typeInto("#configName", "Old scenarios")
    await submit()
    expect(store.putStatuses).toEqual([403])
    expect(container.textContent).toContain(SOCIAL_MONITORING_REFUSAL)
    expect(await deleteThroughApi(row.id)).toBe(403)

    expect(await getMonitoringScenariosUncached("org_1")).toEqual(before)
    // The next scenario joins the same list instead of starting a new one beside it.
    const second = await scenario("Competitor mentions", "rival")
    expect(socialMonitoringRows("Monitoring scenarios").map((candidate) => candidate.id)).toEqual([row.id])
    expect((await getMonitoringScenariosUncached("org_1")).map((item) => item.id)).toEqual([second.id, first.id])
  })

  it("does not let the channels API put a row where Social Monitoring looks", async () => {
    await saveSocialMonitoringSettings("org_1", { schedule: { cadenceMinutes: 90 } })
    const before = await getSocialMonitoringSettings("org_1")
    const bot = await telegramBot("Support bot", "111:aaa")

    // Social Monitoring reads whichever of its rows the database returns first, so a second one could take over.
    const planted = await createChannel({
      json: async () => ({ channelType: "social_monitoring", configName: "Monitoring providers", settings: { schedule: { enabled: false } } }),
      headers: new Headers(),
    } as unknown as NextRequest)
    expect(planted.status).toBe(403)
    expect(await putThroughApi(bot, { channelType: "social_monitoring", configName: "Monitoring providers" })).toBe(403)

    expect(store.rows.get(bot)).toMatchObject({ channelType: "telegram", configName: "Support bot" })
    expect(socialMonitoringRows("Monitoring providers")).toHaveLength(1)
    expect(await getSocialMonitoringSettings("org_1")).toEqual(before)
  })

  it("leaves a Slack hook to Integrations", async () => {
    const id = await connectSlack()

    expect(await putThroughApi(id, { configName: "Sales alerts", isActive: false })).toBe(403)
    expect(await deleteThroughApi(id)).toBe(403)

    // Integrations still reads the hook switched on and pointing where it did.
    expect(await slackHooksInIntegrations()).toEqual([
      expect.objectContaining({ id, configName: "Sales alerts", webhookUrl: SLACK_HOOK, isActive: true }),
    ])
  })
})
