// @vitest-environment jsdom
/**
 * The thread header of the inbox in a narrow conversation column (2026-11-15).
 * At 1280 px with the full CRM menu the column is ~410 px, while the header's
 * actions took ~485 px in a row that could not shrink; the inbox clips its
 * overflow, so the right ~140 px — the «…», the snooze and folder icons — were
 * not on the screen at all. At 1024 the column is ~155 px.
 *
 * Now what does not fit stands in «Daha çox», written out (the owner does not
 * read icons), and the rare actions live there at every width. This file
 * renders the real inbox page on real React with the Azerbaijani copy and the
 * network stubbed, gives the header the widths the real screen gives it, and
 * checks which actions stand where and that each one still does its work from
 * the menu. That the row fits the column is measured in Chromium (PR body);
 * jsdom has no layout.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  THREAD_HEADER_MEDIUM_MIN_PX,
  THREAD_HEADER_WIDE_MIN_PX,
  threadHeaderActionInline,
  threadHeaderTier,
  type ThreadHeaderAction,
} from "@/lib/inbox/thread-header-layout"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
const copy = az.inboxV2 as Record<string, string>
const common = az.common as Record<string, string>

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
  const translators = new Map<string, ReturnType<typeof actual.createTranslator>>()
  return {
    useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({
          locale: "az", messages: az as never, namespace: (namespace || undefined) as never, onError: () => {},
        }))
      }
      return translators.get(namespace)!
    },
    useLocale: () => "az",
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import InboxV2Page from "@/app/(dashboard)/inbox/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Widths of the conversation column the real screen gives, measured in Chromium with the full CRM menu. */
const COLUMN = { at1024: 156, at1280: 412, at1440: 572, at1920: 1052 }

const now = new Date().toISOString()
const conversation = (id: string, name: string, body: string, extra: Record<string, unknown> = {}) => ({
  socialConversationId: id,
  contactId: null,
  contactName: name,
  contactPhone: "+994501234567",
  channels: ["instagram"],
  lastChannel: "instagram",
  lastMessageAt: now,
  messageCount: 1,
  unreadCount: 0,
  status: "open",
  participants: [],
  messages: [{ id: `${id}-m1`, direction: "inbound", channelType: "instagram", from: name, to: "fanumsec", body, status: "received", createdAt: now }],
  ...extra,
})
const AGENTS = [
  { id: "u-aysel", name: "Aysel Quliyeva" },
  { id: "u-elvin", name: "Elvin Həsənov" },
]
const FOLDERS = [{ id: "f-vip", name: "VIP müştərilər", color: "#7c3aed" }]

let container: HTMLDivElement
let root: Root
let columnWidth = COLUMN.at1280
let observers: Array<() => void> = []
let requests: Array<{ url: string; method: string; body: unknown }> = []

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  columnWidth = COLUMN.at1280
  observers = []
  requests = []
  stable.router.push.mockClear()
  // The header is as wide as the column; jsdom has no layout, so it is told.
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("data-testid") !== "inbox-thread-header") return original.call(this)
    return { width: columnWidth, height: 56, top: 0, left: 0, right: columnWidth, bottom: 56, x: 0, y: 0, toJSON() {} } as DOMRect
  })
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: () => void) {}
    observe() { observers.push(this.callback) }
    unobserve() {}
    disconnect() { observers = observers.filter((cb) => cb !== this.callback) }
  })
  window.history.replaceState(null, "", "/inbox?conversation=sc-mirvari")
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method !== "GET") requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({
        conversations: [
          conversation("sc-mirvari", "@mirvari.decor", "Nişan dekoru neçəyədir?"),
          conversation("sc-parviz", "@parviz.aliyev", "Gerek ele Parviz qoyadim adini"),
        ],
        channels: [],
        stats: { totalMessages: 2, inbound: 2, outbound: 0, conversations: 2 },
      })
    }
    if (url.startsWith("/api/v1/users/assignable")) return json(AGENTS)
    if (url.startsWith("/api/v1/inbox/folders")) return json(FOLDERS)
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
}

