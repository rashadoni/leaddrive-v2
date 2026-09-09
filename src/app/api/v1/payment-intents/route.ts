/**
 * D5 Payments — PaymentIntent list + create.
 *
 * GET /api/v1/payment-intents — list tenant's intents. Optional filters:
 *   ?status=     — one of PAYMENT_INTENT_STATUSES
 *   ?providerId= — filter by provider
 *   ?contactId=  — filter by CRM contact
 *   ?subscriptionId= — filter by D4 subscription
 *   ?invoiceId=  — filter by invoice
 *   Ordered by createdAt DESC (most recent first).
 *
 * POST /api/v1/payment-intents — create an intent.
 *   1. Validates required fields (providerId, amount > 0, currency 3-alpha).
 *   2. Loads the PaymentProvider DB row — must exist and be active for this org.
 *   3. Resolves the provider implementation from the registry.
 *   4. Calls provider.createIntent() — slice-1 stub returns a synthetic
 *      externalRef; slice-2 wires the real SDK call.
 *   5. Writes the PaymentIntent DB row.
 *   6. Returns 201 with { intent, clientSecret?, redirectUrl? } — the
 *      client-side secret / redirect URL is used by the front-end checkout
 *      UI to complete the charge.
 *
 * Amount: stored as Decimal(18,4); returned as JSON number via normalizeIntentRow.
 * Currency: normalized to uppercase 3-alpha (e.g. "usd" → "USD").
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  getProvider,
  PAYMENT_INTENT_STATUSES,
  type PaymentIntentStatus,
} from "@/lib/payments"
import { normalizeIntentRow } from "@/lib/prisma-decimal"

/* ─── Constants ─────────────────────────────────────────────────────── */

const VALID_STATUSES = new Set(PAYMENT_INTENT_STATUSES as readonly string[])
/** 3-letter ISO 4217 currency code. Accepts lowercase — normalized to upper. */
const CURRENCY_RE = /^[A-Za-z]{3}$/
/** Max intent amount — fits comfortably in Decimal(18,4) and avoids fat-finger billions. */
const MAX_INTENT_AMOUNT = 999_999_999.9999

/* ─── GET — list intents ────────────────────────────────────────────── */

export const GET = withRlsAuth("payments", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get("status")
  const providerIdParam = searchParams.get("providerId")
  const contactIdParam = searchParams.get("contactId")
  const subscriptionIdParam = searchParams.get("subscriptionId")
  const invoiceIdParam = searchParams.get("invoiceId")

  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return NextResponse.json(
      {
        error: `Invalid \`status\` — must be one of: ${PAYMENT_INTENT_STATUSES.join(", ")}`,
      },
      { status: 400 },
    )
  }

  const where: {
    organizationId: string
    status?: string
    providerId?: string
    contactId?: string
    subscriptionId?: string
    invoiceId?: string
  } = { organizationId: orgId }

  if (statusParam) where.status = statusParam
  if (providerIdParam) where.providerId = providerIdParam
  if (contactIdParam) where.contactId = contactIdParam
  if (subscriptionIdParam) where.subscriptionId = subscriptionIdParam
  if (invoiceIdParam) where.invoiceId = invoiceIdParam

  try {
    const rows = await prisma.paymentIntent.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
        // Deliberately exclude credentials — they live on the provider row.
        // Refunds excluded from list — use GET /[id] for the full picture.
      },
    })
    const intents = rows.map((r: (typeof rows)[number]) => normalizeIntentRow(r))
    return NextResponse.json({ intents, total: intents.length })
  } catch (err) {
    console.error("[payment-intents] GET error:", err)
    return NextResponse.json({ error: "Failed to load payment intents" }, { status: 500 })
  }
})

/* ─── POST — create intent ──────────────────────────────────────────── */

interface CreateBody {
  providerId?: unknown
  amount?: unknown
  currency?: unknown
  description?: unknown
  customerEmail?: unknown
  contactId?: unknown
  subscriptionId?: unknown
  invoiceId?: unknown
  paymentMethod?: unknown
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

