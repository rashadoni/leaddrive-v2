/**
 * GET /api/v1/shell/events: who hears what.
 *
 * An event carries no data, but it still says that a call rang or a ticket
 * arrived. So the stream sends a person only the kinds whose route they could
 * read — the same module gate (`moduleAccessDenial`, the module half of
 * requireAuth, run for real here) — and only their own notifications.
 * requireAuth's authentication half and the organisation read are stubbed; the
 * watcher is replaced by a hand-driven one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import type { ShellEvent, ShellEventListener } from "@/lib/shell-events/watcher"

const auth = vi.hoisted(() => ({
  result: null as unknown,
  modules: {} as Record<string, boolean>,
}))
const watcher = vi.hoisted(() => ({
  listener: null as ShellEventListener | null,
  unsubscribed: 0,
}))

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/api-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-auth")>()
  return {
    ...actual,
    requireAuth: vi.fn(async () => auth.result),
    getOrgModuleContext: vi.fn(async () => ({ plan: "enterprise", addons: [], modules: auth.modules })),
  }
})
vi.mock("@/lib/shell-events/watcher", () => ({
  subscribeShellEvents: (_orgId: string, listener: ShellEventListener) => {
    watcher.listener = listener
    return { ready: Promise.resolve(), unsubscribe: () => { watcher.unsubscribed += 1 } }
  },
}))

import { GET } from "@/app/api/v1/shell/events/route"
import { resetShellPresenceForTests, shellPresentUserIds } from "@/lib/shell-events/presence"

const ALL_MODULES = { voip: true, support: true, omnichannel: true }

function person(overrides: Partial<AuthResult> = {}): AuthResult {
  return {
    orgId: "synthetic-org-a", userId: "synthetic-user-a", role: "manager",
    email: "synthetic-a@example.invalid", name: "Synthetic A", principalType: "session",
    ...overrides,
  }
}

type Open = { read: () => Promise<string>; abort: () => void }

async function open(): Promise<Open> {
  const controller = new AbortController()
  const req = new NextRequest("https://app.leaddrivecrm.org/api/v1/shell/events", { signal: controller.signal })
  const response = await GET(req, undefined as never)
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }))
      if (done) return
      buffer += decoder.decode(value)
    }
  })()
  return {
    /** What the stream wrote since the last read: it writes as soon as an event comes. */
    async read() {
      await new Promise((resolve) => setTimeout(resolve, 20))
      const out = buffer
      buffer = ""
      return out
    },
    abort: () => controller.abort(),
  }
}

const events = (text: string) => [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1])
const connectedKinds = (text: string) => {
  const match = text.match(/event: connected\ndata: (.+)\n/)
  return match ? (JSON.parse(match[1]) as { kinds: string[] }).kinds.sort() : null
}
const emit = (event: ShellEvent) => watcher.listener!(event)

