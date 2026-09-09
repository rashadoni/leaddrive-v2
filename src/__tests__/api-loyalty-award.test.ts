/**
 * POS award — POST /api/v1/loyalty-accounts/award.
 *
 * Staff give a member N points after scanning their QR. Validates input, requires
 * the member to exist, find-OR-CREATEs the account on the real award (never a
 * scan), CAS-writes the earn + audit txn. earnPoints runs for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    loyaltyAccount: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyTier: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: unknown) => r instanceof NextResponse),
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))

import { POST } from "@/app/api/v1/loyalty-accounts/award/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function mkReq(body?: unknown) {
  return new Request("http://x/api/v1/loyalty-accounts/award", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
}

let tx: { loyaltyAccount: { updateMany: ReturnType<typeof vi.fn> }; loyaltyTransaction: { create: ReturnType<typeof vi.fn> } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c-1" } as never)
  vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue({ id: "a-1", points: 100, lifetimePoints: 200, tier: null } as never)
  vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([] as never) // no tiers → no tier change
  tx = {
    loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loyaltyTransaction: { create: vi.fn().mockResolvedValue({ id: "txn-1" }) },
  }
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never)
})

describe("POST /api/v1/loyalty-accounts/award", () => {
  it("401 when auth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "no" }, { status: 401 }) as never)
    expect((await POST(mkReq({ contactId: "c-1", points: 50 }), {} as never)).status).toBe(401)
  })

  it("400 on missing contactId or invalid points", async () => {
    expect((await POST(mkReq({ points: 50 }), {} as never)).status).toBe(400)
    expect((await POST(mkReq({ contactId: "c-1", points: 0 }), {} as never)).status).toBe(400)
    expect((await POST(mkReq({ contactId: "c-1", points: 1.5 }), {} as never)).status).toBe(400)
  })

  it("404 when the member doesn't exist in this org", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null as never)
    expect((await POST(mkReq({ contactId: "ghost", points: 50 }), {} as never)).status).toBe(404)
  })

  it("awards to an existing account (CAS earn + txn), returns the new balance", async () => {
    const r = await POST(mkReq({ contactId: "c-1", points: 50 }), {} as never)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j).toMatchObject({ success: true, accountId: "a-1", awarded: 50, points: 150 })
    expect(tx.loyaltyAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ points: { increment: 50 }, lifetimePoints: { increment: 50 } }) }),
    )
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "earn", delta: 50 }) }),
    )
    expect(prisma.loyaltyAccount.create).not.toHaveBeenCalled()
  })

  it("enrolls a no-account member on the award (create-on-award), then credits", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.loyaltyAccount.create).mockResolvedValue({ id: "a-new", points: 0, lifetimePoints: 0, tier: null } as never)
    const r = await POST(mkReq({ contactId: "c-1", points: 75 }), {} as never)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(prisma.loyaltyAccount.create).toHaveBeenCalled()
    expect(j).toMatchObject({ accountId: "a-new", awarded: 75, points: 75 })
  })

  it("409 after losing the CAS on every retry", async () => {
    tx.loyaltyAccount.updateMany.mockResolvedValue({ count: 0 })
    expect((await POST(mkReq({ contactId: "c-1", points: 50 }), {} as never)).status).toBe(409)
  })
})
