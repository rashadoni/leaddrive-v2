// @vitest-environment jsdom
/**
 * The reply box of the inbox grows with its text (owner, 2026-11-15, with a
 * screenshot of a long Azerbaijani reply cut to one line: «это окно маленькое,
 * когда вставлю большой текст, не могу его увидеть полностью»).
 *
 * The real inbox page on real React with the network stubbed: a long text with
 * line breaks stays whole in the box, the box takes the height of its text and
 * is one line again once the reply is sent; Enter sends the whole text and adds
 * no line, Shift+Enter adds a line and sends nothing. jsdom lays nothing out,
 * so the box's own scrollHeight is given per test — the page's sizing rule is
 * what is checked, not the browser's line breaking.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages

// The same session, router and translator on every render, as the app hands
// them: a fresh object per render re-fires the page's effects keyed on them.
const stable = vi.hoisted(() => ({
  session: { data: { user: { id: "u-me", role: "admin" } }, status: "authenticated" },
  router: { push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} },
}))
vi.mock("next-auth/react", () => ({ useSession: () => stable.session }))
vi.mock("next/navigation", () => ({
  useRouter: () => stable.router,
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const translate = (namespace: string) => actual.createTranslator({
    locale: "az", messages: az as never, namespace: (namespace || undefined) as never, onError: () => {},
  })
  const translators = new Map<string, ReturnType<typeof translate>>()
  return {
    useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) translators.set(namespace, translate(namespace))
      return translators.get(namespace)!
    },
    useLocale: () => "az",
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import InboxV2Page from "@/app/(dashboard)/inbox/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const now = new Date().toISOString()
const conversation = (id: string, name: string, body: string) => ({
  socialConversationId: id,
  contactId: null,
  contactName: name,
  channels: ["instagram"],
  lastChannel: "instagram",
  lastMessageAt: now,
  messageCount: 1,
  unreadCount: 0,
  status: "open",
  participants: [],
  messages: [{ id: `${id}-m1`, direction: "inbound", channelType: "instagram", from: name, to: "fanumsec", body, status: "received", createdAt: now }],
})
const CONVERSATIONS = [
  conversation("sc-mirvari", "@mirvari.decor", "Nişan dekoru neçəyədir?"),
  conversation("sc-parviz", "@parviz.aliyev", "Gerek ele Parviz qoyadim adini"),
]

let container: HTMLDivElement
let root: Root
let posts: { url: string; body: Record<string, unknown> }[]

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  // The thread opens the way a link from analytics opens it.
  window.history.replaceState(null, "", "/inbox?conversation=sc-mirvari")
  posts = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST" && url === "/api/v1/inbox") {
      posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return json({ id: "sent-1" })
    }
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({ conversations: CONVERSATIONS, channels: [], stats: { totalMessages: 2, inbound: 2, outbound: 0, conversations: 2 } })
    }
    if (url.endsWith("/convert-to-lead")) return json({ candidates: [], recommendedAssigneeId: null, draft: null })
    return json([])
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
}

async function renderInbox() {
  await act(async () => { root.render(createElement(InboxV2Page)) })
  await flush()
}

const box = () => container.querySelector<HTMLTextAreaElement>('[data-testid="inbox-reply-box"]')!

/** Types or pastes `text` into the box the way the browser reports it to React. */
async function fill(text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(box(), text)
    box().dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush()
}

async function key(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  await act(async () => { box().dispatchEvent(event) })
  await flush()
  return event
}

/** What a browser would measure: 20 px a line plus 8 px padding top and bottom, and a 1 px border. */
function measureLikeABrowser(element: HTMLTextAreaElement) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => 16 + 20 * element.value.split("\n").length })
  Object.defineProperty(element, "offsetHeight", { configurable: true, get: () => 38 })
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => 36 })
}

const LONG_REPLY = [
  "Salam! Bizim CRM-də bütün kanallar bir ekrandadır: Instagram, WhatsApp, Facebook və e-poçt.",
  "Mesajların yönləndirilməsi də içindədir. Müştəri sadəcə qiyməti soruşur, AI agent cavab verir.",
  "Qiymət sizin siyahınızdan götürülür, özündən endirim uydurmur.",
  "Sabah saat 11-də görüşə bilərik?",
].join("\n")

describe("inbox reply box — grows with a long text", () => {
  it("keeps a long text with its line breaks whole, in a box of several lines", async () => {
    await renderInbox()
    expect(box().tagName, "a box that holds lines, not a one-line input").toBe("TEXTAREA")
    await fill(LONG_REPLY)
    expect(box().value).toBe(LONG_REPLY)
  })

  it("takes the height of its text and is one line again after the reply is sent", async () => {
    await renderInbox()
    measureLikeABrowser(box())
    await fill("Salam")
    expect(box().style.height, "one line").toBe("38px")
    await fill(LONG_REPLY)
    expect(box().style.height, "four lines").toBe("98px")

    await key({ key: "Enter" })
    expect(posts).toHaveLength(1)
    expect(box().value, "sent and emptied").toBe("")
    expect(box().style.height, "back to one line").toBe("38px")
  })

  it("sends the whole text on Enter without adding a line; Shift+Enter adds a line and sends nothing", async () => {
    await renderInbox()
    await fill(LONG_REPLY)

    const newLine = await key({ key: "Enter", shiftKey: true })
    expect(newLine.defaultPrevented, "the browser adds the line").toBe(false)
    expect(posts).toHaveLength(0)

    const send = await key({ key: "Enter" })
    expect(send.defaultPrevented, "no line is added to a text being sent").toBe(true)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.body, "the whole text, line breaks included").toBe(LONG_REPLY)
    expect(posts[0].body.conversationId).toBe("sc-mirvari")
  })
})
