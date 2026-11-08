/**
 * Paying a meeting's deposit by card, through the salon's own Kapital Bank
 * account.
 *
 * The owner asked for both ways of taking a deposit (2026-11-08: «оба
 * варианта»). The other one is a person pressing «received» on the card after
 * cash or a transfer; this one is the customer paying from the link they
 * already have.
 *
 *   1. The customer opens their meeting link `/book/cancel/<token>` — the one
 *      the confirmation carries — and presses «Pay the deposit».
 *      `startDepositCheckout` opens a bank order for exactly what the visit
 *      was asked for, records it as a PaymentIntent (processing, externalRef
 *      = the bank's order id, bookingId = the meeting) and sends them on.
 *   2. The bank returns them to `/api/v1/public/booking/deposit/<token>/kapital-return`,
 *      which asks the bank what became of the order — never the STATUS in the
 *      query, which the bank itself calls temporary — and, for a paid order,
 *      marks the deposit.
 *   3. Whoever closes the tab on the bank's page never comes back; the same
 *      reconcile cron that chases invoice orders chases these.
 *
 * The amount is read from the meeting, never from the request: a deposit the
 * payer can choose is not a deposit. And the money is only ever recorded
 * against a visit that is still asking for it — `awaiting`, nothing else.
 */
import type { Prisma } from "@prisma/client"
import { bookingDb as prisma } from "./db"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { createKapitalOrder, kapitalPaymentPageUrl, KapitalBankError } from "@/lib/payments/kapitalbank/client"
import { loadKapitalConfig } from "@/lib/payments/kapitalbank/config"
import { ONLINE_PAYMENT_CURRENCY, encodeOrderPassword, readOrderHppUrl, readOrderPassword, readOrderTestMode } from "@/lib/payments/kapitalbank/order-metadata"
import { locales, type Locale } from "@/i18n/routing"
import { appendBookingEvent, ensureBookingBaseline } from "./events"

/** A bank order this young is offered again instead of opening a new one. */
const REUSE_ORDER_MS = 15 * 60 * 1000

export type DepositCheckoutRefusal =
  | "not_found"
  | "no_deposit"
  | "already_paid"
  | "not_configured"
  | "currency"
  | "bank_error"

export type DepositCheckoutResult = { ok: true; url: string } | { ok: false; reason: DepositCheckoutRefusal }

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")
}

function bankLanguage(value: string | null | undefined): Locale {
  return value && (locales as readonly string[]).includes(value) ? (value as Locale) : "az"
}

/**
 * What the customer's own page may say about paying: the sum still owed and
 * whether a card would be taken for it right now.
 *
 * «Payable» is deliberately narrow. A salon with no bank account, a visit
 * already paid, a deposit that was kept or sent back — each of those is a
 * page without a button, not a button that fails on press.
 */
