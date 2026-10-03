// @vitest-environment jsdom

import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The channel catalog is a grid of platform tiles, the way Social Monitoring connects accounts
 * (owner, 2026-10-03: «человек нажимает на иконку платформы и всё»).
 *
 * What each tile does is the contract checked here: WhatsApp starts Meta's Embedded Signup from the
 * tile itself (or opens its form when the server has no Embedded Signup); Facebook and Instagram are
 * links into Meta's login; a platform that needs a key opens its form in a window over the catalog; VoIP
 * and integrations go to their own screens; telephony is not here (VoIP calls has its own menu entry). No
 * tile walks the user through the setup wizard's pages, and Edit on a connected channel opens the same window.
 */

const pushes = vi.hoisted(() => [] as string[])
const replaces = vi.hoisted(() => [] as string[])
const search = vi.hoisted(() => ({ current: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn((href: string) => { pushes.push(href) }),
    replace: vi.fn((href: string) => { replaces.push(href) }),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => search.current,
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
  useSession: () => ({
    data: { user: { organizationId: "org-1", organizationSlug: "acme" } },
  }),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", props, children),
}))

vi.mock("@/components/tour/tour-provider", () => ({
  useAutoTour: () => undefined,
}))

vi.mock("@/components/tour/tour-replay-button", () => ({
  TourReplayButton: () => null,
}))

vi.mock("@/components/help/help-button", () => ({
  HelpButton: () => null,
}))

vi.mock("@/components/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
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

import ChannelsPage from "@/app/(dashboard)/settings/channels/page"

function stubMatchMedia() {
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
}

type ApiChannel = {
  id: string
  channelType: string
  configName: string
  pageId?: string | null
  isActive: boolean
  settings?: Record<string, unknown> | null
  hasAccessToken?: boolean
}

async function flushMicrotasks(rounds = 16): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve()
    }
  })
}