beforeEach(() => {
  auth.result = person()
  auth.modules = { ...ALL_MODULES }
  watcher.listener = null
  watcher.unsubscribed = 0
  resetShellPresenceForTests()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/v1/shell/events", () => {
  it("says connected with the kinds a manager with every module may hear, then passes them on", async () => {
    const stream = await open()
    const first = await stream.read()
    expect(first).toMatch(/^retry: \d+\n\n/)
    expect(connectedKinds(first)).toEqual(["calls", "notifications", "tickets", "webchat"])

    emit({ kind: "calls" })
    emit({ kind: "tickets" })
    emit({ kind: "webchat" })
    expect(events(await stream.read())).toEqual(["calls", "tickets", "webchat"])
    stream.abort()
  })

  it("sends only this person's notifications and those for everyone", async () => {
    const stream = await open()
    await stream.read()
    emit({ kind: "notifications", userIds: ["synthetic-user-b"] })
    expect(events(await stream.read())).toEqual([])
    emit({ kind: "notifications", userIds: ["synthetic-user-b", "synthetic-user-a"] })
    emit({ kind: "notifications", userIds: [""] })
    expect(events(await stream.read())).toEqual(["notifications", "notifications"])
    stream.abort()
  })

  it("keeps calls, tickets and chat from a tenant that has not got the module", async () => {
    auth.modules = { voip: false, support: false, omnichannel: false }
    const stream = await open()
    expect(connectedKinds(await stream.read())).toEqual(["notifications"])
    emit({ kind: "calls" })
    emit({ kind: "tickets" })
    emit({ kind: "webchat" })
    expect(events(await stream.read())).toEqual([])
    stream.abort()
  })

  it("keeps a module an admin hid from this person", async () => {
    auth.result = person({ hiddenModules: ["voip"] })
    const stream = await open()
    expect(connectedKinds(await stream.read())).toEqual(["notifications", "tickets", "webchat"])
    emit({ kind: "calls" })
    expect(events(await stream.read())).toEqual([])
    stream.abort()
  })

  it("follows the role: ticketing reads tickets, not calls or the inbox", async () => {
    auth.result = person({ role: "ticketing" })
    const stream = await open()
    expect(connectedKinds(await stream.read())).toEqual(["notifications", "tickets"])
    emit({ kind: "calls" })
    emit({ kind: "webchat" })
    emit({ kind: "tickets" })
    expect(events(await stream.read())).toEqual(["tickets"])
    stream.abort()
  })

  it("subscribes nothing when the tab left while authentication ran", async () => {
    const controller = new AbortController()
    controller.abort()
    const response = await GET(new NextRequest("https://app.leaddrivecrm.org/api/v1/shell/events", { signal: controller.signal }), undefined as never)
    await response.body!.getReader().read()
    expect(watcher.listener).toBeNull()
  })

  it("closes after at most 35 minutes, so the browser reconnects and the kinds are decided again", async () => {
    vi.useFakeTimers()
    try {
      const response = await GET(new NextRequest("https://app.leaddrivecrm.org/api/v1/shell/events"), undefined as never)
      const reader = response.body!.getReader()
      let done = false
      void (async () => {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) { done = true; return }
        }
      })()
      await vi.advanceTimersByTimeAsync(24 * 60_000)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(11 * 60_000)
      expect(done).toBe(true)
      expect(watcher.unsubscribed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("passes on what requireAuth refuses, before any stream", async () => {
    auth.result = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const response = await GET(new NextRequest("https://app.leaddrivecrm.org/api/v1/shell/events"), undefined as never)
    expect(response.status).toBe(401)
    expect(watcher.listener).toBeNull()
  })

  // Owner, 2026-10-27: the AI line offers a transfer to a manager only while
  // one could answer — someone with the CRM open who would see the call.
  it("counts a person who may answer calls as present while the tab is open", async () => {
    const first = await open()
    await first.read()
    expect(shellPresentUserIds("synthetic-org-a")).toEqual(["synthetic-user-a"])
    const second = await open()
    await second.read()
    first.abort()
    // Another tab of the same person is still open.
    expect(shellPresentUserIds("synthetic-org-a")).toEqual(["synthetic-user-a"])
    second.abort()
    expect(shellPresentUserIds("synthetic-org-a")).toEqual([])
  })

  it("does not count someone who cannot answer a call: a viewer, or a tenant without calls", async () => {
    auth.result = person({ role: "viewer" })
    const viewer = await open()
    expect(connectedKinds(await viewer.read())).toContain("calls")
    expect(shellPresentUserIds("synthetic-org-a")).toEqual([])
    viewer.abort()

    auth.result = person()
    auth.modules = { voip: false }
    const noCalls = await open()
    await noCalls.read()
    expect(shellPresentUserIds("synthetic-org-a")).toEqual([])
    noCalls.abort()
  })

  it("lets go of the watcher when the tab goes away", async () => {
    const stream = await open()
    await stream.read()
    stream.abort()
    expect(watcher.unsubscribed).toBe(1)
  })
})
