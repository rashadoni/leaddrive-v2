// @vitest-environment jsdom
/**
 * The conversation list steps aside for an open conversation where the inbox
 * is too narrow for three columns (owner, 2026-11-15, by a mock-up: «Делай А»).
 *
 * With the full CRM menu a 1024 px window gives the inbox 704 px: the folder
 * rail (224) and the list (320) left the conversation 156 px — two or three
 * words a line and a clipped reply box; 1280 left 412. Now the list gives its
 * place to the open conversation below 976 px of inbox, «Söhbətlər» in the
 * conversation's header brings the list back, and the folder rail always stays.
 *
 * This file renders the real inbox page on real React with the Azerbaijani
 * copy and the network stubbed. jsdom has no layout, so the inbox, the thread
 * header and «Söhbətlər» are told the widths Chromium measured with the app's
 * own CSS (PR body); the page decides from those what stands on the screen.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  INBOX_LIST_BESIDE_THREAD_MIN_PX,
  INBOX_THREAD_BESIDE_LIST_MIN_PX,
  inboxListBesideThread,
} from "@/lib/inbox/inbox-columns"
import { THREAD_HEADER_MEDIUM_MIN_PX, threadHeaderTier } from "@/lib/inbox/thread-header-layout"
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
 * What Chromium measured with the full CRM menu (256 px) and the page's 32 px
 * padding: the inbox, the conversation beside or without the list, and
 * «Söhbətlər» in Azerbaijani.
 */
