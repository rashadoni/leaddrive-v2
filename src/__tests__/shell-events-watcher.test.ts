/**
 * The shell event watcher: one look at the database every two seconds for all
 * connected organisations, and an event only for what a tab would see change.
 *
 * Prisma is a stub that answers like the real tables do for the four queries;
 * the test moves rows in and out of it and reads which events come out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type CallRow = { id: string; organizationId: string; status: string; claimedByUserId: string | null; browserAnswerClaimExpiresAt: Date | null }
type Recent = { organizationId: string; userId?: string; count: number; newest: Date }

const db = vi.hoisted(() => ({
  calls: [] as CallRow[],
  notifications: [] as Recent[],
  tickets: [] as Recent[],
  chats: [] as Recent[],
  fail: false,
  queries: 0,
}))

vi.mock("@/lib/prisma", () => {
  const inOrgs = (where: { organizationId: { in: string[] } }, row: { organizationId: string }) => where.organizationId.in.includes(row.organizationId)
  const guard = () => {
    db.queries += 1
    if (db.fail) throw new Error("database unavailable")
  }
  return {
    prisma: {
      callLog: {
        findMany: vi.fn(async ({ where }: { where: { organizationId: { in: string[] } } }) => {
          guard()
          return db.calls.filter((row) => inOrgs(where, row))
        }),
      },
      notification: {
        groupBy: vi.fn(async ({ where }: { where: { organizationId: { in: string[] } } }) => {
          guard()
          return db.notifications.filter((row) => inOrgs(where, row)).map((row) => ({
            organizationId: row.organizationId, userId: row.userId, _count: { _all: row.count }, _max: { createdAt: row.newest },
          }))
        }),
      },
      ticket: {
        groupBy: vi.fn(async ({ where }: { where: { organizationId: { in: string[] } } }) => {
          guard()
          return db.tickets.filter((row) => inOrgs(where, row)).map((row) => ({
            organizationId: row.organizationId, _count: { _all: row.count }, _max: { createdAt: row.newest },
          }))
        }),
      },
      webChatSession: {
        groupBy: vi.fn(async ({ where }: { where: { organizationId: { in: string[] } } }) => {
          guard()
          return db.chats.filter((row) => inOrgs(where, row)).map((row) => ({
            organizationId: row.organizationId, _count: { _all: row.count }, _max: { lastMessageAt: row.newest },
          }))
        }),
      },
    },
  }
})

import { resetShellEventWatcherForTests, subscribeShellEvents, SHELL_WATCH_TICK_MS, type ShellEvent } from "@/lib/shell-events/watcher"

const ORG = "synthetic-org-a"
const OTHER_ORG = "synthetic-org-b"
const at = (iso: string) => new Date(iso)

async function tick(times = 1) {
  for (let turn = 0; turn < times; turn += 1) await vi.advanceTimersByTimeAsync(SHELL_WATCH_TICK_MS)
}

function listen(orgId = ORG) {
  const heard: ShellEvent[] = []
  const subscription = subscribeShellEvents(orgId, (event) => heard.push(event))
  return { heard, ...subscription }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(at("2026-10-27T09:00:00.000Z"))
  db.calls = []
  db.notifications = []
  db.tickets = []
  db.chats = []
  db.fail = false
  db.queries = 0
  resetShellEventWatcherForTests()
})

afterEach(() => {
  resetShellEventWatcherForTests()
  vi.useRealTimers()
})

describe("shell event watcher", () => {
  it("records what is there on connect without announcing it, and is ready after that look", async () => {
    db.calls = [{ id: "call-1", organizationId: ORG, status: "ringing", claimedByUserId: null, browserAnswerClaimExpiresAt: null }]
    db.tickets = [{ organizationId: ORG, count: 2, newest: at("2026-10-27T08:58:00.000Z") }]
    const tab = listen()
    let ready = false
    void tab.ready.then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(ready).toBe(true)
    await tick(3)
    expect(tab.heard).toEqual([])
  })

  it("announces a call that starts ringing, a claim that lapses, and a call that ends", async () => {
    const tab = listen()
    await vi.advanceTimersByTimeAsync(0)

    db.calls = [{ id: "call-1", organizationId: ORG, status: "ringing", claimedByUserId: null, browserAnswerClaimExpiresAt: null }]
    await tick()
    expect(tab.heard).toEqual([{ kind: "calls" }])

    // A seller claims it for 30 s. Nothing is written when the claim lapses —
    // the watcher still sees the call become free again.
    db.calls = [{ ...db.calls[0], claimedByUserId: "synthetic-user-b", browserAnswerClaimExpiresAt: at("2026-10-27T09:00:30.000Z") }]
    await tick()
    expect(tab.heard).toHaveLength(2)
    await tick(15)
    expect(tab.heard).toHaveLength(3)

    db.calls = []
    await tick()
    expect(tab.heard).toEqual([{ kind: "calls" }, { kind: "calls" }, { kind: "calls" }, { kind: "calls" }])
    await tick(5)
    expect(tab.heard).toHaveLength(4)
  })

  it("announces a new ticket or chat message, and stays quiet when the window only empties", async () => {
    db.tickets = [{ organizationId: ORG, count: 1, newest: at("2026-10-27T08:55:00.000Z") }]
    const tab = listen()
    await vi.advanceTimersByTimeAsync(0)

    db.tickets = [{ organizationId: ORG, count: 2, newest: at("2026-10-27T09:00:01.000Z") }]
    await tick()
    expect(tab.heard).toEqual([{ kind: "tickets" }])

    // A row stamped in the server's local clock sorts an hour ahead; the next
    // ticket is still news, by the count.
    db.tickets = [{ organizationId: ORG, count: 3, newest: at("2026-10-27T10:00:05.000Z") }]
    await tick()
    db.tickets = [{ organizationId: ORG, count: 4, newest: at("2026-10-27T10:00:05.000Z") }]
    await tick()
    expect(tab.heard.filter((event) => event.kind === "tickets")).toHaveLength(3)

    db.tickets = [{ organizationId: ORG, count: 1, newest: at("2026-10-27T10:00:05.000Z") }]
    await tick()
    db.tickets = []
    await tick()
    expect(tab.heard.filter((event) => event.kind === "tickets")).toHaveLength(3)

    db.chats = [{ organizationId: ORG, count: 1, newest: at("2026-10-27T09:00:20.000Z") }]
    await tick()
    expect(tab.heard.at(-1)).toEqual({ kind: "webchat" })
  })

  it("names the recipients of new notifications", async () => {
    db.notifications = [{ organizationId: ORG, userId: "synthetic-user-a", count: 1, newest: at("2026-10-27T08:59:00.000Z") }]
    const tab = listen()
    await vi.advanceTimersByTimeAsync(0)

    db.notifications = [
      { organizationId: ORG, userId: "synthetic-user-a", count: 1, newest: at("2026-10-27T08:59:00.000Z") },
      { organizationId: ORG, userId: "synthetic-user-b", count: 1, newest: at("2026-10-27T09:00:01.000Z") },
      { organizationId: ORG, userId: "", count: 1, newest: at("2026-10-27T09:00:01.000Z") },
    ]
    await tick()
    expect(tab.heard).toEqual([{ kind: "notifications", userIds: ["synthetic-user-b", ""] }])
  })

  it("keeps organisations apart", async () => {
    const mine = listen(ORG)
    const theirs = listen(OTHER_ORG)
    await vi.advanceTimersByTimeAsync(0)
    db.calls = [{ id: "call-b", organizationId: OTHER_ORG, status: "ringing", claimedByUserId: null, browserAnswerClaimExpiresAt: null }]
    await tick()
    expect(mine.heard).toEqual([])
    expect(theirs.heard).toEqual([{ kind: "calls" }])
  })

  it("looks once per tick for everyone, and not at all with nobody connected", async () => {
    const tabs = Array.from({ length: 50 }, () => listen())
    await vi.advanceTimersByTimeAsync(0)
    db.queries = 0
    await tick(5)
    expect(db.queries).toBe(5 * 4)

    for (const tab of tabs) tab.unsubscribe()
    db.queries = 0
    await tick(10)
    expect(db.queries).toBe(0)
  })

  it("survives a failing database and still lets the stream say connected", async () => {
    db.fail = true
    const tab = listen()
    let ready = false
    void tab.ready.then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(ready).toBe(true)
    await tick(2)

    db.fail = false
    await tick() // the first good look is the baseline
    db.calls = [{ id: "call-1", organizationId: ORG, status: "ringing", claimedByUserId: null, browserAnswerClaimExpiresAt: null }]
    await tick()
    expect(tab.heard).toEqual([{ kind: "calls" }])
  })
})
