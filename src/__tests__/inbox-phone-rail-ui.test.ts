// @vitest-environment jsdom
/**
 * «Gələnlər» on a phone: the folder rail folds behind «Qovluqlar» and opens
 * over the list (owner, 2026-11-15, by a mock-up of two variants: «Вариант А»).
 *
 * On a phone the CRM menu stays a 64 px strip of icons and the page pads 12 px
 * on each side, so a 390 px window gives the inbox 302 px. The rail (224 px)
 * stood there always and left the list or the open conversation 75 px — one
 * letter a line. Now, below 655 px of inbox, the list and an open conversation
 * each take the whole inbox, «Qovluqlar» (in words) at the top of the list
 * opens the same rail over the list, and «Bağla», a press beside it, Escape or
 * a choice in it closes it. A tablet and a desktop keep the rail beside.
 *
 * This file renders the real inbox page on real React with the Azerbaijani
 * copy and the network stubbed. jsdom has no layout, so the inbox and the
 * thread header are told the widths Chromium measured with the app's own CSS
 * (PR body); the page decides from those what stands on the screen.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  INBOX_LIST_BESIDE_THREAD_MIN_PX,
  INBOX_RAIL_BESIDE_MIN_PX,
  INBOX_THREAD_BESIDE_LIST_MIN_PX,
  inboxListBesideThread,
  inboxRailFolded,
} from "@/lib/inbox/inbox-columns"
import { readHint } from "./helpers/hint"

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

/**
 * What Chromium measured with the app's CSS: on a phone the CRM menu is a
 * 64 px strip and the page pads 12 px a side; on a 768 px tablet the strip
 * stays and the padding is 16 px. «thread» is the open conversation's column.
 */
const SCREEN = {
  at360: { inbox: 272, thread: 270 },
  at390: { inbox: 302, thread: 300 },
  at430: { inbox: 342, thread: 340 },
  at768: { inbox: 672, thread: 445 },
}
const BACK_WIDTH = 95

const now = new Date().toISOString()
const conversation = (id: string, name: string, body: string) => ({
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
})

let container: HTMLDivElement
let root: Root
const width = { inbox: 0, header: 0, back: 0 }
let observed: Array<{ target: Element; report: () => void }> = []

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  width.inbox = 0
  width.header = 0
  width.back = 0
  observed = []
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const id = this.getAttribute("data-testid")
    const w = id === "inbox-root" ? width.inbox
      : id === "inbox-thread-header" ? width.header
        : id === "inbox-thread-back" ? width.back
          : null
    if (w === null) return original.call(this)
    return { width: w, height: 56, top: 0, left: 0, right: w, bottom: 56, x: 0, y: 0, toJSON() {} } as DOMRect
  })
  vi.stubGlobal("ResizeObserver", class {
    private targets: Element[] = []
    constructor(private readonly callback: () => void) {}
    observe(target: Element) {
      this.targets.push(target)
      observed.push({ target, report: () => this.callback() })
    }
    unobserve() {}
    disconnect() { observed = observed.filter((o) => !this.targets.includes(o.target)) }
  })
  window.history.replaceState(null, "", "/inbox")
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input)
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({
        conversations: [
          conversation("sc-mirvari", "@mirvari.decor", "Nişan dekoru neçəyədir?"),
          conversation("sc-parviz", "@parviz.aliyev", "Şar dekoru ad günü üçün varmı?"),
        ],
        channels: [],
        stats: { totalMessages: 2, inbound: 2, outbound: 0, conversations: 2 },
      })
    }
    if (url.startsWith("/api/v1/users/assignable")) return json([{ id: "u-aysel", name: "Aysel Quliyeva" }])
    if (url.startsWith("/api/v1/inbox/folders")) return json([{ id: "f-vip", name: "VIP müştərilər", color: "#7c3aed" }])
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

function giveScreen(screen: { inbox: number; thread: number }) {
  width.inbox = screen.inbox
  width.header = screen.thread
  width.back = BACK_WIDTH
}

async function renderInbox(screen: { inbox: number; thread: number }) {
  giveScreen(screen)
  await act(async () => { root.render(createElement(InboxV2Page)) })
  await flush()
}