async function renderInbox(width: number) {
  columnWidth = width
  await act(async () => { root.render(createElement(InboxV2Page)) })
  await flush()
}

/** The window (or the CRM menu) changes the column's width; the header's observer reports it. */
async function resizeColumn(width: number) {
  columnWidth = width
  await act(async () => { for (const report of observers) report() })
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

const header = () => container.querySelector<HTMLElement>('[data-testid="inbox-thread-header"]')!
const actions = () => container.querySelector<HTMLElement>('[data-testid="inbox-thread-actions"]')!
const moreButton = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-thread-more"]')!
const menu = () => container.querySelector<HTMLElement>('[data-testid="inbox-thread-more-menu"]')
const menuItem = (id: string) => menu()?.querySelector<HTMLButtonElement>(`[data-more-item="${id}"]`) ?? null
const menuItemIds = () => [...(menu()?.querySelectorAll<HTMLElement>("[data-more-item]") ?? [])].map((el) => el.dataset.moreItem)
/** The words a button shows, as the person reads them (a word in a nested span counts). */
const words = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
/** The header's own buttons (outside «Daha çox» and outside the lists they open), by what they say or are titled. */
const headerButton = (label: string) =>
  [...actions().querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    !menu()?.contains(b) && (words(b) === label || b.getAttribute("title") === label)) ?? null
const callButton = () => actions().querySelector<HTMLButtonElement>("button")

async function openMore() {
  await press(moreButton())
  expect(menu(), "«Daha çox» opens").not.toBeNull()
}

describe("inbox thread header — every action reachable in a narrow column", () => {
  it("sorts the column widths of the real screen into the tiers", () => {
    expect(threadHeaderTier(COLUMN.at1024)).toBe("narrow")
    expect(threadHeaderTier(COLUMN.at1280)).toBe("medium")
    expect(threadHeaderTier(COLUMN.at1440)).toBe("medium")
    expect(threadHeaderTier(COLUMN.at1920)).toBe("wide")
    expect(threadHeaderTier(THREAD_HEADER_MEDIUM_MIN_PX - 1)).toBe("narrow")
    expect(threadHeaderTier(THREAD_HEADER_WIDE_MIN_PX - 1)).toBe("medium")
    expect(threadHeaderTier(0), "not measured yet: the full header").toBe("wide")
    // The rare actions are written out in «Daha çox» at every width.
    for (const tier of ["wide", "medium", "narrow"] as const) {
      for (const action of ["snooze", "folder", "trash"] as ThreadHeaderAction[]) expect(threadHeaderActionInline(tier, action)).toBe(false)
    }
  })

  it("at 1280 with the CRM menu: call, «Təyin et», the close tick and «Daha çox» in the header; the rest written out in «Daha çox»", async () => {
    await renderInbox(COLUMN.at1280)
    expect(header().dataset.layout).toBe("medium")
    expect(callButton()?.getAttribute("title"), "the call stays in the header").toBeTruthy()
    expect(headerButton(copy.assign), "«Təyin et» with its word").not.toBeNull()
    expect(headerButton(copy.closeConv), "the close tick").not.toBeNull()
    expect(words(moreButton())).toBe(copy.moreActionsMenu)
    expect(headerButton(copy.participants), "«İştirakçılar» is not in the row").toBeNull()
    expect(headerButton(copy.convertToLead), "«Lidə çevir» is not in the row").toBeNull()
    // The icons that fell off the edge are gone from the row, and the dead «…» with them.
    expect(headerButton(copy.snooze)).toBeNull()
    expect(headerButton(copy.moveToFolder)).toBeNull()
    expect(headerButton(copy.deleteConversation)).toBeNull()
    expect(actions().querySelectorAll(":scope > *")).toHaveLength(4)

    await openMore()
    expect(menuItemIds()).toEqual(["participants", "lead", "snooze", "folder", "trash"])
    expect(words(menuItem("participants"))).toBe(copy.participants)
    expect(words(menuItem("lead"))).toBe(copy.convertToLead)
    expect(words(menuItem("snooze"))).toBe(copy.snooze)
    expect(words(menuItem("folder"))).toBe(copy.moveToFolder)
    expect(words(menuItem("trash"))).toBe(copy.deleteConversation)
  })

  it("at 1024 with the CRM menu: only the call and «Daha çox» stand in the header, and «Daha çox» holds every other action in words", async () => {
    await renderInbox(COLUMN.at1024)
    expect(header().dataset.layout).toBe("narrow")
    expect(actions().querySelectorAll(":scope > *")).toHaveLength(2)
    expect(headerButton(copy.assign)).toBeNull()
    expect(headerButton(copy.closeConv)).toBeNull()

    await openMore()
    expect(menuItemIds()).toEqual(["assign", "participants", "lead", "close", "snooze", "folder", "trash"])
    expect(words(menuItem("assign"))).toBe(copy.assign)
    expect(words(menuItem("close"))).toBe(copy.closeConv)
  })

  it("at 1920: «İştirakçılar» and «Lidə çevir» stand in the header, and «Daha çox» keeps the rare actions", async () => {
    await renderInbox(COLUMN.at1920)
    expect(header().dataset.layout).toBe("wide")
    expect(headerButton(copy.participants)).not.toBeNull()
    expect(headerButton(copy.convertToLead)).not.toBeNull()
    await openMore()
    expect(menuItemIds()).toEqual(["snooze", "folder", "trash"])
  })

  it("follows the column when the window narrows, and the call control is not rebuilt (a live call lives in it)", async () => {
    await renderInbox(COLUMN.at1920)
    const call = callButton()
    expect(headerButton(copy.participants)).not.toBeNull()

    await resizeColumn(COLUMN.at1280)
    expect(header().dataset.layout).toBe("medium")
    expect(headerButton(copy.participants)).toBeNull()
    expect(callButton(), "the same call control, not a new one").toBe(call)

    await resizeColumn(COLUMN.at1024)
    expect(header().dataset.layout).toBe("narrow")
    expect(headerButton(copy.assign)).toBeNull()
    expect(callButton()).toBe(call)

    await resizeColumn(COLUMN.at1920)
    expect(headerButton(copy.participants)).not.toBeNull()
    expect(callButton()).toBe(call)
  })

  it("«Təyin et» from «Daha çox» opens the colleagues in place and assigns the one pressed", async () => {
    await renderInbox(COLUMN.at1024)
    await openMore()
    await press(menuItem("assign")!)
    expect(menuItemIds(), "the menu now shows the list").toEqual([])
    expect(words(menu())).toContain(common.back)
    expect(words(menu())).toContain("Aysel Quliyeva")

    await press([...menu()!.querySelectorAll("button")].find((b) => words(b) === "Elvin Həsənov")!)
    expect(requests).toContainEqual({ url: "/api/v1/inbox/conversations/sc-mirvari", method: "PATCH", body: { assignedTo: "u-elvin" } })
    expect(menu(), "the menu closes after the choice").toBeNull()
  })

  it("«Geri» returns from a list to the actions, and «Daha çox» opens on the actions again next time", async () => {
    await renderInbox(COLUMN.at1280)
    await openMore()
    await press(menuItem("participants")!)
    expect(words(menu())).toContain(copy.participantsHint)
    await press([...menu()!.querySelectorAll("button")].find((b) => words(b) === common.back)!)
    expect(menuItemIds()).toEqual(["participants", "lead", "snooze", "folder", "trash"])

    await press(menuItem("folder")!)
    await press(moreButton())
    expect(menu()).toBeNull()
    await openMore()
    expect(menuItemIds(), "not the folder list left from last time").toEqual(["participants", "lead", "snooze", "folder", "trash"])
  })

  it("adds a participant, snoozes and files the thread from «Daha çox»", async () => {
    await renderInbox(COLUMN.at1280)
    await openMore()
    await press(menuItem("participants")!)
    await press([...menu()!.querySelectorAll("button")].find((b) => words(b) === "Aysel Quliyeva")!)
    expect(requests.some((r) => r.url === "/api/v1/inbox/conversations/sc-mirvari/participants" && r.method === "POST" && (r.body as { userId?: string }).userId === "u-aysel")).toBe(true)

    await openMore()
    await press(menuItem("snooze")!)
    await press([...menu()!.querySelectorAll("button")].find((b) => words(b) === copy.snooze_3h)!)
    const snooze = requests.find((r) => r.method === "PATCH" && r.body && typeof r.body === "object" && "snoozedUntil" in r.body)
    expect(snooze, "snoozed for three hours").toBeDefined()
    expect(new Date((snooze!.body as { snoozedUntil: string }).snoozedUntil).getTime() - Date.now()).toBeGreaterThan(2.9 * 3_600_000)
  })

  it("files the thread into a folder from «Daha çox», with the folder list in words including «Qovluqsuz»", async () => {
    await renderInbox(COLUMN.at1280)
    await openMore()
    await press(menuItem("folder")!)
    expect(words(menu())).toContain(copy.noFolder)
    await press([...menu()!.querySelectorAll("button")].find((b) => words(b) === "VIP müştərilər")!)
    expect(requests).toContainEqual({ url: "/api/v1/inbox/conversations/sc-mirvari", method: "PATCH", body: { folderId: "f-vip" } })
  })

  it("«Lidə çevir» from «Daha çox» opens the lead dialog", async () => {
    await renderInbox(COLUMN.at1024)
    await openMore()
    await press(menuItem("lead")!)
    expect(menu()).toBeNull()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(copy.leadAssignmentTitle)
  })

  it("«Söhbəti bağla» from «Daha çox» opens the same close dialog as the tick", async () => {
    await renderInbox(COLUMN.at1280)
    await press(headerButton(copy.closeConv)!)
    const fromTick = document.querySelector('[role="dialog"]')?.textContent
    expect(fromTick, "the tick opens the close dialog").toBeTruthy()
    act(() => root.unmount())
    root = createRoot(container)

    await renderInbox(COLUMN.at1024)
    await openMore()
    await press(menuItem("close")!)
    expect(menu()).toBeNull()
    expect(document.querySelector('[role="dialog"]')?.textContent).toBe(fromTick)
  })

  it("moves the thread to the trash from «Daha çox» (managers only)", async () => {
    vi.stubGlobal("confirm", () => true)
    await renderInbox(COLUMN.at1280)
    await openMore()
    await press(menuItem("trash")!)
    expect(requests).toContainEqual(expect.objectContaining({ url: "/api/v1/inbox/conversations/sc-mirvari", method: "DELETE" }))

    stable.session.data.user.role = "agent"
    try {
      act(() => root.unmount())
      root = createRoot(container)
      await renderInbox(COLUMN.at1280)
      await openMore()
      expect(menuItem("trash"), "an agent cannot undo it, so it is not offered").toBeNull()
    } finally {
      stable.session.data.user.role = "admin"
    }
  })

  it("closes on a press outside and on Escape, and never stands open together with «Təyin et»", async () => {
    await renderInbox(COLUMN.at1280)
    await openMore()
    await press(container.querySelector("textarea, input") ?? document.body)
    expect(menu(), "a press elsewhere closes it").toBeNull()

    await openMore()
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    await flush()
    expect(menu(), "Escape closes it").toBeNull()

    await openMore()
    await press(headerButton(copy.assign)!)
    expect(menu(), "opening «Təyin et» closes «Daha çox»").toBeNull()
    expect(words(actions())).toContain(copy.unassign)
    await press(moreButton())
    expect(menu()).not.toBeNull()
    expect(words(actions()), "and opening «Daha çox» closes «Təyin et»").not.toContain(copy.unassign)
  })
})
