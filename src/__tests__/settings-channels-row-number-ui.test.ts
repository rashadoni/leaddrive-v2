// @vitest-environment jsdom

/**
 * Which number a connected channel row is.
 *
 * Three live WhatsApp channels in one workspace on 2026-11-10, and «Ayır» next to each: two rows said
 * only «WhatsApp Business Platform (API)» and the third added `984538588084578`, Meta's internal id
 * sitting in the deprecated `phoneNumber` column. Nothing on the screen said which number was which,
 * and disconnecting the wrong one is one click (owner: «тут не виден какой номер на каком ватсап
 * канале»).
 */

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
 * What each tile does is the contract checked here: WhatsApp asks from the tile itself which of
 * Meta's two paths to take and then opens its dialog (or opens its form when the server has no
 * Embedded Signup); Facebook and Instagram are
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
  phoneNumber?: string | null
}

async function flushMicrotasks(rounds = 16): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve()
    }
  })
}

describe("Connected channel rows — which number is this", () => {
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

  async function render(channels: ApiChannel[]) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes("/api/v1/channels/whatsapp/embedded-signup")
        ? { configured: true, appId: "2414060595720618", configId: "1142677331680804" }
        : url.includes("/api/v1/settings/telegram-bot")
          ? { success: true, data: { connected: false, botUsername: null, linkedUsers: 0 } }
          : { success: true, data: channels }
      return { ok: true, status: 200, json: async () => body }
    }))
    await act(async () => {
      root.render(createElement(ChannelsPage))
    })
    await flushMicrotasks(24)
  }

  /** The grey line under the channel's name. */
  const subtitle = (id: string) =>
    container.querySelector<HTMLElement>(`[data-testid="channel-row-${id}"] .text-muted-foreground`)?.textContent ?? ""

  const wa = (id: string, configName: string, extra: Partial<ApiChannel>): ApiChannel =>
    ({ id, channelType: "whatsapp", configName, isActive: true, hasAccessToken: true, ...extra })

  it("names the number Meta shows for it, so two WhatsApp rows can be told apart", async () => {
    await render([
      wa("wa-line", "Lead Drive", { settings: { embeddedSignup: true, displayPhoneNumber: "+994 51 206 08 38" } }),
      wa("wa-demo", "LeadDrive WhatsApp Business", { settings: { embeddedSignup: true, displayPhoneNumber: "+994 10 531 30 65" } }),
    ])

    expect(subtitle("wa-line")).toContain("+994 51 206 08 38")
    expect(subtitle("wa-demo")).toContain("+994 10 531 30 65")
  })

  it("says an id is an id instead of printing fifteen digits that read like a number", async () => {
    // What the owner saw on 2026-11-10: `984538588084578` under the name, which is Meta's
    // phone_number_id in the deprecated `phoneNumber` column — not a number anyone can dial or match.
    await render([wa("wa-old", "Fanum Sec", { phoneNumber: "984538588084578", settings: {} })])

    expect(subtitle("wa-old")).toContain("Meta ID 984538588084578")
  })

  it("prefers the number over the id when the row carries both", async () => {
    await render([wa("wa-both", "Lead Drive", {
      phoneNumber: "984538588084578",
      settings: { displayPhoneNumber: "+994 10 531 30 65" },
    })])

    const line = subtitle("wa-both")
    expect(line).toContain("+994 10 531 30 65")
    expect(line).not.toContain("984538588084578")
  })

  it("leaves a row with no number as it was, and does not call it an id", async () => {
    await render([wa("wa-bare", "Lead Drive", { settings: {} })])

    const line = subtitle("wa-bare")
    expect(line).toContain("WhatsApp Business Platform (API)")
    expect(line).not.toContain("Meta ID")
  })

  it("does not touch a channel whose number column really is a number", async () => {
    // SMS and VoIP keep a dialable number there; labelling it an id would be a lie.
    await render([
      { id: "sms-1", channelType: "sms", configName: "Test SMS", isActive: true, phoneNumber: "+13509005853",
        settings: { smsProvider: "twilio" } },
    ])

    const line = subtitle("sms-1")
    expect(line).toContain("+13509005853")
    expect(line).not.toContain("Meta ID")
  })
})
