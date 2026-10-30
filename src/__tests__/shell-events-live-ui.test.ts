// @vitest-environment jsdom
/**
 * The CRM shell on its event stream (GET /api/v1/shell/events).
 *
 * Measured on production 2026-10-27: polls were 37% of all requests, 28 a
 * minute from an idle tab on screen. On the stream a tab reads a part when
 * the server says it changed, once on every (re)connect, and every two minutes
 * as a safety net; if the stream does not come up or stays down, it polls
 * exactly as before (shell-pollers-visible-tab-ui.test.ts).
 *
 * The real ShellEventsProvider and the four real consumers are rendered over a
 * stubbed network; EventSource is a fake the test drives.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgFromSession } from "@/lib/nav-items"

const state = vi.hoisted(() => ({
  session: {
    iat: 1,
    user: {
      id: "synthetic-user-a", email: "synthetic-a@example.invalid",
      organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
      modules: { crm: true, omnichannel: true, support: true } as Record<string, boolean>,
    },
  },
  status: "authenticated" as "authenticated" | "loading",
  pathname: "/dashboard",
}))

const badge = vi.hoisted(() => ({
  newTicketCount: 0,
  setNewTicketCount: () => {},
  resetBadge: () => {},
  lastCheckedAt: "2026-10-27T00:00:00.000Z",
  updateLastChecked: () => {},
}))

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.session, status: state.status }) }))
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: () => {} }) }))
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children?: ReactNode; href: string; className?: string }) =>
    createElement("a", { href, className }, children),
}))
// One function, as next-intl memoizes it: a new `t` per render would rebuild
// the bell's fetch callback and restart its poll, which the real hook never does.
const t = vi.hoisted(() => Object.assign((key: string) => key, { has: () => false, rich: (key: string) => key }))
vi.mock("next-intl", () => ({ useTranslations: () => t, useLocale: () => "az" }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { warning: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/contexts/ticket-badge-context", () => ({ useTicketBadge: () => badge }))
const registerPush = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock("@/lib/push-client", () => ({ registerPush }))

/** What the two notification APIs hold right now. */
const server = vi.hoisted(() => ({
  notifications: [] as Array<{ id: string; type: string; title: string; message: string; entityType: string; isRead: boolean; createdAt: string }>,
  sectionPush: true,
}))

import { ShellEventsProvider, SAFETY_REFRESH_MS } from "@/components/shell-events-provider"
import { VoipCallProvider } from "@/components/voip-call-provider"
import { Sidebar } from "@/components/sidebar"
import { NotificationBell } from "@/components/notification-bell"
import { TicketNotifier } from "@/components/ticket-notifier"
import { deriveSection } from "@/lib/notifications/taxonomy"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CALLS = "/api/v1/calls/active"
const BELL = "/api/v1/notifications"
const INBOX_BADGE = "/api/v1/notifications?entityType=inbox_message"
const WEB_CHAT = "/api/v1/web-chat/sessions/unread-count"
const TICKETS = "/api/v1/tickets/new-count"
const PREFERENCES = "/api/v1/users/me/notification-preferences"
const POLLERS = [CALLS, BELL, INBOX_BADGE, WEB_CHAT, TICKETS]

let requests: string[]
const asked = (key: string) => requests.filter((request) => request === key).length

function answer(key: string): unknown {
  if (key === CALLS) return { success: true, data: [] }
  if (key === BELL) return { success: true, data: { notifications: server.notifications, unreadCount: server.notifications.length } }
  if (key === INBOX_BADGE) return { success: true, data: { notifications: [], unreadCount: 0 } }
  if (key === WEB_CHAT) return { success: true, data: { count: 0 } }
  if (key === TICKETS) return { count: 0 }
  if (key === PREFERENCES) return { success: true, data: { sections: [{ key: deriveSection("deal"), push: server.sectionPush, types: [] }] } }
  return { success: true, data: {}, browserCalls: false }
}

