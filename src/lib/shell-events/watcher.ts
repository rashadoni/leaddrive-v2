import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { ACTIVE_CALL_MAX_AGE_MS, ACTIVE_CALL_STATUSES } from "@/lib/calls/active-call-window"
import { logOperationalFailure } from "@/lib/telemetry/operational-failure"

/**
 * Tells open CRM tabs the moment something they show has changed — an incoming
 * call, a notification, a new ticket, a visitor's chat message — so they stop
 * asking the server every few seconds.
 *
 * Measured on production 2026-10-27: polls were 37% of all requests (20 000
 * of 55 000 since midnight), an idle tab on screen sent 28 a minute, each
 * costing the single web process ~0.05 s of its one core, almost all of it
 * authentication rather than the query. Here one watcher per process looks at
 * the database every two seconds for every organisation with a tab connected,
 * whatever the number of tabs: four small indexed queries per tick in total.
 *
 * It reads the database rather than being told by the writers, because calls,
 * notifications and tickets are written from the web process, the jobs
 * process, webhooks and the softphone relay alike.
 *
 * Events carry no data, only what changed. The tab then reads it through the
 * route it always used, with that route's permission check.
 */

export type ShellEventKind = "calls" | "notifications" | "tickets" | "webchat"

/** `userIds` names the recipients of a notifications event; "" is everyone in the organisation. */
export type ShellEvent = { kind: ShellEventKind; userIds?: string[] }
export type ShellEventListener = (event: ShellEvent) => void

export const SHELL_WATCH_TICK_MS = 2_000

// A new row is recognised by what it does to this window: the newest time
// grows or the count does. Comparing against a high-water mark instead would
// let one row stamped in another clock (raw SQL defaults run in the server's
// Europe/Berlin, the columns hold UTC) hide every row after it.
const RECENT_WINDOW_MS = 10 * 60_000

type Recent = { count: number; newest: number }

type Watcher = {
  listeners: Map<string, Set<ShellEventListener>>
  /** `calls:<org>` → active-call fingerprint. */
  calls: Map<string, string>
  /** `tickets:<org>`, `webchat:<org>`, `notifications:<org>:<user>` → the window. */
  recent: Map<string, Recent>
  /** Organisations whose first tick is recorded: before it nothing is news. */
  baselined: Set<string>
  waiting: Map<string, Array<() => void>>
  timer: ReturnType<typeof setTimeout> | null
  ticking: boolean
  tickAgain: boolean
  lastFailureLoggedAt: number
}

const globalForWatcher = globalThis as unknown as { __leaddriveShellEventWatcher?: Watcher }

function watcher(): Watcher {
  globalForWatcher.__leaddriveShellEventWatcher ??= {
    listeners: new Map(),
    calls: new Map(),
    recent: new Map(),
    baselined: new Set(),
    waiting: new Map(),
    timer: null,
    ticking: false,
    tickAgain: false,
    lastFailureLoggedAt: 0,
  }
  return globalForWatcher.__leaddriveShellEventWatcher
}

/**
 * Listen to one organisation. `ready` resolves once the watcher has recorded
 * what the organisation looks like now: a tab that reads its data after
 * `ready` misses nothing, because every later change is an event.
 */
export function subscribeShellEvents(
  orgId: string,
  listener: ShellEventListener,
): { ready: Promise<void>; unsubscribe: () => void } {
  const w = watcher()
  let set = w.listeners.get(orgId)
  if (!set) {
    set = new Set()
    w.listeners.set(orgId, set)
  }
  set.add(listener)

  let ready: Promise<void>
  if (w.baselined.has(orgId)) {
    ready = Promise.resolve()
    requestTick(w, SHELL_WATCH_TICK_MS)
  } else {
    ready = new Promise<void>((resolve) => {
      const queue = w.waiting.get(orgId) ?? []
      queue.push(resolve)
      w.waiting.set(orgId, queue)
    })
    requestTick(w, 0)
  }

  let subscribed = true
  const unsubscribe = () => {
    if (!subscribed) return
    subscribed = false
    const current = w.listeners.get(orgId)
    if (!current) return
    current.delete(listener)
    if (current.size > 0) return
    w.listeners.delete(orgId)
    forget(w, orgId)
    if (w.listeners.size === 0 && w.timer) {
      clearTimeout(w.timer)
      w.timer = null
    }
  }
  return { ready, unsubscribe }
}

function forget(w: Watcher, orgId: string) {
  w.baselined.delete(orgId)
  w.calls.delete(`calls:${orgId}`)
  for (const key of [...w.recent.keys()]) {
    if (key.endsWith(`:${orgId}`) || key.includes(`:${orgId}:`)) w.recent.delete(key)
  }
  for (const resolve of w.waiting.get(orgId) ?? []) resolve()
  w.waiting.delete(orgId)
}

function requestTick(w: Watcher, delayMs: number) {
  if (w.listeners.size === 0) return
  if (w.ticking) {
    if (delayMs === 0) w.tickAgain = true
    return
  }
  if (w.timer) {
    if (delayMs > 0) return
    clearTimeout(w.timer)
  }
  w.timer = setTimeout(() => {
    w.timer = null
    void tick(w)
  }, delayMs)
  w.timer.unref?.()
}

