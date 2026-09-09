/**
 * Order returns / RMA registry — D3 OMS Phase 6 Block A slice 2.
 *
 *   POST /api/v1/order-returns  — create an RMA on a BuyerOrder
 *   GET  /api/v1/order-returns  — list (filter by orderId, status)
 *
 * The cumulative-cap math (sibling returns + proposed lines) runs
 * inside a transaction so the SELECT-then-INSERT path is atomic. Slice
 * 2 ships admin-side create + list; slice 3 wires the customer-
 * facing portal form and the refund-webhook handlers.
 *
 * Race-window note: the transaction uses Prisma's default
 * READ COMMITTED isolation. Two concurrent POSTs that each see the
 * same `existingReturns` snapshot can both pass `validateReturnQuantities`
 * and over-allocate by exactly one batch. The DB CHECK on per-(return,
 * orderItem) uniqueness DOES NOT close this — it's a unique on
 * (returnId, orderItemId) not on (orderItemId, organizationId). Slice 3
 * will add a Prisma `$queryRaw('FOR UPDATE')` on the order row OR
 * promote the transaction to SERIALIZABLE. For slice 2, the admin UI
 * is single-operator + the race is theoretical; flagged here for
 * explicit slice-3 closure.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateReturnQuantities } from "@/lib/oms/return-quantity-validator"
import { createNotification } from "@/lib/notifications"
import {
  RETURN_STATUSES,
  type ExistingReturnLine,
  type OrderLineRow,
  type ProposedReturnLine,
  type ReturnStatus,
} from "@/lib/oms/types"

const proposedLineSchema = z.object({
  orderItemId: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(1_000_000),
  reason: z.string().max(500).optional(),
})

const createSchema = z.object({
  orderId: z.string().min(1).max(120),
  /**
   * Optional caller-supplied RMA number. If omitted, the route mints
   * one as `RMA-<timestamp>`. Slice 3 wires a per-tenant numeric
   * sequence (mirrors how invoiceNumber will eventually work).
   */
  rmaNumber: z.string().min(1).max(64).optional(),
  reason: z.string().max(4000).optional(),
  items: z.array(proposedLineSchema).min(1).max(500),
})