describe("Channel catalog — one tile per platform", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    stubMatchMedia()
    pushes.length = 0
    replaces.length = 0
    search.current = new URLSearchParams()
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
    vi.restoreAllMocks()
  })

  async function renderCatalog(channels: ApiChannel[], embeddedSignupConfigured: boolean) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes("/api/v1/channels/whatsapp/embedded-signup")
        ? (embeddedSignupConfigured ? { configured: true, appId: "2414060595720618", configId: "1142677331680804" } : { configured: false })
        : { success: true, data: channels }
      return { ok: true, status: 200, json: async () => body }
    }))
    await act(async () => {
      root.render(createElement(ChannelsPage))
    })
    await flushMicrotasks()
  }

  const tile = (id: string) => container.querySelector<HTMLElement>(`[data-testid="channel-card-${id}"]`)
  /** The one thing a tile does: its single link or button. */
  const action = (id: string) => {
    const element = tile(id)
    const controls = element ? [...element.querySelectorAll<HTMLElement>("a, button")] : []
    expect(controls).toHaveLength(1)
    return controls[0]
  }
  const formOpen = () => Boolean(container.querySelector("form"))
  async function click(element: HTMLElement) {
    await act(async () => {
      element.click()
    })
    await flushMicrotasks()
  }

  it("starts Meta's Embedded Signup from the WhatsApp tile itself", async () => {
    await renderCatalog([], true)
    const whatsapp = action("whatsapp-business")
    expect(whatsapp.tagName).toBe("BUTTON")
    expect(whatsapp.getAttribute("aria-label")).toBe("Connect with Meta: WhatsApp Business Platform (API)")
    expect(whatsapp.hasAttribute("disabled")).toBe(false)
  })

  it("opens WhatsApp's form instead when the server has no Embedded Signup", async () => {
    await renderCatalog([], false)
    expect(tile("whatsapp-business")?.textContent).toContain("Meta sign-in is not set up on this server")
    await click(action("whatsapp-business"))
    expect(formOpen()).toBe(true)
    expect(container.querySelector("#apiKey")).not.toBeNull()
    expect(pushes).toEqual([])
  })

  it("links Facebook and Instagram straight into Meta's login", async () => {
    await renderCatalog([], true)
    expect(action("facebook").getAttribute("href")).toBe("/api/v1/social/oauth/facebook/start?from=channels-facebook")
    // The Instagram path Meta's reviewer follows: Settings -> Channels -> Instagram -> Instagram Login.
    expect(action("instagram").getAttribute("href")).toBe("/api/v1/social/oauth/instagram/start?from=channels-instagram")
  })

  it("opens the form in a window for a platform that needs a key, without leaving the catalog", async () => {
    await renderCatalog([], true)
    expect(formOpen()).toBe(false)
    await click(action("telegram"))
    expect(formOpen()).toBe(true)
    expect(container.querySelector("#botToken")).not.toBeNull()
    expect(pushes).toEqual([])
  })

  it("sends website chat to its own screen, and leaves telephony to VoIP calls", async () => {
    await renderCatalog([], true)
    expect(action("website-chat").getAttribute("href")).toBe("/settings/web-chat")
    for (const id of ["twilio-calls", "threecx", "asterisk", "custom-sip", "whatsapp-business-calls"]) {
      expect(tile(id)).toBeNull()
    }
  })

  it("never walks a platform through the setup wizard's pages", async () => {
    await renderCatalog([], true)
    expect(container.querySelectorAll('a[href^="/settings/channels/connect/"]')).toHaveLength(0)
  })

  it("says on the catalog what Meta's login wired, marks that row, and closes the note", async () => {
    // Where Facebook / Instagram Login lands since 2026-10-03 (lib/social/oauth-return).
    search.current = new URLSearchParams("oauth=instagram&connected=instagram&pages=0&ig=1&channelId=ig-1")
    await renderCatalog([
      { id: "ig-1", channelType: "instagram", configName: "Acme / @acme", pageId: "IG1", isActive: true, hasAccessToken: true, settings: { inboxSubscribed: true } },
      { id: "ig-2", channelType: "instagram", configName: "Other / @other", pageId: "IG2", isActive: true, hasAccessToken: true, settings: { inboxSubscribed: true } },
    ], true)
    const banner = container.querySelector<HTMLElement>('[data-testid="oauth-result-banner"]')
    expect(banner?.getAttribute("data-tone")).toBe("success")
    expect(banner?.textContent).toContain("Channel connected")
    expect(container.querySelector('[data-oauth-result="true"]')?.getAttribute("data-testid")).toBe("channel-row-ig-1")
    const close = [...(banner?.querySelectorAll("button") || [])].find((button) => button.textContent === "Close")
    await click(close as HTMLElement)
    expect(replaces).toEqual(["/settings/channels"])
  })

  it("does not call an Instagram connect a success when Meta returned no Instagram account", async () => {
    search.current = new URLSearchParams("oauth=instagram&connected=facebook&pages=1&ig=0")
    await renderCatalog([], true)
    const banner = container.querySelector<HTMLElement>('[data-testid="oauth-result-banner"]')
    expect(banner?.getAttribute("data-tone")).toBe("warning")
    expect(banner?.textContent).toContain("This channel is still not connected")
    expect(container.querySelector('[data-oauth-result="true"]')).toBeNull()
  })

  it("reports a failed Meta login with Meta's own code", async () => {
    search.current = new URLSearchParams("oauth=facebook&error=facebook_denied")
    await renderCatalog([], true)
    expect(container.querySelector('[data-testid="oauth-result-banner"]')).toBeNull()
    expect(container.querySelector('[data-testid="oauth-error-banner"]')?.textContent).toContain("facebook_denied")
  })

  it("ignores result parameters that do not come with a known return", async () => {
    search.current = new URLSearchParams("connected=facebook&pages=3&error=x")
    await renderCatalog([], true)
    expect(container.querySelector('[data-testid="oauth-result-banner"]')).toBeNull()
    expect(container.querySelector('[data-testid="oauth-error-banner"]')).toBeNull()
  })

  it("lists a connected channel with Edit opening the same window, and shows it on its tile", async () => {
    await renderCatalog([{ id: "tg-1", channelType: "telegram", configName: "Support bot", isActive: true }], true)
    expect(tile("telegram")?.querySelector('[data-testid="channel-card-connected-badge"]')).not.toBeNull()
    expect(tile("telegram")?.textContent).toContain("Support bot")
    const row = container.querySelector<HTMLElement>('[data-testid="channel-row-tg-1"]')
    expect(row?.textContent).toContain("Support bot")
    const edit = [...(row?.querySelectorAll("button") || [])].find((button) => button.textContent?.includes("Edit"))
    expect(edit).toBeDefined()
    await click(edit as HTMLElement)
    expect(formOpen()).toBe(true)
    expect(pushes).toEqual([])
  })
})
