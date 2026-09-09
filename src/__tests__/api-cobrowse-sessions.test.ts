/**
 * T8 Cobrowse — agent-side session route tests.
 *
 * Covers POST (create), GET (fetch), PATCH (transition) with focus
 * on cross-tenant safety + state-machine integration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cobrowseSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    contact: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { POST as CREATE } from "@/app/api/v1/cobrowse/sessions/route"
import { GET, PATCH } from "@/app/api/v1/cobrowse/sessions/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

function makeReq(url: string, method: string, body?: unknown) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
const auth = (orgId = "org1", userId = "u1") => ({
  orgId, userId, role: "admin", email: "", name: "",
})

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── POST /api/v1/cobrowse/sessions ───────────────────────────── */

describe("POST /api/v1/cobrowse/sessions", () => {
  it("propagates auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response("Unauthorized", { status: 401 }) as never)
    const res = await CREATE(makeReq("/api/v1/cobrowse/sessions", "POST", {}))
    expect(res.status).toBe(401)
  })

  it("creates a pending session WITHOUT contactId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.create).mockResolvedValue({
      id: "sess1",
      organizationId: "org1",
      agentUserId: "u1",
      contactId: null,
      status: "pending",
      joinToken: "tok",
      startedAt: new Date(),
    } as any)

    const res = await CREATE(makeReq("/api/v1/cobrowse/sessions", "POST", {}))
    expect(res.status).toBe(201)
    expect(prisma.cobrowseSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org1",
          agentUserId: "u1",
          contactId: null,
          status: "pending",
        }),
      }),
    )
    // joinToken should be 43-char URL-safe.
    const call = vi.mocked(prisma.cobrowseSession.create).mock.calls[0][0]
    expect(call.data.joinToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("404 when contactId is in another org (cross-tenant)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)
    const res = await CREATE(makeReq("/api/v1/cobrowse/sessions", "POST", { contactId: "alien" }))
    expect(res.status).toBe(404)
    expect(prisma.cobrowseSession.create).not.toHaveBeenCalled()
  })

  it("scopes contact verification by org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c1" } as any)
    vi.mocked(prisma.cobrowseSession.create).mockResolvedValue({ id: "sess1" } as any)
    await CREATE(makeReq("/api/v1/cobrowse/sessions", "POST", { contactId: "c1" }))
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", organizationId: "org1" },
      select: { id: true },
    })
  })
})

/* ── GET /api/v1/cobrowse/sessions/[id] ───────────────────────── */

describe("GET /api/v1/cobrowse/sessions/[id]", () => {
  it("propagates auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response("Unauthorized", { status: 401 }) as never)
    const res = await GET(makeReq("/api/v1/cobrowse/sessions/s1", "GET"), makeParams("s1"))
    expect(res.status).toBe(401)
  })

  it("404 when session in another org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/cobrowse/sessions/s1", "GET"), makeParams("s1"))
    expect(res.status).toBe(404)
  })

  it("returns the session when present", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "active",
    } as any)
    const res = await GET(makeReq("/api/v1/cobrowse/sessions/s1", "GET"), makeParams("s1"))
    expect(res.status).toBe(200)
    const body: { session: { id: string } } = await res.json()
    expect(body.session.id).toBe("s1")
  })
})

/* ── PATCH /api/v1/cobrowse/sessions/[id] ─────────────────────── */

describe("PATCH /api/v1/cobrowse/sessions/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("400 when status is not in enum", async () => {
    const res = await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "zombie" }),
      makeParams("s1"),
    )
    expect(res.status).toBe(400)
  })

  it("400 when endReason supplied for non-ended transition", async () => {
    const res = await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "paused", endReason: "timeout" }),
      makeParams("s1"),
    )
    expect(res.status).toBe(400)
  })

  it("404 when session is in another org", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue(null)
    const res = await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "paused" }),
      makeParams("s1"),
    )
    expect(res.status).toBe(404)
  })

  it("409 when transition is invalid (e.g. pending → active directly)", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "pending",
      consentGivenAt: null,
    } as any)
    const res = await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "active" }),
      makeParams("s1"),
    )
    expect(res.status).toBe(409)
    const body: { error: string } = await res.json()
    expect(body.error).toBe("invalid_transition")
  })

  it("409 when transition needs consent that hasn't been granted (resume)", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "paused",
      consentGivenAt: null,
    } as any)
    const res = await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "active" }),
      makeParams("s1"),
    )
    expect(res.status).toBe(409)
    const body: { error: string } = await res.json()
    expect(body.error).toBe("consent_required")
  })

  it("rotates joinToken on active → paused", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "active",
      consentGivenAt: new Date(),
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({ id: "s1", status: "paused" } as any)
    await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "paused" }),
      makeParams("s1"),
    )
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call.data.joinToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("stamps endedAt + endReason on transition to ended", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "active",
      consentGivenAt: new Date(),
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({ id: "s1", status: "ended" } as any)
    await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "ended", endReason: "agent_ended" }),
      makeParams("s1"),
    )
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call.data.endedAt).toBeInstanceOf(Date)
    expect(call.data.endReason).toBe("agent_ended")
  })

  it("defaults endReason to agent_ended when not supplied on → ended", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "active",
      consentGivenAt: new Date(),
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({ id: "s1", status: "ended" } as any)
    await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "ended" }),
      makeParams("s1"),
    )
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call.data.endReason).toBe("agent_ended")
  })

  it("returns 409 session_state_changed when concurrent update drifted status", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "active",
      consentGivenAt: new Date(),
    } as any)
    // updateMany returns count: 0 — meaning no row matched the
    // expected status condition (concurrent transition won).
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "paused" }),
      makeParams("s1"),
    )
    expect(res.status).toBe(409)
    const body: { error: string } = await res.json()
    expect(body.error).toBe("session_state_changed")
  })

  it("conditional-where update key includes the expected status (race protection)", async () => {
    vi.mocked(prisma.cobrowseSession.findFirst).mockResolvedValue({
      id: "s1",
      status: "active",
      consentGivenAt: new Date(),
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({ id: "s1" } as any)
    await PATCH(
      makeReq("/api/v1/cobrowse/sessions/s1", "PATCH", { status: "paused" }),
      makeParams("s1"),
    )
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call.where).toEqual({ id: "s1", status: "active" })
  })
})
