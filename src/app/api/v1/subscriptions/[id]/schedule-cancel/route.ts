/**
 * Schedule-cancel toggle — D4 Phase 6 Block A slice 2.
 *
 *   POST /api/v1/subscriptions/[id]/schedule-cancel
 *   Body: { cancelAtPeriodEnd: boolean }
 *
 * Stripe-style "cancel at period end" — flips the flag without changing
 * `status`. The actual cancel happens at currentPeriodEnd via the
 * slice-3 reaper cron, which:
 *   1. Scans `subscriptions WHERE cancelAtPeriodEnd=true AND currentPeriodEnd <= now()`
 *   2. Calls the SM with to=cancelled for each
 *   3. Writes the `cancelled` event with `metadata.reason=scheduled`
 *
 * Toggle semantics:
 *   - true: schedule a cancel at period end (cancelAtPeriodEnd=true)
 *   - false: revoke a previously-scheduled cancel (cancelAtPeriodEnd=false)
 *
 * Status gate: forbidden when status='cancelled' (already terminal).
 * The DB CHECK `subscriptions_scheduled_cancel_coherence_check` is the
 * floor — this route-level gate fires first so the human-facing error
 * message is specific ("already cancelled") instead of a generic CHECK
 * violation. Both layers enforce the same invariant; the route is
 * defense-in-depth + UX. Allowed statuses: active / paused / past_due / trial.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { normalizeSubscriptionRow } from "@/lib/prisma-decimal"

const toggleSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
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

export const POST = withRlsAuth("subscriptions", "write", async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const existing = await prisma.subscription.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true, cancelAtPeriodEnd: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Subscription not found in tenant" }, { status: 404 })
  }

  if (existing.status === "cancelled") {
    return NextResponse.json(
      { error: "Subscription is already cancelled — schedule-cancel is a no-op" },
      { status: 409 }
    )
  }

  // Same-state no-op rejection — surfaces a clearer error than the DB
  // accepting a write that doesn't change anything.
  if (existing.cancelAtPeriodEnd === parsed.data.cancelAtPeriodEnd) {
    return NextResponse.json(
      {
        error: `cancelAtPeriodEnd is already ${parsed.data.cancelAtPeriodEnd} — no-op`,
      },
      { status: 400 }
    )
  }

  const eventType = parsed.data.cancelAtPeriodEnd ? "cancel_scheduled" : "cancel_revoked"

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const u = await tx.subscription.update({
      where: { id: existing.id },
      data: { cancelAtPeriodEnd: parsed.data.cancelAtPeriodEnd },
    })
    // Schedule-cancel is a flag mutation, NOT a status transition.
    // The actual `cancelled` event is emitted by the slice-3 reaper cron
    // when the period ends. These two events let slice-3 MRR/churn
    // reporting distinguish "always active" from "scheduled-and-revoked"
    // — a primary churn-recovery KPI.
    await tx.subscriptionEvent.create({
      data: {
        organizationId: auth.orgId,
        subscriptionId: existing.id,
        eventType,
        previousStatus: existing.status,
        newStatus: existing.status,
        metadata: {
          cancelAtPeriodEnd: parsed.data.cancelAtPeriodEnd,
          source: "schedule_cancel_route",
        } as unknown as Prisma.InputJsonValue,
      },
    })
    return u
  })

  return NextResponse.json({
    subscription: normalizeSubscriptionRow(updated),
    scheduled: parsed.data.cancelAtPeriodEnd,
  })
})
