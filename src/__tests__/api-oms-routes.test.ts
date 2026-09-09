/**
 * D3 OMS slice 2 — route handler tests.
 *
 * These exercise the request-boundary behavior that the slice-1 pure-
 * helper tests can't see: auth gating, Zod input validation, cross-
 * tenant FK rejection, refund-coherence enforcement, P2002 unique
 * collision mapping. We mock Prisma + api-auth so the tests are
 * pure-fn + zero-DB; the actual SQL CHECK constraints + Prisma
 * transactions are exercised in slice-1 migration + slice-3
 * integration tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    buyerOrder: { findFirst: vi.fn() },
    buyerOrderItem: { findMany: vi.fn() },
    orderShipment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    orderReturn: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orderReturnItem: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    // $transaction here accepts a callback and runs it with `tx = this.prisma`
    // so the route's inner `tx.orderReturn.create(...)` resolves to the same
    // mocked client. Mirrors the pattern in api-offers.test.ts.
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi
    .fn()
    .mockImplementation(
      (r: unknown) =>
        r != null &&
        typeof r === "object" &&
        "status" in (r as Record<string, unknown>) &&
        typeof (r as { json?: unknown }).json === "function"
    ),
}))

import { POST as POST_ship, GET as GET_ship } from "@/app/api/v1/order-shipments/route"
import { POST as POST_ship_trans } from "@/app/api/v1/order-shipments/[id]/transition/route"
import { POST as POST_ret, GET as GET_ret } from "@/app/api/v1/order-returns/route"
import { POST as POST_ret_trans } from "@/app/api/v1/order-returns/[id]/transition/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ORG = "org-1"
const USER = "user-1"
const ORDER = "ord-1"

function makeReq(url: string, method: "GET" | "POST", body?: unknown): NextRequest {
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "Content-Type": "application/json" }
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function mockAuthOk() {
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: USER,
    role: "manager",
    email: "u@example.com",
    name: "U",
  } as never)
}

function mockAuthFail() {
  // Auth helper returns a Response-like NextResponse on failure.
  vi.mocked(requireAuth).mockResolvedValue(
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ─── POST /api/v1/order-shipments ────────────────────────────────────── */

describe("POST /api/v1/order-shipments", () => {
  it("returns 401 when auth fails", async () => {
    mockAuthFail()
    const res = await POST_ship(
      makeReq("/api/v1/order-shipments", "POST", { orderId: ORDER, carrier: "ups" })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 on malformed body", async () => {
    mockAuthOk()
    // missing required `carrier` field
    const res = await POST_ship(
      makeReq("/api/v1/order-shipments", "POST", { orderId: ORDER })
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when order is not in tenant", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue(null)
    const res = await POST_ship(
      makeReq("/api/v1/order-shipments", "POST", { orderId: ORDER, carrier: "ups" })
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 when order is in draft/submitted (not yet shippable)", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "draft",
    } as never)
    const res = await POST_ship(
      makeReq("/api/v1/order-shipments", "POST", { orderId: ORDER, carrier: "ups" })
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/must be "approved"/)
  })

  it("rejects stray orderItemIds in lineItems with 400", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "approved",
    } as never)
    // Order owns only "oi_widget"; payload includes "oi_phantom"
    vi.mocked(prisma.buyerOrderItem.findMany).mockResolvedValue([
      { id: "oi_widget" },
    ] as never)
    const res = await POST_ship(
      makeReq("/api/v1/order-shipments", "POST", {
        orderId: ORDER,
        carrier: "ups",
        lineItems: [
          { orderItemId: "oi_widget", quantity: 1 },
          { orderItemId: "oi_phantom", quantity: 1 },
        ],
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/oi_phantom/)
  })

  it("creates a pending shipment on a happy path", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "approved",
    } as never)
    const created = {
      id: "shp-1",
      organizationId: ORG,
      orderId: ORDER,
      carrier: "ups",
      trackingNumber: "1Z999",
      status: "pending",
      lineItems: [],
    }
    vi.mocked(prisma.orderShipment.create).mockResolvedValue(created as never)
    const res = await POST_ship(
      makeReq("/api/v1/order-shipments", "POST", {
        orderId: ORDER,
        carrier: "ups",
        trackingNumber: "1Z999",
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.shipment.id).toBe("shp-1")
    expect(json.shipment.status).toBe("pending")
  })
})

