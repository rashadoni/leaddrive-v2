/**
 * D5 Payments — incoming webhook handler.
 *
 * POST /api/v1/payment-webhooks/[provider]
 *
 * `[provider]` is the PaymentProvider DB row id (NOT the type string).
 * Each tenant's webhook URL is unique per provider record — the id
 * is used to load the row, derive the org context, and fetch the
 * webhookSecret for signature verification.
 *
 * ## Security
 * This is a PUBLIC endpoint — no user JWT is required. Authentication
 * is purely by signature: `provider.parseWebhook()` verifies the
 * provider-specific HMAC-SHA256 signature before any DB writes.
 * Return 400 on bad signatures so probes get no useful feedback; log
 * the specific error at warn level only.
 *
 * ## Idempotency
 * Event log uses UNIQUE(organizationId, providerId, externalId). A
 * duplicate delivery (same Stripe evt_...) triggers P2002 on INSERT
 * and is replied to with 200 immediately — no re-processing.
 *
 * ## Response strategy
 * Always 200 to the provider (except auth/config errors before the
 * event is inserted). Non-200 would trigger provider retries, which
 * can cause double-processing if the first delivery actually succeeded
 * but a transient error occurred after the write. Handler errors are
 * logged, the event row is marked "failed", and 200 is returned so
 * Stripe/PayPal don't retry indefinitely.
 *
 * ## Events handled (slice-2)
 *   payment_intent.succeeded     → intent status → "succeeded"
 *   payment_intent.payment_failed → intent status → "failed"
 *   payment_intent.canceled       → intent status → "cancelled"
 *   charge.refund.updated (succeeded) → refund "succeeded" + intent advancement
 *
 * All other eventTypes are logged and marked "ignored".
 *
 * ## Soft blocker (slice-3)
 * Event handlers run without a DB transaction — a crash between the
 * refund update and the intent update leaves state partially applied.
 * Slice-3 will wrap the handler body in a serializable $transaction.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getProvider, advanceIntentState, type PaymentIntentStatus } from "@/lib/payments"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

/* ─── Signature-header lookup by provider type ───────────────────────── */

const SIGNATURE_HEADER: Record<string, string> = {
  stripe: "stripe-signature",
  paypal: "paypal-transmission-sig",
  yookassa: "x-yookassa-signature",
  robokassa: "x-robokassa-signature",
}

/* ─── Utility helpers ────────────────────────────────────────────────── */

/** Check if a Prisma error is a P2002 unique-constraint violation. */
function isPrismaP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
}

/** Check if an error is a Prisma P2034 serialization failure (wraps PG 40001). */
function isPrismaP2034(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034"
}

/**
 * Run `fn` up to `maxAttempts` times, retrying on Prisma P2034
 * (Postgres serialization failure / PG 40001). Uses a short fixed
 * back-off between attempts. If all attempts fail with P2034, re-throws.
 */
async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (isPrismaP2034(err) && attempt < maxAttempts) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 20 * attempt))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

/**
 * Extract `data.object.id` from a Stripe-style webhook payload.
 * Returns null if the path is absent or malformed.
 */
function extractObjectId(payload: Record<string, unknown>): string | null {
  const data = payload.data as Record<string, unknown> | undefined
  if (!data) return null
  const obj = data.object as Record<string, unknown> | undefined
  if (!obj) return null
  return typeof obj.id === "string" ? obj.id : null
}

/* ─── HandlerOutcome ─────────────────────────────────────────────────── */

type HandlerOutcome = "processed" | "ignored"

/* ─── Individual event handlers ──────────────────────────────────────── */

/**
 * Advance a PaymentIntent to `toStatus` using the SM.
 * Returns "ignored" when the intent is not found (unknown externalRef —
 * could be a test event or a race with intent creation).
 * Throws when the SM rejects the transition → event is marked "failed".
 *
 * Wrapped in a Serializable transaction so the findFirst + update are
 * atomic — prevents a concurrent transition from interleaving between
 * the read and the write (e.g. two webhooks for the same intent arriving
 * simultaneously).
 */
