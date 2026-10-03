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
 * and integrations go to their own screens. No tile walks the user through the setup wizard's pages,
 * and Edit on a connected channel opens the same window.
 */

const pushes = vi.hoisted(() => [] as string[])
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn((href: string) => { pushes.push(href) }),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
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

  it("sends VoIP and integrations to their own screens", async () => {
    await renderCatalog([], true)
    expect(action("asterisk").getAttribute("href")).toBe("/settings/voip")
    expect(action("website-chat").getAttribute("href")).toBe("/settings/web-chat")
  })

  it("never walks a platform through the setup wizard's pages, except the WhatsApp Calling guide", async () => {
    await renderCatalog([], true)
    const wizardLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/settings/channels/connect/"]')]
      .map((link) => link.getAttribute("href"))
    expect(wizardLinks).toEqual(["/settings/channels/connect/whatsapp-business-calls"])
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
