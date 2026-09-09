/**
 * D8 Loyalty — org-wide members list route tests.
 *
 * GET /api/v1/loyalty-accounts — paginated members, contact join + name
 * fallback, pagination clamp, tier filter, q search resolution, auth denial.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loyaltyAccount: { count: vi.fn(), findMany: vi.fn() },
    contact: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET } from "@/app/api/v1/loyalty-accounts/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }
const req = (url: string) => new Request(url) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

describe("GET /api/v1/loyalty-accounts", () => {
  it("lists members joined to contact, richest-first, with name fallback", async () => {
    vi.mocked(prisma.loyaltyAccount.count).mockResolvedValue(2 as any)
    vi.mocked(prisma.loyaltyAccount.findMany).mockResolvedValue([
      { contactId: "c1", points: 100, lifetimePoints: 500, tier: "gold", tierUpgradedAt: null },
      { contactId: "c2", points: 10, lifetimePoints: 50, tier: "bronze", tierUpgradedAt: null },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: "c1", fullName: "Alice", email: "a@x.com" },
      { id: "c2", fullName: null, email: "b@x.com" },
    ] as any)

    const res = await GET(req("http://x/api/v1/loyalty-accounts"), undefined as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.members[0]).toMatchObject({ contactId: "c1", name: "Alice", points: 100, lifetimePoints: 500, tier: "gold" })
    // name falls back to email when fullName is null
    expect(body.members[1].name).toBe("b@x.com")
    expect(prisma.loyaltyAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ lifetimePoints: "desc" }, { createdAt: "asc" }] }),
    )
  })

  it("paginates: page=2 pageSize=10 → skip 10 take 10", async () => {
    vi.mocked(prisma.loyaltyAccount.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.loyaltyAccount.findMany).mockResolvedValue([] as any)
    await GET(req("http://x/api/v1/loyalty-accounts?page=2&pageSize=10"), undefined as any)
    expect(prisma.loyaltyAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    )
  })

  it("caps pageSize at 100", async () => {
    vi.mocked(prisma.loyaltyAccount.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.loyaltyAccount.findMany).mockResolvedValue([] as any)
    await GET(req("http://x/api/v1/loyalty-accounts?pageSize=9999"), undefined as any)
    expect(prisma.loyaltyAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it("tier filter scopes the where clause", async () => {
    vi.mocked(prisma.loyaltyAccount.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.loyaltyAccount.findMany).mockResolvedValue([] as any)
    await GET(req("http://x/api/v1/loyalty-accounts?tier=gold"), undefined as any)
    expect(prisma.loyaltyAccount.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", tier: "gold" },
    })
  })

  it("q search resolves matching contactIds then scopes accounts", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([{ id: "c9" }] as any) // search
    vi.mocked(prisma.loyaltyAccount.count).mockResolvedValue(1 as any)
    vi.mocked(prisma.loyaltyAccount.findMany).mockResolvedValue([
      { contactId: "c9", points: 5, lifetimePoints: 5, tier: null, tierUpgradedAt: null },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([{ id: "c9", fullName: "Zed", email: "z@x.com" }] as any) // join
    await GET(req("http://x/api/v1/loyalty-accounts?q=zed"), undefined as any)
    expect(prisma.loyaltyAccount.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", contactId: { in: ["c9"] } },
    })
  })

  it("q with zero contact matches → empty in-clause, empty page, no join query", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any) // search: no matches
    vi.mocked(prisma.loyaltyAccount.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.loyaltyAccount.findMany).mockResolvedValue([] as any)
    const res = await GET(req("http://x/api/v1/loyalty-accounts?q=nobody"), undefined as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.members).toEqual([])
    expect(body.total).toBe(0)
    expect(prisma.loyaltyAccount.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", contactId: { in: [] } },
    })
    // no rows → the contact-join query is skipped, so only the search ran
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(1)
  })

  it("returns the auth response when requireAuth denies", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any,
    )
    const res = await GET(req("http://x/api/v1/loyalty-accounts"), undefined as any)
    expect(res.status).toBe(403)
  })
})