async function handleIntentTransition(
  payload: Record<string, unknown>,
  orgId: string,
  toStatus: PaymentIntentStatus,
): Promise<HandlerOutcome> {
  const externalRef = extractObjectId(payload)
  if (!externalRef) return "ignored"

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const intent = await tx.paymentIntent.findFirst({
      where: { externalRef, organizationId: orgId },
      select: { id: true, status: true },
    })
    if (!intent) {
      console.warn("[payment-webhooks] Intent not found for externalRef:", externalRef)
      return "ignored"
    }

    const sm = advanceIntentState({
      from: intent.status as PaymentIntentStatus,
      to: toStatus,
    })
    if (!sm.ok) throw new Error(sm.error)

    const now = new Date()
    const timestamps: { succeededAt?: Date; failedAt?: Date; cancelledAt?: Date } = {}
    if (sm.sideEffect === "capturing") timestamps.succeededAt = now
    if (sm.sideEffect === "failing") timestamps.failedAt = now
    if (sm.sideEffect === "cancelling") timestamps.cancelledAt = now

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: toStatus, ...timestamps },
    })
    return "processed" as HandlerOutcome
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/**
 * Handle `charge.refund.updated` — mark refund as succeeded + advance
 * parent intent to `partially_refunded` or `refunded`.
 * Only acts on status === "succeeded"; other statuses are ignored for
 * slice-2 (failed refunds tracked in future slice-3 alerting).
 *
 * Wrapped in a Serializable transaction so the refund update and the
 * intent advance are atomic — a crash or concurrent write between the
 * two can no longer leave state partially applied.
 */
async function handleRefundUpdated(
  payload: Record<string, unknown>,
  orgId: string,
): Promise<HandlerOutcome> {
  const data = (payload.data as Record<string, unknown> | undefined)
  const obj = data?.object as Record<string, unknown> | undefined
  if (!obj || typeof obj.id !== "string") return "ignored"

  // Only process refunds that have just succeeded
  if (obj.status !== "succeeded") return "ignored"

  const refundExternalRef = obj.id

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const refund = await tx.paymentRefund.findFirst({
      where: { externalRef: refundExternalRef, organizationId: orgId },
      select: { id: true, status: true, amount: true, paymentIntentId: true },
    })
    if (!refund) {
      console.warn("[payment-webhooks] Refund not found for externalRef:", refundExternalRef)
      return "ignored" as HandlerOutcome
    }

    // Idempotent: already marked succeeded
    if (refund.status === "succeeded") return "ignored" as HandlerOutcome

    // Sum of OTHER succeeded refunds (this one is still pending/processing)
    const agg = await tx.paymentRefund.aggregate({
      where: {
        paymentIntentId: refund.paymentIntentId,
        status: "succeeded",
        id: { not: refund.id },
      },
      _sum: { amount: true },
    })
    const existingSum = decimalToNumber(agg._sum.amount ?? 0)
    const refundAmount = decimalToNumber(refund.amount)

    // Mark refund succeeded (atomic with intent advance below)
    await tx.paymentRefund.update({
      where: { id: refund.id },
      data: { status: "succeeded", succeededAt: new Date() },
    })

    // Advance parent intent (inside same tx — atomic with refund update)
    const intent = await tx.paymentIntent.findFirst({
      where: { id: refund.paymentIntentId },
      select: { id: true, status: true, amount: true },
    })
    if (!intent) return "processed" as HandlerOutcome // refund updated; intent gone — edge case

    const intentAmount = decimalToNumber(intent.amount)
    const totalRefunded = existingSum + refundAmount
    const newIntentStatus: PaymentIntentStatus =
      totalRefunded >= intentAmount ? "refunded" : "partially_refunded"

    const sm = advanceIntentState({
      from: intent.status as PaymentIntentStatus,
      to: newIntentStatus,
    })
    if (!sm.ok) {
      // Throw so the tx rolls back (both updates) and the outer handler marks
      // this event "failed" — visible in the webhook event dashboard.
      throw new Error(
        `SM rejected intent advance after refund.updated: ${sm.error} ` +
        `(intent ${intent.id}: ${intent.status} → ${newIntentStatus})`,
      )
    }
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: newIntentStatus },
    })
    return "processed" as HandlerOutcome
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/* ─── Event dispatch table ───────────────────────────────────────────── */

type EventHandler = (
  payload: Record<string, unknown>,
  orgId: string,
) => Promise<HandlerOutcome>