async function readSignals(orgs: string[], now: number) {
  const since = new Date(now - RECENT_WINDOW_MS)
  return runWithRlsBypass(async () => {
    const [calls, notifications, tickets, chats] = await Promise.all([
      prisma.callLog.findMany({
        where: {
          organizationId: { in: orgs },
          status: { in: ACTIVE_CALL_STATUSES },
          startedAt: { gte: new Date(now - ACTIVE_CALL_MAX_AGE_MS) },
        },
        select: { id: true, organizationId: true, status: true, claimedByUserId: true, browserAnswerClaimExpiresAt: true },
        orderBy: { id: "asc" },
        take: 500,
      }),
      prisma.notification.groupBy({
        by: ["organizationId", "userId"],
        where: { organizationId: { in: orgs }, createdAt: { gt: since } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.ticket.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: orgs }, createdAt: { gt: since } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.webChatSession.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: orgs }, lastMessageAt: { gt: since } },
        _count: { _all: true },
        _max: { lastMessageAt: true },
      }),
    ])
    return { calls, notifications, tickets, chats }
  })
}

// A look that has not answered by then counts as failed, so one stuck query
// cannot stop the watcher for every tab.
const TICK_TIMEOUT_MS = 15_000

function withinTime<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("shell events look timed out")), ms)
    timer.unref?.()
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** True when the window gained a row: a newer time, or more rows. */
function grew(previous: Recent | undefined, next: Recent): boolean {
  if (!previous) return true
  return next.newest > previous.newest || next.count > previous.count
}

async function tick(w: Watcher) {
  w.ticking = true
  const orgs = [...w.listeners.keys()]
  const events: Array<{ orgId: string; event: ShellEvent }> = []
  try {
    const now = Date.now()
    const { calls, notifications, tickets, chats } = await withinTime(readSignals(orgs, now), TICK_TIMEOUT_MS)

    // Which calls a popup shows depends on status and on whether a browser
    // claim is still fresh — and a claim lapses without anything being written.
    const callPrints = new Map<string, string[]>()
    for (const call of calls) {
      const claimFresh = Boolean(call.claimedByUserId) && (call.browserAnswerClaimExpiresAt?.getTime() ?? 0) > now
      const print = `${call.id}:${call.status}:${claimFresh ? call.claimedByUserId : ""}`
      const list = callPrints.get(call.organizationId) ?? []
      list.push(print)
      callPrints.set(call.organizationId, list)
    }

    const nextRecent = new Map<string, Recent>()
    for (const row of tickets) {
      nextRecent.set(`tickets:${row.organizationId}`, { count: row._count._all, newest: row._max.createdAt?.getTime() ?? 0 })
    }
    for (const row of chats) {
      nextRecent.set(`webchat:${row.organizationId}`, { count: row._count._all, newest: row._max.lastMessageAt?.getTime() ?? 0 })
    }
    for (const row of notifications) {
      nextRecent.set(`notifications:${row.organizationId}:${row.userId}`, { count: row._count._all, newest: row._max.createdAt?.getTime() ?? 0 })
    }

    for (const orgId of orgs) {
      if (!w.listeners.has(orgId)) continue // left while the queries ran
      const known = w.baselined.has(orgId)

      const callsKey = `calls:${orgId}`
      const print = (callPrints.get(orgId) ?? []).join("|")
      if (known && w.calls.get(callsKey) !== print) events.push({ orgId, event: { kind: "calls" } })
      w.calls.set(callsKey, print)

      for (const kind of ["tickets", "webchat"] as const) {
        const key = `${kind}:${orgId}`
        const next = nextRecent.get(key)
        if (next) {
          if (known && grew(w.recent.get(key), next)) events.push({ orgId, event: { kind } })
          w.recent.set(key, next)
        } else {
          w.recent.delete(key) // the window emptied: nothing new arrived
        }
      }

      const prefix = `notifications:${orgId}:`
      const recipients: string[] = []
      for (const key of [...w.recent.keys()]) {
        if (key.startsWith(prefix) && !nextRecent.has(key)) w.recent.delete(key)
      }
      for (const [key, next] of nextRecent) {
        if (!key.startsWith(prefix)) continue
        if (known && grew(w.recent.get(key), next)) recipients.push(key.slice(prefix.length))
        w.recent.set(key, next)
      }
      if (recipients.length > 0) events.push({ orgId, event: { kind: "notifications", userIds: recipients } })

      w.baselined.add(orgId)
    }
  } catch {
    // Keep watching; a connected tab still reads on its own every two minutes,
    // and one still waiting for `connected` polls. Logged at most once a
    // minute, without the error itself.
    if (Date.now() - w.lastFailureLoggedAt > 60_000) {
      w.lastFailureLoggedAt = Date.now()
      logOperationalFailure("shell-events-watch")
    }
  } finally {
    w.ticking = false
    // `ready` waits for a look that worked: an organisation recorded from a
    // failed look would take its next good one as the baseline, silently. The
    // tab polls meanwhile (its 4 s fallback).
    for (const orgId of orgs) {
      if (!w.baselined.has(orgId)) continue
      for (const resolve of w.waiting.get(orgId) ?? []) resolve()
      w.waiting.delete(orgId)
    }
  }

  for (const { orgId, event } of events) {
    for (const listener of [...(w.listeners.get(orgId) ?? [])]) {
      try {
        listener(event)
      } catch {
        // one broken stream must not stop the others
      }
    }
  }

  const again = w.tickAgain
  w.tickAgain = false
  requestTick(w, again ? 0 : SHELL_WATCH_TICK_MS)
}

/** Tests only: forget every listener and timer. */
export function resetShellEventWatcherForTests() {
  const w = globalForWatcher.__leaddriveShellEventWatcher
  if (w?.timer) clearTimeout(w.timer)
  delete globalForWatcher.__leaddriveShellEventWatcher
}