let visibility: DocumentVisibilityState = "visible"
async function show(next: DocumentVisibilityState) {
  visibility = next
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")) })
  await advance(0)
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  for (let turn = 0; turn < 4; turn += 1) await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

let container: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(createElement(ShellEventsProvider, null, createElement(VoipCallProvider, null,
      createElement(Sidebar, { org: orgFromSession(state.session?.user), sessionLoaded: true }),
      createElement(NotificationBell),
      createElement(TicketNotifier),
    )))
  })
}

/** The browser's EventSource, driven by the test. */
class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static opened: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  onerror: (() => void) | null = null
  private listeners = new Map<string, Array<() => void>>()
  constructor(public url: string) { FakeEventSource.opened.push(this) }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close() { this.readyState = FakeEventSource.CLOSED }
  async emit(type: string) {
    if (type === "connected") this.readyState = FakeEventSource.OPEN
    await act(async () => { for (const listener of this.listeners.get(type) ?? []) listener() })
    await advance(0)
  }
  async fail(closed = false) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING
    await act(async () => { this.onerror?.() })
    await advance(0)
  }
}
const stream = () => FakeEventSource.opened.at(-1)!
const pollerRequests = () => requests.filter((request) => POLLERS.includes(request))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-27T09:00:00.000Z"))
  requests = []
  visibility = "visible"
  server.notifications = []
  server.sectionPush = true
  toast.mockClear()
  registerPush.mockClear()
  FakeEventSource.opened = []
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.spyOn(Math, "random").mockReturnValue(0.5)
  state.session = {
    iat: 1,
    user: {
      id: "synthetic-user-a", email: "synthetic-a@example.invalid",
      organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
      modules: { crm: true, omnichannel: true, support: true },
    },
  }
  state.status = "authenticated"
  state.pathname = "/dashboard"
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
  Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility !== "visible" })
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://app.leaddrivecrm.org")
    const entityType = url.searchParams.get("entityType")
    const key = `${url.pathname}${entityType ? `?entityType=${entityType}` : ""}`
    requests.push(key)
    return new Response(JSON.stringify(answer(key)), { status: 200, headers: { "content-type": "application/json" } })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("the shell on a live event stream", () => {
  it("reads each part once when the stream says connected, and nothing before", async () => {
    await render()
    await advance(1_000)
    expect(stream().url).toBe("/api/v1/shell/events")
    expect(pollerRequests()).toEqual([])

    await stream().emit("connected")
    for (const poller of POLLERS) expect({ poller, asked: asked(poller) }).toEqual({ poller, asked: 1 })
  })

  it("an idle connected tab reads only the safety refresh: 2.5 requests a minute instead of 28", async () => {
    await render()
    await stream().emit("connected")
    const start = requests.length
    await advance(SAFETY_REFRESH_MS - 1_000)
    expect(requests.length).toBe(start)
    await advance(1_000)
    expect(requests.slice(start).sort()).toEqual([...POLLERS].sort())
    // Ten minutes idle: five safety reads of five parts.
    await advance(4 * SAFETY_REFRESH_MS)
    expect(requests.length - start).toBe(25)
  })

  it("an event reads only its part, half a second later, and a burst of events reads once", async () => {
    await render()
    await stream().emit("connected")
    await advance(5_000)
    const start = requests.length

    await stream().emit("calls")
    expect(requests.length).toBe(start) // spread: not every tab of the office at once
    await advance(500)
    expect(requests.slice(start)).toEqual([CALLS])

    // A call that rings, is answered and claimed within seconds: one read
    // per three seconds, whatever the number of events.
    await stream().emit("calls")
    await stream().emit("calls")
    await stream().emit("calls")
    await advance(2_900)
    expect(asked(CALLS)).toBe(2)
    await advance(100)
    expect(asked(CALLS)).toBe(3)
    await advance(10_000)
    expect(asked(CALLS)).toBe(3)

    const before = requests.length
    await stream().emit("notifications")
    await stream().emit("tickets")
    await stream().emit("webchat")
    await advance(500)
    expect(requests.slice(before).sort()).toEqual([BELL, INBOX_BADGE, TICKETS, WEB_CHAT].sort())
  })

  it("events while the tab is hidden are read once, when it is shown", async () => {
    await render()
    await stream().emit("connected")
    await show("hidden")
    const start = requests.length
    await stream().emit("calls")
    await stream().emit("calls")
    await stream().emit("tickets")
    await advance(30_000)
    expect(requests.length).toBe(start)

    await show("visible")
    expect(requests.slice(start).sort()).toEqual([CALLS, TICKETS].sort())
  })

  it("the badges catch up on return when the last read is older than 30 s: a count read down elsewhere", async () => {
    await render()
    await stream().emit("connected")
    await show("hidden")
    await advance(20_000)
    const start = requests.length
    await show("visible")
    expect(requests.length).toBe(start) // 20 s: still fresh
    await show("hidden")
    await advance(20_000)
    await show("visible")
    expect(requests.slice(start).sort()).toEqual([BELL, INBOX_BADGE].sort())
  })

  it("a tab hidden for a minute closes its stream and reconnects when shown", async () => {
    await render()
    await stream().emit("connected")
    await show("hidden")
    await advance(59_000)
    expect(stream().readyState).not.toBe(FakeEventSource.CLOSED)
    await advance(1_000)
    expect(stream().readyState).toBe(FakeEventSource.CLOSED)
    expect(FakeEventSource.opened).toHaveLength(1)

    const start = requests.length
    await show("visible")
    expect(FakeEventSource.opened).toHaveLength(2)
    expect(requests.length).toBe(start) // waits for `connected`
    await stream().emit("connected")
    expect(requests.slice(start).sort()).toEqual([...POLLERS].sort())
  })

  it("a stream that never connects leaves the tab polling as before after 4 s", async () => {
    await render()
    await advance(3_900)
    expect(pollerRequests()).toEqual([])
    await advance(100)
    for (const poller of POLLERS) expect({ poller, asked: asked(poller) }).toEqual({ poller, asked: 1 })
    await advance(60_000)
    expect(asked(CALLS)).toBe(13)
  })

  it("a refused stream (a 502 while a deploy restarts the app) polls at once and tries a new stream later", async () => {
    await render()
    await stream().fail(true)
    for (const poller of POLLERS) expect({ poller, asked: asked(poller) }).toEqual({ poller, asked: 1 })

    await advance(9_900)
    expect(FakeEventSource.opened).toHaveLength(1)
    await advance(100)
    expect(FakeEventSource.opened).toHaveLength(2)
    // Still polling while the new one connects.
    const callsBefore = asked(CALLS)
    await advance(5_000)
    expect(asked(CALLS)).toBe(callsBefore + 1)

    await stream().emit("connected")
    const back = requests.length
    await advance(60_000)
    expect(requests.length).toBe(back)
  })

  it("refused again, the next try waits twice as long", async () => {
    await render()
    await stream().fail(true)
    await advance(10_000)
    await stream().fail(true)
    await advance(19_900)
    expect(FakeEventSource.opened).toHaveLength(2)
    await advance(100)
    expect(FakeEventSource.opened).toHaveLength(3)
  })

  it("a dropped stream polls after 15 s, and its return reads once and stops the polling", async () => {
    await render()
    await stream().emit("connected")
    const start = requests.length

    await stream().fail()
    await advance(14_000)
    expect(requests.length).toBe(start)
    await advance(1_000)
    expect(requests.slice(start).sort()).toEqual([...POLLERS].sort())
    await advance(10_000)
    expect(asked(CALLS)).toBe(4) // connected, fallback start, 5 s, 10 s

    await stream().emit("connected")
    const back = requests.length
    expect(asked(CALLS)).toBe(5)
    await advance(60_000)
    expect(requests.length).toBe(back)
  })

  it("opens no stream for a signed-out page and polls instead", async () => {
    state.session = null as never
    state.status = "unauthenticated" as never
    await render()
    await advance(0)
    expect(FakeEventSource.opened).toEqual([])
    // The bell still asks for itself (and gets the 401 it always got).
    expect(asked(BELL)).toBe(1)
  })
})