/* ─── GET /api/v1/order-shipments ─────────────────────────────────────── */

describe("GET /api/v1/order-shipments", () => {
  it("returns 401 when auth fails", async () => {
    mockAuthFail()
    const res = await GET_ship(makeReq("/api/v1/order-shipments", "GET"))
    expect(res.status).toBe(401)
  })

  it("returns 400 on invalid status filter", async () => {
    mockAuthOk()
    const res = await GET_ship(
      makeReq("/api/v1/order-shipments?status=fictional", "GET")
    )
    expect(res.status).toBe(400)
  })

  it("scopes findMany to org + filters when params provided", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findMany).mockResolvedValue([] as never)
    const res = await GET_ship(
      makeReq("/api/v1/order-shipments?orderId=ord-1&status=delivered", "GET")
    )
    expect(res.status).toBe(200)
    const findManyCall = vi.mocked(prisma.orderShipment.findMany).mock.calls[0][0]!
    expect(findManyCall.where).toMatchObject({
      organizationId: ORG,
      orderId: "ord-1",
      status: "delivered",
    })
  })
})

/* ─── POST /api/v1/order-shipments/[id]/transition ───────────────────── */

describe("POST /api/v1/order-shipments/[id]/transition", () => {
  function ctx(id = "shp-1") {
    return { params: Promise.resolve({ id }) }
  }

  it("returns 404 when shipment is not in tenant", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue(null)
    const res = await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", { to: "in_transit" }),
      ctx()
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 on invalid state transition (pending → delivered skip)", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue({
      id: "shp-1",
      status: "pending",
      shippedAt: null,
    } as never)
    const res = await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", { to: "delivered" }),
      ctx()
    )
    expect(res.status).toBe(409)
  })

  it("sets shippedAt when transitioning pending → in_transit", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue({
      id: "shp-1",
      status: "pending",
      shippedAt: null,
    } as never)
    vi.mocked(prisma.orderShipment.update).mockResolvedValue({
      id: "shp-1",
      status: "in_transit",
      shippedAt: new Date(),
    } as never)
    const res = await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", { to: "in_transit" }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderShipment.update).mock.calls[0][0]!
    expect(updateCall.data.status).toBe("in_transit")
    expect(updateCall.data.shippedAt).toBeInstanceOf(Date)
    expect(updateCall.data.deliveredAt).toBeUndefined()
  })

  it("sets deliveredAt when transitioning in_transit → delivered", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue({
      id: "shp-1",
      status: "in_transit",
      shippedAt: new Date("2026-05-15T00:00:00Z"),
    } as never)
    vi.mocked(prisma.orderShipment.update).mockResolvedValue({
      id: "shp-1",
      status: "delivered",
    } as never)
    const res = await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", { to: "delivered" }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderShipment.update).mock.calls[0][0]!
    expect(updateCall.data.deliveredAt).toBeInstanceOf(Date)
    // shippedAt MUST NOT be overwritten — caller-supplied / SM-set timestamp survives.
    expect(updateCall.data.shippedAt).toBeUndefined()
  })

  it("returns 409 when leaving the delivered terminal", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue({
      id: "shp-1",
      status: "delivered",
      shippedAt: new Date(),
    } as never)
    const res = await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", { to: "in_transit" }),
      ctx()
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/terminal/i)
  })

  it("writes lastStatusNote to the update payload when supplied", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue({
      id: "shp-1",
      status: "in_transit",
      shippedAt: new Date(),
    } as never)
    vi.mocked(prisma.orderShipment.update).mockResolvedValue({
      id: "shp-1",
      status: "exception",
    } as never)
    const res = await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", {
        to: "exception",
        lastStatusNote: "Carrier reported address verification failed",
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderShipment.update).mock.calls[0][0]!
    expect(updateCall.data.lastStatusNote).toBe(
      "Carrier reported address verification failed"
    )
    // exception transition has sideEffect="none" — no new timestamp writes.
    expect(updateCall.data.shippedAt).toBeUndefined()
    expect(updateCall.data.deliveredAt).toBeUndefined()
  })

  it("omits lastStatusNote from the update payload when not supplied", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderShipment.findFirst).mockResolvedValue({
      id: "shp-1",
      status: "pending",
      shippedAt: null,
    } as never)
    vi.mocked(prisma.orderShipment.update).mockResolvedValue({
      id: "shp-1",
      status: "in_transit",
    } as never)
    await POST_ship_trans(
      makeReq("/api/v1/order-shipments/shp-1/transition", "POST", { to: "in_transit" }),
      ctx()
    )
    const updateCall = vi.mocked(prisma.orderShipment.update).mock.calls[0][0]!
    // `undefined` here (not null) — Prisma omits undefined fields,
    // preserving any prior stored note.
    expect(updateCall.data.lastStatusNote).toBeUndefined()
  })
})

