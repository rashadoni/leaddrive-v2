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
 * One connection per Facebook Page / Instagram account (owner, 2026-10-27: «нужна чтоб один канал был»): its
 * row in Settings → Channels says whether messaging AND Social Monitoring work, offers to turn monitoring back
 * on, and its disconnect dialog says that monitoring stops too.
 *
 * Found on prod the same morning: the LeadDrive Page was disconnected and connected again through the catalog;
 * messages came back, monitoring stayed off, and no screen said so.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
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
  useSession: () => ({ data: { user: { organizationId: "org-1", organizationSlug: "acme" } } }),
}))
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => createElement("a", props, children),
}))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
// The confirm dialog renders what the page hands it, so the test reads the text a user would read.
vi.mock("@/components/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ open, title, description }: { open?: boolean; title?: string; description?: string }) =>
    open ? createElement("div", { "data-testid": "confirm" }, createElement("h2", null, title), createElement("p", null, description)) : null,
}))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) => (open ? createElement("div", null, children) : null),
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ asChild, children, variant: _variant, size: _size, ...props }: {
    asChild?: boolean; children?: ReactNode; variant?: string; size?: string; [key: string]: unknown
  }) => {
    void _variant
    void _size
    if (asChild && isValidElement(children)) return cloneElement(children as ReactElement<Record<string, unknown>>, props)
    return createElement("button", props, children)
  },
}))

import ChannelsPage from "@/app/(dashboard)/settings/channels/page"

type Monitoring = { state: "on" | "off" | "awaiting_meta"; lastPolledAt: string | null }
const page = (id: string, name: string, monitoring?: Monitoring, channelType = "facebook") => ({
  id,
  channelType,
  configName: name,
  pageId: `page-${id}`,
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
  ...(monitoring ? { monitoring } : {}),
})

describe("Settings → Channels: one row per Meta page, messaging and monitoring together", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(channels: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: channels }) })))
    await act(async () => { root.render(createElement(ChannelsPage)) })
    await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
  }
  const row = (id: string) => container.querySelector<HTMLElement>(`[data-testid="channel-row-${id}"]`)!
  const chip = (id: string) => row(id).querySelector<HTMLElement>('[data-testid="channel-row-monitoring"]')
  const turnOn = (id: string) => row(id).querySelector<HTMLAnchorElement>('[data-testid="channel-row-monitoring-on"]')

  it("says on each page's row whether messaging and monitoring work", async () => {
    await render([
      page("collected", "Andrologiya.az", { state: "on", lastPolledAt: "2026-10-27T07:17:00.000Z" }),
      page("lost", "Lead Drive CRM", { state: "off", lastPolledAt: "2026-10-27T06:47:00.000Z" }),
      page("client", "@and_azerbaijan", { state: "awaiting_meta", lastPolledAt: null }, "instagram"),
    ])

    expect(row("collected").querySelector('[data-testid="channel-row-connected-badge"]')?.textContent).toBe("Messaging")
    expect(chip("collected")?.dataset.state).toBe("on")
    expect(chip("collected")?.textContent).toMatch(/^Monitoring · posts collected /)
    expect(turnOn("collected")).toBeNull()

    expect(chip("lost")?.textContent).toBe("Monitoring off")
    // Back on the monitoring login, landing on this very row.
    const href = new URL(turnOn("lost")!.getAttribute("href")!, "https://app.example")
    expect(href.pathname).toBe("/api/v1/social/oauth/facebook/start")
    expect(Object.fromEntries(href.searchParams)).toEqual({ from: "channels-monitoring", channelId: "lost" })

    // A client's page waits for Meta: no green claim, and no button that could not work.
    expect(chip("client")?.textContent).toBe("Monitoring: waiting for Meta approval")
    expect(turnOn("client")).toBeNull()
  })

  it("shows no monitoring line where the workspace has no Social Monitoring, nor on other channels", async () => {
    await render([
      page("plain", "Acme Page"),
      { id: "wa", channelType: "whatsapp", configName: "Number", phoneNumberId: "1", isActive: true, hasAccessToken: true },
    ])
    expect(row("plain").querySelector('[data-testid="channel-row-connected-badge"]')?.textContent).toBe("Connected")
    expect(chip("plain")).toBeNull()
    expect(chip("wa")).toBeNull()
  })

  it("warns that disconnecting a page also stops its monitoring", async () => {
    await render([
      page("collected", "Andrologiya.az", { state: "on", lastPolledAt: null }),
      { id: "wa", channelType: "whatsapp", configName: "Number", phoneNumberId: "1", isActive: true, hasAccessToken: true },
    ])
    const disconnect = (id: string) => [...row(id).querySelectorAll("button")].find((b) => b.textContent?.includes("Disconnect"))!

    await act(async () => disconnect("collected").click())
    const pageText = container.querySelector('[data-testid="confirm"]')?.textContent || ""
    expect(pageText).toContain("Social Monitoring stops collecting its posts and comments")
    expect(pageText).toContain("collected mentions stay in the CRM")

    await act(async () => disconnect("wa").click())
    const numberText = container.querySelector('[data-testid="confirm"]')?.textContent || ""
    expect(numberText).not.toContain("Social Monitoring")
  })
})
