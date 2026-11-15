// @vitest-environment jsdom
/**
 * The dense inbox on the real page (owner, 2026-11-15: the reel's mock-up
 * «очень нравится», «Давай» to the list of what changes): the rail's
 * «AI cavablayır» and «Cavab gözləyir» with their counts, the channels by
 * their own logos and names, «Etiketlər»; the tabs «Açıq / Gözləyir / Bağlı»
 * with the word beside the live dot; a row that says who answers and carries
 * several labels; the thread's channel chips and its «date · channel» lines;
 * and the «Bu gün» card — drawn from the reports' real numbers, and not drawn
 * at all when the reports have nothing.
 *
 * Real React, the Azerbaijani copy the owner reads, the network stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { formatDate } from "@/lib/format-date"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
const copy = az.inboxV2 as Record<string, string>

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

/** 10:00 on the local calendar day `daysAgo` before today. */
const localAt = (daysAgo: number, hour = 10, minute = 0) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute)
}
const iso = (d: Date) => d.toISOString()
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const msg = (id: string, channelType: string, direction: string, body: string, at: Date) => ({
  id, direction, channelType, from: direction === "inbound" ? "customer" : "us", to: "x", body, status: "received", createdAt: iso(at),
})

const anarMessages = [
  msg("a1", "instagram", "inbound", "Salam, bu çəkmənin 42-si var?", localAt(3, 14, 20)),
  msg("a2", "instagram", "outbound", "Salam! Var, 89 ₼", localAt(3, 14, 22)),
  msg("a3", "whatsapp", "inbound", "Salam, çəkmə 42 hələ var?", localAt(2, 11, 5)),
  msg("a4", "whatsapp", "outbound", "95 ₼, endirim bitib", localAt(2, 11, 31)),
]
const CONVERSATIONS = [
  {
    socialConversationId: "sc-anar", contactId: null, contactName: "Anar Məmmədov",
    channels: ["instagram", "whatsapp"], lastChannel: "whatsapp", lastDirection: "outbound",
    lastMessage: "95 ₼, endirim bitib", lastMessageAt: iso(localAt(2, 11, 31)),
    messageCount: 4, unreadCount: 0, status: "open", participants: [],
    assignedTo: "u-gunel", conversationTags: ["VIP"], messages: anarMessages,
  },
  {
    socialConversationId: "sc-rena", contactId: null, contactName: "Rəna Hüseynova",
    channels: ["whatsapp"], lastChannel: "whatsapp", lastDirection: "inbound",
    lastMessage: "Sabah gətirərsiniz?", lastMessageAt: iso(localAt(0, 9)),
    messageCount: 1, unreadCount: 0, status: "open", participants: [], assignedTo: null, botHandled: true,
    conversationTags: ["Çatdırılma"],
    messages: [msg("r1", "whatsapp", "inbound", "Sabah gətirərsiniz?", localAt(0, 9))],
  },
  {
    socialConversationId: "sc-kamran", contactId: null, contactName: "Kamran Əliyev",
    channels: ["telegram"], lastChannel: "telegram", lastDirection: "inbound",
    lastMessage: "Sifariş №214", lastMessageAt: iso(localAt(0, 8)),
    messageCount: 1, unreadCount: 2, status: "open", participants: [], assignedTo: null,
    messages: [msg("k1", "telegram", "inbound", "Sifariş №214", localAt(0, 8))],
  },
]

let analytics: "real" | "empty" = "real"
const requested: string[] = []

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  analytics = "real"
  requested.length = 0
  Element.prototype.scrollIntoView = () => {}
  window.history.replaceState(null, "", "/inbox?conversation=sc-anar")
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input)
    requested.push(url)
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({ conversations: CONVERSATIONS, channels: [], stats: { totalMessages: 6, inbound: 4, outbound: 2, conversations: 3 } })
    }
    if (url.startsWith("/api/v1/users/assignable")) return json([{ id: "u-gunel", name: "Günel Həsənova" }])
    // AI training is not switched on for these channels.
    if (url.endsWith("/learning")) return new Response("{}", { status: 404 })
    if (url.startsWith("/api/v1/inbox/analytics/temporal")) {
      if (analytics === "empty") return json({ heatmap: [], trend: [] })
      if (url.includes("&to=")) return json({ heatmap: [], trend: [{ date: dayKey(localAt(1)), inbound: 20, outbound: 9 }] })
      return json({
        heatmap: [],
        trend: [
          { date: dayKey(localAt(6)), inbound: 12, outbound: 4 },
          { date: dayKey(localAt(1)), inbound: 30, outbound: 11 },
          { date: dayKey(localAt(0)), inbound: 25, outbound: 8 },
        ],
      })
    }
    if (url.startsWith("/api/v1/inbox/analytics/frt")) {
      return json(analytics === "empty" ? { answered: 0, medianMinutes: null } : { answered: 7, medianMinutes: 1 + 40 / 60 })
    }
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

