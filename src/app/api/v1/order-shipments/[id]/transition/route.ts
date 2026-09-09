/**
 * Order-shipment transition — D3 OMS Phase 6 Block A slice 2.
 *
 *   POST /api/v1/order-shipments/[id]/transition
 *
 * Body: `{ to: ShipmentStatus, lastStatusNote?: string }`
 *
 * Uses the slice-1 `advanceShipmentState` helper to validate the
 * transition, then applies the matching timestamp side-effect:
 *
 *   sideEffect = "shipping"   → set shippedAt = now()
 *   sideEffect = "delivering" → set deliveredAt = now() (shippedAt
 *                               must already be set per DB CHECK;
 *                               if route entered from `pending →
 *                               delivered` skip the SM blocks it,
 *                               so this is safe — see slice-1 tests).
 *   sideEffect = "none"       → no timestamp write
 *
 * The DB CHECK `order_shipments_timestamps_check` is the final
 * gate — it'll reject a row where the route helper math diverged
 * from the schema's invariant (defense-in-depth).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { advanceShipmentState } from "@/lib/oms/shipment-state-machine"
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/oms/types"

const transitionSchema = z.object({
  to: z.enum(SHIPMENT_STATUSES),
  lastStatusNote: z.string().max(2000).optional(),
})

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

export const POST = withRlsAuth("commerce", "write", async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = transitionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const existing = await prisma.orderShipment.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true, shippedAt: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Shipment not found in tenant" }, { status: 404 })
  }

  const move = advanceShipmentState({
    from: existing.status as ShipmentStatus,
    to: parsed.data.to,
  })
  if (!move.ok) {
    return NextResponse.json({ error: move.error }, { status: 409 })
  }

  // Build the update payload — only write timestamps the SM tells us
  // to. Existing `shippedAt` is preserved on `delivering` transitions
  // (which require shippedAt non-null per DB CHECK; SM only allows
  // `delivering` from `in_transit` / `exception`, both of which have
  // shippedAt set).
  const now = new Date()
  const update: {
    status: ShipmentStatus
    shippedAt?: Date
    deliveredAt?: Date
    lastStatusNote?: string | null
  } = {
    status: parsed.data.to,
  }
  if (move.sideEffect === "shipping") update.shippedAt = now
  if (move.sideEffect === "delivering") update.deliveredAt = now
  if (parsed.data.lastStatusNote !== undefined) {
    update.lastStatusNote = parsed.data.lastStatusNote
  }

  const updated = await prisma.orderShipment.update({
    where: { id: existing.id },
    data: update,
  })

  return NextResponse.json({ shipment: updated, kind: move.sideEffect })
})
