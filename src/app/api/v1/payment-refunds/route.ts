/**
 * D5 Payments — PaymentRefund list + create.
 *
 * GET  /api/v1/payment-refunds — list refunds. Optional filters:
 *   ?paymentIntentId= — filter by parent intent
 *   ?status=          — one of REFUND_STATUSES
 *   Ordered by createdAt DESC.
 *
 * POST /api/v1/payment-refunds — initiate a refund against an existing intent.
 *
 * ## Refund flow
 *  1. Validate required fields: paymentIntentId, amount (> 0).
 *  2. Load the PaymentIntent (must belong to this org, must be in
 *     `succeeded` or `partially_refunded` state — 422 otherwise).
 *  3. Sum existing non-failed refunds for this intent. Reject if
 *     `existing_sum + new_amount > intent.amount` (over-refund guard).
 *  4. Resolve provider implementation via registry.
 *  5. Call `provider.refund()` stub.  Slice-2 stubs return `status:"pending"`;
 *     slice-3 wires real SDK calls which often return `status:"succeeded"` inline.
 *  6. Create the PaymentRefund DB row with the provider-reported status.
 *  7. If the provider confirms the refund immediately (`status:"succeeded"`):
 *       • advance the parent intent to `refunded` (full) or `partially_refunded`
 *       • write `succeededAt` on the refund row and `updatedAt` on the intent
 *     Otherwise the intent status is unchanged — the webhook handler promotes it
 *     once the provider fires a `charge.refunded` / equivalent event.
 *  8. Return 201 { refund, intentStatus }.
 *
 * ## Concurrency (slice-3)
 * Steps 3-7 run inside a Serializable `prisma.$transaction`. Postgres SSI
 * prevents two concurrent refund requests from both reading existingSum = 0,
 * both passing the over-refund guard, and both committing excess refunds.
 * A serialization failure (Prisma P2034 / PG 40001) surfaces as HTTP 409 —
 * the caller should retry.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  getProvider,
  advanceIntentState,
  type PaymentIntentStatus,
} from "@/lib/payments"
import { normalizeRefundRow, decimalToNumber } from "@/lib/prisma-decimal"

/* ─── Constants ─────────────────────────────────────────────────────── */

/** Statuses a PaymentIntent must be in for a refund to be issued. */
const REFUNDABLE_STATUSES: ReadonlySet<string> = new Set([
  "succeeded",
  "partially_refunded",
])

/** Refund statuses returned by providers (matches RefundIntentOk.status). */
const REFUND_STATUSES = ["pending", "processing", "succeeded", "failed"] as const
type RefundStatus = (typeof REFUND_STATUSES)[number]

const VALID_REFUND_STATUSES = new Set(REFUND_STATUSES as readonly string[])

/** Maximum refund amount — same upper bound as intents. */
const MAX_REFUND_AMOUNT = 999_999_999.9999

/* ─── GET — list refunds ────────────────────────────────────────────── */

export const GET = withRlsAuth("payments", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const paymentIntentIdParam = searchParams.get("paymentIntentId")
  const statusParam = searchParams.get("status")

  if (statusParam && !VALID_REFUND_STATUSES.has(statusParam)) {
    return NextResponse.json(
      { error: `Invalid \`status\` — must be one of: ${REFUND_STATUSES.join(", ")}` },
      { status: 400 },
    )
  }

  const where: {
    organizationId: string
    paymentIntentId?: string
    status?: string
  } = { organizationId: orgId }

  if (paymentIntentIdParam) where.paymentIntentId = paymentIntentIdParam
  if (statusParam) where.status = statusParam

  try {
    const rows = await prisma.paymentRefund.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
    const refunds = rows.map((r: (typeof rows)[number]) => normalizeRefundRow(r))
    return NextResponse.json({ refunds, total: refunds.length })
  } catch (err) {
    console.error("[payment-refunds] GET error:", err)
    return NextResponse.json({ error: "Failed to load refunds" }, { status: 500 })
  }
})

/* ─── POST — create refund ──────────────────────────────────────────── */

interface CreateBody {
  paymentIntentId?: unknown
  amount?: unknown
  reason?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("payments", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- paymentIntentId (required) -----------------------------------
  if (typeof body.paymentIntentId !== "string" || !body.paymentIntentId.trim()) {
    return NextResponse.json({ error: "`paymentIntentId` is required" }, { status: 400 })
  }
  const paymentIntentId = body.paymentIntentId.trim()

  // --- amount (required, positive, bounded) -------------------------
  if (
    typeof body.amount !== "number" ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0 ||
    body.amount > MAX_REFUND_AMOUNT
  ) {
    return NextResponse.json(
      { error: `\`amount\` must be a positive number ≤ ${MAX_REFUND_AMOUNT}` },
      { status: 400 },
    )
  }
  const amount = body.amount

  // --- optional fields ----------------------------------------------
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 200)
      : null

  // NOTE: `body.metadata` is accepted but intentionally NOT persisted —
  // the PaymentRefund model has no `metadata` column (see
  // prisma/schema.prisma). The previous `create` attempted to write it,
  // which never compiled. Until a JSON column is added in a migration,
  // the field is parsed-and-ignored. See task report.

