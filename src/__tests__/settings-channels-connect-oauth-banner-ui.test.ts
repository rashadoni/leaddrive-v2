// @vitest-environment jsdom

import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the channel page says after coming back from Meta.
 *
 * Two separate lies lived in this banner, and both came from the same root cause: it was decided by
 * the URL alone.
 *
 *   1. The Instagram card deliberately starts the FACEBOOK OAuth flow, because Instagram Direct is
 *      delivered through the linked Page's `messages` webhook. So the callback can legitimately return
 *      `?connected=facebook&pages=1&ig=0` — a real result for Facebook and nothing whatsoever for
 *      Instagram, on which the banner still fired.
 *   2. `?pages=1` says only what META did. It says nothing about what LeadDrive stored, so the green
 *      banner also fired over a channel row that was switched off, one whose message subscription Meta
 *      had refused, and over no row at all. In the refused case the SAME SCREEN carried the form's
 *      "Not delivering — Meta refused the message subscription" a few hundred pixels lower.
 *
 * Hence the form below is deliberately NOT mocked here: several checks assert that the banner and the
 * form print the same sentence about the same row, which is the property that was broken.
 */

const routeParams = { channel: "instagram" }
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
  useSession: () => ({ data: { user: { organizationId: "org-1", organizationSlug: "acme" } } }),
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

import ChannelConnectPage from "@/app/(dashboard)/settings/channels/connect/[channel]/page"

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

/** A page row exactly as the OAuth callback + publicChannelConfig produce it. */
const wiredFacebookRow: ApiChannel = {
  id: "fb-page",
  channelType: "facebook",
  configName: "Acme Page",
  pageId: "1122334455",
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
}

const wiredInstagramRow: ApiChannel = {
  ...wiredFacebookRow,
  id: "ig-account",
  channelType: "instagram",
  configName: "Acme Instagram",
  pageId: "17841400000000000",
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve()
    }
  })
}

