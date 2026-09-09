/**
 * Subscription plan change — D4 Phase 6 Block A slice 2.
 *
 *   POST /api/v1/subscriptions/[id]/plan-change
 *   Body: { newPlanId: string }
 *
 * Validates the new plan is in-tenant + active, runs the slice-1
 * proration calculator with the current period boundaries, snapshots
 * the new plan's price/interval onto the subscription, and emits a
 * `plan_changed` SubscriptionEvent with the prorationAmount + plan-id
 * before/after.
 *
 * Period boundaries (`currentPeriodStart/End`, `nextBillingAt`) are
 * INTENTIONALLY carried over from the old plan — proration covers
 * the price delta until the existing cycle ends; slice-3 rollover
 * cron will re-anchor on the new plan's interval at `currentPeriodEnd`.
 * This matches Stripe's mid-cycle upgrade semantics. A regression that
 * resets the period at plan-change time would (a) double-charge the
 * customer (proration + immediate full period) and (b) misalign
 * `nextBillingAt` with `currentPeriodEnd`. Tests assert the route's
 * update payload does NOT include period fields.
 *
 * Gate: only `active` subscriptions can have their plan changed.
 *   - trial / past_due / paused: changing plan from those statuses is
 *     out of scope for slice 2 (each has its own design question —
 *     plan-change from trial would need to recompute trialEndsAt,
 *     plan-change from past_due needs to reset dunning, etc.).
 *   - cancelled: terminal, rejected by the SM principle (no win-back).
 *
 * Slice-3 deferral: this route does NOT issue an invoice for the
 * proration. The `prorationAmount` is recorded on the event row;
 * actually billing it requires the Stripe-invoice bridge (slice 3).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { calculateProration } from "@/lib/subscriptions/proration-calculator"
import type { PlanSnapshotCore } from "@/lib/subscriptions/types"
import { decimalToNumber, normalizeSubscriptionRow } from "@/lib/prisma-decimal"

const changeSchema = z.object({
  newPlanId: z.string().min(1).max(120),
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

export const POST = withRlsAuth("subscriptions", "write", async (req: NextRequest, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = changeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  type SubscriptionRow = {
    id: string
    status: string
    planId: string
    unitAmount: unknown
    currency: string
    currentPeriodStart: Date
    currentPeriodEnd: Date
  }
  const existing = (await prisma.subscription.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      status: true,
      planId: true,
      unitAmount: true,
      currency: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  })) as SubscriptionRow | null
  if (!existing) {
    return NextResponse.json({ error: "Subscription not found in tenant" }, { status: 404 })
  }

  // Status gate. trial/past_due/paused/cancelled are explicitly out of
  // scope for slice-2 plan-change — each has its own design question
  // (see route header).
  if (existing.status !== "active") {
    return NextResponse.json(
      {
        error: `Plan-change requires status="active"; current status is "${existing.status}". Resolve via /transition first, OR see slice-3 design for trial/past_due plan-change.`,
      },
      { status: 409 }
    )
  }

  // Same-plan check — caller is trying to "change" to the existing plan.
  if (parsed.data.newPlanId === existing.planId) {
    return NextResponse.json(
      { error: "New planId is the same as the current planId — no-op" },
      { status: 400 }
    )
  }

  // Shape matches `PlanSnapshotCore` from `@/lib/subscriptions/types`
  // (no `trialDays` — plan-change ignores trial config; only create
  // path consumes it). Select clause + type must stay in sync.
  const newPlan = (await prisma.subscriptionPlan.findFirst({
    where: { id: parsed.data.newPlanId, organizationId: auth.orgId },
    select: {
      id: true,
      unitAmount: true,
      currency: true,
      billingInterval: true,
      billingIntervalCount: true,
      isActive: true,
    },
  })) as PlanSnapshotCore | null
  if (!newPlan) {
    return NextResponse.json({ error: "New plan not found in tenant" }, { status: 404 })
  }
  if (!newPlan.isActive) {
    return NextResponse.json(
      { error: "Target plan is archived (isActive=false); cannot change to it" },
      { status: 409 }
    )
  }

  // Currency-mismatch guard — proration math doesn't FX-convert. A
  // change from USD to EUR would silently treat them as equal, which
  // is incorrect. Slice 3 may add currency conversion via a stored
  // FX rate; for now we reject explicitly.
  if (newPlan.currency !== existing.currency) {
    return NextResponse.json(
      {
        error: `Currency mismatch — subscription is in "${existing.currency}" but new plan is in "${newPlan.currency}". Cross-currency plan changes require slice-3 FX support.`,
      },
      { status: 400 }
    )
  }

  const proration = calculateProration({
    currentUnitAmount: decimalToNumber(existing.unitAmount),
    newUnitAmount: decimalToNumber(newPlan.unitAmount),
    currentPeriodStart: existing.currentPeriodStart,
    currentPeriodEnd: existing.currentPeriodEnd,
    asOf: new Date(),
  })

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const u = await tx.subscription.update({
      where: { id: existing.id },
      data: {
        planId: newPlan.id,
        // Snapshot the new plan's price + interval (mirrors create path).
        unitAmount: decimalToNumber(newPlan.unitAmount),
        currency: newPlan.currency,
        billingInterval: newPlan.billingInterval,
        billingIntervalCount: newPlan.billingIntervalCount,
      },
    })
    await tx.subscriptionEvent.create({
      data: {
        organizationId: auth.orgId,
        subscriptionId: existing.id,
        eventType: "plan_changed",
        previousStatus: existing.status,
        newStatus: existing.status,
        previousPlanId: existing.planId,
        newPlanId: newPlan.id,
        prorationAmount: proration.prorationAmount,
        metadata: {
          unusedCredit: proration.unusedCredit,
          newCharge: proration.newCharge,
          daysRemaining: proration.daysRemaining,
          daysInPeriod: proration.daysInPeriod,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    return u
  })

  return NextResponse.json({
    subscription: normalizeSubscriptionRow(updated),
    proration: {
      prorationAmount: proration.prorationAmount,
      unusedCredit: proration.unusedCredit,
      newCharge: proration.newCharge,
      daysRemaining: proration.daysRemaining,
      daysInPeriod: proration.daysInPeriod,
    },
  })
})