const EVENT_HANDLERS: Record<string, EventHandler> = {
  "payment_intent.succeeded": (p, orgId) =>
    handleIntentTransition(p, orgId, "succeeded"),
  "payment_intent.payment_failed": (p, orgId) =>
    handleIntentTransition(p, orgId, "failed"),
  "payment_intent.canceled": (p, orgId) =>
    handleIntentTransition(p, orgId, "cancelled"),
  "charge.refund.updated": handleRefundUpdated,
}

/* ─── Main handler ───────────────────────────────────────────────────── */

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await context.params

  // 1. Load provider row — gives us org context + webhookSecret
  // RLS: this lookup IS the org resolution (the per-tenant webhook URL carries the row id) → bypass scope.
  const providerRow = await runWithRlsBypass(() =>
    prisma.paymentProvider.findFirst({
      where: { id: providerId },
      select: { id: true, organizationId: true, type: true, webhookSecret: true, isActive: true },
    })
  )
  if (!providerRow) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  }
  if (!providerRow.webhookSecret) {
    return NextResponse.json(
      {
        error:
          "Provider has no webhook secret configured. " +
          "Set `webhookSecret` on the PaymentProvider record before receiving webhooks.",
      },
      { status: 400 },
    )
  }
  // A disabled provider should not process incoming events — return 410 Gone
  // so that the operator can silence a channel without deleting the secret.
  if (!providerRow.isActive) {
    return NextResponse.json(
      { error: "Provider is disabled (isActive: false) — webhook processing suspended." },
      { status: 410 },
    )
  }

  // 2. Resolve provider implementation from registry
  const provider = getProvider(providerRow.type)
  if (!provider) {
    return NextResponse.json(
      { error: `Provider type "${providerRow.type}" is not registered` },
      { status: 503 },
    )
  }

  // 3. Read raw body + extract provider-specific signature header
  const rawBody = await req.text()
  const sigHeaderName = SIGNATURE_HEADER[providerRow.type] ?? "x-signature"
  const signature = req.headers.get(sigHeaderName) ?? ""

  // 4. Verify signature + parse payload
  const parsed = await provider.parseWebhook({
    rawBody,
    signature,
    webhookSecret: providerRow.webhookSecret,
  })
  if (!parsed.ok) {
    console.warn("[payment-webhooks] Signature verification failed:", {
      providerId,
      error: parsed.error,
    })
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const { externalId, eventType, payload } = parsed
  const { organizationId } = providerRow

  // RLS: signature verified + org resolved — the event log insert and ALL handler work
  // (incl. the Serializable $transactions, which inherit the context via the inTx wrap)
  // run tenant-scoped.
  return runWithTenant(organizationId, async () => {

  // 5. Idempotency: insert event log row
  let webhookEventId: string
  try {
    const event = await prisma.paymentWebhookEvent.create({
      data: {
        organizationId,
        providerId,
        externalId,
        eventType,
        payload,
        signatureValid: true,
        status: "processing",
      },
      select: { id: true },
    })
    webhookEventId = event.id
  } catch (err) {
    if (isPrismaP2002(err)) {
      // Duplicate delivery — already processed, return 200
      return NextResponse.json({ ok: true, duplicate: true })
    }
    throw err
  }

  // 6. Dispatch to event handler
  const handlerFn = EVENT_HANDLERS[eventType]
  if (!handlerFn) {
    await prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "ignored", processedAt: new Date() },
    })
    return NextResponse.json({ ok: true, ignored: true })
  }

  try {
    const outcome = await withSerializableRetry(() => handlerFn(payload, organizationId))
    await prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: { status: outcome, processedAt: new Date() },
    })
    return NextResponse.json({ ok: true, ...(outcome === "ignored" ? { ignored: true } : {}) })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("[payment-webhooks] Event handler failed:", {
      eventType,
      externalId,
      providerId,
      error: errorMsg,
    })
    await prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: "failed",
        processedAt: new Date(),
        processingError: errorMsg.slice(0, 500),
      },
    })
    // Always 200 — non-200 triggers provider retries of potentially unprocessable events
    return NextResponse.json({ ok: true, error: "Event handler failed" })
  }

  }) // end runWithTenant (tenant-scoped handler body)
}