const SCREEN = {
  at1024: { inbox: 704, thread: 477 },
  at1280: { inbox: 960, thread: 733 },
  at1296: { inbox: 976, thread: 428 },
  at1440: { inbox: 1120, thread: 572 },
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
  window.history.replaceState(null, "", "/inbox?conversation=sc-mirvari")
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

/** The widths the screen gives: the conversation is as wide as its column, «Söhbətlər» as Chromium drew it. */
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

/** The window (or the CRM menu) changes the inbox's width; every observer reports it. */
async function resize(screen: { inbox: number; thread: number }) {
  giveScreen(screen)
  await act(async () => { for (const o of [...observed]) o.report() })
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

const inbox = () => container.querySelector<HTMLElement>('[data-testid="inbox-root"]')!
const rail = () => inbox().querySelector<HTMLElement>(":scope > aside")
const list = () => container.querySelector<HTMLElement>('[data-testid="inbox-conversation-list"]')!
const header = () => container.querySelector<HTMLElement>('[data-testid="inbox-thread-header"]')
const back = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-thread-back"]')
const words = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
/**
 * Whether the list is on the screen. Only the page decides it: no class tied
 * to the window's width may show or hide it behind the page's back (the old
 * `hidden lg:flex` did, by the window instead of the inbox).
 */
const listShown = () => {
  const classes = [...list().classList]
  expect(classes.filter((c) => c.includes(":") && /(^|:)(hidden|flex|block)$/.test(c)), "no width-bound display class on the list").toEqual([])
  return !classes.includes("hidden")
}
const listRow = (name: string) =>
  [...list().querySelectorAll<HTMLElement>("[role=button]")].find((el) => words(el).includes(name)) ?? null

describe("inbox columns — the list steps aside for an open conversation in a narrow inbox", () => {
  it("keeps three columns only where the conversation still gets 428 px beside the list", () => {
    // Borders 2 + rail 224 + seams 2 + list 320 + conversation 428.
    expect(INBOX_LIST_BESIDE_THREAD_MIN_PX).toBe(976)
    expect(INBOX_THREAD_BESIDE_LIST_MIN_PX).toBeGreaterThanOrEqual(THREAD_HEADER_MEDIUM_MIN_PX)
    expect(inboxListBesideThread(SCREEN.at1024.inbox)).toBe(false)
    expect(inboxListBesideThread(SCREEN.at1280.inbox)).toBe(false)
    expect(inboxListBesideThread(SCREEN.at1296.inbox)).toBe(true)
    expect(inboxListBesideThread(SCREEN.at1440.inbox)).toBe(true)
    // Not measured yet (or no layout): the three columns, as before.
    expect(inboxListBesideThread(0)).toBe(true)
  })

  it("at 1024 the open conversation takes the list's place, the folder rail stays, and «Söhbətlər» says so in words", async () => {
    await renderInbox(SCREEN.at1024)
    expect(header(), "the conversation is open").not.toBeNull()
    expect(inbox().dataset.listBesideThread).toBe("false")
    expect(listShown(), "the list has stepped aside").toBe(false)
    expect(rail(), "the folder rail is there").not.toBeNull()
    expect(rail()!.classList.contains("hidden")).toBe(false)
    expect(words(rail())).toContain(copy.inbox)

    expect(back(), "«Söhbətlər» stands in the conversation's header").not.toBeNull()
    expect(header()!.contains(back())).toBe(true)
    expect(words(back())).toBe(copy.backToConversations)
    expect(copy.backToConversations).toBe("Söhbətlər")
    expect(await readHint(back())).toBe(copy.backToConversationsHint)
  })

  it("gives the header's actions only the room «Söhbətlər» leaves beside it", async () => {
    await renderInbox(SCREEN.at1024)
    // 477 px of header minus 95 px of «Söhbətlər» and its 12 px gap: 370 px, below the medium row.
    expect(threadHeaderTier(SCREEN.at1024.thread)).toBe("medium")
    expect(header()!.dataset.layout).toBe(threadHeaderTier(SCREEN.at1024.thread - BACK_WIDTH - 12))
    expect(header()!.dataset.layout).toBe("narrow")

    await resize(SCREEN.at1280)
    expect(header()!.dataset.layout).toBe(threadHeaderTier(SCREEN.at1280.thread - BACK_WIDTH - 12))
    expect(header()!.dataset.layout).toBe("medium")
  })

  it("«Söhbətlər» brings the list back with the rail beside it, and opening another conversation sends it aside again", async () => {
    await renderInbox(SCREEN.at1024)
    await press(back()!)

    expect(header(), "no conversation is open").toBeNull()
    expect(listShown(), "the list is back").toBe(true)
    expect(rail()!.classList.contains("hidden")).toBe(false)
    expect(words(list())).toContain("@mirvari.decor")
    expect(words(list())).toContain("@parviz.aliyev")
    expect(words(container)).toContain(copy.selectConversation)

    const parviz = listRow("@parviz.aliyev")
    expect(parviz, "the other conversation is in the list").not.toBeNull()
    await press(parviz!)
    expect(words(header())).toContain("@parviz.aliyev")
    expect(listShown(), "the list steps aside for it").toBe(false)
    expect(back()).not.toBeNull()
  })

  it("from 976 px of inbox the list stands beside the conversation and there is no «Söhbətlər»", async () => {
    for (const screen of [SCREEN.at1296, SCREEN.at1440]) {
      await renderInbox(screen)
      expect(header(), "the conversation is open").not.toBeNull()
      expect(inbox().dataset.listBesideThread).toBe("true")
      expect(listShown()).toBe(true)
      expect(rail()!.classList.contains("hidden")).toBe(false)
      expect(back()).toBeNull()
      expect(header()!.dataset.layout).toBe(threadHeaderTier(screen.thread))
    }
  })

  it("follows the inbox when the window or the CRM menu changes its width, with the conversation still open", async () => {
    await renderInbox(SCREEN.at1440)
    expect(listShown()).toBe(true)

    await resize(SCREEN.at1024)
    expect(words(header())).toContain("@mirvari.decor")
    expect(listShown()).toBe(false)
    expect(back()).not.toBeNull()

    await resize(SCREEN.at1440)
    expect(words(header())).toContain("@mirvari.decor")
    expect(listShown()).toBe(true)
    expect(back()).toBeNull()
  })

  it("shows the list in a narrow inbox when no conversation is open", async () => {
    window.history.replaceState(null, "", "/inbox")
    await renderInbox(SCREEN.at1024)
    expect(header()).toBeNull()
    expect(listShown()).toBe(true)
    expect(rail()).not.toBeNull()
  })
})
