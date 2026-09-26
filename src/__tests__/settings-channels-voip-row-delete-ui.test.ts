// @vitest-environment jsdom

import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The channel catalog's trash on a VoIP card, and what the catalog does when the server turns a delete down.
 *
 * Found 2026-09-21 (PR #360). A card showing a connected row offered Edit and a trash. On the VoIP cards (Twilio, 3CX,
 * Asterisk, Custom SIP) the trash sent `DELETE /api/v1/channels/{id}`, which has always answered 403 for a VoIP row —
 * VoIP is managed at /settings/voip through /api/v1/voip/config — and the catalog refetched without reading the answer:
 * the dialog closed, the row stayed, and nothing said why. Production had one such row (workspace leaddrive, "Asterisk
 * VoIP"). Edit was no way out either: it opened the channel form, whose save the channels API refuses the same way.
 *
 * The VoIP row is saved by the real VoIP settings route, the Telegram bots by the channel form's own payload through the
 * real create route; the catalog is the real page on the real list route, and its trash goes through the real confirm
 * dialog to the real DELETE route. Every check reads the rendered page or the table behind it.
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
// The confirm dialog is deliberately NOT mocked: whether a refusal reaches the screen is decided inside it.

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
    open ? createElement("div", { role: "dialog" }, children) : null,
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
  updatedAt: Date
}

type OrderBy = Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>

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

/** The list route orders newest first, and which row a catalog card shows depends on that order. */
function ordered(rows: StoredRow[], orderBy?: OrderBy): StoredRow[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [{ createdAt: "asc" as const }])
    .flatMap((clause) => Object.entries(clause))
  const value = (row: StoredRow, key: string) => {
    const raw = (row as unknown as Record<string, unknown>)[key]
    return raw instanceof Date ? raw.getTime() : String(raw)
  }
  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const left = value(a, key)
      const right = value(b, key)
      if (left === right) continue
      return (left < right ? -1 : 1) * (direction === "desc" ? -1 : 1)
    }
    return 0
  })
}

function tick(): Date {
  store.clock += 1
  return new Date(Date.UTC(2026, 8, 21, 12, 0, store.clock))
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
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: OrderBy }) =>
        ordered([...store.rows.values()].filter((row) => rowMatches(row, where)), orderBy).map(snapshot),
      findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: OrderBy }) => {
        const [row] = ordered([...store.rows.values()].filter((candidate) => rowMatches(candidate, where)), orderBy)
        return row ? snapshot(row) : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.rows.get(where.id)
        if (!row) throw new Error(`no row ${where.id}`)
        applyWrite(row, { ...data, updatedAt: tick() })
        return snapshot(row)
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matched = [...store.rows.values()].filter((row) => rowMatches(row, where))
        for (const row of matched) applyWrite(row, { ...data, updatedAt: tick() })
        return { count: matched.length }
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const matched = [...store.rows.values()].filter((row) => rowMatches(row, where))
        for (const row of matched) store.rows.delete(row.id)
        return { count: matched.length }
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const at = tick()
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
          createdAt: at,
          updatedAt: at,
        }
        applyWrite(row, data)
        store.rows.set(row.id, row)
        return snapshot(row)
      },
    },
    // The VoIP save takes a per-workspace advisory lock first.
    $executeRaw: async () => 1,
    $transaction: async (work: (tx: unknown) => unknown) => work(client),
  }
  return { prisma: client, logAudit: vi.fn(async () => undefined) }
})

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
const sessions = vi.hoisted(() => ({
  admin: { orgId: "org_1", userId: "user_1", role: "admin", email: "admin@example.test", name: "Admin" },
  manager: { orgId: "org_1", userId: "user_1", role: "manager", email: "admin@example.test", name: "Admin" },
}))
// Session resolution has its own tests; here every request is the workspace admin unless a test demotes it. The
// channels gate (lib/channels-access) is the real one, so a demoted admin meets its real refusal.
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getSession: vi.fn(async () => sessions.admin),
  requireAuth: vi.fn(async () => sessions.admin),
  requireSessionAuth: vi.fn(async () => sessions.admin),
  isAuthError: () => false,
  orgHasModule: vi.fn(async () => true),
}))
// Cross-workspace claims concern Facebook/Instagram only and have their own tests (channels-claimed-elsewhere).
vi.mock("@/lib/channels/inbound-claim", () => ({
  channelIdsClaimedElsewhere: vi.fn(async () => new Set<string>()),
}))

import ChannelsPage from "@/app/(dashboard)/settings/channels/page"
import { requireSessionAuth } from "@/lib/api-auth"
import { buildChannelPayload, type ChannelConfigFormData } from "@/lib/channels/channel-config-payload"
import { GET as listChannels, POST as createChannel } from "@/app/api/v1/channels/route"
import { DELETE as deleteChannel } from "@/app/api/v1/channels/[id]/route"
import { GET as readVoipConfig, PUT as saveVoipConfig } from "@/app/api/v1/voip/config/route"

