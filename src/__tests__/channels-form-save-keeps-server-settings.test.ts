// @vitest-environment jsdom

import crypto from "crypto"
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

/**
 * Saving the channel form on a Facebook/Instagram row, carried through the real PUT route and read back the way
 * every channel screen reads it.
 *
 * Found 2026-09-21 while working on #339. The form rebuilds `settings` from its own fields on every save, and
 * `PUT /api/v1/channels/[id]` stored that object as it came, so each key the server had written vanished on Save.
 * `live-connection` reads a missing `inboxSubscribed` as live — on purpose, for legacy rows — so a Page Meta had
 * refused, and a staged App Review row, turned into "Connected … inbound messages reach Inbox" after one click
 * while Meta delivered nothing. The same Save reset the AI reply policy the webhooks enforce.
 *
 * Nothing here is a hand-written settings object: the rows are what the real connect code, the real Instagram
 * Login callback and the real reply-policy endpoint store; the save is the real form's submit, handed to the real
 * PUT handler; and the verdict is `channelConnectionState(publicChannelConfig(row))`, the predicate the catalog,
 * the form and the connect page share.
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
  pageId: string | null
  apiKey: string | null
  appId: string | null
  appSecret: string | null
  verifyToken: string | null
  isActive: boolean
  settings: unknown
  createdAt: Date
}

const store = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  clock: 0,
  subscribe: vi.fn(),
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
          pageId: null,
          apiKey: null,
          appId: null,
          appSecret: null,
          verifyToken: null,
          isActive: true,
          settings: null,
          createdAt: new Date(Date.UTC(2026, 8, 21, 12, 0, store.clock)),
        }
        applyWrite(row, data)
        store.rows.set(row.id, row)
        return snapshot(row)
      },
    },
  },
  logAudit: vi.fn(async () => undefined),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
// Session resolution has its own tests; here every request is the workspace admin.
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getSession: vi.fn(async () => null),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(async () => ({
    orgId: "org_1", userId: "user_1", role: "admin", email: "admin@example.test", name: "Admin",
  })),
  isAuthError: () => false,
}))
vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: vi.fn(async () => ({ orgId: "org_1", role: "admin", userId: "user_1" })),
}))
vi.mock("@/lib/social/meta-subscribe", () => ({
  subscribePageToMessages: (...args: unknown[]) => store.subscribe(...args),
}))
// Cross-workspace claims have their own tests (channels-claimed-elsewhere); none exist in this workspace.
vi.mock("@/lib/channels/inbound-claim", () => ({
  channelIdsClaimedElsewhere: vi.fn(async () => new Set<string>()),
}))
// LeadDrive's shared Instagram-Login app (env) — the unpinned path a Model A tenant takes.
vi.mock("@/lib/social/tenant-meta-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/social/tenant-meta-app")>()),
  getTenantInstagramLoginApp: vi.fn(async () => null),
}))

import { ChannelConfigForm } from "@/components/channel-config-form"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"
import { GET as instagramCallback } from "@/app/api/v1/social/oauth/instagram/callback/route"
import { GET as readReplyPolicies, PATCH as setReplyPolicy } from "@/app/api/v1/settings/channel-reply/route"
import { PUT as updateChannel } from "@/app/api/v1/channels/[id]/route"
import { publicChannelConfig } from "@/lib/channels/public-channel-config"
import { channelConnectionState } from "@/lib/channels/live-connection"
import { metaConnectionReason } from "@/lib/channels/connection-reason"

// ---- The rows, as the real writers produce them. -----------------------------------------------------------

/** A Facebook connect whose `subscribed_apps` call Meta refused (typically a missing pages_messaging). */
async function refusedPage() {
  store.subscribe.mockResolvedValueOnce({ success: false, error: "(#200) pages_messaging missing" })
  const { channelId } = await ensureInboxChannelForPage("org_1", "facebook", "PAGE_1", "Acme Page", "page-token")
  return channelId!
}

async function livePage() {
  const { channelId } = await ensureInboxChannelForPage("org_1", "facebook", "PAGE_2", "Acme Shop", "page-token-2")
  return channelId!
}

/** A staged App Review connect: stored, and its subscription deliberately never requested. */
async function stagedPage() {
  const { channelId } = await ensureInboxChannelForPage(
    "org_1", "facebook", "PAGE_3", "Acme Review", "staged-token", { staged: true },
  )
  return channelId!
}

