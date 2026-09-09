/**
 * D5 Payments — PaymentRefund per-id (GET).
 *
 * GET /api/v1/payment-refunds/[id] — fetch one refund.
 *   Amount returned as JSON number (Decimal→number via normalizeRefundRow).
 *
 * Note: refunds are immutable post-create from the API layer. Status
 * transitions are driven by the webhook handler (POST
 * /api/v1/payment-webhooks/[provider]) — the provider fires a refund
 * event, the handler marks the refund succeeded/failed and advances the
 * parent intent if needed.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeRefundRow } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("payments", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await context.params

  try {
    const refund = await prisma.paymentRefund.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        paymentIntentId: true,
        externalRef: true,
        amount: true,
        currency: true,
        status: true,
        reason: true,
        failureCode: true,
        failureMessage: true,
        succeededAt: true,
        failedAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!refund) {
      return NextResponse.json({ error: "Refund not found" }, { status: 404 })
    }

    return NextResponse.json({ refund: normalizeRefundRow(refund) })
  } catch (err) {
    console.error("[payment-refunds/:id] GET error:", err)
    return NextResponse.json({ error: "Failed to load refund" }, { status: 500 })
  }
})
