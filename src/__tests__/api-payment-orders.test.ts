import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentOrder: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn() }))
vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "AZN" }))

import { GET, POST } from "@/app/api/finance/payment-orders/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { NextRequest } from "next/server"

function makeReq(url = "http://localhost/api/finance/payment-orders", body?: unknown): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }
  return new NextRequest(url)
}

function makeBadJsonReq(): NextRequest {
  return new NextRequest("http://localhost/api/finance/payment-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{{{",
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("GET /api/finance/payment-orders", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  it("returns orders ordered by createdAt desc", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const orders = [{ id: "o1" }, { id: "o2" }]
    vi.mocked(prisma.paymentOrder.findMany).mockResolvedValue(orders as any)

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ data: orders })
    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { createdAt: "desc" },
    })
  })

  it("applies status filter when provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findMany).mockResolvedValue([])

    const res = await GET(makeReq("http://localhost/api/finance/payment-orders?status=approved"))
    expect(res.status).toBe(200)
    expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", status: "approved" },
      orderBy: { createdAt: "desc" },
    })
  })
})

describe("POST /api/finance/payment-orders", () => {
  const validBody = {
    counterpartyName: "Acme Corp",
    amount: 1500.50,
    purpose: "Office supplies",
  }

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST(makeReq(undefined, validBody))
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid JSON", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST(makeBadJsonReq())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Invalid JSON")
  })

  it("creates order with 201 and auto-generates first order number", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(null)
    const created = { id: "po-1", orderNumber: "ПП-001" }
    vi.mocked(prisma.paymentOrder.create).mockResolvedValue(created as any)

    const res = await POST(makeReq(undefined, validBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data).toEqual(created)
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        orderNumber: "ПП-001",
        counterpartyName: "Acme Corp",
        amount: 1500.50,
        purpose: "Office supplies",
      }),
    })
  })

  it("increments order number from last existing order", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue({ orderNumber: "ПП-005" } as any)
    vi.mocked(prisma.paymentOrder.create).mockResolvedValue({ id: "po-2", orderNumber: "ПП-006" } as any)

    await POST(makeReq(undefined, validBody))
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderNumber: "ПП-006" }),
    })
  })

  it("returns 400 when required field counterpartyName is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST(makeReq(undefined, { amount: 100, purpose: "Test" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Validation failed")
    expect(json.details).toHaveProperty("counterpartyName")
  })

  it("returns 400 when unknown field is provided (strict schema)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST(makeReq(undefined, { ...validBody, unknownField: "surprise" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Validation failed")
  })

  it("accepts amount as string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.paymentOrder.create).mockResolvedValue({ id: "po-3" } as any)

    const res = await POST(makeReq(undefined, { ...validBody, amount: "250.75" }))
    expect(res.status).toBe(201)
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 250.75 }),
    })
  })

  it("applies default currency and paymentMethod when not provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.paymentOrder.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.paymentOrder.create).mockResolvedValue({ id: "po-4" } as any)

    await POST(makeReq(undefined, validBody))
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currency: "AZN",
        paymentMethod: "bank_transfer",
      }),
    })
  })
})