  // --- load intent (with nested provider) --------------------------
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: paymentIntentId, organizationId: orgId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      externalRef: true,
      providerId: true,
      provider: {
        select: { type: true, isActive: true, credentials: true },
      },
    },
  })
  if (!intent) {
    return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
  }

  // --- gate on provider active state --------------------------------
  // Mirrors the check in payment-intents/route.ts — a disabled provider
  // must not issue new charges OR refunds.
  if (!intent.provider.isActive) {
    return NextResponse.json(
      {
        error:
          "Payment provider is disabled (isActive: false). " +
          "Re-enable the provider before issuing refunds.",
      },
      { status: 400 },
    )
  }

  // --- validate refundable state ------------------------------------
  if (!REFUNDABLE_STATUSES.has(intent.status)) {
    return NextResponse.json(
      {
        error:
          `Cannot refund an intent with status "${intent.status}". ` +
          `Intent must be in: ${[...REFUNDABLE_STATUSES].join(", ")}.`,
      },
      { status: 422 },
    )
  }

  const intentAmount = decimalToNumber(intent.amount)

  // --- resolve provider (registry lookup — no IO) -------------------
  const provider = getProvider(intent.provider.type)
  if (!provider) {
    return NextResponse.json(
      {
        error:
          `Provider type "${intent.provider.type}" is not registered. ` +
          "This is a server configuration error — contact support.",
      },
      { status: 503 },
    )
  }

  // --- Serializable transaction: steps 3–7 -------------------------
  // Wraps aggregate guard + provider call + DB writes in one atomic unit.
  // Postgres SSI (Serializable Isolation Level) prevents two concurrent
  // requests from both reading existingSum=0, both passing the guard, and
  // both writing refunds that together exceed intent.amount — one of them
  // will be aborted with PG error 40001 (serialization failure) and should
  // be retried by the caller.
  //
  // The provider.refund() HTTP call is intentionally inside the transaction.
  // Refunds are low-frequency admin actions; holding the DB connection for
  // ~1 external RTT is acceptable to avoid the "orphan refund" edge case
  // (provider succeeded but DB write was racing with a concurrent refund).
  try {
    const { refund, intentStatus } = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Step 3: Aggregate existing non-failed refunds (inside tx)
        const agg = await tx.paymentRefund.aggregate({
          where: { paymentIntentId, status: { notIn: ["failed"] } },
          _sum: { amount: true },
        })
        const existingSum = decimalToNumber(agg._sum.amount ?? 0)

        // Step 4: Over-refund guard
        if (amount + existingSum > intentAmount) {
          throw Object.assign(
            new Error(
              `Refund amount ${amount} would exceed the remaining refundable balance ` +
              `${(intentAmount - existingSum).toFixed(4)} ` +
              `(intent: ${intentAmount}, already refunded: ${existingSum}).`,
            ),
            { _tag: "OVER_REFUND" },
          )
        }

        // Step 5: Call provider (inside tx — low-frequency refunds; acceptable
        // to hold the transaction open during the HTTP round-trip)
        const outcome = await provider.refund(
          intent.provider.credentials as Record<string, unknown>,
          { externalRef: intent.externalRef ?? "", amount, reason: reason ?? undefined },
        )
        if (!outcome.ok) {
          throw Object.assign(
            new Error(outcome.error),
            { _tag: "PROVIDER_ERROR", _failureCode: outcome.failureCode ?? null },
          )
        }

        const providerRefundStatus = outcome.status as RefundStatus
        const now = new Date()

        // Step 6: Create refund row
        const refund = await tx.paymentRefund.create({
          data: {
            organizationId: orgId,
            paymentIntentId,
            externalRef: outcome.refundExternalRef,
            amount,
            currency: intent.currency,
            status: providerRefundStatus,
            reason,
            succeededAt: providerRefundStatus === "succeeded" ? now : null,
            createdBy: auth.userId,
          },
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

        // Step 7: Advance intent status if refund confirmed immediately
        let intentStatus = intent.status as PaymentIntentStatus

        if (providerRefundStatus === "succeeded") {
          const totalRefunded = existingSum + amount
          const newIntentStatus: PaymentIntentStatus =
            totalRefunded >= intentAmount ? "refunded" : "partially_refunded"

          const smResult = advanceIntentState({ from: intentStatus, to: newIntentStatus })

          if (smResult.ok) {
            await tx.paymentIntent.update({
              where: { id: paymentIntentId },
              data: { status: newIntentStatus },
            })
            intentStatus = newIntentStatus
          } else {
            console.warn(
              "[payment-refunds] SM rejected intent status advance after succeeded refund:",
              { intentId: paymentIntentId, from: intentStatus, to: newIntentStatus, smError: smResult.error },
            )
          }
        }

        return { refund, intentStatus }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    return NextResponse.json(
      { refund: normalizeRefundRow(refund), intentStatus },
      { status: 201 },
    )
  } catch (err: unknown) {
    const e = err as Record<string, unknown>
    // Tagged errors thrown from inside the transaction
    if (e?._tag === "OVER_REFUND") {
      return NextResponse.json({ error: String(e.message) }, { status: 400 })
    }
    if (e?._tag === "PROVIDER_ERROR") {
      return NextResponse.json(
        { error: String(e.message), failureCode: e._failureCode ?? null },
        { status: 502 },
      )
    }
    // Prisma P2034 — Postgres serialization failure (wraps PG 40001)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return NextResponse.json(
        { error: "Concurrent refund conflict — please retry in a moment." },
        { status: 409 },
      )
    }
    // Defense-in-depth: raw PG 40001 (test stubs / future driver changes)
    const pgCode = (e?.cause as Record<string, unknown>)?.code ?? e?.code
    if (pgCode === "40001") {
      return NextResponse.json(
        { error: "Concurrent refund conflict — please retry in a moment." },
        { status: 409 },
      )
    }
    console.error("[payment-refunds] POST error:", err)
    return NextResponse.json({ error: "Failed to create refund" }, { status: 500 })
  }
})
