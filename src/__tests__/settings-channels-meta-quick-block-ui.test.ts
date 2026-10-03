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
 * The channel catalog opens with WhatsApp, Facebook and Instagram — one click each, the way Social
 * Monitoring connects accounts (owner, 2026-10-03: "подключения такая каша").
 *
 * The cards in that block are the catalog's own cards (their connection state is held by
 * settings-channels-meta-oneclick-ui.test.ts); what is checked here is the block itself: each Meta card
 * appears there and nowhere else, WhatsApp connects through Meta's Embedded Signup straight from its
 * card, a server without Embedded Signup still offers the setup form, and "manual setup" opens the
 * form directly instead of the intro and the readiness questions.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
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

describe("Channel catalog — the one-click block for the Meta messengers", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    stubMatchMedia()
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

  const quick = () => container.querySelector<HTMLElement>('[data-testid="channels-meta-quick"]')
  const quickCard = (id: string) => quick()?.querySelector<HTMLElement>(`[data-testid="channel-card-${id}"]`) || null
  const linksIn = (el: HTMLElement | null) => [...(el?.querySelectorAll<HTMLAnchorElement>("a") || [])].map((a) => a.getAttribute("href"))

  it("shows WhatsApp, Facebook and Instagram in the block, once each", async () => {
    await renderCatalog([], true)
    for (const id of ["whatsapp-business", "facebook", "instagram"]) {
      expect(quickCard(id)).not.toBeNull()
      expect(container.querySelectorAll(`[data-testid="channel-card-${id}"]`)).toHaveLength(1)
    }
    // The rest of the catalog is still there below it.
    expect(container.querySelector('[data-testid="channel-card-telegram"]')).not.toBeNull()
    expect(quick()?.querySelector('[data-testid="channel-card-telegram"]')).toBeNull()
  })

  it("connects WhatsApp through Meta straight from its card", async () => {
    await renderCatalog([], true)
    const button = quickCard("whatsapp-business")?.querySelector<HTMLElement>('[data-testid="whatsapp-embedded-signup-button"] button')
    expect(button?.textContent).toContain("Connect with Meta")
    expect(button?.hasAttribute("disabled")).toBe(false)
    // Manual setup opens the form itself, not the intro and the readiness questions.
    expect(linksIn(quickCard("whatsapp-business"))).toEqual(["/settings/channels/connect/whatsapp-business?mode=new&stage=connect"])
  })

  it("still offers the setup form when the server has no Embedded Signup", async () => {
    await renderCatalog([], false)
    const card = quickCard("whatsapp-business")
    expect(card?.querySelector('[data-testid="whatsapp-embedded-signup-button"]')).toBeNull()
    expect(linksIn(card)).toEqual([
      "/settings/channels/connect/whatsapp-business?mode=new&stage=connect",
      "/settings/channels/connect/whatsapp-business?mode=new&stage=connect",
    ])
    expect(card?.textContent).toContain("Open setup")
  })

  it("keeps Facebook and Instagram on their one-click Meta login, with manual setup going straight to the form", async () => {
    await renderCatalog([], true)
    expect(linksIn(quickCard("facebook"))).toEqual([
      "/api/v1/social/oauth/facebook/start?from=channels-facebook",
      "/settings/channels/connect/facebook?mode=new&stage=connect",
    ])
    // The Instagram path Meta's reviewer follows: Settings -> Channels -> Instagram -> Instagram Login.
    expect(linksIn(quickCard("instagram"))).toEqual([
      "/api/v1/social/oauth/instagram/start?from=channels-instagram",
      "/settings/channels/connect/instagram?mode=new&stage=connect",
    ])
  })

  it("shows a connected WhatsApp number on its card instead of the connect button", async () => {
    await renderCatalog([{ id: "wa-1", channelType: "whatsapp", configName: "Acme WhatsApp", isActive: true, hasAccessToken: true }], true)
    const card = quickCard("whatsapp-business")
    expect(card?.querySelector('[data-testid="channel-card-connected-badge"]')?.textContent).toContain("Connected")
    expect(card?.textContent).toContain("Acme WhatsApp")
    expect(card?.querySelector('[data-testid="whatsapp-embedded-signup-button"]')).toBeNull()
  })
})
