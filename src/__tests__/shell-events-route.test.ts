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

  it("follows the role: a viewer hears no more than the routes would show them", async () => {
    auth.result = person({ role: "viewer" })
    const stream = await open()
    const kinds = connectedKinds(await stream.read())!
    const { checkPermission } = await import("@/lib/permissions")
    expect(kinds).toEqual([
      "notifications",
      ...(checkPermission("viewer", "voip", "read") ? ["calls"] : []),
      ...(checkPermission("viewer", "tickets", "read") ? ["tickets"] : []),
      ...(checkPermission("viewer", "inbox", "read") ? ["webchat"] : []),
    ].sort())
    stream.abort()
  })

  it("passes on what requireAuth refuses, before any stream", async () => {
    auth.result = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const response = await GET(new NextRequest("https://app.leaddrivecrm.org/api/v1/shell/events"), undefined as never)
    expect(response.status).toBe(401)
    expect(watcher.listener).toBeNull()
  })

  it("lets go of the watcher when the tab goes away", async () => {
    const stream = await open()
    await stream.read()
    stream.abort()
    expect(watcher.unsubscribed).toBe(1)
  })
})