describe("Meta OAuth return banner", () => {
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
    routeParams.channel = "instagram"
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Both the channel list and the form's provider probe answer from this one stub. */
  function stubApi(channels: ApiChannel[], options: { ok?: boolean; status?: number } = {}) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: async () => ({
        success: true,
        data: channels,
        providers: { facebook: true, instagram: true },
      }),
    })))
  }

  async function renderConnect(channel: string, search: string, channels: ApiChannel[] = []) {
    routeParams.channel = channel
    currentSearch = new URLSearchParams(search)
    stubApi(channels)
    await act(async () => {
      root.render(createElement(ChannelConnectPage))
    })
    await flushMicrotasks()
  }

  const banner = () => container.querySelector<HTMLElement>('[data-testid="oauth-result-banner"]')
  const tone = () => banner()?.getAttribute("data-tone") || null
  const bannerTitle = () => banner()?.querySelectorAll("p")[0]?.textContent || ""
  const bannerReason = () => banner()?.querySelectorAll("p")[1]?.textContent || ""
  /** What the form a few hundred pixels lower says about the very same row. */
  const formState = () =>
    container.querySelector<HTMLElement>('[data-testid="meta-connection-state"]')?.textContent || ""

  describe("what Meta returned", () => {
    it("does not congratulate an Instagram connect that wired no Instagram account", async () => {
      await renderConnect("instagram", "stage=connect&mode=existing&connected=facebook&pages=1&ig=0")
      expect(tone()).toBe("warning")
      expect(bannerTitle()).toContain("This channel is still not connected")
      // And it names the actual cause, which is invisible from inside LeadDrive.
      expect(bannerReason()).toContain("Instagram BUSINESS account")
    })

    it("does not claim a Facebook connect that returned no Page", async () => {
      await renderConnect("facebook", "stage=connect&mode=existing&connected=facebook&pages=0&ig=0")
      expect(tone()).toBe("warning")
      expect(bannerReason()).toContain("returned no Facebook Page")
    })

    it("shows no OAuth banner at all when the user simply opened the page", async () => {
      await renderConnect("instagram", "stage=connect&mode=existing", [wiredInstagramRow])
      expect(banner()).toBeNull()
    })

    it("says nothing about Meta on a guide that is not a Meta channel", async () => {
      // Only the two Meta cards are OAuth return targets, so a `?connected=` here is hand-typed.
      await renderConnect("telegram", "stage=connect&mode=existing&connected=facebook&pages=1&ig=0")
      expect(banner()).toBeNull()
    })

    it("still reports a Meta error verbatim", async () => {
      await renderConnect("instagram", "stage=connect&mode=existing&error=no_admined_pages")
      expect(container.textContent).toContain("Connection did not finish")
      expect(container.textContent).toContain("no_admined_pages")
    })
  })

  describe("what LeadDrive actually stored", () => {
    it("congratulates a connect whose saved row really does deliver", async () => {
      await renderConnect(
        "instagram",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=1",
        [wiredInstagramRow],
      )
      expect(tone()).toBe("success")
      expect(bannerTitle()).toContain("Channel connected")
      expect(formState()).toContain("Connected.")
    })

    it("reads the separate Instagram-Login callback, which reports ig without pages", async () => {
      // oauth/instagram/callback redirects with `connected=instagram&ig=1` and no `pages` at all.
      await renderConnect(
        "instagram",
        "stage=connect&mode=existing&connected=instagram&ig=1",
        [wiredInstagramRow],
      )
      expect(tone()).toBe("success")
    })

    it("judges the Facebook card on Pages, not on Instagram accounts", async () => {
      await renderConnect(
        "facebook",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=0",
        [wiredFacebookRow],
      )
      expect(tone()).toBe("success")
      expect(bannerTitle()).toContain("Channel connected")
    })

    it("does not congratulate a row whose message subscription Meta refused", async () => {
      // The screen used to contradict itself here: green "Channel connected, send a message" on top,
      // "Not delivering — Meta refused the subscription" in the form below, same row, same screen.
      await renderConnect(
        "facebook",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=0",
        [{ ...wiredFacebookRow, settings: { inboxSubscribed: false } }],
      )
      expect(tone()).toBe("warning")
      expect(bannerTitle()).not.toContain("Channel connected")
      expect(bannerReason()).toContain("Meta refused the message subscription")
      // The property that matters: one row, one sentence, wherever the user looks.
      expect(formState()).toBe(bannerReason())
    })

    it("does not congratulate a row that is switched off", async () => {
      // webhooks/facebook resolves inbound DMs with `isActive: true` — an off row is invisible to it.
      await renderConnect(
        "facebook",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=0",
        [{ ...wiredFacebookRow, isActive: false }],
      )
      expect(tone()).toBe("warning")
      expect(bannerReason()).toContain("switched off")
      expect(formState()).toBe(bannerReason())
    })

    it("does not congratulate a row that carries no page token", async () => {
      await renderConnect(
        "facebook",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=0",
        [{ ...wiredFacebookRow, pageId: null, hasAccessToken: false, settings: null }],
      )
      expect(tone()).toBe("warning")
      expect(formState()).toBe(bannerReason())
    })

    it("does not congratulate a connect that left no channel row behind", async () => {
      await renderConnect("facebook", "stage=connect&mode=existing&connected=facebook&pages=1&ig=0", [])
      expect(tone()).toBe("warning")
      expect(bannerTitle()).not.toContain("Channel connected")
      expect(bannerReason()).toContain("holds no channel")
    })

    it("does not congratulate an account another workspace connected first — its DMs go there", async () => {
      // 2026-09-11: Fanumsec connected @leaddrive.az, LeadDrive Inc.'s June claim kept winning the webhook,
      // and this banner said "Channel connected". The API now ships `claimedElsewhere` (the boolean only).
      await renderConnect(
        "instagram",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=1",
        [{ ...wiredInstagramRow, claimedElsewhere: true }],
      )
      expect(tone()).toBe("warning")
      expect(bannerTitle()).toBe("channelClaimedElsewhere.title")
      expect(bannerReason()).toBe("channelClaimedElsewhere.reason")
      expect(formState()).toBe(bannerReason())
    })

    it("keeps the wired-but-not-delivering case out of the send-a-message wording", async () => {
      // "Still not connected" would send a tenant whose Page IS stored back through an OAuth that has
      // nothing left to fix; the toggle is what they need.
      await renderConnect(
        "facebook",
        "stage=connect&mode=existing&connected=facebook&pages=1&ig=0",
        [{ ...wiredFacebookRow, isActive: false }],
      )
      expect(bannerTitle()).toContain("not delivering")
      expect(bannerTitle()).not.toContain("still not connected")
    })
  })

  describe("before the answer is known", () => {
    it("claims nothing while the channel list is still in flight", async () => {
      routeParams.channel = "facebook"
      currentSearch = new URLSearchParams("stage=connect&mode=existing&connected=facebook&pages=1&ig=0")
      // A fetch that never settles: exactly the first paint after Meta redirects back.
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
      await act(async () => {
        root.render(createElement(ChannelConnectPage))
      })
      expect(tone()).toBe("pending")
      expect(container.textContent).not.toContain("Channel connected")
    })

    it("does not turn a failed channel-list read into a verdict either way", async () => {
      routeParams.channel = "facebook"
      currentSearch = new URLSearchParams("stage=connect&mode=existing&connected=facebook&pages=1&ig=0")
      stubApi([], { ok: false, status: 500 })
      await act(async () => {
        root.render(createElement(ChannelConnectPage))
      })
      await flushMicrotasks()
      expect(tone()).toBe("pending")
      expect(container.textContent).not.toContain("Channel connected")
      expect(bannerReason()).toContain("could not read")
    })
  })
})
