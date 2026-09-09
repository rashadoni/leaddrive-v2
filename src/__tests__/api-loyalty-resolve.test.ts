/**
 * POS member resolve — POST /api/v1/loyalty-accounts/resolve.
 *
 * Staff scans a membership QR → we identify the member. Resolve by exact
 * contactId or the 8-char member-number suffix; READ-ONLY (a member with no
 * account → accountId null + 0 points, never creates); ambiguous suffix → 409;
 * unknown → 404.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    loyaltyAccount: { findFirst: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: unknown) => r instanceof NextResponse),
}))

import { POST } from "@/app/api/v1/loyalty-accounts/resolve/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }
const CONTACT = { id: "cmABCDEFGH12345678", fullName: "Jane Doe", email: "j@x.com" }
const ACCOUNT = { id: "a-1", points: 120, lifetimePoints: 300, tier: "silver" }

function mkReq(body?: unknown) {
  return new Request("http://x/api/v1/loyalty-accounts/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(ACCOUNT as never)
})

describe("POST /api/v1/loyalty-accounts/resolve", () => {
  it("401 when auth fails (withRlsAuth gate)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "no" }, { status: 401 }) as never)
    const r = await POST(mkReq({ code: "x" }), { params: Promise.resolve({}) } as never)
    expect(r.status).toBe(401)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })

  it("400 when code is missing", async () => {
    const r = await POST(mkReq({}), {} as never)
    expect(r.status).toBe(400)
  })

  it("resolves by exact contactId and returns the member summary", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as never)
    const r = await POST(mkReq({ code: CONTACT.id }), {} as never)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.member).toMatchObject({
      accountId: "a-1",
      contactId: CONTACT.id,
      name: "Jane Doe",
      points: 120,
      tier: "silver",
    })
    expect(prisma.$queryRaw).not.toHaveBeenCalled() // exact hit → no suffix query
  })

  it("falls back to the 8-char member-number suffix", async () => {
    vi.mocked(prisma.contact.findFirst)
      .mockResolvedValueOnce(null as never) // exact miss
      .mockResolvedValueOnce(CONTACT as never) // resolved from suffix
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: CONTACT.id }] as never)
    const r = await POST(mkReq({ code: "12345678" }), {} as never)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.member.contactId).toBe(CONTACT.id)
    expect(prisma.$queryRaw).toHaveBeenCalled()
  })

  it("resolves a SHORT member number (short contactId) — no length regression", async () => {
    vi.mocked(prisma.contact.findFirst)
      .mockResolvedValueOnce(null as never) // exact miss
      .mockResolvedValueOnce({ id: "c123", fullName: "Bob", email: null } as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "c123" }] as never)
    const r = await POST(mkReq({ code: "C123" }), {} as never) // 4-char member number
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.member.contactId).toBe("c123")
    expect(prisma.$queryRaw).toHaveBeenCalled()
  })

  it("409 when the member-number suffix is ambiguous", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "a" }, { id: "b" }] as never)
    const r = await POST(mkReq({ code: "12345678" }), {} as never)
    const j = await r.json()
    expect(r.status).toBe(409)
    expect(j.error).toBe("ambiguous_code")
  })

  it("404 when no contact matches", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    const r = await POST(mkReq({ code: "99999999" }), {} as never)
    expect(r.status).toBe(404)
  })

  it("is READ-ONLY: a member with no account yet → accountId null + 0 points, never creates", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as never)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(null as never)
    const r = await POST(mkReq({ code: CONTACT.id }), {} as never)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(prisma.loyaltyAccount.create).not.toHaveBeenCalled() // no spurious 0/0 account on a scan
    expect(j.member).toMatchObject({ accountId: null, contactId: CONTACT.id, points: 0, lifetimePoints: 0, tier: null })
  })
})
