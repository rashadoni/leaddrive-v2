// @vitest-environment jsdom
/**
 * The inbox customer panel as the owner-approved mock-up draws it (2026-11-15) — the real inbox
 * page on real React, with the Azerbaijani copy the owner reads and the network stubbed:
 *
 *  - the eight «Sürətli əməllər», each in words, a disabled one saying why;
 *  - «AI rejimi» switches this one conversation off and says who did it;
 *  - «Müştəri yolu» shows the customer's other channels and a call, and no amounts;
 *  - the open deal with the organization's own stage names, without the lost stage;
 *  - «Xatırlat» makes a task about this customer that will ring at the chosen time.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { readHint } from "./helpers/hint"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
const copy = az.inboxV2 as Record<string, string>
const panelCopy = az.inboxPanel as Record<string, string>

const stable = vi.hoisted(() => ({
  session: { data: { user: { id: "u-me", role: "admin", organizationId: "org-1", name: "Günel" } }, status: "authenticated" },
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

const now = new Date()
const iso = (offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString()
const conversation = (id: string, name: string, contactId: string | null, body: string) => ({
  socialConversationId: id,
  contactId,
  contactName: name,
  contactPhone: contactId ? "+994503112400" : null,
  channels: ["instagram"],
  lastChannel: "instagram",
  lastMessageAt: iso(0),
  messageCount: 1,
  unreadCount: 0,
  status: "open",
  participants: [],
  messages: [{ id: `${id}-m1`, direction: "inbound", channelType: "instagram", from: name, to: "dukan", body, status: "received", createdAt: iso(-5) }],
})
const CONVERSATIONS = [
  {
    ...conversation("sc-anar", "Anar Məmmədov", "ct-anar", "Sabah gələrəm 😊"),
    // One customer, one feed (#1650): his Instagram and his WhatsApp are one thread.
    threadKey: "contact:ct-anar",
    threadConversations: [
      { key: "sc-anar:instagram", id: "sc-anar", platform: "instagram", channelConfigId: null, lastMessageAt: iso(0), lastInboundAt: iso(-5), messageCount: 1, unreadCount: 0 },
      { key: "sc-anar-wa:whatsapp", id: "sc-anar-wa", platform: "whatsapp", channelConfigId: null, lastMessageAt: iso(-1490), lastInboundAt: iso(-1500), messageCount: 3, unreadCount: 0 },
    ],
  },
  conversation("sc-guest", "@qonaq", null, "Salam"),
]

const journey = {
  total: 3,
  beyondCurrent: true,
  steps: [
    { kind: "chat", key: "chat:a", conversationId: "sc-anar", channel: "instagram", startedAt: iso(-3000), at: iso(-2990), messages: 2, quote: "Salam! Var, 89 ₼ 😊", media: null, author: "operator", authorName: "Günel", current: true },
    { kind: "chat", key: "chat:b", conversationId: "sc-anar-wa", channel: "whatsapp", startedAt: iso(-1500), at: iso(-1490), messages: 3, quote: "95 ₼, endirim bitib", media: null, author: "operator", authorName: "Tural", current: false },
    { kind: "call", key: "call:c", conversationId: null, channel: "voip", at: iso(-60), direction: "inbound", status: "completed", durationSec: 72, current: false },
  ],
}

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let autoReplyOff = false
let container: HTMLDivElement
let root: Root

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
  calls = []
  autoReplyOff = false
  Element.prototype.scrollIntoView = () => {}
  // The inbox listens to its live stream once it knows the organization; jsdom has none.
  vi.stubGlobal("EventSource", class {
    addEventListener() {}
    close() {}
  })
  window.history.replaceState(null, "", "/inbox?conversation=sc-anar")
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
    calls.push({ url, method, body })
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({ conversations: CONVERSATIONS, channels: [], stats: { totalMessages: 2, inbound: 2, outbound: 0, conversations: 2 } })
    }
    if (url.endsWith("/auto-reply") && method === "PUT") {
      autoReplyOff = !(body as { on: boolean }).on
      return json({ off: autoReplyOff, offAt: autoReplyOff ? iso(0) : null, offBy: "u-me" })
    }
    if (url.endsWith("/panel")) {
      return json({
        since: iso(-3 * 24 * 60),
        channels: ["instagram", "whatsapp", "voip"],
        language: "az",
        journey,
        autoReply: { off: autoReplyOff, offAt: autoReplyOff ? iso(0) : null, offByName: autoReplyOff ? "Günel" : null, channelAi: true },
      })
    }
    if (url.startsWith("/api/v1/deals?")) {
      return json({ deals: [{ id: "d1", name: "Dəri çəkmə, qara", stage: "PROPOSAL", pipelineId: "p1", valueAmount: 89, currency: "AZN" }], total: 1 })
    }
    if (url === "/api/v1/pipelines/p1") {
      return json({ id: "p1", name: "Satış", stages: [
        { name: "LEAD", displayName: "Yeni" },
        { name: "PROPOSAL", displayName: "Təklif" },
        { name: "PAYMENT", displayName: "Ödəniş" },
        { name: "DELIVERED", displayName: "Təhvil", isWon: true },
        { name: "LOST", displayName: "Uduzdu", isLost: true },
      ] })
    }
    if (url.startsWith("/api/v1/tasks") && method === "POST") return json({ id: "t-new" }, 201)
    if (url.startsWith("/api/v1/tasks?")) {
      return json({ tasks: [{ id: "t1", title: "Anar bəy mağazaya gəlir — çəkmə hazır olsun", dueDate: iso(24 * 60), remindAt: iso(24 * 60), status: "pending" }], total: 1 })
    }
    if (url.startsWith("/api/v1/bookings/context")) return json({ timezone: "Asia/Baku", hosts: [], pages: [] })
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
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() })
}

async function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(InboxV2Page))) })
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

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush()
}

const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-contact-panel-toggle"]')
const panel = () => container.querySelector<HTMLElement>('[data-testid="inbox-contact-panel"]')
const inPanel = (testId: string) => panel()?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null

async function openCard() {
  await renderInbox()
  await press(toggle()!)
  expect(panel(), "the avatar opens the card").not.toBeNull()
}

describe("inbox customer panel", () => {
  it("lays out the eight quick actions in words", async () => {
    await openCard()
    const tiles = inPanel("inbox-panel-quick-actions")!
    for (const key of ["actCall", "actAssign", "actTag", "actNote", "actMeeting", "actDeal", "actTemplate", "actAi"]) {
      expect(tiles.textContent, key).toContain(panelCopy[key])
    }
    expect(inPanel("inbox-panel-customer")!.textContent).toContain("Anar Məmmədov")
    expect(inPanel("inbox-panel-customer")!.textContent).toContain("+994503112400")
  })

  it("switches the AI off for this customer's correspondence on all his channels, and says who did it", async () => {
    await openCard()
    const ai = () => inPanel("inbox-panel-action-ai")!
    expect(ai().getAttribute("aria-pressed")).toBe("true")
    expect(ai().textContent).toContain(panelCopy.aiStateOn)

    await press(ai())
    const puts = calls.filter((call) => call.method === "PUT").sort((a, b) => a.url.localeCompare(b.url))
    expect(puts).toEqual([
      { url: "/api/v1/inbox/conversations/sc-anar-wa/auto-reply", method: "PUT", body: { on: false } },
      { url: "/api/v1/inbox/conversations/sc-anar/auto-reply", method: "PUT", body: { on: false } },
    ])
    expect(ai().getAttribute("aria-pressed")).toBe("false")
    expect(ai().textContent).toContain(panelCopy.aiStateOff)
    expect(await readHint(ai())).toContain("Günel")
  })

  it("shows the customer's path across channels with a call, and no amount column", async () => {
    await openCard()
    const card = inPanel("inbox-panel-journey")!
    expect(card.textContent).toContain(panelCopy.journeyTitle)
    const steps = card.querySelectorAll('[data-testid="inbox-panel-journey-step"]')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toContain("Instagram")
    expect(steps[0].textContent).toContain("«Salam! Var, 89 ₼ 😊» — Günel")
    expect(steps[1].textContent).toContain("WhatsApp")
    expect(steps[2].textContent).toContain(`${panelCopy.journeyCall}`)
    expect(steps[2].textContent).toContain("1:12")
    // The words are quoted as written; no figure is pulled out of them into a column of its own.
    expect([...steps].map((step) => step.lastElementChild?.textContent ?? "")).not.toContain("89 ₼")
  })

  it("shows the open deal with the organization's own stage names, without the lost stage", async () => {
    await openCard()
    const card = inPanel("inbox-panel-deal")!
    expect(calls.some((call) => call.url === "/api/v1/deals?contactId=ct-anar&open=1&limit=5")).toBe(true)
    expect(card.textContent).toContain("Dəri çəkmə, qara")
    for (const stage of ["Yeni", "Təklif", "Ödəniş", "Təhvil"]) expect(card.textContent).toContain(stage)
    expect(card.textContent).not.toContain("Uduzdu")
    expect(card.textContent).toMatch(/89\s*₼/)
  })

  it("sets a reminder about this customer that rings at the chosen time", async () => {
    await openCard()
    const card = inPanel("inbox-panel-reminder")!
    expect(card.textContent).toContain("Anar bəy mağazaya gəlir — çəkmə hazır olsun")
    await press(inPanel("inbox-panel-reminder-add")!)
    const form = inPanel("inbox-panel-reminder-form")!
    const [text, when] = [...form.querySelectorAll<HTMLInputElement>("input")]
    await type(text, "Ölçünü yoxla")
    await type(when, "2026-11-16T11:00")
    await press([...form.querySelectorAll("button")].find((button) => button.textContent?.includes(panelCopy.reminderSave))!)

    const post = calls.find((call) => call.method === "POST" && call.url === "/api/v1/tasks")
    expect(post?.body).toMatchObject({
      title: "Ölçünü yoxla",
      relatedType: "contact",
      relatedId: "ct-anar",
      assignedTo: "u-me",
      remindAt: new Date("2026-11-16T11:00").toISOString(),
      dueDate: new Date("2026-11-16T11:00").toISOString(),
    })
  })

  it("opens the meeting form for this customer, and says so when there is no service to book", async () => {
    await openCard()
    await press(inPanel("inbox-panel-action-meeting")!)
    const dialog = document.querySelector<HTMLElement>('[data-testid="inbox-panel-meeting-dialog"]')
    expect(dialog).not.toBeNull()
    expect(document.body.textContent).toContain("Anar Məmmədov")
    // The Meetings module's own context arrives through react-query, a few ticks later.
    await vi.waitFor(async () => {
      await flush()
      expect(dialog!.textContent).toContain(panelCopy.meetingNoServices)
    })
    expect(calls.some((call) => call.url.startsWith("/api/v1/bookings/context"))).toBe(true)
  })

  it("keeps the deal tile closed, with the reason, on a conversation with no CRM customer", async () => {
    window.history.replaceState(null, "", "/inbox?conversation=sc-guest")
    await openCard()
    const deal = inPanel("inbox-panel-action-deal")!
    expect((deal as HTMLButtonElement).disabled).toBe(true)
    expect(await readHint(deal.parentElement)).toBe(panelCopy.hintDealNoContact)
    expect(inPanel("inbox-panel-deal")).toBeNull()
    expect(inPanel("inbox-panel-reminder")).toBeNull()
    // The contact panel still opens with the rest of the card.
    expect(panel()!.textContent).toContain(copy.details)
  })
})
