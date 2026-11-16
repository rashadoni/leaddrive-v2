// @vitest-environment jsdom
/**
 * The customer card on the right of the inbox (owner, 2026-11-15, on
 * fanumsec's Instagram thread with @mirvari.decor): it stood open for good and
 * squeezed the conversation. «Сделай так, что при нажатии [на аватар]
 * раскрывалась, и потом при нажатии в другом месте опять закрывалась.»
 *
 * The real inbox page on real React, with the Azerbaijani copy the owner
 * reads and the network stubbed: the card is closed until the avatar in the
 * thread header opens it; a press anywhere else or Escape closes it; presses
 * inside the card, and inside the lead dialog opened from it, do not.
 *
 * Where the inbox has room for a fourth column (owner, 2026-11-16, «Да, делай»
 * to the card standing beside the conversation as in the mock-up), the card
 * stands open by itself, presses elsewhere leave it, and the avatar hides it.
 * jsdom has no layout, so the inbox is told the width Chromium gives it: a
 * 1440 px window with the full CRM menu is 1120 px of inbox (as in
 * inbox-list-beside-thread-ui.test.ts).
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { readHint } from "./helpers/hint"
import { INBOX_PANEL_BESIDE_THREAD_MIN_PX, inboxListBesideThread } from "@/lib/inbox/inbox-columns"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
const copy = az.inboxV2 as Record<string, string>

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
/** The inbox's width as the page measures it; 1120 px is a 1440 px window with the full CRM menu. */
const width = { inbox: 1120 }
let observed: Array<{ target: Element; report: () => void }> = []

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  width.inbox = 1120
  observed = []
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("data-testid") !== "inbox-root") return original.call(this)
    const w = width.inbox
    return { width: w, height: 600, top: 0, left: 0, right: w, bottom: 600, x: 0, y: 0, toJSON() {} } as DOMRect
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
  // The thread opens the way a link from analytics opens it.
  window.history.replaceState(null, "", "/inbox?conversation=sc-mirvari")
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input)
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
  vi.restoreAllMocks()
  window.history.replaceState(null, "", "/")
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
}

async function renderInbox() {
  await act(async () => { root.render(createElement(InboxV2Page)) })
  await flush()
}

/** A press the way a mouse makes it: down, up, click — each bubbling from the element. */
async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
  await flush()
}

async function escape(from: Element = document.body) {
  await act(async () => {
    from.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
  await flush()
}

const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="inbox-contact-panel-toggle"]')
const panel = () => container.querySelector<HTMLElement>('[data-testid="inbox-contact-panel"]')
/** The innermost element whose whole text is `text` (a button with an icon beside its words counts). */
const byText = (text: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll<HTMLElement>("*")].find((el) =>
    el.textContent?.trim() === text && ![...el.children].some((child) => child.textContent?.trim() === text)) ?? null

/** The window resized: the inbox reports its new width the way ResizeObserver does. */
async function resizeInbox(inbox: number) {
  width.inbox = inbox
  await act(async () => {
    for (const o of observed) if (o.target.getAttribute("data-testid") === "inbox-root") o.report()
  })
  await flush()
}

async function openCard() {
  await press(toggle()!)
  expect(panel(), "the avatar opens the card").not.toBeNull()
}

describe("inbox customer card — opened from the avatar, closed by a press elsewhere", () => {
  it("is closed by default, and the avatar says in words that it opens the card", async () => {
    await renderInbox()
    expect(toggle(), "the thread is open with its header").not.toBeNull()
    expect(panel()).toBeNull()
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false")
    expect(toggle()!.textContent).toContain("@mirvari.decor")
    expect(toggle()!.textContent).toContain(copy.contactPanelOpen)
    expect(await readHint(toggle())).toBe(copy.contactPanelHint)
  })

  it("opens on the avatar with this customer's card, and a second press on it closes it", async () => {
    await renderInbox()
    await openCard()
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true")
    expect(toggle()!.textContent).toContain(copy.contactPanelClose)
    expect(panel()!.getAttribute("aria-label")).toBe(copy.contactPanelLabel)
    expect(panel()!.textContent).toContain("@mirvari.decor")
    expect(panel()!.textContent).toContain(copy.details)

    await press(toggle()!)
    expect(panel()).toBeNull()
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false")
  })

  it("stays open for presses inside the card", async () => {
    await renderInbox()
    await openCard()
    await press(byText(copy.details, panel()!)!)
    expect(panel()).not.toBeNull()
    await press(panel()!)
    expect(panel()).not.toBeNull()
  })

  it("closes on a press in the conversation, and on a press on another conversation in the list", async () => {
    await renderInbox()
    await openCard()
    await press(byText("Nişan dekoru neçəyədir?")!)
    expect(panel(), "a press on the messages closes it").toBeNull()

    await openCard()
    await press(byText("@parviz.aliyev")!)
    expect(panel(), "a press on another conversation closes it").toBeNull()
    expect(toggle()!.textContent, "and the other conversation is open").toContain("@parviz.aliyev")
  })

  it("closes on Escape", async () => {
    await renderInbox()
    await openCard()
    await escape()
    expect(panel()).toBeNull()
  })

  it("stays open while the lead dialog opened from it is in use; Escape closes the dialog first", async () => {
    await renderInbox()
    await openCard()
    await press(byText(copy.leadHandoffAction, panel()!)!)
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog, "the lead dialog opened").not.toBeNull()
    expect(panel(), "opening it did not close the card").not.toBeNull()

    await press(byText(copy.leadAssignmentTitle, dialog!)!)
    expect(panel(), "a press inside the dialog is not a press outside the card").not.toBeNull()

    await escape(dialog!)
    expect(document.querySelector('[role="dialog"]'), "Escape closed the dialog").toBeNull()
    expect(panel(), "and left the card").not.toBeNull()

    await escape()
    expect(panel()).toBeNull()
  })
})

