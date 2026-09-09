/**
 * D8 Loyalty — member self-serve redeem (portal Phase 3).
 *
 * POST /api/v1/public/portal-redeem — a portal member spends points on a
 * LoyaltyReward. Covers auth, the loyalty_portal gate, reward validity,
 * insufficient-balance, stock exhaustion, the happy path, and — critically —
 * that contactId is taken from the JWT, NEVER the request body (no
 * member-impersonation). redeemPoints (pure CAS math) runs for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    loyaltyReward: { findFirst: vi.fn() },
    loyaltyAccount: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { POST } from "@/app/api/v1/public/portal-redeem/route"
import { getPortalUser } from "@/lib/portal-auth"
import { prisma } from "@/lib/prisma"

const USER = { contactId: "c-1", organizationId: "org-1", companyId: null, fullName: "Jane", email: "j@x.com" }

function mkReq(body?: unknown) {
  return new Request("http://x/api/v1/public/portal-redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// A fresh tx mock we can inspect after the call.
let tx: {
  $queryRaw: ReturnType<typeof vi.fn>
  loyaltyRedemption: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
  loyaltyAccount: { updateMany: ReturnType<typeof vi.fn> }
  loyaltyTransaction: { create: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPortalUser).mockResolvedValue(USER as never)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["loyalty_portal"] } as never)
  vi.mocked(prisma.loyaltyReward.findFirst).mockResolvedValue({ id: "rw-1", name: "Free coffee", pointsCost: 50, stockLimit: null } as never)
  vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue({ id: "a-1", points: 100, lifetimePoints: 200 } as never)
  tx = {
    $queryRaw: vi.fn().mockResolvedValue([]), // the FOR UPDATE reward-row lock
    loyaltyRedemption: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "red-1" }) },
    loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loyaltyTransaction: { create: vi.fn().mockResolvedValue({ id: "txn-1" }) },
  }
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never)
})

describe("POST /api/v1/public/portal-redeem", () => {
  it("401 when not a portal member", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null as never)
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    expect(r.status).toBe(401)
    expect(prisma.loyaltyReward.findFirst).not.toHaveBeenCalled()
  })

  it("400 when rewardId is missing", async () => {
    const r = await POST(mkReq({}))
    expect(r.status).toBe(400)
  })

  it("403 when the loyalty_portal flag is off", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["whatsapp"] } as never)
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    expect(r.status).toBe(403)
    expect(prisma.loyaltyReward.findFirst).not.toHaveBeenCalled()
  })

  it("404 when the reward is missing or inactive", async () => {
    vi.mocked(prisma.loyaltyReward.findFirst).mockResolvedValue(null as never)
    const r = await POST(mkReq({ rewardId: "rw-x" }))
    expect(r.status).toBe(404)
  })

  it("400 insufficient_points when the balance is below the cost", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue({ id: "a-1", points: 30, lifetimePoints: 200 } as never)
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    const j = await r.json()
    expect(r.status).toBe(400)
    expect(j.error).toBe("insufficient_points")
    expect(j.needed).toBe(50)
    expect(tx.loyaltyAccount.updateMany).not.toHaveBeenCalled()
  })

  it("400 insufficient_points when the member has no account", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(null as never)
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    const j = await r.json()
    expect(r.status).toBe(400)
    expect(j.error).toBe("insufficient_points")
  })

  it("400 out_of_stock when the stock limit is exhausted", async () => {
    vi.mocked(prisma.loyaltyReward.findFirst).mockResolvedValue({ id: "rw-1", name: "Mug", pointsCost: 50, stockLimit: 5 } as never)
    tx.loyaltyRedemption.count.mockResolvedValue(5) // already 5 of 5 claimed
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    const j = await r.json()
    expect(r.status).toBe(400)
    expect(j.error).toBe("out_of_stock")
    expect(tx.$queryRaw).toHaveBeenCalled() // reward row locked FOR UPDATE before the count
    expect(tx.loyaltyAccount.updateMany).not.toHaveBeenCalled()
  })

  it("debits points, writes the 'redeem' txn + redemption, returns remaining balance", async () => {
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.success).toBe(true)
    expect(j.remainingPoints).toBe(50) // 100 - 50
    expect(j.reward).toMatchObject({ name: "Free coffee", pointsSpent: 50 })
    // CAS debits by a negative delta, never touches lifetime
    expect(tx.loyaltyAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { points: { increment: -50 }, lifetimePoints: { increment: 0 } },
      }),
    )
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "redeem", delta: -50 }) }),
    )
    // unlimited stock (stockLimit:null) → no row lock taken
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })

  it("scopes contactId to the JWT, NEVER the request body (no impersonation)", async () => {
    // attacker tries to redeem against someone else's account via the body
    await POST(mkReq({ rewardId: "rw-1", contactId: "victim-999" }))
    expect(prisma.loyaltyAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contactId: "c-1" }) }),
    )
    expect(tx.loyaltyRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c-1" }) }),
    )
  })

  it("409 after losing the CAS on every retry", async () => {
    tx.loyaltyAccount.updateMany.mockResolvedValue({ count: 0 }) // always lose
    const r = await POST(mkReq({ rewardId: "rw-1" }))
    expect(r.status).toBe(409)
  })
})
