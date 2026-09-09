/**
 * T8 Cobrowse — public join + consent route tests.
 *
 * These endpoints are unauthenticated; security comes from:
 *   1) Token shape pre-check (cheap defense against scrapers)
 *   2) DB findUnique by joinToken (globally unique)
 *   3) State machine gate on every transition
 *
 * Uniform 404 on "no row" and "wrong status" prevents token-existence
 * enumeration via timing/error differentials.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cobrowseSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import { POST as JOIN } from "@/app/api/v1/public/cobrowse/join/route"
import { POST as CONSENT } from "@/app/api/v1/public/cobrowse/consent/route"
import { prisma } from "@/lib/prisma"

const VALID_TOKEN = "a".repeat(43)

function makeReq(url: string, body: unknown) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── POST /api/v1/public/cobrowse/join ──────────────────────────── */

describe("POST /api/v1/public/cobrowse/join", () => {
  it("400 on missing joinToken", async () => {
    const res = await JOIN(makeReq("/api/v1/public/cobrowse/join", {}))
    expect(res.status).toBe(400)
  })

  it("400 on malformed joinToken (shape pre-check)", async () => {
    const res = await JOIN(makeReq("/api/v1/public/cobrowse/join", { joinToken: "tooShort" }))
    expect(res.status).toBe(400)
    expect(prisma.cobrowseSession.findUnique).not.toHaveBeenCalled()
  })

  it("404 when token doesn't match any session", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue(null)
    const res = await JOIN(makeReq("/api/v1/public/cobrowse/join", { joinToken: VALID_TOKEN }))
    expect(res.status).toBe(404)
  })

  it("409 when session is past pending (already joined / ended)", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "active",
      consentGivenAt: new Date(),
      organization: { name: "Acme", slug: "acme" },
    } as any)
    const res = await JOIN(makeReq("/api/v1/public/cobrowse/join", { joinToken: VALID_TOKEN }))
    expect(res.status).toBe(409)
  })

  it("transitions pending → awaiting_consent + returns org name", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "pending",
      consentGivenAt: null,
      organization: { name: "Acme Co", slug: "acme" },
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await JOIN(makeReq("/api/v1/public/cobrowse/join", { joinToken: VALID_TOKEN }))
    expect(res.status).toBe(200)
    const body: { session: { id: string; organizationName: string } } = await res.json()
    expect(body.session.id).toBe("s1")
    expect(body.session.organizationName).toBe("Acme Co")

    expect(prisma.cobrowseSession.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", status: "pending" },
      data: { status: "awaiting_consent" },
    })
  })

  it("409 when concurrent update drifted status away from pending", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "pending",
      consentGivenAt: null,
      organization: { name: "Acme", slug: "acme" },
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await JOIN(makeReq("/api/v1/public/cobrowse/join", { joinToken: VALID_TOKEN }))
    expect(res.status).toBe(409)
  })

  it("scopes lookup by joinToken only (no org)", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue(null)
    await JOIN(makeReq("/api/v1/public/cobrowse/join", { joinToken: VALID_TOKEN }))
    const call = vi.mocked(prisma.cobrowseSession.findUnique).mock.calls[0][0]
    expect(call.where).toEqual({ joinToken: VALID_TOKEN })
  })
})

/* ── POST /api/v1/public/cobrowse/consent ──────────────────────── */

describe("POST /api/v1/public/cobrowse/consent — granted", () => {
  it("400 on missing granted field", async () => {
    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN }))
    expect(res.status).toBe(400)
  })

  it("400 on malformed joinToken", async () => {
    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: "x", granted: true }))
    expect(res.status).toBe(400)
  })

  it("404 on unknown token", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue(null)
    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN, granted: true }))
    expect(res.status).toBe(404)
  })

  it("409 when session is in wrong state for active transition", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "ended",
      consentGivenAt: null,
    } as any)
    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN, granted: true }))
    expect(res.status).toBe(409)
  })

  it("stamps consentGivenAt + transitions to active on granted=true", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "awaiting_consent",
      consentGivenAt: null,
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN, granted: true }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call.data.status).toBe("active")
    expect(call.data.consentGivenAt).toBeInstanceOf(Date)
  })

  it("409 session_state_changed when consent grants race with concurrent transition", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "awaiting_consent",
      consentGivenAt: null,
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN, granted: true }))
    expect(res.status).toBe(409)
    const body: { error: string } = await res.json()
    expect(body.error).toBe("session_state_changed")
  })
})

describe("POST /api/v1/public/cobrowse/consent — declined", () => {
  it("ends session with reason customer_left on granted=false", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "awaiting_consent",
      consentGivenAt: null,
    } as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN, granted: false }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call.data.status).toBe("ended")
    expect(call.data.endReason).toBe("customer_left")
    expect(call.data.endedAt).toBeInstanceOf(Date)
  })

  it("409 when declining a session that's already terminal", async () => {
    vi.mocked(prisma.cobrowseSession.findUnique).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      status: "ended",
      consentGivenAt: null,
    } as any)
    const res = await CONSENT(makeReq("/api/v1/public/cobrowse/consent", { joinToken: VALID_TOKEN, granted: false }))
    expect(res.status).toBe(409)
  })
})
