import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    offer: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    offerItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    // PUT replaces the line items and re-states the total in ONE interactive
    // transaction. Run the callback against the same mock so the assertions
    // below still see tx.offerItem.* / tx.offer.updateMany.
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof Response || (r && r.status !== undefined && typeof r.json === "function" && !r.orgId)),
}))

vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "AZN" }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }) }))
vi.mock("jspdf", () => {
  class MockJsPDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }
    // registerUnicodeFont(doc) registers the DejaVu TTFs on every PDF route —
    // the mock must accept the VFS/font calls or the route throws before output.
    addFileToVFS = vi.fn()
    addFont = vi.fn()
    setFontSize = vi.fn()
    setFont = vi.fn()
    text = vi.fn()
    setDrawColor = vi.fn()
    line = vi.fn()
    setFillColor = vi.fn()
    rect = vi.fn()
    addPage = vi.fn()
    splitTextToSize = vi.fn().mockReturnValue(["note line"])
    setTextColor = vi.fn()
    output = vi.fn().mockReturnValue(new ArrayBuffer(100))
  }
  return { default: MockJsPDF }
})

import { GET, POST } from "@/app/api/v1/offers/route"
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/v1/offers/[id]/route"
import { GET as GET_PDF } from "@/app/api/v1/offers/[id]/pdf/route"
import { POST as POST_SEND } from "@/app/api/v1/offers/[id]/send/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth, isAuthError } from "@/lib/api-auth"
import { sendEmail } from "@/lib/email"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" } as any)
  vi.mocked(isAuthError).mockReturnValue(false)
  ;(prisma as any).$transaction = vi
    .fn()
    .mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
})

// ─── GET /api/v1/offers ─────────────────────────────────────────────

