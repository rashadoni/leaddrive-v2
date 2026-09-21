// @vitest-environment jsdom

import crypto from "crypto"
import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Which channel the connect page opens after a Meta round trip.
 *
 * 2026-09-21, production, tenant `leaddrive` — a workspace that holds several customers' Facebook
 * Pages. "Connect Facebook Page" was started from channel cmua55s6t03n0kpvtm63bclud and the callback
 * came back as `?mode=existing&stage=connect&connected=facebook&pages=1&ig=0`, with no row id. The page
 * then fell back to "the first live Facebook row of the workspace" and rendered ANOTHER customer's
 * channel, "Andrologiya.az", right under "Channel connected" — in an editable form with a Save button.
 *
 * The rule pinned here: after an OAuth return the page opens the row the URL names (checked against
 * the session's own channel list and the card's type) or no row at all. The last block runs the real
 * callback against a workspace shaped like `leaddrive` and feeds its redirect to the real page, so the
 * route and the page are held to the rule together.
 */

const routeParams = { channel: "facebook" }
let currentSearch = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useParams: () => routeParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => currentSearch,
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1", organizationSlug: "leaddrive" } } }),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", props, children),
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
  buttonVariants: () => "",
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

vi.mock("@/components/channels/tiktok-channel-hub", () => ({
  TikTokChannelHub: () => null,
}))

// ---- Server side of the round trip: an in-memory ChannelConfig table instead of Postgres. ----------

type StoredRow = {
  id: string
  organizationId: string
  channelType: string
  configName: string
  pageId: string | null
  apiKey: string | null
  isActive: boolean
  settings: Record<string, unknown> | null
  createdAt: number
}
const store: StoredRow[] = []
let createdSeq = 0

function rowMatches(row: StoredRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key]
    if (expected && typeof expected === "object" && "in" in expected) {
      return (expected as { in: unknown[] }).in.includes(actual)
    }
    return actual === expected
  })
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = store.find((candidate) => rowMatches(candidate, where))
        return row ? { id: row.id } : null
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        store
          .filter((candidate) => rowMatches(candidate, where))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((row) => ({ id: row.id, settings: row.settings })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredRow> }) => {
        const row = store.find((candidate) => candidate.id === where.id)
        if (!row) throw new Error(`no row ${where.id}`)
        Object.assign(row, data)
        return { id: row.id }
      },
      create: async ({ data }: { data: Partial<StoredRow> }) => {
        createdSeq += 1
        const row: StoredRow = {
          id: `cc_created_${createdSeq}`,
          organizationId: "",
          channelType: "",
          configName: "",
          pageId: null,
          apiKey: null,
          isActive: true,
          settings: null,
          createdAt: 1_000 + createdSeq,
          ...data,
        }
        store.push(row)
        return { id: row.id }
      },
    },
    socialAccount: { upsert: async () => ({ id: "social" }) },
  },
}))
vi.mock("@/lib/secure-token", () => ({ encryptToken: (token: string) => `enc:${token}` }))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(async () => "org-1"), getSession: vi.fn(async () => null) }))
vi.mock("@/lib/social/meta-subscribe", () => ({ subscribePageToMessages: vi.fn(async () => ({ success: true })) }))
vi.mock("@/lib/social/source-route-plan", () => ({ compileOrganizationSourceRoutePlans: vi.fn(async () => undefined) }))
vi.mock("@/lib/social/tenant-meta-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/social/tenant-meta-app")>()),
  // LeadDrive's shared app (env) — the unpinned path every Model A tenant takes.
  getTenantMetaApp: vi.fn(async () => null),
}))

import ChannelConnectPage from "@/app/(dashboard)/settings/channels/connect/[channel]/page"
import { GET as facebookCallback } from "@/app/api/v1/social/oauth/facebook/callback/route"

type ApiChannel = {
  id: string
  channelType: string
  configName: string
  pageId?: string | null
  isActive: boolean
  settings?: Record<string, unknown> | null
  hasAccessToken?: boolean
  claimedElsewhere?: boolean
}

/** The row Connect was pressed on in production. */
const ORIGIN_ID = "cmua55s6t03n0kpvtm63bclud"

const originRow: ApiChannel = {
  id: ORIGIN_ID,
  channelType: "facebook",
  configName: "LeadDrive",
  pageId: "PAGE_LD",
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
}

/** Another customer's live Page in the same workspace — listed FIRST, which is how it got picked. */
const otherCustomerRow: ApiChannel = {
  id: "cc_andrologiya",
  channelType: "facebook",
  configName: "Andrologiya.az",
  pageId: "PAGE_ANDRO",
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
}

