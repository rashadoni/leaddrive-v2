/**
 * Order-return transition — D3 OMS Phase 6 Block A slice 2.
 *
 *   POST /api/v1/order-returns/[id]/transition
 *
 * Body shape (discriminated by `to`):
 *   { to: "approved"  }                          — sets approvedAt
 *   { to: "received"  }                          — sets receivedAt
 *   { to: "refunded", refundedAmount, refundRef } — sets refundedAt + amount + ref
 *   { to: "closed"   }                          — terminal close (may be no-refund)
 *   { to: "rejected" }                          — terminal reject (only from requested)
 *   { to: "cancelled"}                          — terminal cancel (only from approved)
 *
 * Refund coherence: when `to = "refunded"`, both `refundedAmount` and
 * `refundRef` are required so the DB CHECK (all-three-NULL OR all-
 * three-non-NULL) is satisfied. Other transitions reject these fields
 * to prevent accidentally setting half-state from non-refund branches.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { advanceReturnState } from "@/lib/oms/return-state-machine"
import { RETURN_STATUSES, type ReturnStatus } from "@/lib/oms/types"

const transitionSchema = z.object({
  to: z.enum(RETURN_STATUSES),
  refundedAmount: z.number().min(0).max(1_000_000_000).optional(),
  refundRef: z.string().min(1).max(255).optional(),
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

export const POST = withRlsAuth("commerce", "write", async (req: NextRequest, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = transitionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const existing = await prisma.orderReturn.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Return not found in tenant" }, { status: 404 })
  }

  const move = advanceReturnState({
    from: existing.status as ReturnStatus,
    to: parsed.data.to,
  })
  if (!move.ok) {
    return NextResponse.json({ error: move.error }, { status: 409 })
  }

  // Refund-coherence gate at the request boundary:
  //   • on `to=refunded` — caller MUST supply both refundedAmount + refundRef
  //   • on any other transition — caller MUST NOT supply either field
  // The DB CHECK enforces the same invariant; we surface a 400 here
  // so the operator sees a clear error before the DB fires a generic
  // CHECK violation.
  if (parsed.data.to === "refunded") {
    if (parsed.data.refundedAmount == null || parsed.data.refundRef == null) {
      return NextResponse.json(
        { error: "Transitioning to 'refunded' requires both refundedAmount and refundRef" },
        { status: 400 }
      )
    }
  } else {
    if (parsed.data.refundedAmount != null || parsed.data.refundRef != null) {
      return NextResponse.json(
        { error: `refundedAmount / refundRef are only accepted when to='refunded' (got to='${parsed.data.to}')` },
        { status: 400 }
      )
    }
  }

  const now = new Date()
  const update: {
    status: ReturnStatus
    approvedAt?: Date
    receivedAt?: Date
    refundedAt?: Date
    refundedAmount?: number
    refundRef?: string
  } = { status: parsed.data.to }

  if (move.sideEffect === "approving") update.approvedAt = now
  if (move.sideEffect === "receiving") update.receivedAt = now
  if (move.sideEffect === "refunding") {
    update.refundedAt = now
    // Non-null asserted by the gate above.
    update.refundedAmount = parsed.data.refundedAmount as number
    update.refundRef = parsed.data.refundRef as string
  }

  const updated = await prisma.orderReturn.update({
    where: { id: existing.id },
    data: update,
    include: { items: true },
  })

  return NextResponse.json({ return: updated, kind: move.sideEffect })
})
