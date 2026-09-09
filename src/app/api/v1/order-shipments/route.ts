/**
 * Order shipments registry — D3 OMS Phase 6 Block A slice 2.
 *
 *   POST /api/v1/order-shipments  — create a pending shipment on a BuyerOrder
 *   GET  /api/v1/order-shipments  — list (filter by orderId, status)
 *
 * State transitions land on the [id]/transition sibling route. Slice 2
 * ships the admin-side CRUD + transition routes; slice 3 wires the
 * shipping-provider integrations (label generation, tracking pull)
 * and the customer-facing tracking page.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { SHIPMENT_STATUSES } from "@/lib/oms/types"
import { createNotification } from "@/lib/notifications"

/**
 * Per-line snapshot — matches the `ShipmentLineSnapshot` interface
 * declared at `src/lib/oms/types.ts`. JSON column shape kept in sync
 * here at the request boundary.
 */
const lineItemSchema = z.object({
  orderItemId: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(1_000_000),
  productName: z.string().max(255).optional(),
})

const createSchema = z.object({
  orderId: z.string().min(1).max(120),
  /** Free-text carrier slug; slice 3 may enum once integrations land. */
  carrier: z.string().min(1).max(64),
  trackingNumber: z.string().min(1).max(128).optional(),
  /** Empty array allowed — caller may not know which lines yet. */
  lineItems: z.array(lineItemSchema).max(500).optional(),
})

const statusFilterSchema = z.enum(SHIPMENT_STATUSES).optional()

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
  const order = await prisma.buyerOrder.findFirst({
    where: { id: parsed.data.orderId, organizationId: auth.orgId },
    select: { id: true, status: true },
  })
  if (!order) {
    return NextResponse.json({ error: "Order not found in tenant" }, { status: 404 })
  }

  // Shipments only make sense post-approval. Catches the operator
  // mistake of trying to ship a draft / submitted / cancelled order.
  // The state machine reasons about Shipment status, NOT BuyerOrder
  // status, so this gate lives at the route.
  const SHIPPABLE_ORDER_STATUSES = new Set([
    "approved",
    "shipped",
    "delivered",
    "closed",
  ])
  if (!SHIPPABLE_ORDER_STATUSES.has(order.status)) {
    return NextResponse.json(
      {
        error: `Order is in status "${order.status}"; must be "approved", "shipped", "delivered", or "closed" before a shipment can be created`,
      },
      { status: 409 }
    )
  }

  // Validate per-line orderItemIds (if provided) belong to the order.
  if (parsed.data.lineItems && parsed.data.lineItems.length > 0) {
    const itemIds = Array.from(new Set(parsed.data.lineItems.map((li) => li.orderItemId)))
    const owned = (await prisma.buyerOrderItem.findMany({
      where: { id: { in: itemIds }, orderId: order.id },
      select: { id: true },
    })) as { id: string }[]
    if (owned.length !== itemIds.length) {
      const ownedSet = new Set(owned.map((o) => o.id))
      const stray = itemIds.filter((id) => !ownedSet.has(id))
      return NextResponse.json(
        {
          error: `Shipment lineItems reference order items not on this order: ${stray.slice(0, 5).join(", ")}`,
        },
        { status: 400 }
      )
    }
  }

  const created = await prisma.orderShipment.create({
    data: {
      organizationId: auth.orgId,
      orderId: order.id,
      carrier: parsed.data.carrier,
      trackingNumber: parsed.data.trackingNumber ?? null,
      status: "pending",
      lineItems: (parsed.data.lineItems ?? []) as unknown as Prisma.InputJsonValue,
      createdBy: auth.userId,
    },
  })

  // Phase 2c notification — org-wide in-app only (no specific recipient for BuyerOrder shipments).
  // Best-effort: .catch() so it never blocks the response.
  createNotification({
    organizationId: auth.orgId,
    type: "info",
    title: "Order shipped",
    message: `Shipment created for order ${parsed.data.orderId}`,
    entityType: "order",
    entityId: parsed.data.orderId,
    kind: "order.shipped",
  }).catch(() => {})

  return NextResponse.json({ shipment: created }, { status: 201 })
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

  const shipments = await prisma.orderShipment.findMany({
    where: {
      organizationId: auth.orgId,
      ...(orderId ? { orderId } : {}),
      ...(statusParsed.data ? { status: statusParsed.data } : {}),
    },
    orderBy: { createdAt: "desc" },
    // TODO(slice 3): cursor pagination paired with the carrier-pull cron + admin UI.
    take: 500,
  })

  return NextResponse.json({ shipments })
})
