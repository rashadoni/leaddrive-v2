// @vitest-environment jsdom

import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the channel connect screen puts in front of the operator.
 *
 * The owner's complaint on 2026-11-09 was not a bug report, it was the screen: the same connection
 * was explained four times in a row — a help strip, a three-card map, a numbered "what this guide
 * covers" list, two standalone provider/LeadDrive lists, plus a Meta card repeating all of it — and
 * the only thing he actually had to do (choose a scenario and press a button) sat three screens
 * down. The page was 3499px tall at 1470x835.
 *
 * So the properties guarded here are the ones he asked for, not the markup that happens to satisfy
 * them today:
 *
 *   1. The action comes first. The scenario choice and the primary button precede the explanation
 *      in document order, so they are what the viewport shows.
 *   2. The explanation exists once and starts folded. Any step of the connection is printed on
 *      exactly one line of the screen — the old page printed `providerActions` three times and
 *      `leadDriveActions` three times, which is what made it unreadable.
 *   3. No block scrolls inside the page (owner's standing rule: an inner scrollbar is a bug).
 *
 * The duplicate check is deliberately a sweep over the rendered text rather than a list of known
 * strings: a fifth copy of the same explanation would be added as new markup, not as a repeat of a
 * string this test already names.
 */

const routeParams = { channel: "whatsapp" }
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

vi.mock("@/components/channels/tiktok-channel-hub", () => ({ TikTokChannelHub: () => null }))

vi.mock("@/components/channel-config-form", () => ({
  ChannelConfigForm: () => createElement("div", { "data-testid": "credential-form" }, "credential form"),
}))

import ChannelConnectPage from "@/app/(dashboard)/settings/channels/connect/[channel]/page"

/** Every channel whose guide takes a different shape: Meta, bot, bridge, external-settings, voice. */
const CHANNELS = ["whatsapp", "facebook", "instagram", "telegram", "tiktok", "website-chat", "twilio-calls"]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  currentSearch = new URLSearchParams()
  routeParams.channel = "whatsapp"
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

async function render(channel: string, search = "") {
  routeParams.channel = channel
  currentSearch = new URLSearchParams(search)
  await act(async () => { root.render(createElement(ChannelConnectPage)) })
}

/** Text that is its own line on screen: a leaf element carrying a sentence of its own. */
function screenLines(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll("p, li, h1, h2, h3, h4, span, dd"))
    .filter((element) => element.children.length === 0)
    .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 15)
}

describe("channel connect screen", () => {
  it.each(CHANNELS)("puts the choice and the button above the explanation (%s)", async (channel) => {
    await render(channel)

    const details = container.querySelector("details")
    expect(details, "the explanation is one foldable block").not.toBeNull()
    // `open` absent means folded: the operator sees the action, not the essay.
    expect(details?.hasAttribute("open")).toBe(false)

    const scenarioButtons = Array.from(container.querySelectorAll("button[aria-pressed]"))
    expect(scenarioButtons.length).toBeGreaterThanOrEqual(2)

    for (const control of scenarioButtons) {
      expect(
        control.compareDocumentPosition(details as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${channel}: the scenario choice must come before the explanation`,
      ).toBeTruthy()
    }
  })

  it.each(CHANNELS)("explains each step on exactly one line (%s)", async (channel) => {
    await render(channel)

    const seen = new Map<string, number>()
    for (const line of screenLines(container)) {
      seen.set(line, (seen.get(line) || 0) + 1)
    }
    const repeated = [...seen.entries()].filter(([, count]) => count > 1).map(([line]) => line)

    expect(repeated, `${channel}: these sentences are printed more than once`).toEqual([])
  })

  it("keeps the readiness question free of a second copy of itself", async () => {
    await render("whatsapp", "stage=eligibility")

    const seen = new Map<string, number>()
    for (const line of screenLines(container)) {
      seen.set(line, (seen.get(line) || 0) + 1)
    }
    expect([...seen.entries()].filter(([, count]) => count > 1).map(([line]) => line)).toEqual([])
  })

  it("does not print the channel hint twice around the credential form", async () => {
    await render("whatsapp", "stage=connect")

    expect(container.querySelector("[data-testid='credential-form']")).not.toBeNull()
    const seen = new Map<string, number>()
    for (const line of screenLines(container)) {
      seen.set(line, (seen.get(line) || 0) + 1)
    }
    expect([...seen.entries()].filter(([, count]) => count > 1).map(([line]) => line)).toEqual([])
  })

  it.each(CHANNELS)("gives no block a scrollbar of its own (%s)", async (channel) => {
    await render(channel)

    const scrollers = Array.from(container.querySelectorAll("*")).filter((element) => {
      const className = element.getAttribute("class") || ""
      return /(^|[\s:])overflow-(y-)?(auto|scroll)/.test(className)
    })
    expect(scrollers.map((element) => element.tagName.toLowerCase()), `${channel}: inner scroll`).toEqual([])
  })
})