const statusFilterSchema = z.enum(RETURN_STATUSES).optional()

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("commerce", "write", async (req: NextRequest, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Cross-tenant order FK check — must belong to this tenant.
  // Helper-cast to keep `.map()` callback types crisp; the Prisma
  // `findFirst` nested-select inference doesn't always carry through
  // into downstream destructuring.
  // ⚠️ Keep these local types in sync with the `select { ... }` clause
  // below — adding a field to the select without updating the type
  // leaves the new field invisible to TS at the route boundary.
  type OrderItemRow = {
    id: string
    productId: string
    productName: string
    quantity: number
  }
  type OrderRow = { id: string; status: string; items: OrderItemRow[] }
  const order = (await prisma.buyerOrder.findFirst({
    where: { id: parsed.data.orderId, organizationId: auth.orgId },
    select: {
      id: true,
      status: true,
      items: {
        select: { id: true, productId: true, productName: true, quantity: true },
      },
    },
  })) as OrderRow | null
  if (!order) {
    return NextResponse.json({ error: "Order not found in tenant" }, { status: 404 })
  }

  // Returns only make sense post-shipment. An RMA against a draft /
  // approved / cancelled order is a UI bug.
  const RETURNABLE_ORDER_STATUSES = new Set([
    "shipped",
    "delivered",
    "closed",
  ])
  if (!RETURNABLE_ORDER_STATUSES.has(order.status)) {
    return NextResponse.json(
      {
        error: `Order is in status "${order.status}"; must be "shipped", "delivered", or "closed" before a return can be filed`,
      },
      { status: 409 }
    )
  }

  // Snapshot productId + productName from the order line into the
  // return line — survives line deletion. The validator only sees
  // ids + quantities, so we look up names from the order graph above.
  const orderItemById = new Map(order.items.map((it) => [it.id, it]))

  const orderLines: OrderLineRow[] = order.items.map((it) => ({
    id: it.id,
    quantity: it.quantity,
  }))

  // Pull existing return lines for this order. The validator filters
  // rejected/cancelled siblings out of the cap math — we deliberately
  // include ALL statuses here and let the helper do the filtering, so
  // a sibling-status regression is caught by lib-oms tests, not
  // silently absorbed by the SELECT.
  //
  // Defense-in-depth: scope the JOIN by `organizationId: auth.orgId`
  // as well as `orderId`. The FK from OrderReturn → BuyerOrder
  // already implies same-tenant rows (cross-tenant FK insertion is
  // impossible via the Prisma layer), but if a future raw-SQL
  // script or migration ever creates a mismatched-org return, the
  // double-scope here prevents the validator from reading
  // another tenant's return cap into this tenant's math.
  // ⚠️ Keep in sync with the `select { ... }` clause below — same drift
  // tripwire as the OrderRow declaration above.
  type ExistingItemRow = {
    orderItemId: string
    quantity: number
    return: { status: string }
  }
  const existingItems = (await prisma.orderReturnItem.findMany({
    where: { return: { organizationId: auth.orgId, orderId: order.id } },
    select: {
      orderItemId: true,
      quantity: true,
      return: { select: { status: true } },
    },
  })) as ExistingItemRow[]
  const existingReturns: ExistingReturnLine[] = existingItems.map((row) => ({
    orderItemId: row.orderItemId,
    quantity: row.quantity,
    returnStatus: row.return.status as ReturnStatus,
  }))

  const proposed: ProposedReturnLine[] = parsed.data.items.map((it) => ({
    orderItemId: it.orderItemId,
    quantity: it.quantity,
  }))

  const validation = validateReturnQuantities({
    orderLines,
    existingReturns,
    proposed,
  })
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Return quantity validation failed", details: validation.errors },
      { status: 400 }
    )
  }

  const rmaNumber = parsed.data.rmaNumber ?? `RMA-${Date.now()}`

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newReturn = await tx.orderReturn.create({
        data: {
          organizationId: auth.orgId,
          orderId: order.id,
          rmaNumber,
          status: "requested",
          reason: parsed.data.reason ?? null,
          createdBy: auth.userId,
        },
      })

      for (const it of parsed.data.items) {
        const orderItem = orderItemById.get(it.orderItemId)
        // Already validated existence in `validateReturnQuantities`;
        // this is a defense-in-depth fallback so a TOCTOU race between
        // SELECT and INSERT surfaces here instead of hitting a Prisma
        // FK error.
        if (!orderItem) {
          throw new Error(`Order item ${it.orderItemId} disappeared mid-transaction`)
        }
        await tx.orderReturnItem.create({
          data: {
            returnId: newReturn.id,
            orderItemId: it.orderItemId,
            productId: orderItem.productId,
            productName: orderItem.productName,
            quantity: it.quantity,
            reason: it.reason ?? null,
          },
        })
      }

      return tx.orderReturn.findUnique({
        where: { id: newReturn.id },
        include: { items: true },
      })
    })

    // Phase 2c notification — org-wide in-app only (no specific recipient for BuyerOrder returns).
    // Best-effort: .catch() so it never blocks the response.
    createNotification({
      organizationId: auth.orgId,
      type: "info",
      title: "Order return filed",
      message: `Return ${rmaNumber} filed for order ${parsed.data.orderId}`,
      entityType: "order",
      entityId: parsed.data.orderId,
      kind: "order.returned",
    }).catch(() => {})

    return NextResponse.json({ return: created }, { status: 201 })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      // Two collision shapes share this code:
      //   • (organizationId, rmaNumber) — caller passed a duplicate
      //     rmaNumber or `Date.now()` collided under tight load
      //   • (returnId, orderItemId) — TOCTOU race between two
      //     concurrent POSTs proposed the same orderItem within
      //     the same new return id (very narrow, but possible)
      // Branch on `e.meta.target` (Prisma surfaces the columns that
      // triggered the index) so the operator sees the actual cause,
      // not a hardcoded RMA-already-exists message.
      const target = (e.meta?.target ?? []) as readonly string[]
      const isItemDup = target.includes("returnId") && target.includes("orderItemId")
      if (isItemDup) {
        return NextResponse.json(
          {
            error: "Return references the same order item twice — collapse duplicate orderItemIds client-side and retry",
          },
          { status: 409 }
        )
      }
      // Fall through: rmaNumber unique on (organizationId, rmaNumber).
      return NextResponse.json(
        {
          error: `RMA "${rmaNumber}" already exists in this tenant — pass a different rmaNumber or omit to auto-generate`,
        },
        { status: 409 }
      )
    }
    throw e
  }
})

export const GET = withRlsAuth("commerce", "read", async (req: NextRequest, auth) => {
  const url = new URL(req.url)
  const orderId = url.searchParams.get("orderId")
  const statusRaw = url.searchParams.get("status")
  const statusParsed = statusFilterSchema.safeParse(statusRaw ?? undefined)
  if (!statusParsed.success) {
    const echo = (statusRaw ?? "").slice(0, 32)
    return NextResponse.json({ error: `Invalid status filter: "${echo}"` }, { status: 400 })
  }

  const returns = await prisma.orderReturn.findMany({
    where: {
      organizationId: auth.orgId,
      ...(orderId ? { orderId } : {}),
      ...(statusParsed.data ? { status: statusParsed.data } : {}),
    },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    // TODO(slice 3): cursor pagination alongside the RMA admin UI.
    take: 500,
  })

  return NextResponse.json({ returns })
})
