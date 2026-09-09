/**
 * T8 Cobrowse — signal route tests (agent + public).
 *
 * Verifies cross-tenant scoping, state guard, payload-size cap,
 * and pub-sub delivery routing through the channel manager.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cobrowseSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { POST as AGENT_SIGNAL } from "@/app/api/v1/cobrowse/sessions/[id]/signal/route"
import { POST as PUBLIC_SIGNAL } from "@/app/api/v1/public/cobrowse/signal/route"
import {
  __resetChannelsForTest,
  subscribe,
  type SignalEnvelope,
} from "@/lib/cobrowse/channels"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const VALID_TOKEN = "a".repeat(43)

function makeReq(url: string, body: unknown) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
const auth = (orgId = "org1") => ({ orgId, userId: "u1", role: "admin", email: "", name: "" })

beforeEach(() => {
  vi.clearAllMocks()
  __resetChannelsForTest()
})

/* ── Agent signal ──────────────────────────────────────────────── */

describe("POST /api/v1/cobrowse/sessions/[id]/signal — agent", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("400 on missing kind", async () => {
    const res = await AGENT_SIGNAL(makeReq("/", { payload: {} }), makeParams("s1"))
    expect(res.status).toBe(400)
  })

  it("400 on unknown kind", async () => {
    const res = await AGENT_SIGNAL(makeReq("/", { kind: "ping", payload: {} }), makeParams("s1"))
    expect(res.status).toBe(400)
  })

  it("413 on oversized payload (tightened to 16KB cap)", async () => {
    const big = { sdp: "x".repeat(20 * 1024) }
    const res = await AGENT_SIGNAL(makeReq("/", { kind: "offer", payload: big }), makeParams("s1"))
    expect(res.status).toBe(413)
  })

  it("404 on cross-tenant session", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue(null)
    const res = await AGENT_SIGNAL(makeReq("/", { kind: "offer", payload: {} }), makeParams("s1"))
    expect(res.status).toBe(404)
  })

  it("409 when session is in pending state (not yet signalling)", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1", status: "pending",
    } as any)
    const res = await AGENT_SIGNAL(makeReq("/", { kind: "offer", payload: {} }), makeParams("s1"))
    expect(res.status).toBe(409)
  })

  it("409 when session is ended", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1", status: "ended",
    } as any)
    const res = await AGENT_SIGNAL(makeReq("/", { kind: "ended", payload: {} }), makeParams("s1"))
    expect(res.status).toBe(409)
  })

  it("delivered=true when customer is subscribed", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1", status: "active",
    } as any)
    const customerFn = vi.fn()
    subscribe("s1", "customer", customerFn)

    const res = await AGENT_SIGNAL(
      makeReq("/", { kind: "offer", payload: { sdp: "v=0" } }),
      makeParams("s1"),
    )
    expect(res.status).toBe(200)
    const body: { delivered: boolean } = await res.json()
    expect(body.delivered).toBe(true)
    expect(customerFn).toHaveBeenCalledTimes(1)
    const env: SignalEnvelope = customerFn.mock.calls[0][0]
    expect(env.from).toBe("agent")
    expect(env.kind).toBe("offer")
  })

  it("delivered=false when customer hasn't subscribed yet", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1", status: "active",
    } as any)
    const res = await AGENT_SIGNAL(
      makeReq("/", { kind: "ice", payload: {} }),
      makeParams("s1"),
    )
    expect(res.status).toBe(200)
    const body: { delivered: boolean } = await res.json()
    expect(body.delivered).toBe(false)
  })

  it("409 in awaiting_consent (tightened — pre-consent offers would silently drop without persistence)", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1", status: "awaiting_consent",
    } as any)
    const res = await AGENT_SIGNAL(
      makeReq("/", { kind: "offer", payload: {} }),
      makeParams("s1"),
    )
    expect(res.status).toBe(409)
  })

  it("accepts signal in paused state (resume offer)", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1", status: "paused",
    } as any)
    const res = await AGENT_SIGNAL(
      makeReq("/", { kind: "resume", payload: {} }),
      makeParams("s1"),
    )
    expect(res.status).toBe(200)
  })
})

/* ── Public (customer) signal ─────────────────────────────────── */

describe("POST /api/v1/public/cobrowse/signal — customer", () => {
  it("400 on malformed joinToken", async () => {
    const res = await PUBLIC_SIGNAL(makeReq("/", { joinToken: "x", kind: "offer", payload: {} }))
    expect(res.status).toBe(400)
  })

  it("404 when token doesn't match", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue(null)
    const res = await PUBLIC_SIGNAL(
      makeReq("/", { joinToken: VALID_TOKEN, kind: "answer", payload: {} }),
    )
    expect(res.status).toBe(404)
  })

  it("409 when session not in signalling state", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1", status: "ended",
    } as any)
    const res = await PUBLIC_SIGNAL(
      makeReq("/", { joinToken: VALID_TOKEN, kind: "answer", payload: {} }),
    )
    expect(res.status).toBe(409)
  })

  it("routes payload to agent listener", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1", status: "active",
    } as any)
    const agentFn = vi.fn()
    subscribe("s1", "agent", agentFn)

    const res = await PUBLIC_SIGNAL(
      makeReq("/", { joinToken: VALID_TOKEN, kind: "ice", payload: { candidate: "host" } }),
    )
    expect(res.status).toBe(200)
    expect(agentFn).toHaveBeenCalledTimes(1)
    expect((agentFn.mock.calls[0][0] as SignalEnvelope).from).toBe("customer")
  })

  it("413 on oversized payload (tightened to 16KB cap)", async () => {
    const big = { x: "y".repeat(20 * 1024) }
    const res = await PUBLIC_SIGNAL(
      makeReq("/", { joinToken: VALID_TOKEN, kind: "ice", payload: big }),
    )
    expect(res.status).toBe(413)
  })
})

describe("preflightContentLength helper", () => {
  it("rejects requests when Content-Length header exceeds cap", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    // Forge a request with an absurdly-high Content-Length header.
    const req = new NextRequest(new URL("/", "http://localhost:3000"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(10 * 1024 * 1024), // 10MB header claim
      },
      body: JSON.stringify({ kind: "offer", payload: { tiny: "ok" } }),
    })
    const res = await AGENT_SIGNAL(req, makeParams("s1"))
    expect(res.status).toBe(413)
  })
})
