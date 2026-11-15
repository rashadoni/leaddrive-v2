// @vitest-environment jsdom
/**
 * One customer, one feed on the inbox screen (owner, 2026-11-15, approved mock-up «Bütün kanallar bir
 * lentdə»). The real inbox page on real React with the Azerbaijani copy and the network stubbed:
 *  - the channel chips over his feed (dense inbox, #1649) count his whole history and narrow it;
 *  - opening him reads his own history, older than the list;
 *  - a reply goes through the conversation of the chosen channel, by default where he wrote last;
 *  - assign and close reach every channel of his, and the farewell goes once;
 *  - an Instagram conversation tied to nobody offers «Bu eyni müştəridir» for the one customer its
 *    number belongs to.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
const copy = az.inboxV2 as Record<string, string>

const stable = vi.hoisted(() => ({
  session: { data: { user: { id: "u-me", role: "admin" } }, status: "authenticated" },
  router: { push: vi.fn(), replace: () => {}, refresh: () => {}, prefetch: () => {} },
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

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const msg = (id: string, conversationId: string, channelType: string, direction: "inbound" | "outbound", body: string, h: number) => ({
  id, conversationId, channelType, direction, body, createdAt: hoursAgo(h), status: direction === "inbound" ? "received" : "sent",
  from: direction === "inbound" ? "customer" : "shop", to: direction === "inbound" ? "shop" : "customer", channelConfigId: `cfg-${channelType}`,
})

/** Anar: Instagram (linked by a manager) and WhatsApp, newest first like the list. */
const anar = {
  threadKey: "contact_c-anar",
  contactId: "c-anar",
  contactName: "Anar Məmmədov",
  contactPhone: "+994501112233",
  contactEmail: null,
  channels: ["instagram", "whatsapp"],
  lastChannel: "whatsapp",
  lastMessageAt: hoursAgo(1),
  messageCount: 4,
  unreadCount: 0,
  status: "open",
  participants: [],
  socialConversationId: "conv-wa",
  messages: [
    msg("m-wa-2", "conv-wa", "whatsapp", "outbound", "95 ₼, endirim bitib", 1),
    msg("m-ig-2", "conv-ig", "instagram", "inbound", "Sabah gələrəm 😊", 2),
    msg("m-wa-1", "conv-wa", "whatsapp", "inbound", "Salam, çəkmə 42 hələ var?", 30),
    msg("m-ig-1", "conv-ig", "instagram", "inbound", "Bu çəkmənin 42-si var?", 50),
  ],
  threadConversations: [
    { key: "conv-wa|whatsapp", id: "conv-wa", platform: "whatsapp", channelConfigId: "cfg-whatsapp", lastMessageAt: hoursAgo(1), lastInboundAt: hoursAgo(30), messageCount: 2, unreadCount: 0, status: "open", contactLinked: false },
    { key: "conv-ig|instagram", id: "conv-ig", platform: "instagram", channelConfigId: "cfg-instagram", lastMessageAt: hoursAgo(2), lastInboundAt: hoursAgo(2), messageCount: 2, unreadCount: 0, status: "open", customerHandle: "anar.mm", contactLinked: true },
  ],
}

/** Rəna writes on Instagram and is tied to nobody yet; her number belongs to one customer. */
const rena = {
  threadKey: "addr_ig-rena",
  contactId: null,
  contactName: "rena.h",
  contactPhone: null,
  contactEmail: null,
  channels: ["instagram"],
  lastChannel: "instagram",
  lastMessageAt: hoursAgo(3),
  messageCount: 1,
  unreadCount: 0,
  status: "open",
  participants: [],
  socialConversationId: "conv-rena",
  messages: [msg("m-rena", "conv-rena", "instagram", "inbound", "Nömrəm 055 123 45 67", 3)],
  threadConversations: [
    { key: "conv-rena|instagram", id: "conv-rena", platform: "instagram", channelConfigId: "cfg-instagram", lastMessageAt: hoursAgo(3), lastInboundAt: hoursAgo(3), messageCount: 1, unreadCount: 0, status: "open", customerHandle: "rena.h", contactLinked: false },
  ],
}