/** An Instagram Login round trip for @acme.az, through the real callback. */
async function instagramLoginAccount() {
  process.env.INSTAGRAM_APP_ID = "782807994549098"
  process.env.INSTAGRAM_APP_SECRET = "ig-secret"
  process.env.INSTAGRAM_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback"
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("https://api.instagram.com/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "IG_SHORT", user_id: "IG_1" }), { status: 200 })
    }
    if (url.includes("/access_token?grant_type=ig_exchange_token")) {
      return new Response(JSON.stringify({ access_token: "IG_LONG", expires_in: 5184000 }), { status: 200 })
    }
    if (url.includes("/me?fields=")) return new Response(JSON.stringify({ user_id: "IG_1", username: "acme.az" }), { status: 200 })
    return new Response("not found", { status: 404 })
  }))
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const payload = JSON.stringify({ orgId: "org_1", state: "nonce", ts: Date.now(), ret: "channels-instagram" })
  const state = Buffer.from(`${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`).toString("base64url")
  const res = await instagramCallback({
    url: `https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback?code=CODE&state=${encodeURIComponent(state)}`,
    cookies: { get: (name: string) => (name === "ld_ig_oauth" ? { value: state } : undefined) },
    headers: { get: () => null },
  } as unknown as NextRequest)
  expect(new URL(res.headers.get("location") || "").searchParams.get("connected")).toBe("instagram")
  vi.unstubAllGlobals()
  const row = [...store.rows.values()].find((candidate) => candidate.pageId === "IG_1")
  return row!.id
}