const rail = () => container.querySelector<HTMLElement>('[data-testid="inbox-folder-rail"]')!
const list = () => container.querySelector<HTMLElement>('[data-testid="inbox-conversation-list"]')!
const row = (name: string) => [...list().querySelectorAll<HTMLElement>('[role="button"]')].find((el) => el.textContent?.includes(name))!
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""

describe("dense inbox — folder rail", () => {
  it("lists «AI cavablayır» and «Cavab gözləyir» after «Təyin edilməyib», each with its count", async () => {
    await renderInbox()
    const views = [...rail().querySelectorAll<HTMLElement>("[data-view]")].map((el) => el.dataset.view)
    expect(views.slice(0, 5)).toEqual(["all", "me", "unassigned", "chatbot", "awaiting"])
    const ai = rail().querySelector('[data-view="chatbot"]')
    const awaiting = rail().querySelector('[data-view="awaiting"]')
    expect(text(ai)).toBe(`${copy.view_chatbot}1`)
    expect(copy.view_chatbot).toBe("AI cavablayır")
    // Rəna and Kamran wrote last; Anar was answered.
    expect(text(awaiting)).toBe(`${copy.view_awaiting}2`)
    expect(copy.view_awaiting).toBe("Cavab gözləyir")
  })

  it("shows only the conversations waiting for an answer under «Cavab gözləyir»", async () => {
    await renderInbox()
    await press(rail().querySelector('[data-view="awaiting"]')!)
    const names = [...list().querySelectorAll('[role="button"]')].map((el) => el.textContent ?? "")
    expect(names.some((n) => n.includes("Rəna Hüseynova"))).toBe(true)
    expect(names.some((n) => n.includes("Kamran Əliyev"))).toBe(true)
    expect(names.some((n) => n.includes("Anar Məmmədov"))).toBe(false)
  })

  it("draws each channel with its own logo and its name in Azerbaijani", async () => {
    await renderInbox()
    for (const ch of ["whatsapp", "instagram", "telegram", "facebook", "voip", "email", "web-chat"]) {
      expect(rail().querySelector(`[data-channel-logo="${ch}"]`), ch).not.toBeNull()
    }
    const railText = text(rail())
    for (const name of ["Messenger", "Zənglər", "E-poçt", "Sayt çatı"]) expect(railText).toContain(name)
  })

  it("lists the labels in use under «Etiketlər» with their counts; a press filters the list", async () => {
    await renderInbox()
    const labels = rail().querySelector<HTMLElement>('[data-testid="inbox-rail-labels"]')!
    expect(text(labels)).toBe(`${copy.railLabels}Çatdırılma1VIP1`)
    const vip = [...labels.querySelectorAll("button")].find((b) => b.textContent?.includes("VIP"))!
    await press(vip)
    expect(vip.getAttribute("aria-pressed")).toBe("true")
    const names = [...list().querySelectorAll('[role="button"]')].map((el) => el.textContent ?? "")
    expect(names.length).toBe(1)
    expect(names[0]).toContain("Anar Məmmədov")
  })
})

describe("dense inbox — tabs and rows", () => {
  it("orders the tabs «Açıq / Gözləyir / Bağlı» and says the live state in a word", async () => {
    await renderInbox()
    const tabs = [...list().querySelectorAll<HTMLElement>("[data-status-tab]")]
    expect(tabs.map((t) => t.dataset.statusTab)).toEqual(["opened", "snoozed", "closed"])
    expect(text(tabs[1])).toBe(`${copy.tab_snoozed}0`)
    expect(copy.tab_snoozed).toBe("Gözləyir")
    // jsdom has no EventSource: the inbox polls, and says so.
    expect(text(list().querySelector('[data-testid="inbox-live-status"]'))).toBe(copy.pollingWord)
  })

  it("puts the channel's logo on the customer's avatar", async () => {
    await renderInbox()
    expect(row("Anar Məmmədov").querySelector('[data-testid="inbox-row-channel"] [data-channel-logo]')?.getAttribute("data-channel-logo")).toBe("whatsapp")
    expect(row("Kamran Əliyev").querySelector('[data-testid="inbox-row-channel"] [data-channel-logo]')?.getAttribute("data-channel-logo")).toBe("telegram")
  })

  it("says who answers: the colleague's initials, or the AI; an unread row shows its count instead", async () => {
    await renderInbox()
    const anar = row("Anar Məmmədov").querySelector<HTMLElement>('[data-testid="inbox-row-responder"]')!
    expect(anar.dataset.responder).toBe("agent")
    expect(anar.textContent).toBe("GH")
    expect(anar.getAttribute("aria-label")).toBe("Günel Həsənova cavab verir")
    const rena = row("Rəna Hüseynova").querySelector<HTMLElement>('[data-testid="inbox-row-responder"]')!
    expect(rena.dataset.responder).toBe("ai")
    expect(rena.getAttribute("aria-label")).toBe(copy.responderAi)
    expect(row("Kamran Əliyev").querySelector('[data-testid="inbox-row-responder"]')).toBeNull()
    expect(text(row("Kamran Əliyev"))).toContain("2")
  })

  it("carries several coloured labels on one line", async () => {
    await renderInbox()
    const chips = [...row("Rəna Hüseynova").querySelectorAll<HTMLElement>("[data-row-chip]")].map((c) => [c.dataset.rowChip, text(c)])
    expect(chips).toEqual([
      ["awaiting", "Cavab gözləyir"],
      ["tag:Çatdırılma", "Çatdırılma"],
      ["ai", "AI cavabladı"],
    ])
    // An unread row does not repeat «Cavab gözləyir»: its count says it.
    expect(row("Kamran Əliyev").querySelector('[data-row-chip="awaiting"]')).toBeNull()
  })
})