export async function depositCheckoutView(orgId: string, booking: { depositAmount: unknown; depositStatus: string | null }): Promise<{
  amount: string
  currency: string
  status: string
  payable: boolean
} | null> {
  if (!booking.depositStatus) return null
  const amount = decimalToNumber(booking.depositAmount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const config = booking.depositStatus === "awaiting" ? await loadKapitalConfig(orgId) : null
  return {
    amount: String(Math.round(amount * 100) / 100),
    currency: ONLINE_PAYMENT_CURRENCY,
    status: booking.depositStatus,
    payable: Boolean(config?.isActive),
  }
}

/** Open (or reopen) a bank order for this meeting's deposit. Runs under the meeting's tenant scope. */
export async function startDepositCheckout(input: { orgId: string; bookingId: string; token: string }): Promise<DepositCheckoutResult> {
  const { orgId, bookingId } = input
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: orgId },
    select: { id: true, name: true, email: true, depositAmount: true, depositStatus: true, bookingPage: { select: { title: true } }, snapshot: true },
  })
  if (!booking) return { ok: false, reason: "not_found" }
  if (!booking.depositStatus || booking.depositAmount === null) return { ok: false, reason: "no_deposit" }
  if (booking.depositStatus !== "awaiting") return { ok: false, reason: "already_paid" }
  const amount = Math.round(decimalToNumber(booking.depositAmount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "no_deposit" }

  const snapshot = booking.snapshot && typeof booking.snapshot === "object" && !Array.isArray(booking.snapshot) ? booking.snapshot as Record<string, unknown> : null
  // The deposit is in the currency the bank settles in. A salon that prices in
  // anything else is told so rather than charged the same number of manats.
  const priced = typeof snapshot?.priceCurrency === "string" ? snapshot.priceCurrency : ONLINE_PAYMENT_CURRENCY
  if (priced.toUpperCase() !== ONLINE_PAYMENT_CURRENCY) return { ok: false, reason: "currency" }

  const config = await loadKapitalConfig(orgId)
  if (!config || !config.isActive) return { ok: false, reason: "not_configured" }

  // A second press within a few minutes returns to the same bank order, so one
  // meeting does not collect a row of open orders.
  const recent = await prisma.paymentIntent.findFirst({
    where: {
      organizationId: orgId, bookingId, providerId: config.providerId, status: "processing",
      amount, createdAt: { gte: new Date(Date.now() - REUSE_ORDER_MS) }, externalRef: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { externalRef: true, metadata: true },
  })
  if (recent?.externalRef && readOrderTestMode(recent.metadata) === config.isTestMode) {
    const password = readOrderPassword(orgId, recent.metadata)
    const hppUrl = readOrderHppUrl(recent.metadata)
    if (password && hppUrl) return { ok: true, url: kapitalPaymentPageUrl({ id: recent.externalRef, password, hppUrl }) }
  }

  const title = typeof snapshot?.title === "string" ? snapshot.title : booking.bookingPage.title
  let order
  try {
    order = await createKapitalOrder(config, {
      amount,
      currency: ONLINE_PAYMENT_CURRENCY,
      description: title,
      language: bankLanguage(typeof snapshot?.locale === "string" ? snapshot.locale : null),
      redirectUrl: `${appBaseUrl()}/api/v1/public/booking/deposit/${encodeURIComponent(input.token)}/kapital-return`,
    })
  } catch (error) {
    console.error("[booking-deposit] create order failed", error instanceof KapitalBankError ? error.code : error)
    return { ok: false, reason: "bank_error" }
  }

  await prisma.paymentIntent.create({
    data: {
      organizationId: orgId, providerId: config.providerId, externalRef: order.id,
      amount, currency: ONLINE_PAYMENT_CURRENCY, status: "processing",
      description: title, customerEmail: booking.email, bookingId, paymentMethod: "card",
      metadata: {
        source: "booking_deposit",
        hppUrl: order.hppUrl,
        testMode: config.isTestMode,
        orderPassword: encodeOrderPassword(orgId, order.password),
      },
    },
  })
  return { ok: true, url: kapitalPaymentPageUrl(order) }
}

/**
 * Put a paid bank order on the meeting. Called only once per order: the
 * caller has already claimed the intent (processing → succeeded) inside this
 * same transaction, so the return page and the cron cannot both record it.
 *
 * The meeting is updated conditionally, on `awaiting` — if a manager marked
 * the same deposit received by hand a minute earlier, the card is not rewound
 * and the ledger gains no second «paid». The money is still recorded, as the
 * payment intent it already is.
 */
export async function applyDepositPaymentInTx(tx: Prisma.TransactionClient, input: { orgId: string; bookingId: string; paidAt: Date }): Promise<"marked" | "already"> {
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${input.bookingId} AND "organizationId" = ${input.orgId} FOR UPDATE`
  const row = await tx.booking.findFirst({ where: { id: input.bookingId, organizationId: input.orgId } })
  if (!row || row.depositStatus !== "awaiting") return "already"
  const baseline = await ensureBookingBaseline(tx, row)
  const updated = await tx.booking.update({ where: { id: baseline.id }, data: { depositStatus: "paid", depositPaidAt: input.paidAt } })
  // The customer paid it, so the history says the customer — not whichever
  // process happened to notice the bank's answer.
  const event = await appendBookingEvent(tx, updated, "deposit_paid", null)
  await tx.booking.update({ where: { id: baseline.id }, data: { version: event.version } })
  return "marked"
}