async function setReplyPolicyThroughMatrix(body: Record<string, unknown>) {
  const res = await setReplyPolicy(new Request("https://app.leaddrivecrm.org/api/v1/settings/channel-reply", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest)
  expect(res.status).toBe(200)
}

async function replyPolicyInMatrix(id: string) {
  const res = await readReplyPolicies(new Request("https://app.leaddrivecrm.org/api/v1/settings/channel-reply") as unknown as NextRequest)
  const json = (await res.json()) as { data: { channels: Array<{ id: string; reply: Record<string, unknown> }> } }
  return json.data.channels.find((channel) => channel.id === id)?.reply
}

/** A PUT from some other admin client — not the form. */
async function putDirectly(id: string, body: Record<string, unknown>) {
  const res = await updateChannel(
    { json: async () => body, headers: new Headers() } as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )
  expect(res.status).toBe(200)
}

/** What /api/v1/channels ships for the row — the view the catalog hands to the form. */
function apiView(id: string) {
  const row = store.rows.get(id)
  if (!row) throw new Error(`no row ${id}`)
  return { ...publicChannelConfig(snapshot(row)), claimedElsewhere: false }
}

/** The state every channel screen shows for the row. */
function screenState(id: string) {
  return channelConnectionState(apiView(id))
}

function settingsOf(id: string): Record<string, unknown> {
  return jsonCopy((store.rows.get(id)?.settings || {}) as Record<string, unknown>)
}

beforeEach(() => {
  store.rows.clear()
  store.clock = 0
  store.puts.length = 0
  store.subscribe.mockReset()
  store.subscribe.mockResolvedValue({ success: true })
})

describe("saving the channel form on a Meta row keeps what the server wrote", () => {
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

  /** The browser side: the form's provider probe, and its PUT handed to the real route handler. */
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
      return new Response(JSON.stringify({ providers: { facebook: true, instagram: true } }), { status: 200 })
    }))
  }

  /** Every await in the route is a resolved in-memory promise, so one macrotask turn drains them all. */
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  async function openForm(id: string) {
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
        // Passed the way the catalog does: the API's JSON, not a hand-picked subset of it.
        initialData: apiView(id) as Record<string, unknown>,
      }))
    })
    await settle()
  }

  function field<T extends Element = HTMLInputElement>(selector: string): T {
    const element = container.querySelector<T>(selector)
    if (!element) throw new Error(`missing ${selector}`)
    return element
  }

  const connectionStateText = () => field<HTMLElement>('[data-testid="meta-connection-state"]').textContent

  /** React tracks the value on the node, so a plain assignment is swallowed; go through the native setter. */
  async function typeInto(selector: string, value: string) {
    const input = field(selector)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  async function click(input: HTMLInputElement) {
    await act(async () => {
      input.click()
    })
  }

  /** The Instagram-Login checkbox has no id of its own; it is the one inside the Instagram Login label. */
  function instagramLoginCheckbox(): HTMLInputElement {
    const label = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.startsWith("Instagram Login"))
    const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!input) throw new Error("missing the Instagram Login checkbox")
    return input
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

  it("keeps a Page Meta refused on Reconnect needed after it is renamed and saved", async () => {
    const id = await refusedPage()
    expect(screenState(id)).toBe("needsReconnect")

    await openForm(id)
    expect(connectionStateText()).toBe(metaConnectionReason("en", "needsReconnect"))
    await typeInto("#configName", "Acme Page — support")
    await save()

    expect(store.rows.get(id)?.configName).toBe("Acme Page — support")
    expect(screenState(id)).toBe("needsReconnect")
    expect(settingsOf(id)).toEqual({ inboxSubscribed: false })
    // The form sent only its own fields; the route is what kept Meta's answer.
    expect(store.puts[0]?.settings).not.toHaveProperty("inboxSubscribed")

    // And the form, reopened on the saved row, still says so instead of "Connected".
    await openForm(id)
    expect(connectionStateText()).toBe(metaConnectionReason("en", "needsReconnect"))
  })

  it("keeps a staged App Review Page on not-requested-yet after a save", async () => {
    const id = await stagedPage()
    expect(screenState(id)).toBe("subscriptionPending")

    await openForm(id)
    await save()

    expect(screenState(id)).toBe("subscriptionPending")
    expect(settingsOf(id)).toEqual({ inboxSubscribed: false, appReviewOnly: true, subscriptionPending: true })
  })

  it("keeps an Instagram Login account's token expiry and handle", async () => {
    const id = await instagramLoginAccount()
    const connected = settingsOf(id)
    expect(connected).toMatchObject({ igLogin: true, username: "acme.az" })
    expect(typeof connected.tokenExpiresAt).toBe("number")

    await openForm(id)
    await save()

    expect(settingsOf(id)).toEqual(connected)
  })

  it("keeps the AI reply policy the reply matrix set on the Page", async () => {
    // webhooks/facebook answers with AI only when settings.replyMode is "ai" (default "agent"): an erased policy
    // switched AI replies off on this Page, silently, from a screen that does not show the policy at all.
    const id = await livePage()
    await setReplyPolicyThroughMatrix({
      configId: id,
      mode: "ai",
      afterHoursAi: true,
      draftMode: true,
      aiThreshold: 0.7,
      aiRolloutPercent: 50,
      outOfOffice: { enabled: true, message: "Back at 9:00" },
      escalateKeywords: ["оператор"],
    })
    const policy = await replyPolicyInMatrix(id)

    await openForm(id)
    await typeInto("#configName", "Acme Shop DMs")
    await save()

    expect(await replyPolicyInMatrix(id)).toEqual(policy)
    expect(policy).toMatchObject({ mode: "ai", afterHoursAi: true, draftMode: true, aiThreshold: 0.7, aiRolloutPercent: 50 })
    expect(screenState(id)).toBe("live")
  })

  it("still lets the form set and clear the flags it owns", async () => {
    const id = await instagramLoginAccount()
    const connected = settingsOf(id)

    await openForm(id)
    await typeInto("#loginConfigId", "1234567890123456")
    await click(field("#appReviewOnly"))
    await save()
    expect(settingsOf(id)).toEqual({ ...connected, loginConfigId: "1234567890123456", appReviewOnly: true })

    // Un-ticking a box and emptying a field is how the form removes its own keys; the server's stay put.
    await openForm(id)
    expect(instagramLoginCheckbox().checked).toBe(true)
    expect(field("#appReviewOnly").checked).toBe(true)
    await click(instagramLoginCheckbox())
    await click(field("#appReviewOnly"))
    await typeInto("#loginConfigId", "")
    await save()
    expect(settingsOf(id)).toEqual({ tokenExpiresAt: connected.tokenExpiresAt, username: "acme.az" })
  })

  it("does not let un-ticking App Review turn a never-subscribed Page into a live one", async () => {
    // Promoting the staged app is the form's call; whether Meta delivers is not. Nobody has asked Meta yet.
    const id = await stagedPage()
    await openForm(id)
    await click(field("#appReviewOnly"))
    await save()

    expect(screenState(id)).not.toBe("live")
    expect(settingsOf(id)).toEqual({ inboxSubscribed: false, subscriptionPending: true })
  })

  it("does not let any other client write the server's answer either", async () => {
    const refused = await refusedPage()
    // Claiming the subscription succeeded, or relabelling the refusal as a staged "not requested yet".
    await putDirectly(refused, { settings: { inboxSubscribed: true } })
    expect(screenState(refused)).toBe("needsReconnect")
    await putDirectly(refused, { settings: { appReviewOnly: true, subscriptionPending: true } })
    expect(settingsOf(refused)).toEqual({ inboxSubscribed: false, appReviewOnly: true })
    expect(screenState(refused)).toBe("needsReconnect")

    // The reply policy has its own admin endpoint, with validation and an audit trail of its own.
    const live = await livePage()
    await putDirectly(live, { settings: { replyMode: "ai", aiRolloutPercent: 100 } })
    expect(settingsOf(live)).toEqual({ inboxSubscribed: true })
    expect(await replyPolicyInMatrix(live)).toMatchObject({ mode: "agent", aiRolloutPercent: null })
  })

  it("leaves settings alone when a request does not send any", async () => {
    // A switch-off carries no settings. Merging it anyway would drop the form's own `appReviewOnly` and quietly
    // promote the staged app to the workspace's default — the accident that flag exists to prevent.
    const id = await stagedPage()
    await putDirectly(id, { isActive: false })
    expect(settingsOf(id)).toEqual({ inboxSubscribed: false, appReviewOnly: true, subscriptionPending: true })
    expect(screenState(id)).toBe("paused")
  })
})