describe("GET /api/v1/offers", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET(makeReq("http://localhost:3000/api/v1/offers"))
    expect(res.status).toBe(401)
  })

  it("returns offers with pagination", async () => {
    const mockOffers = [{ id: "o1", title: "Offer A", items: [{ id: "i1" }] }]
    vi.mocked(prisma.offer.findMany).mockResolvedValue(mockOffers as any)
    vi.mocked(prisma.offer.count).mockResolvedValue(1)

    const res = await GET(makeReq("http://localhost:3000/api/v1/offers?page=1&limit=10"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.offers).toHaveLength(1)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
  })

  it("passes search, status, and dealId filters", async () => {
    vi.mocked(prisma.offer.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.offer.count).mockResolvedValue(0)

    await GET(makeReq("http://localhost:3000/api/v1/offers?search=test&status=draft&dealId=d1"))

    const call = vi.mocked(prisma.offer.findMany).mock.calls[0][0] as any
    expect(call.where.title).toEqual({ contains: "test", mode: "insensitive" })
    expect(call.where.status).toBe("draft")
    expect(call.where.dealId).toBe("d1")
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.offer.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET(makeReq("http://localhost:3000/api/v1/offers"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

// ─── POST /api/v1/offers ────────────────────────────────────────────

describe("POST /api/v1/offers", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST(makeReq("http://localhost:3000/api/v1/offers", {
      method: "POST",
      body: JSON.stringify({ title: "Test" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when title is missing", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/offers", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
  })

  it("creates offer with items and calculates totals", async () => {
    vi.mocked(prisma.offer.count).mockResolvedValue(5)
    const created = {
      id: "o-new", offerNumber: "OFF-2026-006", title: "New Offer", totalAmount: 900,
      items: [{ name: "Service A", quantity: 10, unitPrice: 100, discount: 10, total: 900, sortOrder: 0 }],
    }
    vi.mocked(prisma.offer.create).mockResolvedValue(created as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/offers", {
      method: "POST",
      body: JSON.stringify({
        title: "New Offer",
        items: [{ name: "Service A", quantity: 10, unitPrice: 100, discount: 10 }],
      }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.title).toBe("New Offer")

    // Verify create was called with calculated totalAmount
    const createCall = vi.mocked(prisma.offer.create).mock.calls[0][0] as any
    expect(createCall.data.totalAmount).toBe(900) // 10 * 100 - 10% = 900
    expect(createCall.data.offerNumber).toMatch(/^OFF-\d{4}-006$/)
  })
})

// ─── GET /api/v1/offers/:id ─────────────────────────────────────────

describe("GET /api/v1/offers/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/offers/o1"), makeParams("o1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when offer not found", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(null)
    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/offers/missing"), makeParams("missing"))
    expect(res.status).toBe(404)
  })

  it("returns offer with items", async () => {
    const mockOffer = { id: "o1", title: "Offer A", items: [{ id: "i1", name: "Item 1" }] }
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(mockOffer as any)

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/offers/o1"), makeParams("o1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("o1")
    expect(json.data.items).toHaveLength(1)
  })
})

// ─── PUT /api/v1/offers/:id ─────────────────────────────────────────

describe("PUT /api/v1/offers/:id", () => {
  it("returns 400 on invalid body", async () => {
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/offers/o1", { method: "PUT", body: JSON.stringify({ type: "invalid_type" }) }),
      makeParams("o1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when the offer belongs to another org", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(null as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/offers/missing", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when updateMany count is 0", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue({ id: "o1" } as any)
    vi.mocked(prisma.offer.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/offers/o1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("o1"),
    )
    expect(res.status).toBe(404)
  })

  // ── F-55: the ownership check must precede the item mutations ────────────
  // offer_items had no RLS policy, so app.org_id did not constrain the delete
  // or the create, and the RLS extension committed each one in its own
  // transaction. With the check sitting AFTER them, a PUT against another
  // tenant's offer wiped that offer's line items (empty array) or injected
  // forged ones (populated array) and only then returned 404 — both writes
  // already committed, nothing to roll back. This test fails on that ordering.
  it("touches no line items when the offer belongs to another org", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(null as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/offers/victim-offer", {
        method: "PUT",
        body: JSON.stringify({ items: [{ name: "Forged line", quantity: 1, unitPrice: 9999, discount: 0 }] }),
      }),
      makeParams("victim-offer"),
    )

    expect(res.status).toBe(404)
    expect(prisma.offerItem.deleteMany).not.toHaveBeenCalled()
    expect(prisma.offerItem.createMany).not.toHaveBeenCalled()
    expect(prisma.offer.updateMany).not.toHaveBeenCalled()
  })

  it("deletes no line items when the items array is empty and the offer is foreign", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(null as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/offers/victim-offer", {
        method: "PUT",
        body: JSON.stringify({ items: [] }),
      }),
      makeParams("victim-offer"),
    )

    expect(res.status).toBe(404)
    expect(prisma.offerItem.deleteMany).not.toHaveBeenCalled()
  })

  it("updates offer with new items, recalculating totals", async () => {
    vi.mocked(prisma.offerItem.deleteMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.offerItem.createMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.offer.updateMany).mockResolvedValue({ count: 1 } as any)
    const updated = { id: "o1", title: "Updated", totalAmount: 450, items: [{ name: "New Item", quantity: 5, unitPrice: 100, discount: 10, total: 450 }] }
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(updated as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/offers/o1", {
        method: "PUT",
        body: JSON.stringify({
          title: "Updated",
          items: [{ name: "New Item", quantity: 5, unitPrice: 100, discount: 10 }],
        }),
      }),
      makeParams("o1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.title).toBe("Updated")

    // Old items deleted and new created — and the delete stays scoped to the
    // caller's org THROUGH the parent, so the statement is safe on its own even
    // if the up-front ownership check is ever refactored away.
    expect(prisma.offerItem.deleteMany).toHaveBeenCalledWith({
      where: { offerId: "o1", offer: { organizationId: "org-1" } },
    })
    expect(prisma.offerItem.createMany).toHaveBeenCalled()

    // Every new row carries the caller's org: offer_items now has its own
    // tenant_isolation policy and organizationId is NOT NULL.
    const created = vi.mocked(prisma.offerItem.createMany).mock.calls[0][0] as any
    expect(created.data.every((r: any) => r.organizationId === "org-1")).toBe(true)

    // …and the replacement happened inside one transaction, not three.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

// ─── DELETE /api/v1/offers/:id ──────────────────────────────────────

describe("DELETE /api/v1/offers/:id", () => {
  it("returns 404 when deleteMany count is 0", async () => {
    vi.mocked(prisma.offer.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/offers/missing", { method: "DELETE" }),
      makeParams("missing"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes offer and returns deleted id", async () => {
    vi.mocked(prisma.offer.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/offers/o1", { method: "DELETE" }),
      makeParams("o1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("o1")
  })
})

// ─── GET /api/v1/offers/:id/pdf ─────────────────────────────────────

describe("GET /api/v1/offers/:id/pdf", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_PDF(makeReq("http://localhost:3000/api/v1/offers/o1/pdf"), makeParams("o1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when offer not found", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(null)
    const res = await GET_PDF(makeReq("http://localhost:3000/api/v1/offers/missing/pdf"), makeParams("missing"))
    expect(res.status).toBe(404)
  })

  it("returns PDF buffer with correct headers", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue({
      id: "o1", offerNumber: "OFF-2026-001", title: "Test", status: "draft",
      createdAt: new Date(), validUntil: null, notes: "Some notes",
      totalAmount: 1000, currency: "AZN", includeVat: false,
      items: [{ name: "Service", quantity: 2, unitPrice: 500, discount: 0, total: 1000, sortOrder: 0 }],
      company: { name: "Acme", address: "123 St", email: "a@a.com", phone: "+1" },
      contact: { fullName: "John", email: "j@a.com", phone: null },
      organization: { name: "LeadDrive" },
    } as any)

    const res = await GET_PDF(makeReq("http://localhost:3000/api/v1/offers/o1/pdf"), makeParams("o1"))
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toContain("offer-OFF-2026-001.pdf")
  })
})

// ─── POST /api/v1/offers/:id/send ───────────────────────────────────

describe("POST /api/v1/offers/:id/send", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/offers/o1/send", { method: "POST", body: JSON.stringify({}) }),
      makeParams("o1"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 on invalid send payload (missing email)", async () => {
    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/offers/o1/send", {
        method: "POST",
        body: JSON.stringify({ subject: "Hi", message: "Body" }),
      }),
      makeParams("o1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when offer not found", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue(null)
    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/offers/o1/send", {
        method: "POST",
        body: JSON.stringify({ recipientEmail: "test@test.com", subject: "Offer", message: "Please review" }),
      }),
      makeParams("o1"),
    )
    expect(res.status).toBe(404)
  })

  it("sends email, updates offer status to sent, and returns success", async () => {
    vi.mocked(prisma.offer.findFirst).mockResolvedValue({
      id: "o1", offerNumber: "OFF-2026-001", currency: "AZN", includeVat: false,
      totalAmount: 1000, validUntil: null, notes: null, contactId: "ct1",
      items: [{ name: "Svc", quantity: 1, unitPrice: 1000, discount: 0, total: 1000 }],
    } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true } as any)
    vi.mocked(prisma.offer.update).mockResolvedValue({} as any)

    const res = await POST_SEND(
      makeReq("http://localhost:3000/api/v1/offers/o1/send", {
        method: "POST",
        body: JSON.stringify({ recipientEmail: "client@test.com", subject: "Your Offer", message: "Please review" }),
      }),
      makeParams("o1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    // Verify sendEmail was called
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "client@test.com",
      subject: "Your Offer",
    }))

    // Verify offer status updated to "sent"
    expect(prisma.offer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "o1" },
      data: expect.objectContaining({ status: "sent" }),
    }))
  })
})