/* ─── POST /api/v1/order-returns ──────────────────────────────────────── */

describe("POST /api/v1/order-returns", () => {
  it("returns 401 on auth fail", async () => {
    mockAuthFail()
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        items: [{ orderItemId: "oi_widget", quantity: 1 }],
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 on empty items", async () => {
    mockAuthOk()
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", { orderId: ORDER, items: [] })
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when order is not in tenant", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue(null)
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        items: [{ orderItemId: "oi_widget", quantity: 1 }],
      })
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 when order is in approved (not yet returnable)", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "approved",
      items: [{ id: "oi_widget", productId: "p_w", productName: "W", quantity: 5 }],
    } as never)
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        items: [{ orderItemId: "oi_widget", quantity: 1 }],
      })
    )
    expect(res.status).toBe(409)
  })

  it("returns 400 with validator errors when cap exceeded", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "delivered",
      items: [{ id: "oi_widget", productId: "p_w", productName: "W", quantity: 5 }],
    } as never)
    // Previous return already claimed 4 of 5 widgets in 'received' status.
    vi.mocked(prisma.orderReturnItem.findMany).mockResolvedValue([
      {
        orderItemId: "oi_widget",
        quantity: 4,
        return: { status: "received" },
      },
    ] as never)
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        items: [{ orderItemId: "oi_widget", quantity: 2 }],
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.details).toBeDefined()
    expect(json.details.join(" ")).toMatch(/exceeds original quantity 5/)
  })

  it("ignores rejected/cancelled siblings when computing the cap (validator integration)", async () => {
    // Two prior returns hit the same line with 4 units each, but both
    // were ultimately rejected / cancelled. The CAP is fully open
    // again — proposing 5 should succeed. This regression-guards the
    // route forwarding ALL existing rows to the validator (not pre-
    // filtering) so the validator can do the filtering itself.
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "delivered",
      items: [{ id: "oi_widget", productId: "p_w", productName: "W", quantity: 5 }],
    } as never)
    vi.mocked(prisma.orderReturnItem.findMany).mockResolvedValue([
      { orderItemId: "oi_widget", quantity: 4, return: { status: "rejected" } },
      { orderItemId: "oi_widget", quantity: 4, return: { status: "cancelled" } },
    ] as never)
    const txMocks = {
      orderReturn: {
        create: vi.fn().mockResolvedValue({ id: "ret-2" }),
        findUnique: vi.fn().mockResolvedValue({
          id: "ret-2",
          status: "requested",
          rmaNumber: "RMA-REOPEN",
          items: [],
        }),
      },
      orderReturnItem: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )

    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        rmaNumber: "RMA-REOPEN",
        items: [{ orderItemId: "oi_widget", quantity: 5 }],
      })
    )
    expect(res.status).toBe(201)

    // Air-tightness: prove the route forwarded ALL existing rows to
    // the validator — i.e. did NOT pre-filter by status at SELECT.
    // A regression that adds `return: { status: { notIn: [...] } }` to
    // the findMany would still produce status=201 on this test (empty
    // result set instead of 8-units result set), so we must inspect
    // the actual where clause.
    const findManyCall = vi.mocked(prisma.orderReturnItem.findMany).mock.calls[0][0]
    // The nested filter on `return` must contain organizationId +
    // orderId only — NO status predicate. If a regression adds one,
    // this assertion breaks.
    const returnFilter = (findManyCall?.where as { return?: Record<string, unknown> } | undefined)?.return
    expect(returnFilter).toBeDefined()
    expect(Object.keys(returnFilter as Record<string, unknown>).sort()).toEqual([
      "orderId",
      "organizationId",
    ])
  })

  it("creates an RMA in 'requested' status on happy path", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "delivered",
      items: [{ id: "oi_widget", productId: "p_w", productName: "W", quantity: 5 }],
    } as never)
    vi.mocked(prisma.orderReturnItem.findMany).mockResolvedValue([] as never)

    // $transaction callback runs synchronously in tests — wire to a
    // mock tx that records writes and returns a shape-correct row.
    const txMocks = {
      orderReturn: {
        create: vi.fn().mockResolvedValue({ id: "ret-1" }),
        findUnique: vi.fn().mockResolvedValue({
          id: "ret-1",
          status: "requested",
          rmaNumber: "RMA-CUSTOM",
          items: [
            { id: "ri-1", orderItemId: "oi_widget", quantity: 1, productId: "p_w" },
          ],
        }),
      },
      orderReturnItem: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )

    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        rmaNumber: "RMA-CUSTOM",
        items: [{ orderItemId: "oi_widget", quantity: 1, reason: "damaged" }],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.return.id).toBe("ret-1")
    expect(json.return.status).toBe("requested")
    expect(json.return.rmaNumber).toBe("RMA-CUSTOM")
  })

  it("returns 409 on rmaNumber unique collision (P2002)", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "delivered",
      items: [{ id: "oi_widget", productId: "p_w", productName: "W", quantity: 5 }],
    } as never)
    vi.mocked(prisma.orderReturnItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["organizationId", "rmaNumber"] },
      })
    )
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        rmaNumber: "RMA-DUP",
        items: [{ orderItemId: "oi_widget", quantity: 1 }],
      })
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/RMA "RMA-DUP" already exists/)
  })

  it("returns 409 with item-collision message when P2002 targets (returnId, orderItemId)", async () => {
    mockAuthOk()
    vi.mocked(prisma.buyerOrder.findFirst).mockResolvedValue({
      id: ORDER,
      status: "delivered",
      items: [{ id: "oi_widget", productId: "p_w", productName: "W", quantity: 5 }],
    } as never)
    vi.mocked(prisma.orderReturnItem.findMany).mockResolvedValue([] as never)
    // Concurrent POST inserted the same (returnId, orderItemId) pair —
    // narrow race window the validator can't close at SELECT time.
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["returnId", "orderItemId"] },
      })
    )
    const res = await POST_ret(
      makeReq("/api/v1/order-returns", "POST", {
        orderId: ORDER,
        rmaNumber: "RMA-X",
        items: [{ orderItemId: "oi_widget", quantity: 1 }],
      })
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    // MUST NOT regress to the hardcoded RMA-already-exists message —
    // the operator needs to see the actual cause.
    expect(json.error).not.toMatch(/RMA "/)
    expect(json.error).toMatch(/same order item twice/i)
  })
})