let container: HTMLDivElement
let root: Root
let requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  requests = []
  // A wide conversation column (1920 px): every header action stands in the header (thread-header-layout).
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("data-testid") !== "inbox-thread-header") return original.call(this)
    return { width: 1052, height: 56, top: 0, left: 0, right: 1052, bottom: 56, x: 0, y: 0, toJSON() {} } as DOMRect
  })
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  window.history.replaceState(null, "", "/inbox?conversation=conv-ig")
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method !== "GET") requests.push({ url, method, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null })
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      if (method !== "GET") return json({ id: "sent-1" })
      return json({ conversations: [anar, rena], channels: [], stats: { totalMessages: 5, inbound: 4, outbound: 1, conversations: 2 } })
    }
    if (url.startsWith("/api/v1/inbox/thread?contactId=c-anar")) {
      // His history is older than the list: a question from last month.
      return json({
        messages: [...anar.messages, msg("m-ig-old", "conv-ig", "instagram", "inbound", "Köhnə sual: qara rəng var?", 700)],
        callLogs: [{ id: "call-1", direction: "inbound", fromNumber: "+994501112233", toNumber: "+994121234567", status: "completed", duration: 72, provider: "voip", createdAt: hoursAgo(20) }],
        conversationIds: ["conv-wa", "conv-ig"],
      })
    }
    if (url.startsWith("/api/v1/inbox/thread?")) return json({ messages: [], callLogs: [], conversationIds: [] })
    if (url === "/api/v1/inbox/conversations/conv-rena/contact-link" && method === "GET") {
      return json({ platform: "instagram", linkable: true, contact: null, suggestions: [
        { id: "c-rena", fullName: "Rəna Hüseynova", phone: "+994551234567", email: null, matchedBy: "phone", matchedValue: "994551234567" },
      ] })
    }
    if (url.endsWith("/contact-link")) return json({ contact: null })
    if (url.startsWith("/api/v1/inbox/conversations/bulk")) return json({ results: [], summary: { requested: 2, updated: 2, sendFailed: 0, deliveryUnknown: 0 } })
    if (url.startsWith("/api/v1/users/assignable")) return json([{ id: "u-gunel", name: "Günel" }])
    if (url.endsWith("/convert-to-lead")) return json({ candidates: [], recommendedAssigneeId: null, draft: null })
    if (url.endsWith("/learning")) return json(null) // no AI training on these channels
    return json([])
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() })
}
async function renderInbox() {
  await act(async () => { root.render(createElement(InboxV2Page)) })
  await flush()
}
async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
  await flush()
}
async function fill(text: string) {
  const box = container.querySelector<HTMLTextAreaElement>('[data-testid="inbox-reply-box"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(box, text)
    box.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush()
}
async function choose(select: HTMLSelectElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await flush()
}

const words = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
/** The channel chips over the thread (dense inbox, #1649), keyed by their channel. */
const chips = () => [...container.querySelectorAll<HTMLButtonElement>("[data-thread-channel]")]
const chip = (channel: string) => container.querySelector<HTMLButtonElement>(`[data-thread-channel="${channel}"]`)
/** A chip as it reads: its channel and the count it shows. */
const chipCount = (b: Element) => [b.getAttribute("data-thread-channel"), b.querySelector("span.tabular-nums")?.textContent ?? null]
const feed = () => words(container.querySelector(".overflow-y-auto.p-4"))
const replyTarget = () => container.querySelector<HTMLSelectElement>('[data-testid="inbox-reply-target"]')!
const sent = () => requests.filter((r) => r.url === "/api/v1/inbox" && r.method === "POST").map((r) => r.body)

describe("one customer, one feed on the inbox screen", () => {
  it("shows his channels above the feed and his history from before the list", async () => {
    await renderInbox()
    // Counted over his whole history, not only the list's messages: Instagram 3 with last month's question.
    expect(chips().map(chipCount)).toEqual([["instagram", "3"], ["whatsapp", "2"], ["voip", "1"], ["all", null]])
    expect(words(chip("all"))).toBe("Bütün kanallar bir lentdə")
    expect(chip("all")!.getAttribute("aria-pressed")).toBe("true")
    expect(feed()).toContain("Köhnə sual: qara rəng var?")
    expect(feed()).toContain("Salam, çəkmə 42 hələ var?")

    await press(chip("whatsapp")!)
    expect(feed()).toContain("Salam, çəkmə 42 hələ var?")
    expect(feed()).not.toContain("Bu çəkmənin 42-si var?")
    await press(chip("instagram")!)
    expect(feed()).toContain("Bu çəkmənin 42-si var?")
    expect(feed()).not.toContain("Salam, çəkmə 42 hələ var?")
  })

  it("answers where he wrote last, and through the chosen channel's conversation", async () => {
    await renderInbox()
    // He wrote last on Instagram (we answered on WhatsApp after that): the reply goes to Instagram.
    expect([...replyTarget().options].map((o) => o.textContent)).toEqual(["WhatsApp", "Instagram"])
    expect(replyTarget().value).toBe("conv-ig|instagram")
    await fill("Anar bəy, 42 ölçü saxlanılıb")
    await press(container.querySelector('[data-testid="inbox-send"]')!)
    expect(sent().at(-1)).toMatchObject({ channel: "instagram", conversationId: "conv-ig", contactId: "c-anar" })

    await choose(replyTarget(), "conv-wa|whatsapp")
    await fill("WhatsApp-dan da yazıram")
    await press(container.querySelector('[data-testid="inbox-send"]')!)
    expect(sent().at(-1)).toMatchObject({ channel: "whatsapp", conversationId: "conv-wa" })
  })

  it("assigns every channel of his", async () => {
    await renderInbox()
    const assign = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="inbox-thread-actions"] button')]
      .find((b) => b.getAttribute("title") === copy.assign)!
    await press(assign)
    await press([...container.querySelectorAll("button")].find((b) => words(b) === "Günel")!)
    const patched = requests.filter((r) => r.method === "PATCH" && r.url.startsWith("/api/v1/inbox/conversations/"))
    expect(patched.map((r) => r.url).sort()).toEqual(["/api/v1/inbox/conversations/conv-ig", "/api/v1/inbox/conversations/conv-wa"])
    expect(patched.every((r) => r.body?.assignedTo === "u-gunel")).toBe(true)
  })

  it("closes all his channels with the farewell for the one being answered", async () => {
    await renderInbox()
    const close = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="inbox-thread-actions"] button')]
      .find((b) => b.getAttribute("aria-label") === copy.closeConv)!
    await press(close)
    const dialogButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => words(b) === label)!
    await press(dialogButton("Satıldı"))
    const farewell = document.querySelector<HTMLTextAreaElement>("#bulk-close-message")!
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    await act(async () => {
      setValue.call(farewell, "Təşəkkür edirik, Anar bəy!")
      farewell.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await flush()
    await press(dialogButton(copy.bulkClose))
    const bulk = requests.find((r) => r.url === "/api/v1/inbox/conversations/bulk")!
    // The farewell goes once, to Instagram — where he wrote last and where the reply box points.
    expect(bulk.body).toMatchObject({ action: "close", message: "Təşəkkür edirik, Anar bəy!", farewellIds: ["conv-ig"] })
    expect([...(bulk.body!.ids as string[])].sort()).toEqual(["conv-ig", "conv-wa"])
  })

  it("offers «Bu eyni müştəridir» for an Instagram conversation tied to nobody", async () => {
    window.history.replaceState(null, "", "/inbox?conversation=conv-rena")
    await renderInbox()
    expect(feed()).toContain("Nömrəm 055 123 45 67")
    expect(words(container)).toContain("Instagram · rena.h hələ müştəriyə bağlanmayıb.")
    expect(words(container)).toContain("Yazışmada +994 55 123 45 67 var. CRM-də: Rəna Hüseynova. Eyni müştəridir?")
    await press([...container.querySelectorAll("button")].find((b) => words(b) === "Bəli, eyni müştəridir")!)
    const link = requests.find((r) => r.url === "/api/v1/inbox/conversations/conv-rena/contact-link")!
    expect(link).toMatchObject({ method: "POST", body: { contactId: "c-rena", via: "suggestion" } })
  })
})
