import { describe, it, expect, vi, beforeEach } from "vitest"

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentOrder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    bill: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    billPayment: { create: vi.fn() },
    paymentRegistryEntry: { create: vi.fn() },
    invoice: { findMany: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((cb: any) => cb({
      paymentOrder: { update: vi.fn().mockResolvedValue({ id: "po-1", status: "executed" }) },
      bill: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      billPayment: { create: vi.fn() },
      paymentRegistryEntry: { create: vi.fn() },
    })),
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn() }))
vi.mock("@/lib/finance/telegram-notify", () => ({
  notifyPaymentOrderPending: vi.fn(),
  notifyPaymentOrderExecuted: vi.fn(),
  notifyOverdueBills: vi.fn(),
  notifyOverdueInvoices: vi.fn(),
  notifyUpcomingDeadlines: vi.fn(),
  getAdvanceDays: vi.fn().mockResolvedValue(7),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { NextRequest } from "next/server"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function makeReq(url = "http://localhost/api/finance/payment-orders/po-1", method = "GET", body?: unknown): NextRequest {
  const opts: ConstructorParameters<typeof NextRequest>[1] = { method }
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" }
    opts.body = JSON.stringify(body)
  }
  return new NextRequest(url, opts)
}

const params = (id = "po-1") => Promise.resolve({ id })

beforeEach(() => vi.resetAllMocks())

/* ================================================================== */
/*  [id] route — GET / PUT / DELETE                                    */
/* ================================================================== */
import { GET as getById, PUT, DELETE } from "@/app/api/finance/payment-orders/[id]/route"

describe("GET /api/finance/payment-orders/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await getById(makeReq(), { params: params() })
    expect(res.status).toBe(401)
  })

  it("returns 404 when order does not exist", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(null)
    const res = await getById(makeReq(), { params: params() })
    expect(res.status).toBe(404)
  })

  it("returns the order on success", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const order = { id: "po-1", status: "draft", amount: 100 }
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(order as any)
    const res = await getById(makeReq(), { params: params() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual(order)
  })
})

describe("PUT /api/finance/payment-orders/[id]", () => {
  it("returns 400 when order is not in draft/pending_approval", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "executed" } as any)
    const res = await PUT(makeReq("http://localhost/x", "PUT", { purpose: "New" }), { params: params() })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("Cannot edit")
  })

  it("updates a draft order successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "draft" } as any)
    const updated = { id: "po-1", purpose: "Updated purpose" }
    vi.mocked(prisma.paymentOrder.update).mockResolvedValue(updated as any)
    const res = await PUT(makeReq("http://localhost/x", "PUT", { purpose: "Updated purpose" }), { params: params() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.purpose).toBe("Updated purpose")
  })
})

describe("DELETE /api/finance/payment-orders/[id]", () => {
  it("returns 400 when order is not draft", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "approved" } as any)
    const res = await DELETE(makeReq("http://localhost/x", "DELETE"), { params: params() })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("drafts")
  })

  it("deletes a draft order", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "draft" } as any)
    vi.mocked(prisma.paymentOrder.delete).mockResolvedValue({} as any)
    const res = await DELETE(makeReq("http://localhost/x", "DELETE"), { params: params() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

/* ================================================================== */
/*  submit — draft → pending_approval                                  */
/* ================================================================== */
import { POST as submitPost } from "@/app/api/finance/payment-orders/[id]/submit/route"

describe("POST /api/finance/payment-orders/[id]/submit", () => {
  it("returns 400 when status is not draft", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "approved" } as any)
    const res = await submitPost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("drafts")
  })

  it("transitions draft → pending_approval", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({
      id: "po-1", status: "draft", orderNumber: "ПП-001",
      counterpartyName: "Acme", amount: 100, currency: "AZN", purpose: "Test",
    } as any)
    vi.mocked(prisma.paymentOrder.update).mockResolvedValue({ id: "po-1", status: "pending_approval" } as any)

    const res = await submitPost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe("pending_approval")
  })
})

/* ================================================================== */
/*  approve — pending_approval → approved                              */
/* ================================================================== */
import { POST as approvePost } from "@/app/api/finance/payment-orders/[id]/approve/route"

describe("POST /api/finance/payment-orders/[id]/approve", () => {
  it("returns 404 for nonexistent order", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(null)
    const res = await approvePost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(404)
  })

  it("returns 400 when status is not pending_approval", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "draft" } as any)
    const res = await approvePost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("pending")
  })

  it("transitions pending_approval → approved", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "pending_approval" } as any)
    vi.mocked(prisma.paymentOrder.update).mockResolvedValue({ id: "po-1", status: "approved", approvedAt: new Date() } as any)

    const res = await approvePost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe("approved")
  })
})

/* ================================================================== */
/*  reject — pending_approval → rejected                               */
/* ================================================================== */
import { POST as rejectPost } from "@/app/api/finance/payment-orders/[id]/reject/route"

describe("POST /api/finance/payment-orders/[id]/reject", () => {
  it("returns 400 when status is not pending_approval", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "draft" } as any)
    const res = await rejectPost(makeReq("http://localhost/x", "POST", { reason: "Bad" }), { params: params() })
    expect(res.status).toBe(400)
  })

  it("returns 400 when reason is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "pending_approval" } as any)
    const res = await rejectPost(makeReq("http://localhost/x", "POST", {}), { params: params() })
    expect(res.status).toBe(400)
  })

  it("transitions pending_approval → rejected with reason", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "pending_approval" } as any)
    vi.mocked(prisma.paymentOrder.update).mockResolvedValue({ id: "po-1", status: "rejected", rejectionReason: "Budget exceeded" } as any)

    const res = await rejectPost(makeReq("http://localhost/x", "POST", { reason: "Budget exceeded" }), { params: params() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe("rejected")
  })
})