describe("inbox customer card — a column beside the conversation where the inbox has room", () => {
  // A 1585 px window with the full CRM menu (~1393 px with the menu collapsed).
  const WIDE = 1265

  it("starts at the width where the conversation keeps 428 px beside the rail, the list and the card", () => {
    expect(INBOX_PANEL_BESIDE_THREAD_MIN_PX).toBe(WIDE)
    expect(WIDE - (2 + 224 + 320 + 288 + 3), "the conversation's share at that width").toBe(428)
    expect(inboxListBesideThread(WIDE), "the list stands beside it too").toBe(true)
  })

  it("stands open without a click, and the avatar says in words that it hides it", async () => {
    width.inbox = WIDE
    await renderInbox()
    expect(panel(), "the card stands without a click").not.toBeNull()
    expect(panel()!.getAttribute("data-panel-mode")).toBe("column")
    expect(panel()!.className, "a column, not a sheet over the conversation").not.toContain("absolute")
    expect(panel()!.textContent).toContain("@mirvari.decor")
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true")
    expect(toggle()!.textContent).toContain(copy.contactPanelClose)
    expect(await readHint(toggle())).toBe(copy.contactPanelHintColumn)
  })

  it("stays for presses in the conversation and Escape, and follows to another conversation", async () => {
    width.inbox = WIDE
    await renderInbox()
    await press(byText("Nişan dekoru neçəyədir?")!)
    expect(panel(), "a press on the messages leaves the column").not.toBeNull()
    await escape()
    expect(panel(), "Escape leaves the column").not.toBeNull()

    await press(byText("@parviz.aliyev")!)
    expect(toggle()!.textContent, "the other conversation is open").toContain("@parviz.aliyev")
    expect(panel(), "and the card stands for it").not.toBeNull()
    expect(panel()!.textContent).toContain("@parviz.aliyev")
  })

  it("hides on the avatar, stays hidden for the next conversation, and comes back on the avatar", async () => {
    width.inbox = WIDE
    await renderInbox()
    await press(toggle()!)
    expect(panel(), "the avatar hid the card").toBeNull()
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false")
    expect(toggle()!.textContent).toContain(copy.contactPanelOpen)
    expect(await readHint(toggle())).toBe(copy.contactPanelHintColumnHidden)

    await press(byText("@parviz.aliyev")!)
    expect(toggle()!.textContent).toContain("@parviz.aliyev")
    expect(panel(), "the person's choice holds for the next conversation").toBeNull()

    await press(toggle()!)
    expect(panel(), "the avatar brought it back").not.toBeNull()
    expect(panel()!.getAttribute("data-panel-mode")).toBe("column")
  })

  it("one pixel narrower is the card over the conversation, closed until the avatar opens it", async () => {
    width.inbox = WIDE - 1
    await renderInbox()
    expect(panel()).toBeNull()
    expect(await readHint(toggle())).toBe(copy.contactPanelHint)
    await openCard()
    expect(panel()!.getAttribute("data-panel-mode")).toBe("overlay")
    expect(panel()!.className).toContain("absolute")
  })

  it("goes when the window narrows past it instead of covering the conversation, and stands again when it widens", async () => {
    width.inbox = WIDE
    await renderInbox()
    expect(panel()!.getAttribute("data-panel-mode")).toBe("column")

    await resizeInbox(1120)
    expect(panel(), "narrower, the card does not open over the conversation by itself").toBeNull()

    await openCard()
    await resizeInbox(WIDE)
    expect(panel()!.getAttribute("data-panel-mode"), "wider again, the column").toBe("column")

    await resizeInbox(1120)
    expect(panel(), "the card opened over the conversation earlier is not opened again").toBeNull()
  })
})
