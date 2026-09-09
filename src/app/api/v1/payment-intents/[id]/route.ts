/**
 * D5 Payments — PaymentIntent per-id (GET / PATCH).
 *
 * GET  /api/v1/payment-intents/[id] — fetch one intent with refunds list.
 *   Amount fields returned as JSON numbers (Decimal→number via normalizeIntentRow /
 *   normalizeRefundRow). No credential data exposed — credentials live on the
 *   provider row, not the intent.
 *
 * PATCH /api/v1/payment-intents/[id] — advance intent status.
 *   Only `status` is mutable here; the payment gateway updates amount,
 *   externalRef, etc. via the webhook handler (POST /api/v1/payment-webhooks/[provider]).
 *   Transition validation is delegated to `advanceIntentState` (pure SM);
 *   invalid transitions return 422 Unprocessable Entity so callers can
 *   distinguish "bad data" (422) from "bad request shape" (400).
 *   Timestamp side-effects are applied per the SM contract:
 *     capturing  → succeededAt = now()
 *     failing    → failedAt   = now()
 *     cancelling → cancelledAt = now()
 *     refunding  → no intent-level timestamp (PaymentRefund row carries it)
 *     none       → status-only write
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  advanceIntentState,
  PAYMENT_INTENT_STATUSES,
  type PaymentIntentStatus,
} from "@/lib/payments"
import { normalizeIntentRow, normalizeRefundRow } from "@/lib/prisma-decimal"

const VALID_STATUSES = new Set(PAYMENT_INTENT_STATUSES as readonly string[])
const PROVIDER_SETTLED_STATUSES = new Set<PaymentIntentStatus>([
  "succeeded",
  "partially_refunded",
  "refunded",
])

/* ─── GET — fetch one intent ────────────────────────────────────────── */

export const GET = withRlsAuth("payments", "read", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await context.params

  try {
    const intent = await prisma.paymentIntent.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        providerId: true,
        externalRef: true,
        amount: true,
        currency: true,
        status: true,
        description: true,
        customerEmail: true,
        contactId: true,
        subscriptionId: true,
        invoiceId: true,
        paymentMethod: true,
        metadata: true,
        failureCode: true,
        failureMessage: true,
        succeededAt: true,
        failedAt: true,
        cancelledAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        refunds: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            externalRef: true,
            amount: true,
            currency: true,
            status: true,
            reason: true,
            failureCode: true,
            failureMessage: true,
            succeededAt: true,
            failedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    })

    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    const { refunds, ...intentScalars } = intent
    return NextResponse.json({
      intent: {
        ...normalizeIntentRow(intentScalars),
        refunds: refunds.map((r: (typeof refunds)[number]) => normalizeRefundRow(r)),
      },
    })
  } catch (err) {
    console.error("[payment-intents/:id] GET error:", err)
    return NextResponse.json({ error: "Failed to load payment intent" }, { status: 500 })
  }
})

/* ─── PATCH — advance status ────────────────────────────────────────── */

export const PATCH = withRlsAuth("payments", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await context.params

  let body: { status?: unknown }
  try {
    body = (await req.json()) as { status?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- validate target status ---------------------------------------
  if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json(
      {
        error: `\`status\` must be one of: ${PAYMENT_INTENT_STATUSES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const toStatus = body.status as PaymentIntentStatus

  if (PROVIDER_SETTLED_STATUSES.has(toStatus)) {
    return NextResponse.json(
      {
        error:
          `Payment intent status "${toStatus}" is provider-controlled. ` +
          "Use the signed payment webhook or refund flow instead.",
      },
      { status: 403 },
    )
  }

  // --- load existing intent ----------------------------------------
  const existing = await prisma.paymentIntent.findFirst({
    where: { id, organizationId: orgId },
    select: { status: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
  }

  // --- validate transition via state machine -------------------------
  const smResult = advanceIntentState({
    from: existing.status as PaymentIntentStatus,
    to: toStatus,
  })
  if (!smResult.ok) {
    return NextResponse.json(
      { error: smResult.error },
      { status: 422 },
    )
  }

  // --- build timestamp side-effects from SM hint --------------------
  const now = new Date()
  const timestampData: {
    succeededAt?: Date
    failedAt?: Date
    cancelledAt?: Date
  } = {}
  if (smResult.sideEffect === "capturing") timestampData.succeededAt = now
  if (smResult.sideEffect === "failing") timestampData.failedAt = now
  if (smResult.sideEffect === "cancelling") timestampData.cancelledAt = now
  // "refunding" and "none" → no intent-level timestamp write

  // --- write DB -----------------------------------------------------
  try {
    const updated = await prisma.paymentIntent.update({
      where: { id },
      data: { status: toStatus, ...timestampData },
      select: {
        id: true,
        organizationId: true,
        providerId: true,
        externalRef: true,
        amount: true,
        currency: true,
        status: true,
        description: true,
        customerEmail: true,
        contactId: true,
        subscriptionId: true,
        invoiceId: true,
        paymentMethod: true,
        metadata: true,
        failureCode: true,
        failureMessage: true,
        succeededAt: true,
        failedAt: true,
        cancelledAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json({ intent: normalizeIntentRow(updated) })
  } catch (err) {
    console.error("[payment-intents/:id] PATCH error:", err)
    return NextResponse.json({ error: "Failed to update payment intent" }, { status: 500 })
  }
})