/* ─── POST /api/v1/order-returns/[id]/transition ─────────────────────── */

describe("POST /api/v1/order-returns/[id]/transition", () => {
  function ctx(id = "ret-1") {
    return { params: Promise.resolve({ id }) }
  }

  it("returns 404 when return is not in tenant", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue(null)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", { to: "approved" }),
      ctx()
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 on invalid SM transition (requested → refunded skip)", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "requested",
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", {
        to: "refunded",
        refundedAmount: 50,
        refundRef: "stripe_re_x",
      }),
      ctx()
    )
    expect(res.status).toBe(409)
  })

  it("requires refundedAmount + refundRef when to='refunded'", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "received",
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", { to: "refunded" }),
      ctx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/requires both refundedAmount and refundRef/)
  })

  it("rejects refundedAmount on a non-refunded transition (approved branch)", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "requested",
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", {
        to: "approved",
        refundedAmount: 50, // illegal on non-refunded
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/only accepted when to='refunded'/)
  })

  it("rejects refundRef-only payload on approved → received transition", async () => {
    // received transition has sideEffect="receiving" — the route MUST
    // not write any refund column. refundRef alone (without amount or
    // at) would create a half-coherent row that the DB CHECK rejects;
    // we reject at the route boundary for a clearer error.
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "approved",
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", {
        to: "received",
        refundRef: "stripe_re_leak",
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/only accepted when to='refunded'/)
  })

  it("rejects refundedAmount on approved → cancelled (terminal branch)", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "approved",
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", {
        to: "cancelled",
        refundedAmount: 0, // 0 is still "supplied" — gate uses != null
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/only accepted when to='refunded'/)
  })

  it("rejects refund fields on refunded → closed (already-refunded coherence)", async () => {
    // refunded → closed has sideEffect="none" — the refund triplet
    // was already written at the received → refunded step. Re-supplying
    // refund fields here would re-write the columns, breaking the
    // "set-once" semantic. Reject at the route boundary.
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "refunded",
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", {
        to: "closed",
        refundedAmount: 99.99,
        refundRef: "stripe_re_resupplied",
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/only accepted when to='refunded'/)
  })

  it("sets approvedAt on requested → approved", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "requested",
    } as never)
    vi.mocked(prisma.orderReturn.update).mockResolvedValue({
      id: "ret-1",
      status: "approved",
      items: [],
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", { to: "approved" }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderReturn.update).mock.calls[0][0]!
    expect(updateCall.data.status).toBe("approved")
    expect(updateCall.data.approvedAt).toBeInstanceOf(Date)
    expect(updateCall.data.receivedAt).toBeUndefined()
    expect(updateCall.data.refundedAt).toBeUndefined()
  })

  it("sets all three refund columns on received → refunded", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "received",
    } as never)
    vi.mocked(prisma.orderReturn.update).mockResolvedValue({
      id: "ret-1",
      status: "refunded",
      items: [],
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", {
        to: "refunded",
        refundedAmount: 87.5,
        refundRef: "stripe_re_abc",
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderReturn.update).mock.calls[0][0]!
    // Refund-coherence: all three columns set together.
    expect(updateCall.data.refundedAt).toBeInstanceOf(Date)
    expect(updateCall.data.refundedAmount).toBe(87.5)
    expect(updateCall.data.refundRef).toBe("stripe_re_abc")
  })

  it("allows refunded → closed without touching the already-populated refund triplet (set-once semantic)", async () => {
    // The refund triplet (amount/ref/at) was set at the prior received
    // → refunded step. Closing on top of that MUST NOT overwrite —
    // verifies the route's update payload contains NEITHER any new
    // refund field NOR any timestamp side-effect. The DB row's
    // existing refunded* values survive untouched.
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "refunded",
    } as never)
    vi.mocked(prisma.orderReturn.update).mockResolvedValue({
      id: "ret-1",
      status: "closed",
      items: [],
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", { to: "closed" }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderReturn.update).mock.calls[0][0]!
    // Status flip only — every other field stays `undefined` so Prisma
    // emits a partial UPDATE that does not touch refund columns.
    expect(updateCall.data.status).toBe("closed")
    expect(updateCall.data.refundedAt).toBeUndefined()
    expect(updateCall.data.refundedAmount).toBeUndefined()
    expect(updateCall.data.refundRef).toBeUndefined()
    expect(updateCall.data.approvedAt).toBeUndefined()
    expect(updateCall.data.receivedAt).toBeUndefined()
  })

  it("allows received → closed (no-refund close) WITHOUT touching refund columns", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findFirst).mockResolvedValue({
      id: "ret-1",
      status: "received",
    } as never)
    vi.mocked(prisma.orderReturn.update).mockResolvedValue({
      id: "ret-1",
      status: "closed",
      items: [],
    } as never)
    const res = await POST_ret_trans(
      makeReq("/api/v1/order-returns/ret-1/transition", "POST", { to: "closed" }),
      ctx()
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.orderReturn.update).mock.calls[0][0]!
    // Refund triplet must stay untouched so the DB CHECK
    // (refund_coherence — all-NULL OR all-non-NULL) holds.
    expect(updateCall.data.refundedAt).toBeUndefined()
    expect(updateCall.data.refundedAmount).toBeUndefined()
    expect(updateCall.data.refundRef).toBeUndefined()
  })
})

/* ─── GET /api/v1/order-returns ───────────────────────────────────────── */

describe("GET /api/v1/order-returns", () => {
  it("filters by orderId and status", async () => {
    mockAuthOk()
    vi.mocked(prisma.orderReturn.findMany).mockResolvedValue([] as never)
    const res = await GET_ret(
      makeReq("/api/v1/order-returns?orderId=ord-1&status=approved", "GET")
    )
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.orderReturn.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({
      organizationId: ORG,
      orderId: "ord-1",
      status: "approved",
    })
  })

  it("rejects invalid status filter with 400", async () => {
    mockAuthOk()
    const res = await GET_ret(
      makeReq("/api/v1/order-returns?status=stolen", "GET")
    )
    expect(res.status).toBe(400)
  })
})
