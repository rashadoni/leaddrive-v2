// @vitest-environment jsdom
/**
 * «Məsul əməkdaş» in the inbox's filters (2026-11-16) — the conversations one person holds, so a
 * manager who leaves can be handed over. The real inbox page on real React with the Azerbaijani copy
 * and the network stubbed:
 *  - the filter names who holds conversations, the ones who no longer work here included;
 *  - choosing a person asks the server for her conversations — the list alone holds only the
 *    recently written ones — and shows hers only, with every count beside the list inside them;
 *  - the strip above the list says whose conversations these are and leads on to handing them over
 *    with the bulk «assign» that already exists;
 *  - an answer for the person chosen before never replaces the list of the choice made after;
 *  - «Bütün söhbətləri ötür»: everything the person holds goes to one colleague in one press — by the
 *    number the server counted, not by what the list shows — and a refusal is said in the dialog.
 *
 * What the server adds for a person, and that the conversations reach their new owner in the
 * database, is `user-handover-inbox-postgres.test.ts`.
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
const thread = (id: string, name: string, assignedTo: string | null, hours: number, messages = true) => ({
  threadKey: `addr_${id}`,
  contactId: null,
  contactName: name,
  contactPhone: null,
  contactEmail: null,
  channels: ["whatsapp"],
  lastChannel: "whatsapp",
  lastMessage: `${name}: sual`,
  lastMessageAt: hoursAgo(hours),
  lastDirection: "inbound",
  messageCount: messages ? 1 : 0,
  unreadCount: 0,
  status: "open",
  assignedTo,
  participants: [],
  socialConversationId: id,
  messages: messages
    ? [{ id: `m-${id}`, conversationId: id, channelType: "whatsapp", direction: "inbound", body: `${name}: sual`, createdAt: hoursAgo(hours), status: "received", from: name, to: "shop", channelConfigId: "cfg-wa" }]
    : [],
})

/** What the list's window holds: one conversation each of Leyla, Aysel and nobody. */
const WINDOW = [
  thread("conv-leyla-recent", "Anar Məmmədov", "u-leyla", 1),
  thread("conv-aysel", "Rəna Hüseynova", "u-aysel", 2),
  thread("conv-nobody", "Kamran Əliyev", null, 3),
]
/** Leyla's conversation nobody wrote in for a month — the server adds it only when asked for her. */
const QUIET = thread("conv-leyla-quiet", "Sevda Həsənova", "u-leyla", 24 * 30, false)

let container: HTMLDivElement
let root: Root
let requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
/** When set, the answer for Leyla's list waits until the test lets it go. */
let holdLeyla: { release: () => void; waiting: Promise<void> } | null = null
let leylaHasMore = false
/** What `POST /api/v1/inbox/assignees/transfer` answers; null — the server refuses. */
let transferAnswer: { conversations: number; webChats: number; total: number } | null = { conversations: 6, webChats: 1, total: 7 }
/** Set once a handover went through: Leyla holds nothing any more. */
let handedOver = false

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  requests = []
  holdLeyla = null
  leylaHasMore = false
  transferAnswer = { conversations: 6, webChats: 1, total: 7 }
  handedOver = false
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  window.history.replaceState(null, "", "/inbox")
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    requests.push({ url, method, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null })
    if (url === "/api/v1/inbox/assignees") {
      return json([
        { id: "u-aysel", name: "Aysel", active: true, removed: false, open: handedOver ? 8 : 1 },
        // Switched off last week; her conversations are still hers. Seven of them — the list below
        // shows two: the rest are website chats and conversations the answer had no room for.
        ...(handedOver ? [] : [{ id: "u-leyla", name: "Leyla", active: false, removed: false, open: 7 }]),
        // Deleted long ago: the row holds a placeholder, the answer no name.
        { id: "u-gone", name: null, active: false, removed: true, open: 1 },
      ])
    }
    if (url === "/api/v1/inbox/assignees/transfer") {
      if (!transferAnswer) return new Response(JSON.stringify({ error: "Invalid assignee" }), { status: 400, headers: { "content-type": "application/json" } })
      handedOver = true
      return json(transferAnswer)
    }
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      const assignee = new URL(url, "http://localhost").searchParams.get("assignee")
      if (assignee === "u-leyla" && handedOver) {
        // Her conversations are Aysel's now.
        return json({ conversations: [thread("conv-leyla-recent", "Anar Məmmədov", "u-aysel", 1), ...WINDOW.slice(1)], channels: [], stats: { totalMessages: 3, inbound: 3, outbound: 0, conversations: 3 }, assignee: { id: "u-leyla", more: false } })
      }
      if (assignee === "u-leyla") {
        if (holdLeyla) await holdLeyla.waiting
        return json({ conversations: [...WINDOW, QUIET], channels: [], stats: { totalMessages: 3, inbound: 3, outbound: 0, conversations: 4 }, assignee: { id: "u-leyla", more: leylaHasMore } })
      }
      return json({ conversations: WINDOW, channels: [], stats: { totalMessages: 3, inbound: 3, outbound: 0, conversations: 3 }, ...(assignee ? { assignee: { id: assignee, more: false } } : {}) })
    }
    if (url.startsWith("/api/v1/inbox/conversations/bulk")) return json({ results: [], summary: { requested: 2, updated: 2, sendFailed: 0, deliveryUnknown: 0 } })
    // The assign list knows working accounts only — Leyla is not in it.
    if (url.startsWith("/api/v1/users/assignable")) return json([{ id: "u-me", name: "Rəşad" }, { id: "u-aysel", name: "Aysel" }])
    if (url.startsWith("/api/v1/inbox/thread?")) return json({ messages: [], callLogs: [], conversationIds: [] })
    if (url.endsWith("/learning")) return json(null)
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
async function choose(select: HTMLSelectElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await flush()
}