describe("dense inbox — the thread", () => {
  const channels = () => container.querySelector<HTMLElement>('[data-testid="inbox-thread-channels"]')!
  const separators = () => [...container.querySelectorAll<HTMLElement>('[data-testid="inbox-thread-separator"]')].map(text)
  const day = (daysAgo: number) => formatDate(localAt(daysAgo), "az", { day: "numeric", month: "long" })

  it("has a chip per channel with its count, and «Bütün kanallar bir lentdə»", async () => {
    await renderInbox()
    const chips = [...channels().querySelectorAll<HTMLElement>("[data-thread-channel]")]
    expect(chips.map((c) => [c.dataset.threadChannel, text(c)])).toEqual([
      ["instagram", "Instagram2"],
      ["whatsapp", "WhatsApp2"],
      ["all", copy.threadAllChannels],
    ])
    expect(chips.at(-1)!.getAttribute("aria-pressed")).toBe("true")
  })

  it("draws «date · channel» where the day or the channel changes", async () => {
    await renderInbox()
    expect(separators()).toEqual([`${day(3)}· Instagram`, `${day(2)}· WhatsApp`])
  })

  it("shows one channel's messages after its chip is pressed, and all of them after «Bütün kanallar»", async () => {
    await renderInbox()
    await press(channels().querySelector('[data-thread-channel="whatsapp"]')!)
    const thread = () => text(container.querySelector('[data-testid="inbox-thread-header"]')?.parentElement)
    expect(thread()).toContain("çəkmə 42 hələ var?")
    expect(thread()).not.toContain("bu çəkmənin 42-si var?")
    expect(separators()).toEqual([`${day(2)}· WhatsApp`])

    await press(channels().querySelector('[data-thread-channel="all"]')!)
    expect(thread()).toContain("bu çəkmənin 42-si var?")
    expect(separators()).toHaveLength(2)
  })
})

describe("dense inbox — «Bu gün»", () => {
  const card = () => container.querySelector<HTMLElement>('[data-testid="inbox-today-card"]')

  it("shows today's incoming messages, the change against yesterday so far, seven bars and the usual reply", async () => {
    await renderInbox()
    expect(card(), "the card is drawn").not.toBeNull()
    expect(text(card()!.querySelector('[data-testid="inbox-today-count"]'))).toBe(`25${copy.todayCardUnit}`)
    // 25 today against 20 yesterday up to this hour.
    expect(text(card()!.querySelector('[data-testid="inbox-today-delta"]'))).toBe("25%")
    const bars = [...card()!.querySelectorAll<HTMLElement>('[data-testid="inbox-today-bars"] > span')]
    expect(bars).toHaveLength(7)
    expect(bars.map((b) => b.getAttribute("aria-label")?.split(": ")[1])).toEqual(["12", "0", "0", "0", "0", "30", "25"])
    expect(text(card()!.querySelector('[data-testid="inbox-today-reply"]'))).toBe(`${copy.todayCardReply}1 dəq 40 san`)
    // The days are the browser's calendar days.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(requested.some((u) => u.startsWith("/api/v1/inbox/analytics/temporal") && u.includes(`tz=${encodeURIComponent(tz)}`))).toBe(true)
  })

  it("draws no card when the reports counted nothing in seven days", async () => {
    analytics = "empty"
    await renderInbox()
    expect(requested.some((u) => u.startsWith("/api/v1/inbox/analytics/temporal"))).toBe(true)
    expect(card()).toBeNull()
  })
})