/** The window (or the CRM menu) changes the inbox's width; the page's own observers report it. */
async function resize(screen: { inbox: number; thread: number }) {
  giveScreen(screen)
  const measured = ["inbox-root", "inbox-thread-header"]
  await act(async () => {
    for (const o of [...observed]) if (measured.includes(o.target.getAttribute("data-testid") ?? "")) o.report()
  })
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

async function pressEscape() {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
  await flush()
}

const inbox = () => container.querySelector<HTMLElement>('[data-testid="inbox-root"]')!
const rail = () => container.querySelector<HTMLElement>('[data-testid="inbox-folder-rail"]')!
const list = () => container.querySelector<HTMLElement>('[data-testid="inbox-conversation-list"]')!
/** The conversation's column: the last column of the inbox. */
const thread = () => [...inbox().children].filter((el) => el.tagName === "SECTION").at(-1) as HTMLElement
const header = () => container.querySelector<HTMLElement>('[data-testid="inbox-thread-header"]')
const back = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-thread-back"]')
const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-rail-toggle"]')
const closeButton = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-rail-close"]')
const backdrop = () => container.querySelector<HTMLElement>('[data-testid="inbox-rail-backdrop"]')
const place = () => container.querySelector<HTMLElement>('[data-testid="inbox-rail-place"]')
const words = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""

/**
 * Whether a column is on the screen. Only the page decides it: no class tied
 * to the window's width may show or hide it behind the page's back.
 */
const shown = (el: HTMLElement) => {
  const classes = [...el.classList]
  expect(classes.filter((c) => c.includes(":") && /(^|:)(hidden|flex|block|absolute|static)$/.test(c)), "no width-bound display class").toEqual([])
  return !classes.includes("hidden")
}
/** The list takes whatever the inbox has, instead of its 320 px column. */
const listTakesInbox = () => list().classList.contains("flex-1") && !list().classList.contains("w-80")
/** The rail lies over the list instead of standing beside it. */
const railOverList = () => rail().classList.contains("absolute")
/** A line of the rail by its words (its count stands in a span of its own). */
const railButton = (name: string) =>
  [...rail().querySelectorAll<HTMLButtonElement>("button")].find((el) => [...el.querySelectorAll("span")].some((s) => words(s) === name)) ?? null

describe("inbox on a phone — the folder rail folds behind «Qovluqlar»", () => {
  it("folds the rail below 655 px of inbox: every phone width, never a tablet", () => {
    // Borders 2 + rail 224 + seam 1 + the 428 px a conversation needs.
    expect(INBOX_RAIL_BESIDE_MIN_PX).toBe(655)
    expect(INBOX_RAIL_BESIDE_MIN_PX).toBe(2 + 224 + 1 + INBOX_THREAD_BESIDE_LIST_MIN_PX)
    expect(INBOX_RAIL_BESIDE_MIN_PX).toBeLessThan(INBOX_LIST_BESIDE_THREAD_MIN_PX)
    for (const screen of [SCREEN.at360, SCREEN.at390, SCREEN.at430]) {
      expect(inboxRailFolded(screen.inbox)).toBe(true)
      expect(inboxListBesideThread(screen.inbox)).toBe(false)
    }
    expect(inboxRailFolded(SCREEN.at768.inbox)).toBe(false)
    expect(inboxRailFolded(INBOX_LIST_BESIDE_THREAD_MIN_PX)).toBe(false)
    // Not measured yet (or no layout): the rail stands, as before.
    expect(inboxRailFolded(0)).toBe(false)
  })

  it("at 390 the list takes the whole inbox, with «Qovluqlar» in words and where the list stands", async () => {
    await renderInbox(SCREEN.at390)
    expect(shown(list()), "the list is there").toBe(true)
    expect(listTakesInbox(), "the list takes the whole inbox").toBe(true)
    expect(shown(rail()), "the rail has folded").toBe(false)
    expect(shown(thread()), "no empty «pick a conversation» column beside the list").toBe(false)
    expect(words(list())).toContain("@mirvari.decor")
    expect(words(list())).toContain("@parviz.aliyev")

    expect(toggle(), "«Qovluqlar» stands at the top of the list").not.toBeNull()
    expect(list().contains(toggle())).toBe(true)
    expect(words(toggle())).toBe(copy.railOpen)
    expect(copy.railOpen).toBe("Qovluqlar")
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false")
    expect(await readHint(toggle())).toBe(copy.railOpenHint)
    expect(words(place())).toBe(copy.view_all)
  })

  it("«Qovluqlar» opens the same rail over the list, and «Bağla» closes it", async () => {
    await renderInbox(SCREEN.at390)
    await press(toggle()!)

    expect(shown(rail()), "the rail is open").toBe(true)
    expect(railOverList(), "over the list, not beside it").toBe(true)
    expect(backdrop(), "the list is dimmed under it").not.toBeNull()
    expect(shown(list()), "the list stays under the rail").toBe(true)
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true")
    // Nothing in the rail moved: the views, the channels and the folders.
    for (const part of [copy.inbox, copy.view_all, copy.view_me, copy.view_unassigned, copy.channels, "Instagram", copy.folders, "VIP müştərilər"]) {
      expect(words(rail()), part).toContain(part)
    }
    expect(document.activeElement, "the keyboard is in the rail, on no button whose hint would open").toBe(rail())
    expect(document.body.querySelector('[data-testid="hint-bubble"]'), "no hint stands over the rail").toBeNull()

    expect(words(closeButton())).toBe(copy.railClose)
    expect(copy.railClose).toBe("Bağla")
    expect(await readHint(closeButton())).toBe(copy.railCloseHint)
    await press(closeButton()!)
    expect(shown(rail()), "«Bağla» closed it").toBe(false)
    expect(backdrop()).toBeNull()
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false")
    expect(document.body.querySelector('[data-testid="hint-bubble"]'), "no hint left over the list").toBeNull()
  })

  it("a press beside the rail or Escape closes it too", async () => {
    await renderInbox(SCREEN.at390)
    await press(toggle()!)
    await press(backdrop()!)
    expect(shown(rail()), "a press on the dimmed list closed it").toBe(false)

    await press(toggle()!)
    expect(shown(rail())).toBe(true)
    await pressEscape()
    expect(shown(rail()), "Escape closed it").toBe(false)
    expect(document.activeElement, "the keyboard is back on «Qovluqlar»").toBe(toggle())
  })

  it("a choice in the rail closes it, and the top of the list says where it now stands", async () => {
    await renderInbox(SCREEN.at390)

    await press(toggle()!)
    await press(railButton(copy.view_unassigned)!)
    expect(shown(rail()), "the choice closed the rail").toBe(false)
    expect(words(place())).toBe(copy.view_unassigned)
    expect(document.body.querySelector('[data-testid="hint-bubble"]'), "no hint left over the list").toBeNull()

    await press(toggle()!)
    await press(railButton("Instagram")!)
    expect(shown(rail())).toBe(false)
    expect(words(place())).toBe(`${copy.view_unassigned} · Instagram`)

    await press(toggle()!)
    await press(railButton("VIP müştərilər")!)
    expect(shown(rail())).toBe(false)
    expect(words(place())).toBe(`${copy.view_unassigned} · Instagram · VIP müştərilər`)

    await press(toggle()!)
    await press(railButton("VIP müştərilər")!)
    await press(toggle()!)
    await press(railButton(copy.view_all)!)
    expect(words(place()), "«Hamısı» clears the channel").toBe(copy.view_all)
  })

  it("an open conversation takes the whole inbox, and «Söhbətlər» brings back the whole-width list", async () => {
    window.history.replaceState(null, "", "/inbox?conversation=sc-mirvari")
    await renderInbox(SCREEN.at390)

    expect(header(), "the conversation is open").not.toBeNull()
    expect(shown(thread()), "the conversation is there").toBe(true)
    expect(thread().classList.contains("flex-1")).toBe(true)
    expect(shown(list()), "the list has stepped aside").toBe(false)
    expect(shown(rail()), "the rail stays folded").toBe(false)
    expect(words(back())).toBe(copy.backToConversations)

    await press(back()!)
    expect(header()).toBeNull()
    expect(shown(list())).toBe(true)
    expect(listTakesInbox()).toBe(true)
    expect(shown(thread())).toBe(false)
    expect(toggle()).not.toBeNull()
  })

  it("at 360 and 430 the same: the list and the conversation each take the whole inbox", async () => {
    await renderInbox(SCREEN.at360)
    for (const screen of [SCREEN.at360, SCREEN.at430]) {
      await resize(screen)
      expect(inbox().dataset.listBesideThread).toBe("false")
      expect(listTakesInbox()).toBe(true)
      expect(shown(rail())).toBe(false)
      expect(toggle()).not.toBeNull()
      await press(list().querySelector<HTMLElement>("[role=button]")!)
      expect(header(), "a conversation opened").not.toBeNull()
      expect(shown(thread())).toBe(true)
      expect(shown(list())).toBe(false)
      expect(shown(rail())).toBe(false)
      await press(back()!)
    }
  })

  it("follows the inbox's width: a tablet keeps the rail beside, and an open rail does not come back by itself", async () => {
    await renderInbox(SCREEN.at390)
    await press(toggle()!)
    expect(shown(rail())).toBe(true)

    await resize(SCREEN.at768)
    expect(shown(rail()), "the rail stands beside the list").toBe(true)
    expect(railOverList(), "beside, not over").toBe(false)
    expect(backdrop()).toBeNull()
    expect(toggle(), "no «Qovluqlar» while the rail stands").toBeNull()
    expect(closeButton(), "no «Bağla» while the rail stands").toBeNull()
    expect(list().classList.contains("w-80")).toBe(true)
    expect(shown(thread()), "the «pick a conversation» column is back beside the list").toBe(true)
    expect(words(container)).toContain(copy.selectConversation)

    await resize(SCREEN.at390)
    expect(shown(rail()), "folded again, and closed").toBe(false)
    expect(backdrop()).toBeNull()
    expect(listTakesInbox()).toBe(true)
  })

  it("before the inbox has measured itself, the rail stands as it always did", async () => {
    await renderInbox({ inbox: 0, thread: 0 })
    expect(shown(rail())).toBe(true)
    expect(railOverList()).toBe(false)
    expect(toggle()).toBeNull()
    expect(list().classList.contains("w-80")).toBe(true)
  })
})