const words = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const list = () => container.querySelector<HTMLElement>('[data-testid="inbox-conversation-list"]')!
/** The customers in the list, top to bottom. */
const customers = () => ["Anar Məmmədov", "Rəna Hüseynova", "Kamran Əliyev", "Sevda Həsənova"]
  .filter((name) => [...list().querySelectorAll<HTMLElement>('[role="button"]')].some((el) => el.textContent?.includes(name)))
const strip = () => container.querySelector<HTMLElement>('[data-testid="inbox-assignee-strip"]')
const viewCount = (view: string) => words(container.querySelector(`[data-view="${view}"] span.tabular-nums`))
const listReads = () => requests.filter((r) => r.method === "GET" && (r.url === "/api/v1/inbox" || r.url.startsWith("/api/v1/inbox?"))).map((r) => r.url)

/** Opens the filters beside the search and returns the «Məsul əməkdaş» list (it lives in a popover). */
async function assigneeFilter(): Promise<HTMLSelectElement> {
  if (!document.querySelector('[data-testid="inbox-assignee-filter"]')) {
    await press(container.querySelector('button[aria-label="Filtrlər"]')!)
  }
  return document.querySelector<HTMLSelectElement>('[data-testid="inbox-assignee-filter"]')!
}

describe("the inbox's «Məsul əməkdaş» filter", () => {
  it("names who holds conversations — the switched-off one by name, the deleted one in the screen's words", async () => {
    await renderInbox()
    const select = await assigneeFilter()
    expect(select.getAttribute("aria-label")).toBe("Məsul əməkdaş")
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Bütün əməkdaşlar",
      "Aysel",
      "Rəşad",
      "Leyla (deaktiv)",
      "Silinmiş əməkdaş",
    ])
    // Nothing is narrowed until somebody is chosen.
    expect(select.value).toBe("")
    expect(strip()).toBeNull()
    expect(customers()).toEqual(["Anar Məmmədov", "Rəna Hüseynova", "Kamran Əliyev"])
  })

  it("asks the server for the person's conversations and shows hers only — the quiet one too", async () => {
    await renderInbox()
    expect(listReads()).toEqual(["/api/v1/inbox"])
    await choose(await assigneeFilter(), "u-leyla")

    expect(listReads().at(-1)).toBe("/api/v1/inbox?assignee=u-leyla")
    // Sevda's conversation was not in the list at all: nobody wrote in it for a month.
    expect(customers()).toEqual(["Anar Məmmədov", "Sevda Həsənova"])
    expect(words(strip())).toContain("Əməkdaşın söhbətləri: Leyla (deaktiv)")
    // The counts beside the list are inside her conversations, like the list itself.
    expect(viewCount("all")).toBe("2")
    expect(viewCount("unassigned")).toBe("")
    expect(words(container.querySelector('[data-status-tab="opened"]'))).toContain("2")
    // Not all of them were sent — nothing claims otherwise.
    expect(words(strip())).not.toContain(copy.assigneeFilterMore)

    // «Hamısını göstər» gives the whole list back.
    await press([...strip()!.querySelectorAll("button")].find((b) => words(b) === "Hamısını göstər")!)
    expect(strip()).toBeNull()
    expect(listReads().at(-1)).toBe("/api/v1/inbox")
    expect(customers()).toEqual(["Anar Məmmədov", "Rəna Hüseynova", "Kamran Əliyev"])
    expect(viewCount("all")).toBe("3")
  })

  it("says so when the person holds more conversations than one answer carries", async () => {
    leylaHasMore = true
    await renderInbox()
    await choose(await assigneeFilter(), "u-leyla")
    expect(words(strip())).toContain(copy.assigneeFilterMore)
  })

  it("hands the conversations over: the strip's button ticks them, the assign list names the new owner", async () => {
    await renderInbox()
    await choose(await assigneeFilter(), "u-leyla")
    const selectAll = strip()!.querySelector<HTMLButtonElement>('[data-testid="inbox-assignee-select-all"]')!
    expect(words(selectAll)).toBe("Bütün görünənləri seç (maks. 2)")
    await press(selectAll)

    const assign = container.querySelector<HTMLSelectElement>(`select[aria-label="${copy.bulkAssign}"]`)!
    // Leyla herself cannot be given work any more: the assign list does not offer her.
    expect([...assign.options].map((option) => option.textContent)).not.toContain("Leyla")
    await choose(assign, "u-aysel")

    const bulk = requests.find((r) => r.method === "POST" && r.url === "/api/v1/inbox/conversations/bulk")!
    expect(bulk.body).toMatchObject({ action: "assign", assignedTo: "u-aysel" })
    expect([...(bulk.body!.ids as string[])].sort()).toEqual(["conv-leyla-quiet", "conv-leyla-recent"])
    // Who holds conversations has changed — the filter's list is read again.
    expect(requests.filter((r) => r.url === "/api/v1/inbox/assignees").length).toBeGreaterThan(1)
  })

  it("moves from «Mənim» to «Hamısı» for a person chosen there — «mine» would show an empty list", async () => {
    await renderInbox()
    await press(container.querySelector('[data-view="me"]')!)
    expect(customers()).toEqual([])
    await choose(await assigneeFilter(), "u-leyla")
    expect(customers()).toEqual(["Anar Məmmədov", "Sevda Həsənova"])
  })

  it("does not let the answer for the person chosen before replace the list chosen after", async () => {
    await renderInbox()
    let release!: () => void
    holdLeyla = { waiting: new Promise<void>((resolve) => { release = resolve }), release: () => release() }
    await choose(await assigneeFilter(), "u-leyla")
    // Her list has not arrived yet; the person changes his mind and asks for everybody.
    await press([...strip()!.querySelectorAll("button")].find((b) => words(b) === "Hamısını göstər")!)
    expect(customers()).toEqual(["Anar Məmmədov", "Rəna Hüseynova", "Kamran Əliyev"])

    // Now the slow answer for Leyla arrives — with her month-old conversation in it.
    await act(async () => { holdLeyla!.release() })
    await flush()
    expect(strip()).toBeNull()
    expect(customers()).toEqual(["Anar Məmmədov", "Rəna Hüseynova", "Kamran Əliyev"])
  })

  // ── «Bütün söhbətləri ötür» ─────────────────────────────────────────────────────────────────────

  const transferButton = () => strip()?.querySelector<HTMLButtonElement>('[data-testid="inbox-assignee-transfer-all"]') ?? null
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="inbox-assignee-transfer-dialog"]')
  const transferTo = () => document.querySelector<HTMLSelectElement>('[data-testid="inbox-assignee-transfer-to"]')!
  const confirm = () => document.querySelector<HTMLButtonElement>('[data-testid="inbox-assignee-transfer-confirm"]')!
  const posts = (url: string) => requests.filter((r) => r.method === "POST" && r.url === url)

  it("hands over everything the person holds in one press — by the server's count, not the list's", async () => {
    await renderInbox()
    await choose(await assigneeFilter(), "u-leyla")
    // The list shows two conversations; she holds seven.
    expect(customers()).toEqual(["Anar Məmmədov", "Sevda Həsənova"])
    expect(words(transferButton())).toBe("Bütün söhbətləri ötür (7)")
    expect(dialog()).toBeNull()

    await press(transferButton()!)
    expect(words(dialog())).toContain("Leyla (deaktiv): açıq söhbətlər — 7.")
    expect(words(dialog())).toContain("Bağlı söhbətlər və zibil qutusu olduğu kimi qalır.")
    // Who can take them: the people the assign list knows. Never «nobody», never Leyla herself.
    expect([...transferTo().options].map((option) => option.textContent)).toEqual(["Əməkdaş seçin", "Rəşad", "Aysel"])
    // Nothing is sent until somebody is chosen.
    expect(confirm().disabled).toBe(true)
    expect(words(confirm())).toBe("7 söhbəti ötür")
    await press(confirm())
    expect(posts("/api/v1/inbox/assignees/transfer")).toEqual([])

    await choose(transferTo(), "u-aysel")
    expect(confirm().disabled).toBe(false)
    const readsBefore = listReads().length
    await press(confirm())

    // One request names the two people — no ids, no rounds of fifty.
    expect(posts("/api/v1/inbox/assignees/transfer").map((r) => r.body)).toEqual([{ from: "u-leyla", to: "u-aysel" }])
    expect(posts("/api/v1/inbox/conversations/bulk")).toEqual([])
    // The dialog is gone, the screen says what happened in the number the server answered with.
    expect(dialog()).toBeNull()
    expect(words(container.querySelector('[role="status"]'))).toContain("7 söhbət ötürüldü — indi Aysel cavab verir")
    // Her list is read again and is empty now; there is nothing left to hand over.
    expect(listReads().length).toBeGreaterThan(readsBefore)
    expect(listReads().at(-1)).toBe("/api/v1/inbox?assignee=u-leyla")
    expect(customers()).toEqual([])
    expect(words(strip())).toContain("Əməkdaşın söhbətləri: Leyla (deaktiv)")
    expect(transferButton()).toBeNull()
  })

  it("says in the dialog that nothing was moved when the server refuses — and keeps the choice", async () => {
    transferAnswer = null
    await renderInbox()
    await choose(await assigneeFilter(), "u-leyla")
    await press(transferButton()!)
    await choose(transferTo(), "u-aysel")
    await press(confirm())

    expect(posts("/api/v1/inbox/assignees/transfer").length).toBe(1)
    expect(words(dialog()!.querySelector('[role="alert"]'))).toBe(copy.assigneeTransferFailed)
    expect(transferTo().value).toBe("u-aysel")
    // No success is claimed, and her conversations are still listed as hers.
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(customers()).toEqual(["Anar Məmmədov", "Sevda Həsənova"])

    // «Ləğv et» closes it; the button is still there to try again.
    await press([...document.querySelectorAll("button")].find((b) => words(b) === (az.common as Record<string, string>).cancel)!)
    expect(dialog()).toBeNull()
    expect(words(transferButton())).toBe("Bütün söhbətləri ötür (7)")
  })

  it("does not offer a person her own conversations, and offers nothing for someone who holds none", async () => {
    await renderInbox()
    // Aysel holds one: it can go to anyone but Aysel.
    await choose(await assigneeFilter(), "u-aysel")
    expect(words(transferButton())).toBe("Bütün söhbətləri ötür (1)")
    await press(transferButton()!)
    expect([...transferTo().options].map((option) => option.textContent)).toEqual(["Əməkdaş seçin", "Rəşad"])
    expect(words(confirm())).toBe("1 söhbəti ötür")
    await press([...document.querySelectorAll("button")].find((b) => words(b) === (az.common as Record<string, string>).cancel)!)

    // Rəşad holds no open conversation — there is nothing to hand over, and no button says otherwise.
    await choose(await assigneeFilter(), "u-me")
    expect(words(strip())).toContain("Əməkdaşın söhbətləri: Rəşad")
    expect(transferButton()).toBeNull()
  })
})