/* ================================================================== */
/*  execute — approved → executed                                      */
/* ================================================================== */
import { POST as executePost } from "@/app/api/finance/payment-orders/[id]/execute/route"

describe("POST /api/finance/payment-orders/[id]/execute", () => {
  it("returns 400 when status is not approved", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ id: "po-1", status: "pending_approval" } as any)
    const res = await executePost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("approved")
  })

  it("transitions approved → executed via $transaction", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({
      id: "po-1", status: "approved", orderNumber: "ПП-001",
      counterpartyName: "Acme", counterpartyId: null, amount: 500, currency: "AZN",
      purpose: "Services", billId: null, paymentMethod: "bank_transfer",
    } as any)

    const res = await executePost(makeReq("http://localhost/x", "POST"), { params: params() })
    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  check-deadlines                                                    */
/* ================================================================== */
import { GET as deadlinesGet, POST as deadlinesPost } from "@/app/api/finance/payment-orders/check-deadlines/route"

describe("GET /api/finance/payment-orders/check-deadlines", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await deadlinesGet(makeReq("http://localhost/api/finance/payment-orders/check-deadlines"))
    expect(res.status).toBe(401)
  })

  it("returns upcoming deadlines", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.bill.findMany).mockResolvedValue([])
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    const res = await deadlinesGet(makeReq("http://localhost/api/finance/payment-orders/check-deadlines?days=14"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveProperty("upcomingBills")
    expect(json.data).toHaveProperty("upcomingInvoices")
    expect(json.data.daysAhead).toBe(14)
  })
})

/* ================================================================== */
/*  next-number                                                        */
/* ================================================================== */
import { GET as nextNumberGet } from "@/app/api/finance/payment-orders/next-number/route"

describe("GET /api/finance/payment-orders/next-number", () => {
  it("returns ПП-001 when no orders exist", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(null)
    const res = await nextNumberGet(makeReq("http://localhost/api/finance/payment-orders/next-number"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.nextNumber).toBe("ПП-001")
  })

  it("increments from the last order number", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ orderNumber: "ПП-005" } as any)
    const res = await nextNumberGet(makeReq("http://localhost/api/finance/payment-orders/next-number"))
    const json = await res.json()
    expect(json.data.nextNumber).toBe("ПП-006")
  })
})

/* ================================================================== */
/*  stats                                                              */
/* ================================================================== */
import { GET as statsGet } from "@/app/api/finance/payment-orders/stats/route"

describe("GET /api/finance/payment-orders/stats", () => {
  it("returns aggregated stats", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.count)
      .mockResolvedValueOnce(3 as any)   // draft
      .mockResolvedValueOnce(2 as any)   // pending
      .mockResolvedValueOnce(1 as any)   // approved
      .mockResolvedValueOnce(5 as any)   // executed
    vi.mocked(prisma.paymentOrder.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: 10000 } } as any)
      .mockResolvedValueOnce({ _sum: { amount: 5000 } } as any)

    const res = await statsGet(makeReq("http://localhost/api/finance/payment-orders/stats"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.totalDraft).toBe(3)
    expect(json.data.totalExecuted).toBe(5)
    expect(json.data.totalAmount).toBe(10000)
    expect(json.data.executedAmount).toBe(5000)
  })
})

/* ================================================================== */
/*  notification-settings                                              */
/* ================================================================== */
import { GET as notifGet, PUT as notifPut } from "@/app/api/finance/payment-orders/notification-settings/route"

describe("GET /api/finance/payment-orders/notification-settings", () => {
  it("returns defaults when no settings stored", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
    const res = await notifGet(makeReq("http://localhost/api/finance/payment-orders/notification-settings"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.overdue.enabled).toBe(true)
  })
})

describe("PUT /api/finance/payment-orders/notification-settings", () => {
  it("returns 400 for invalid JSON", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = new NextRequest("http://localhost/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    })
    const res = await notifPut(req)
    expect(res.status).toBe(400)
  })

  it("saves valid notification settings", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
    vi.mocked(prisma.organization.update).mockResolvedValue({} as any)
    const body = {
      recipientEmail: "admin@co.az",
      overdue: { enabled: false, channels: ["email"] },
      advance: { enabled: true, channels: ["telegram"], daysBeforeDeadline: 5 },
      paymentOrders: { enabled: true, channels: ["telegram"] },
      billPayments: { enabled: true, channels: ["telegram"] },
    }
    const res = await notifPut(makeReq("http://localhost/x", "PUT", body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.overdue.enabled).toBe(false)
  })
})

/* ================================================================== */
/*  numbering-gaps                                                     */
/* ================================================================== */
import { GET as gapsGet } from "@/app/api/finance/payment-orders/numbering-gaps/route"

describe("GET /api/finance/payment-orders/numbering-gaps", () => {
  it("returns empty gaps when no orders", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findMany).mockResolvedValue([])
    const res = await gapsGet(makeReq("http://localhost/api/finance/payment-orders/numbering-gaps"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.gaps).toEqual([])
    expect(json.data.totalOrders).toBe(0)
  })

  it("detects gaps in numbering", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findMany).mockResolvedValue([
      { orderNumber: "ПП-001", status: "executed", createdAt: new Date() },
      { orderNumber: "ПП-003", status: "draft", createdAt: new Date() },
    ] as any)
    const res = await gapsGet(makeReq("http://localhost/api/finance/payment-orders/numbering-gaps"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.gaps).toContain("ПП-002")
    expect(json.data.lastNumber).toBe(3)
  })
})