const instagramRow: ApiChannel = {
  id: "cc_ig",
  channelType: "instagram",
  configName: "LeadDrive / @leaddrive.az",
  pageId: "IG_LD",
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve()
    }
  })
}

describe("connect page after a Meta round trip", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
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
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    routeParams.channel = "facebook"
    store.length = 0
    vi.unstubAllGlobals()
  })

  /** The channel list is this session's own workspace; the form's provider probe answers from it too. */
  function stubChannelsApi(channels: ApiChannel[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: channels, providers: { facebook: true, instagram: true } }),
    })))
  }

  async function renderConnect(channel: string, search: string, channels: ApiChannel[]) {
    routeParams.channel = channel
    currentSearch = new URLSearchParams(search)
    stubChannelsApi(channels)
    await act(async () => {
      root.render(createElement(ChannelConnectPage))
    })
    await flushMicrotasks()
  }

  const form = () => container.querySelector<HTMLElement>("[data-channel-config-form]")
  const formName = () => container.querySelector<HTMLInputElement>("#configName")?.value ?? null
  const noRowSummary = () => container.querySelector<HTMLElement>('[data-testid="meta-no-row"]')
  const banner = () => container.querySelector<HTMLElement>('[data-testid="oauth-result-banner"]')
  const tone = () => banner()?.getAttribute("data-tone") || null

  describe("the row the URL names, or none", () => {
    it("does not open another customer's channel when the return names no row (the 2026-09-21 URL)", async () => {
      await renderConnect(
        "facebook",
        "mode=existing&stage=connect&connected=facebook&pages=1&ig=0",
        [otherCustomerRow, originRow],
      )
      expect(form()).toBeNull()
      expect(formName()).toBeNull()
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(noRowSummary()).not.toBeNull()
      // Several Facebook rows exist and none was named: neither "connected" nor "holds no channel".
      expect(tone()).toBe("neutral")
      expect(banner()?.textContent).toContain("Meta finished the connection")
    })

    it("opens exactly the row the callback named", async () => {
      await renderConnect(
        "facebook",
        `mode=existing&stage=connect&connected=facebook&pages=1&ig=0&channelId=${ORIGIN_ID}`,
        [otherCustomerRow, originRow],
      )
      expect(formName()).toBe("LeadDrive")
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(noRowSummary()).toBeNull()
      expect(tone()).toBe("success")
    })

    it("opens nothing for an id that is not in this workspace's own channel list", async () => {
      // Another tenant's row, a deleted row, a hand-edited URL — the list is scoped to the session's
      // org, so none of them is found, and "not found" must not become "some other row".
      await renderConnect(
        "facebook",
        "mode=existing&stage=connect&connected=facebook&pages=1&ig=0&channelId=cc_of_another_org",
        [otherCustomerRow, originRow],
      )
      expect(form()).toBeNull()
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(noRowSummary()).not.toBeNull()
    })

    it("never opens a row of another channel type on a Meta card", async () => {
      await renderConnect(
        "facebook",
        `mode=existing&stage=connect&connected=facebook&pages=1&ig=1&channelId=${instagramRow.id}`,
        [otherCustomerRow, instagramRow],
      )
      expect(form()).toBeNull()
      expect(container.textContent).not.toContain(instagramRow.configName)
      expect(container.textContent).not.toContain("Andrologiya.az")
    })

    it("does not open some other row after a failed connect either", async () => {
      await renderConnect(
        "facebook",
        "mode=existing&stage=connect&error=token_exchange_failed",
        [otherCustomerRow, originRow],
      )
      expect(container.textContent).toContain("Connection did not finish")
      expect(form()).toBeNull()
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(noRowSummary()).not.toBeNull()
    })

    it("reopens the row a failed connect was started from", async () => {
      await renderConnect(
        "facebook",
        `mode=existing&stage=connect&error=token_exchange_failed&channelId=${ORIGIN_ID}`,
        [otherCustomerRow, originRow],
      )
      expect(container.textContent).toContain("Connection did not finish")
      expect(formName()).toBe("LeadDrive")
    })

    it("does not let a URL that names a missing row fall through to another one", async () => {
      await renderConnect("facebook", "mode=existing&stage=connect&channelId=cc_deleted", [otherCustomerRow])
      expect(form()).toBeNull()
      expect(container.textContent).not.toContain("Andrologiya.az")
    })

    it("sends the user to the channel list, and the wizard's own step link does not lead into a guess", async () => {
      await renderConnect(
        "facebook",
        "mode=existing&stage=connect&connected=facebook&pages=2&ig=0",
        [otherCustomerRow, originRow],
      )
      const summaryLinks = Array.from(noRowSummary()?.querySelectorAll("a") || []).map((a) => a.getAttribute("href"))
      expect(summaryLinks).toEqual(["/settings/channels"])

      // The "3. Connect" step link drops the OAuth result and has no row id to carry. It used to land on
      // `?mode=existing&stage=connect` and the first live row of the workspace — one click from here.
      const stepHref = container.querySelector<HTMLAnchorElement>('a[aria-label^="3."]')?.getAttribute("href") || ""
      expect(stepHref.startsWith("/settings/channels/connect/facebook?")).toBe(true)
      expect(new URLSearchParams(stepHref.split("?")[1]).has("connected")).toBe(false)
      await act(async () => root.unmount())
      root = createRoot(container)
      await renderConnect("facebook", stepHref.split("?")[1], [otherCustomerRow, originRow])
      expect(form()).toBeNull()
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(noRowSummary()).not.toBeNull()
    })

    it("picks no row on a plain 'existing' entry when the workspace holds several live Pages", async () => {
      await renderConnect("facebook", "mode=existing&stage=connect", [otherCustomerRow, originRow])
      expect(form()).toBeNull()
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(noRowSummary()).not.toBeNull()
    })

    it("still opens the one delivering row of a Model B tenant next to its app-config row", async () => {
      const appConfigRow: ApiChannel = {
        id: "cc_app_config",
        channelType: "facebook",
        configName: "Our Meta app",
        pageId: null,
        isActive: true,
        hasAccessToken: false,
        settings: null,
      }
      await renderConnect("facebook", "mode=existing&stage=connect", [appConfigRow, originRow])
      expect(formName()).toBe("LeadDrive")
    })

    it("still says 'holds no channel' when the workspace really has no row of this type", async () => {
      await renderConnect("facebook", "mode=existing&stage=connect&connected=facebook&pages=1&ig=0", [instagramRow])
      expect(tone()).toBe("warning")
      expect(banner()?.textContent).toContain("holds no channel")
    })

    it("shows neither a form nor the summary while the channel list is still in flight", async () => {
      routeParams.channel = "facebook"
      currentSearch = new URLSearchParams("mode=existing&stage=connect&connected=facebook&pages=1&ig=0")
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
      await act(async () => {
        root.render(createElement(ChannelConnectPage))
      })
      expect(form()).toBeNull()
      expect(noRowSummary()).toBeNull()
      expect(tone()).toBe("pending")
    })

    it("leaves the plain 'existing' entry without any OAuth result as it was", async () => {
      // Not an OAuth return and no row named: the historical single-row convenience is untouched.
      await renderConnect("facebook", "mode=existing&stage=connect", [originRow])
      expect(formName()).toBe("LeadDrive")
    })
  })

  describe("round trip: the real callback's redirect, rendered by the real page", () => {
    const SECRET = process.env.NEXTAUTH_SECRET || "ld-social-oauth"

    function signedState(fields: Record<string, unknown>): string {
      const payload = JSON.stringify({ orgId: "org-1", state: "nonce", ts: Date.now(), ...fields })
      const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex")
      return Buffer.from(payload + "." + sig).toString("base64url")
    }

    function seedLeaddriveWorkspace() {
      store.push(
        {
          id: ORIGIN_ID, organizationId: "org-1", channelType: "facebook", configName: "LeadDrive",
          pageId: "PAGE_LD", apiKey: "OLD_TOKEN", isActive: true, settings: { inboxSubscribed: true }, createdAt: 1,
        },
        {
          id: "cc_andrologiya", organizationId: "org-1", channelType: "facebook", configName: "Andrologiya.az",
          pageId: "PAGE_ANDRO", apiKey: "ANDRO_TOKEN", isActive: true, settings: { inboxSubscribed: true }, createdAt: 2,
        },
        {
          id: "cc_other_org", organizationId: "org-2", channelType: "facebook", configName: "Other Tenant Page",
          pageId: "PAGE_X", apiKey: "X", isActive: true, settings: { inboxSubscribed: true }, createdAt: 3,
        },
      )
    }

    /** What /api/v1/channels answers for org-1: its own rows only, newest first, token as a boolean. */
    function channelsApiView(): ApiChannel[] {
      return store
        .filter((row) => row.organizationId === "org-1")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          id: row.id,
          channelType: row.channelType,
          configName: row.configName,
          pageId: row.pageId,
          isActive: row.isActive,
          settings: row.settings,
          hasAccessToken: Boolean(row.apiKey),
        }))
    }

    async function runCallback(state: string, grantedPages: Array<{ id: string; name: string; access_token: string }>) {
      process.env.FACEBOOK_APP_ID = "1276226757359622"
      process.env.FACEBOOK_APP_SECRET = "fb-secret"
      process.env.FACEBOOK_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/oauth/access_token?client_id=")) return new Response(JSON.stringify({ access_token: "SHORT" }))
        if (url.includes("grant_type=fb_exchange_token")) return new Response(JSON.stringify({ access_token: "LONG" }))
        if (url.includes("/me/accounts")) return new Response(JSON.stringify({ data: grantedPages }))
        return new Response("not found", { status: 404 })
      }))
      const req = {
        url: `https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback?code=CODE&state=${encodeURIComponent(state)}`,
        cookies: { get: (name: string) => (name === "ld_fb_oauth" ? { value: state } : undefined) },
        headers: { get: () => null },
      } as unknown as NextRequest
      const res = await facebookCallback(req)
      return new URL(res.headers.get("location") || "")
    }

    async function renderLanding(landing: URL) {
      routeParams.channel = landing.pathname.split("/").pop() || ""
      currentSearch = new URLSearchParams(landing.search)
      stubChannelsApi(channelsApiView())
      await act(async () => {
        root.render(createElement(ChannelConnectPage))
      })
      await flushMicrotasks()
    }

    it("lands on the channel that was connected, never on another customer's Page", async () => {
      seedLeaddriveWorkspace()
      const landing = await runCallback(
        signedState({ ret: "channels-facebook", channelId: ORIGIN_ID }),
        [{ id: "PAGE_LD", name: "LeadDrive", access_token: "NEW_TOKEN" }],
      )
      expect(landing.pathname).toBe("/settings/channels/connect/facebook")
      expect(landing.searchParams.get("channelId")).toBe(ORIGIN_ID)
      // The callback really did re-wire that row, and only that row.
      expect(store.find((row) => row.id === ORIGIN_ID)?.apiKey).toBe("NEW_TOKEN")
      expect(store.find((row) => row.id === "cc_andrologiya")?.apiKey).toBe("ANDRO_TOKEN")

      await renderLanding(landing)
      expect(formName()).toBe("LeadDrive")
      expect(container.textContent).not.toContain("Andrologiya.az")
      expect(tone()).toBe("success")
    })

    it("a catalog one-click that connects a brand-new Page lands on that new row", async () => {
      seedLeaddriveWorkspace()
      const landing = await runCallback(
        signedState({ ret: "channels-facebook" }),
        [{ id: "PAGE_NEW", name: "Brand New Clinic", access_token: "NEW_PAGE_TOKEN" }],
      )
      const created = store.find((row) => row.pageId === "PAGE_NEW")
      expect(landing.searchParams.get("channelId")).toBe(created?.id)

      await renderLanding(landing)
      expect(formName()).toBe("Brand New Clinic")
      expect(container.textContent).not.toContain("Andrologiya.az")
    })

    it("a connect that wires several Pages at once opens none of them", async () => {
      seedLeaddriveWorkspace()
      const landing = await runCallback(
        signedState({ ret: "channels-facebook" }),
        [
          { id: "PAGE_ANDRO", name: "Andrologiya.az", access_token: "ANDRO_NEW" },
          { id: "PAGE_LD", name: "LeadDrive", access_token: "LD_NEW" },
        ],
      )
      expect(landing.searchParams.has("channelId")).toBe(false)

      await renderLanding(landing)
      expect(form()).toBeNull()
      expect(noRowSummary()).not.toBeNull()
      expect(tone()).toBe("neutral")
    })

    it("a state naming another tenant's row lands on this tenant's wired row, not the foreign one", async () => {
      seedLeaddriveWorkspace()
      const landing = await runCallback(
        signedState({ ret: "channels-facebook", channelId: "cc_other_org" }),
        [{ id: "PAGE_LD", name: "LeadDrive", access_token: "NEW_TOKEN" }],
      )
      expect(landing.searchParams.get("channelId")).toBe(ORIGIN_ID)

      await renderLanding(landing)
      expect(formName()).toBe("LeadDrive")
      expect(container.textContent).not.toContain("Other Tenant Page")
    })
  })
})