const APP = "https://app.leaddrivecrm.org"
/** An on-prem PBX: the VoIP save accepts a private endpoint only when its exact origin is allowlisted. */
const PBX_HOST = "10.20.30.40"
const PBX_ORIGIN = `http://${PBX_HOST}:8088`

// ---- Rows, created the way the product creates them. -------------------------------------------------------

/** The Asterisk connection, saved where the product saves it: Settings → VoIP. */
async function saveAsteriskInVoipSettings({ isActive }: { isActive: boolean }): Promise<string> {
  const res = await saveVoipConfig(new Request(`${APP}/api/v1/voip/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      configName: "Asterisk VoIP",
      isActive,
      settings: {
        provider: "asterisk",
        ariHost: PBX_HOST,
        ariPort: 8088,
        username: "leaddrive",
        password: "ari-password",
        context: "from-internal",
        callerExtension: "100",
      },
    }),
  }) as unknown as NextRequest)
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: { id: string } }).data.id
}

async function voipSettingsRow() {
  const res = await readVoipConfig(new Request(`${APP}/api/v1/voip/config`) as unknown as NextRequest)
  return ((await res.json()) as { data: Record<string, unknown> | null }).data
}

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

/** Another admin, in another tab, deleting a channel through the same route. */
async function deleteElsewhere(id: string): Promise<number> {
  const res = await deleteChannel(
    { headers: new Headers() } as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )
  return res.status
}

let savedAllowlist: string | undefined

beforeEach(() => {
  store.rows.clear()
  store.clock = 0
  vi.mocked(requireSessionAuth).mockResolvedValue(sessions.admin as Awaited<ReturnType<typeof requireSessionAuth>>)
  savedAllowlist = process.env.VOIP_PRIVATE_ENDPOINT_ALLOWLIST
  process.env.VOIP_PRIVATE_ENDPOINT_ALLOWLIST = PBX_ORIGIN
})

afterEach(() => {
  if (savedAllowlist === undefined) delete process.env.VOIP_PRIVATE_ENDPOINT_ALLOWLIST
  else process.env.VOIP_PRIVATE_ENDPOINT_ALLOWLIST = savedAllowlist
})

describe("channel catalog — a VoIP row and a refused delete", () => {
  let container: HTMLDivElement
  let root: Root
  /** Every DELETE the page sent, with what the route answered. */
  let deletes: Array<{ id: string; status: number }>
  /** When set, the page's DELETE gets this instead of reaching the route — what a proxy in front of the app sends. */
  let proxyAnswer: (() => Response) | null

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
    deletes = []
    proxyAnswer = null
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

  /** The catalog, fed by the real list route; its deletes go to the real DELETE route. */
  async function openCatalog() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url === "/api/v1/channels" && method === "GET") return listChannels(listRequest())
      const row = url.match(/^\/api\/v1\/channels\/([^/?]+)$/)
      if (row && method === "DELETE") {
        const id = decodeURIComponent(row[1])
        const answer = proxyAnswer
          ? proxyAnswer()
          : await deleteChannel(
            { headers: new Headers(init?.headers) } as unknown as NextRequest,
            { params: Promise.resolve({ id }) },
          )
        deletes.push({ id, status: answer.status })
        return answer
      }
      throw new Error(`unexpected request ${method} ${url}`)
    }))
    await act(async () => {
      root.render(createElement(ChannelsPage))
    })
    await settle()
  }

  async function click(element: Element | null | undefined) {
    if (!(element instanceof HTMLElement)) throw new Error("nothing to click")
    await act(async () => {
      element.click()
    })
    await settle()
  }

  const card = (id: string) => {
    const element = container.querySelector<HTMLElement>(`[data-testid="channel-card-${id}"]`)
    if (!element) throw new Error(`no card ${id}`)
    return element
  }
  /** The card or the "Other connected channels" row that shows this channel. */
  const tileShowing = (configName: string) => {
    const tile = [...container.querySelectorAll<HTMLElement>('article[data-testid^="channel-"]')]
      .find((candidate) => candidate.textContent?.includes(configName))
    if (!tile) throw new Error(`nothing shows ${configName}`)
    return tile
  }
  const trashIn = (tile: HTMLElement) => tile.querySelector<HTMLButtonElement>('button[title="Delete"]')
  const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')
  /** The confirm dialog's own buttons are labelled by next-intl keys (the mock returns the key). */
  const dialogButton = (label: string) =>
    [...(dialog()?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.trim() === label)
  const refusal = () => dialog()?.querySelector<HTMLElement>('[role="alert"]')?.textContent ?? null

  it("sends a VoIP row to VoIP settings instead of offering the delete the channels API refuses", async () => {
    const voip = await saveAsteriskInVoipSettings({ isActive: true })
    await telegramBot("Support bot", "111:aaa")

    await openCatalog()

    const asterisk = card("asterisk")
    // The card still shows the connection the VoIP screen saved.
    expect(asterisk.textContent).toContain("Asterisk VoIP")
    expect(asterisk.querySelector('[data-testid="channel-card-connected-badge"]')?.textContent).toBe("Connected")
    // No trash, and no Edit into the channel form: the channels API refuses both for a VoIP row.
    expect(trashIn(asterisk)).toBeNull()
    expect(asterisk.textContent).not.toContain("Edit setup")
    // Instead, one way to where VoIP is managed.
    const link = asterisk.querySelector<HTMLAnchorElement>('a[href="/settings/voip"]')
    expect(link?.textContent).toBe("Open VoIP settings")
    expect(asterisk.textContent).toContain("Managed in VoIP settings.")
    // The Telegram card beside it keeps its trash: only a row with its own screen lost it.
    expect(trashIn(card("telegram"))).not.toBeNull()

    expect(deletes).toEqual([])
    expect(await voipSettingsRow()).toMatchObject({ id: voip, configName: "Asterisk VoIP", isActive: true })
  })

  it("tells a switched-off VoIP row to be switched back on in VoIP settings, not in an Edit the card no longer has", async () => {
    await saveAsteriskInVoipSettings({ isActive: false })

    await openCatalog()

    const asterisk = card("asterisk")
    expect(asterisk.querySelector('[data-testid="channel-card-broken-badge"]')?.textContent).toContain("Switched off")
    expect(trashIn(asterisk)).toBeNull()
    expect(asterisk.querySelector('a[href="/settings/voip"]')?.textContent).toBe("Open VoIP settings")
    // The generic switched-off hint ends "Turn it back on in Edit setup."
    expect(asterisk.textContent).toContain("Managed in VoIP settings.")
    expect(asterisk.textContent).not.toContain("Edit setup")
  })

  it("keeps a refused delete on screen with the server's reason, and starts the next delete without it", async () => {
    const supportBot = await telegramBot("Support bot", "111:aaa")
    const nightBot = await telegramBot("Night shift bot", "222:bbb")
    await openCatalog()
    expect(tileShowing("Support bot")).toBeTruthy()

    // Another admin removes the support bot while this page still shows it; this admin then deletes it too.
    expect(await deleteElsewhere(supportBot)).toBe(200)
    await click(trashIn(tileShowing("Support bot")))
    expect(dialog()?.textContent).toContain("Delete Channel")
    await click(dialogButton("delete"))

    // The route turned it down. The dialog stays open and says why, instead of closing as if it had worked.
    expect(deletes).toEqual([{ id: supportBot, status: 404 }])
    expect(dialog()).not.toBeNull()
    expect(refusal()).toBe("Not found")
    // The catalog re-read the list, so the bot the other admin removed is gone from it.
    expect(container.textContent).not.toContain("Support bot")

    // The next delete opens without the previous reason, and this time the row goes.
    await click(dialogButton("cancel"))
    expect(dialog()).toBeNull()
    await click(trashIn(tileShowing("Night shift bot")))
    expect(dialog()).not.toBeNull()
    expect(refusal()).toBeNull()
    await click(dialogButton("delete"))

    expect(deletes).toEqual([{ id: supportBot, status: 404 }, { id: nightBot, status: 200 }])
    expect(store.rows.has(nightBot)).toBe(false)
    expect(dialog()).toBeNull()
    expect(container.textContent).not.toContain("Night shift bot")
  })

  it("shows the reason a refusal gives in `message` rather than its bare `error`", async () => {
    const bot = await telegramBot("Support bot", "111:aaa")
    await openCatalog()
    // The admin is made a manager in another tab while this page is still open.
    vi.mocked(requireSessionAuth).mockResolvedValue(sessions.manager as Awaited<ReturnType<typeof requireSessionAuth>>)

    await click(trashIn(tileShowing("Support bot")))
    await click(dialogButton("delete"))

    // The gate answers { error: "Forbidden", message: "Only admins can manage channel configuration" }.
    expect(deletes).toEqual([{ id: bot, status: 403 }])
    expect(refusal()).toBe("Only admins can manage channel configuration")
    expect(store.rows.has(bot)).toBe(true)
  })

  it("says the delete failed when the answer carries no reason, such as a proxy's error page", async () => {
    const bot = await telegramBot("Support bot", "111:aaa")
    await openCatalog()
    proxyAnswer = () => new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    })

    await click(trashIn(tileShowing("Support bot")))
    await click(dialogButton("delete"))

    expect(deletes).toEqual([{ id: bot, status: 502 }])
    // An Error with an empty message would leave the dialog's alert empty; the common "failed to delete" line stands in.
    expect(refusal()).toBe("errorDeleteFailed")
    expect(store.rows.has(bot)).toBe(true)
    expect(tileShowing("Support bot")).toBeTruthy()
  })
})