  // --- providerId (required) ----------------------------------------
  if (typeof body.providerId !== "string" || !body.providerId.trim()) {
    return NextResponse.json(
      { error: "`providerId` is required" },
      { status: 400 },
    )
  }
  const providerId = body.providerId.trim()

  // --- amount (required, positive, bounded) -------------------------
  if (
    typeof body.amount !== "number" ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0 ||
    body.amount > MAX_INTENT_AMOUNT
  ) {
    return NextResponse.json(
      {
        error: `\`amount\` must be a positive number ≤ ${MAX_INTENT_AMOUNT}`,
      },
      { status: 400 },
    )
  }
  const amount = body.amount

  // --- currency (required, 3-alpha, normalize to uppercase) ---------
  if (typeof body.currency !== "string" || !CURRENCY_RE.test(body.currency)) {
    return NextResponse.json(
      { error: "`currency` must be a 3-letter ISO 4217 code (e.g. USD, EUR)" },
      { status: 400 },
    )
  }
  const currency = body.currency.toUpperCase()

  // --- optional fields ----------------------------------------------
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 500)
      : null

  const customerEmail =
    typeof body.customerEmail === "string" && body.customerEmail.trim()
      ? body.customerEmail.trim().slice(0, 254)
      : null

  const contactId =
    typeof body.contactId === "string" && body.contactId.trim()
      ? body.contactId.trim()
      : null

  const subscriptionId =
    typeof body.subscriptionId === "string" && body.subscriptionId.trim()
      ? body.subscriptionId.trim()
      : null

  const invoiceId =
    typeof body.invoiceId === "string" && body.invoiceId.trim()
      ? body.invoiceId.trim()
      : null

  const paymentMethod =
    typeof body.paymentMethod === "string" && body.paymentMethod.trim()
      ? body.paymentMethod.trim().slice(0, 50)
      : null

  const metadata =
    body.metadata !== null &&
    typeof body.metadata === "object" &&
    !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {}

  // --- load provider from DB ----------------------------------------
  const providerRow = await prisma.paymentProvider.findFirst({
    where: { id: providerId, organizationId: orgId },
    select: { id: true, type: true, isActive: true, credentials: true },
  })
  if (!providerRow) {
    return NextResponse.json(
      { error: "Payment provider not found" },
      { status: 404 },
    )
  }
  if (!providerRow.isActive) {
    return NextResponse.json(
      {
        error:
          "Payment provider is disabled (isActive: false). " +
          "Enable it before creating intents.",
      },
      { status: 400 },
    )
  }

  // --- resolve provider implementation from registry ----------------
  const provider = getProvider(providerRow.type)
  if (!provider) {
    return NextResponse.json(
      {
        error:
          `Provider type "${providerRow.type}" is not registered. ` +
          "This is a server configuration error — contact support.",
      },
      { status: 503 },
    )
  }

  // --- call provider stub -------------------------------------------
  const outcome = await provider.createIntent(
    providerRow.credentials as Record<string, unknown>,
    { amount, currency, description: description ?? undefined, customerEmail: customerEmail ?? undefined, metadata },
  )

  if (!outcome.ok) {
    return NextResponse.json(
      {
        error: outcome.error,
        failureCode: outcome.failureCode ?? null,
      },
      { status: 502 },
    )
  }

  // --- write DB row --------------------------------------------------
  try {
    const intent = await prisma.paymentIntent.create({
      data: {
        organizationId: orgId,
        providerId,
        externalRef: outcome.externalRef,
        amount,
        currency,
        status: outcome.status as PaymentIntentStatus,
        description,
        customerEmail,
        contactId,
        subscriptionId,
        invoiceId,
        paymentMethod,
        metadata,
        createdBy: auth.userId,
      },
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
    return NextResponse.json(
      {
        intent: normalizeIntentRow(intent),
        // Pass the provider's client-side secret / redirect to the caller.
        // undefined fields are omitted from JSON serialization automatically.
        clientSecret: outcome.clientSecret,
        redirectUrl: outcome.redirectUrl,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error("[payment-intents] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create payment intent" },
      { status: 500 },
    )
  }
})
