// @vitest-environment jsdom
/**
 * What an open CRM tab asks the server while nobody touches it.
 *
 * Measured on production 2026-10-27, owner's tab on /dashboard: idle and on
 * screen it sent 19 requests in 40 s, hidden still 11 (incoming calls every
 * 5 s, the inbox badge, the web-chat count). Each cost the single web process
 * ~0.05 s of its one core, so about fifty open tabs filled it. A page load
 * also asked for the notification preferences three times and for the
 * notifications twice: the bell refetched on every new session object, and
 * next-auth hands out a new one on each of its reads.
 *
 * The shell's real pollers are rendered together — VoipCallProvider, Sidebar,
 * NotificationBell, TicketNotifier — over a stubbed network, and the test
 * counts what reaches it.
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

import { VoipCallProvider } from "@/components/voip-call-provider"
import { Sidebar } from "@/components/sidebar"
import { NotificationBell } from "@/components/notification-bell"
import { TicketNotifier } from "@/components/ticket-notifier"
import { announceNotificationPreferencesChanged } from "@/lib/notifications/preferences-changed"
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
const askedAll = () => Object.fromEntries([...POLLERS, PREFERENCES].map((key) => [key, asked(key)]))

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
    root.render(createElement(VoipCallProvider, null,
      createElement(Sidebar, { org: orgFromSession(state.session.user), sessionLoaded: true }),
      createElement(NotificationBell),
      createElement(TicketNotifier),
    ))
  })
}

/** What next-auth does on each session read: same person, new object, new iat. */
async function sessionRead() {
  state.session = { ...state.session, iat: state.session.iat + 1, user: { ...state.session.user } }
  await render()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-27T09:00:00.000Z"))
  requests = []
  visibility = "visible"
  server.notifications = []
  server.sectionPush = true
  toast.mockClear()
  registerPush.mockClear()
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

describe("the shell's pollers on an idle tab", () => {
  it("a page load asks each thing once, and session reads do not ask again", async () => {
    await render()
    await advance(2_500)
    expect(askedAll()).toEqual({
      [CALLS]: 1, [BELL]: 1, [INBOX_BADGE]: 1, [WEB_CHAT]: 1, [TICKETS]: 1, [PREFERENCES]: 1,
    })

    // next-auth reads the session twice on every load and again whenever a
    // page loads in another tab. Before, each read refetched the bell's list
    // and preferences and restarted the ticket poll.
    await sessionRead()
    await sessionRead()
    await sessionRead()
    await advance(2_000)
    expect(askedAll()).toEqual({
      [CALLS]: 1, [BELL]: 1, [INBOX_BADGE]: 1, [WEB_CHAT]: 1, [TICKETS]: 1, [PREFERENCES]: 1,
    })
  })

  it("a hidden tab asks nothing, and coming back asks once for each", async () => {
    await render()
    await advance(2_500)
    const before = requests.length

    await show("hidden")
    await advance(120_000)
    expect(requests.length).toBe(before)

    const atReturn = askedAll()
    await show("visible")
    for (const poller of POLLERS) expect({ poller, asked: asked(poller) }).toEqual({ poller, asked: atReturn[poller] + 1 })
    expect(asked(PREFERENCES)).toBe(1)

    // The intervals restart from the return: the next call poll is 5 s on,
    // and nothing else is due by then.
    const afterReturn = requests.length
    await advance(4_900)
    expect(requests.length).toBe(afterReturn)
    await advance(100)
    expect(requests.slice(afterReturn)).toEqual([CALLS])
  })

  it("a tab opened in the background asks nothing until it is first shown", async () => {
    visibility = "hidden"
    await render()
    await advance(60_000)
    expect(requests.filter((request) => POLLERS.includes(request))).toEqual([])

    await show("visible")
    for (const poller of POLLERS) expect({ poller, asked: asked(poller) }).toEqual({ poller, asked: 1 })
  })

  it("an idle tab on screen keeps its rhythm: calls 5 s, bell 10 s, tickets 2 s then 12 s, inbox 20 s, chat 30 s", async () => {
    await render()
    await advance(0)
    const start = askedAll()
    await advance(60_000)
    expect({
      calls: asked(CALLS) - start[CALLS],
      bell: asked(BELL) - start[BELL],
      tickets: asked(TICKETS) - start[TICKETS],
      inbox: asked(INBOX_BADGE) - start[INBOX_BADGE],
      chat: asked(WEB_CHAT) - start[WEB_CHAT],
    }).toEqual({ calls: 12, bell: 6, tickets: 6, inbox: 3, chat: 2 })
  })

  it("an organisation without the inbox module is never asked for the web-chat count", async () => {
    state.session = { ...state.session, user: { ...state.session.user, modules: { crm: true, support: true } } }
    await render()
    await advance(60_000)
    expect(asked(WEB_CHAT)).toBe(0)
    expect(asked(CALLS)).toBeGreaterThan(0)
  })

  it("a preference saved in settings reaches the bell without a reload", async () => {
    await render()
    await advance(0)
    const deal = (id: string) => ({
      id, type: "info", title: `Deal ${id}`, message: "", entityType: "deal", isRead: false, createdAt: "2026-10-27T09:00:00.000Z",
    })

    server.notifications = [deal("n-1")]
    await advance(10_000)
    expect(toast).toHaveBeenCalledTimes(1)

    // The settings page switches pop-ups off for the section and says so.
    server.sectionPush = false
    announceNotificationPreferencesChanged()
    await advance(0)
    expect(asked(PREFERENCES)).toBe(2)

    server.notifications = [deal("n-2"), deal("n-1")]
    await advance(10_000)
    expect(toast).toHaveBeenCalledTimes(1)

    // Saved in another tab of the same browser: heard as a storage event.
    window.dispatchEvent(new StorageEvent("storage", { key: "ld-notification-preferences-changed-at", newValue: "1" }))
    await advance(0)
    expect(asked(PREFERENCES)).toBe(3)
  })

  it("registers the push subscription once per load, also when the menu learns the modules", async () => {
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted" } })
    try {
      state.session = { ...state.session, user: { ...state.session.user, modules: { crm: true, support: true } } }
      await render()
      await advance(0)
      // The organisation's modules arrive: the inbox appears in the menu.
      state.session = { ...state.session, user: { ...state.session.user, modules: { crm: true, omnichannel: true, support: true } } }
      await render()
      await advance(0)
      expect(asked(WEB_CHAT)).toBe(1)
      expect(registerPush).toHaveBeenCalledTimes(1)
    } finally {
      Reflect.deleteProperty(window, "Notification")
    }
  })

  it("navigating does not restart the ticket poll", async () => {
    await render()
    await advance(2_500)
    expect(asked(TICKETS)).toBe(1)

    for (const path of ["/contacts", "/deals", "/companies"]) {
      state.pathname = path
      await render()
      await advance(2_500)
    }
    // Before, each navigation rebuilt the poll and asked again 2 s later.
    expect(asked(TICKETS)).toBe(1)

    // The interval still counts from the mount.
    await advance(12_000 - 10_000)
    expect(asked(TICKETS)).toBe(2)
  })
})
