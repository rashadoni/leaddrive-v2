/**
 * Paying a customer invoice by card through Kapital Bank.
 *
 *   1. The customer opens the invoice link `/portal/invoice/<viewToken>` and
 *      presses «Pay». `startInvoiceCheckout` creates a bank order for the
 *      balance due and records it as a PaymentIntent (status "processing",
 *      externalRef = the bank's order id), then sends the customer to the
 *      bank's page.
 *   2. The bank sends the customer back to
 *      `/api/v1/public/invoices/<viewToken>/kapital-return?ID=<order id>`.
 *      `settleKapitalOrder` asks the bank for the order's status — never the
 *      STATUS in the query, which the bank itself calls temporary — and, for
 *      a paid order, records the invoice payment.
 *   3. A customer who closes the tab on the bank's page never comes back;
 *      `/api/cron/kapitalbank-reconcile` asks the bank about every open
 *      intent until it is decided.
 *
 * Recording happens once: the intent is claimed with a conditional write
 * (processing → succeeded) in the same transaction as the invoice payment, so
 * the return page and the cron, or two return requests, cannot both record
 * it. A failure inside the transaction leaves the intent processing for the
 * next attempt.
 */
import { randomUUID } from "crypto"
import type { InvoiceItem, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { locales, type Locale } from "@/i18n/routing"
import { afterInvoicePaymentRecorded, recordInvoicePaymentInTx } from "@/lib/invoices/record-invoice-payment"
import {
  createKapitalOrder,
  getKapitalOrderStatus,
  kapitalOutcome,
  kapitalPaymentPageUrl,
  KapitalBankError,
} from "./client"
import { loadKapitalConfig } from "./config"

/** Kapital Bank merchant accounts settle in manats. */
export const ONLINE_PAYMENT_CURRENCY = "AZN"

/** A bank order this young is offered again instead of opening a new one. */
const REUSE_ORDER_MS = 15 * 60 * 1000
/** An order still undecided after this long is given up on. */
const ABANDON_ORDER_MS = 48 * 60 * 60 * 1000

const NOT_PAYABLE_STATUSES = new Set(["cancelled", "refunded"])

const ORDER_PASSWORD_AAD = { table: "payment_intents", column: "metadata.orderPassword" } as const

export type OnlinePaymentUnavailable = "not_configured" | "inactive" | "currency" | "nothing_due" | "status"

export type OnlinePaymentAvailability =
  | { available: true; amount: number; currency: string }
  | { available: false; reason: OnlinePaymentUnavailable }

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")
}

function documentLocale(value: string | null | undefined): Locale {
  return value && (locales as readonly string[]).includes(value) ? (value as Locale) : "az"
}

/**
 * The invoice page the customer receives. It carries the invoice's document
 * language (`?lang=`, read by the proxy before the page renders): whoever
 * opens it from WhatsApp has no language cookie.
 */
export function invoicePageUrl(viewToken: string, documentLanguage?: string | null): string {
  const path = `/portal/invoice/${encodeURIComponent(viewToken)}?lang=${documentLocale(documentLanguage)}`
  const base = appBaseUrl()
  return base ? `${base}${path}` : path
}

/** The organization owning a link, found without a tenant scope. */
export async function findInvoiceByViewToken(viewToken: string): Promise<{ orgId: string; invoiceId: string } | null> {
  if (!viewToken || viewToken.length > 100) return null
  const row = await runWithRlsBypass(() =>
    prisma.invoice.findUnique({ where: { viewToken }, select: { id: true, organizationId: true } }),
  )
  return row ? { orgId: row.organizationId, invoiceId: row.id } : null
}

/** Give an invoice its link token if it was created before tokens existed. */
export async function ensureInvoiceViewToken(orgId: string, invoiceId: string): Promise<string | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: { viewToken: true },
  })
  if (!invoice) return null
  if (invoice.viewToken) return invoice.viewToken
  const token = randomUUID()
  await prisma.invoice.updateMany({
    where: { id: invoiceId, organizationId: orgId, viewToken: null },
    data: { viewToken: token },
  })
  const saved = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: { viewToken: true },
  })
  return saved?.viewToken ?? null
}

/** The amount a new bank order would ask for: the balance, in whole qəpik. */
function dueAmount(balanceDue: unknown): number {
  return Math.round(decimalToNumber(balanceDue) * 100) / 100
}

export async function onlinePaymentAvailability(
  orgId: string,
  invoice: { status: string; currency: string; balanceDue: unknown },
): Promise<OnlinePaymentAvailability> {
  const config = await loadKapitalConfig(orgId)
  if (!config) return { available: false, reason: "not_configured" }
  if (!config.isActive) return { available: false, reason: "inactive" }
  if (NOT_PAYABLE_STATUSES.has(invoice.status)) return { available: false, reason: "status" }
  if (invoice.currency.toUpperCase() !== ONLINE_PAYMENT_CURRENCY) return { available: false, reason: "currency" }
  const amount = dueAmount(invoice.balanceDue)
  if (amount < 0.01) return { available: false, reason: "nothing_due" }
  return { available: true, amount, currency: ONLINE_PAYMENT_CURRENCY }
}

/** What the public invoice page shows. Runs under the invoice's tenant scope. */
export async function publicInvoiceView(orgId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  })
  if (!invoice) return null
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, settings: true } })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  const invoiceSettings = (settings.invoice ?? {}) as Record<string, unknown>
  const sellerName = (typeof invoiceSettings.companyName === "string" && invoiceSettings.companyName.trim())
    || org?.name
    || ""
  const onlinePayment = await onlinePaymentAvailability(orgId, invoice)
  return {
    sellerName,
    invoiceNumber: invoice.invoiceNumber,
    title: invoice.title,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    recipientName: invoice.recipientName,
    currency: invoice.currency,
    documentLanguage: documentLocale(invoice.documentLanguage),
    subtotal: decimalToNumber(invoice.subtotal),
    discountAmount: decimalToNumber(invoice.discountAmount),
    taxAmount: decimalToNumber(invoice.taxAmount),
    totalAmount: decimalToNumber(invoice.totalAmount),
    paidAmount: decimalToNumber(invoice.paidAmount),
    balanceDue: decimalToNumber(invoice.balanceDue),
    items: invoice.items.map((item: InvoiceItem) => ({
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice: decimalToNumber(item.unitPrice),
      total: decimalToNumber(item.total),
    })),
    onlinePayment: onlinePayment.available
      ? { available: true as const, amount: onlinePayment.amount, currency: onlinePayment.currency }
      : { available: false as const, reason: onlinePayment.reason },
  }
}

function readOrderPassword(orgId: string, metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).orderPassword
  if (typeof value !== "string" || !value) return null
  return decryptForTenantBound(orgId, ORDER_PASSWORD_AAD.table, ORDER_PASSWORD_AAD.column, value)
}

function readHppUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).hppUrl
  return typeof value === "string" && value ? value : null
}

function readTestMode(metadata: unknown): boolean | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).testMode
  return typeof value === "boolean" ? value : null
}

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: OnlinePaymentUnavailable | "not_found" | "bank_error" }

/** Open (or reopen) a bank order for the invoice's balance. Runs under the invoice's tenant scope. */
export async function startInvoiceCheckout(input: {
  orgId: string
  invoiceId: string
  viewToken: string
}): Promise<StartCheckoutResult> {
  const { orgId, invoiceId } = input
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      id: true, invoiceNumber: true, status: true, currency: true, balanceDue: true,
      documentLanguage: true, contactId: true, recipientEmail: true,
    },
  })
  if (!invoice) return { ok: false, reason: "not_found" }
  const availability = await onlinePaymentAvailability(orgId, invoice)
  if (!availability.available) return { ok: false, reason: availability.reason }
  const config = await loadKapitalConfig(orgId)
  if (!config) return { ok: false, reason: "not_configured" }

  // A second press within a few minutes returns to the same bank order, so
  // one invoice does not collect a row of open orders.
  const recent = await prisma.paymentIntent.findFirst({
    where: {
      organizationId: orgId,
      invoiceId,
      providerId: config.providerId,
      status: "processing",
      amount: availability.amount,
      createdAt: { gte: new Date(Date.now() - REUSE_ORDER_MS) },
      externalRef: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { externalRef: true, metadata: true },
  })
  if (recent?.externalRef && readTestMode(recent.metadata) === config.isTestMode) {
    const password = readOrderPassword(orgId, recent.metadata)
    const hppUrl = readHppUrl(recent.metadata)
    if (password && hppUrl) {
      return { ok: true, url: kapitalPaymentPageUrl({ id: recent.externalRef, password, hppUrl }) }
    }
  }

  const language = documentLocale(invoice.documentLanguage)
  let order
  try {
    order = await createKapitalOrder(config, {
      amount: availability.amount,
      currency: ONLINE_PAYMENT_CURRENCY,
      description: invoice.invoiceNumber,
      language,
      redirectUrl: `${appBaseUrl()}/api/v1/public/invoices/${encodeURIComponent(input.viewToken)}/kapital-return`,
    })
  } catch (error) {
    console.error("[kapitalbank] create order failed", error instanceof KapitalBankError ? error.code : error)
    return { ok: false, reason: "bank_error" }
  }

  await prisma.paymentIntent.create({
    data: {
      organizationId: orgId,
      providerId: config.providerId,
      externalRef: order.id,
      amount: availability.amount,
      currency: ONLINE_PAYMENT_CURRENCY,
      status: "processing",
      description: invoice.invoiceNumber,
      customerEmail: invoice.recipientEmail,
      contactId: invoice.contactId,
      invoiceId,
      paymentMethod: "card",
      metadata: {
        source: "invoice_link",
        hppUrl: order.hppUrl,
        testMode: config.isTestMode,
        orderPassword: encryptForTenantBound(orgId, ORDER_PASSWORD_AAD.table, ORDER_PASSWORD_AAD.column, order.password),
      },
    },
  })
  return { ok: true, url: kapitalPaymentPageUrl(order) }
}

class SettlementRefused extends Error {}

export type SettleOutcome = "paid" | "failed" | "open" | "not_found"

/**
 * Ask the bank about one order and act on the answer. Idempotent: a decided
 * intent is reported, not re-recorded. Runs under the intent's tenant scope.
 */
export async function settleKapitalOrder(input: {
  orgId: string
  orderId: string
  /** Limit the lookup to one invoice (the return link names it). */
  invoiceId?: string
}): Promise<SettleOutcome> {
  const { orgId } = input
  const intent = await prisma.paymentIntent.findFirst({
    where: {
      organizationId: orgId,
      externalRef: input.orderId,
      provider: { type: "kapitalbank" },
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    },
    select: {
      id: true, status: true, amount: true, currency: true, invoiceId: true,
      providerId: true, metadata: true, createdAt: true, externalRef: true,
    },
  })
  if (!intent || !intent.externalRef) return "not_found"
  if (["succeeded", "refunded", "partially_refunded"].includes(intent.status)) return "paid"
  if (intent.status === "failed" || intent.status === "cancelled") return "failed"

  const config = await loadKapitalConfig(orgId)
  const password = readOrderPassword(orgId, intent.metadata)
  if (!config || config.providerId !== intent.providerId || !password) return "open"
  const isTestMode = readTestMode(intent.metadata) ?? config.isTestMode

  let bankOrder
  try {
    bankOrder = await getKapitalOrderStatus({ ...config, isTestMode }, { id: intent.externalRef, password })
  } catch (error) {
    console.error("[kapitalbank] order status failed", error instanceof KapitalBankError ? error.code : error)
    return "open"
  }
  const outcome = kapitalOutcome(bankOrder)

  if (outcome === "open") {
    if (Date.now() - intent.createdAt.getTime() > ABANDON_ORDER_MS) {
      await prisma.paymentIntent.updateMany({
        where: { id: intent.id, organizationId: orgId, status: "processing" },
        data: { status: "cancelled", cancelledAt: new Date() },
      })
      return "failed"
    }
    // Touch the row so the reconcile cron moves on to the next one.
    await prisma.paymentIntent.updateMany({
      where: { id: intent.id, organizationId: orgId, status: "processing" },
      data: { updatedAt: new Date() },
    })
    return "open"
  }

  if (outcome === "failed") {
    await prisma.paymentIntent.updateMany({
      where: { id: intent.id, organizationId: orgId, status: "processing" },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureCode: bankOrder.status.slice(0, 64),
        failureMessage: `Kapital Bank order ${intent.externalRef}: ${bankOrder.status}`,
      },
    })
    return "failed"
  }

  const paidAmount = Math.round(bankOrder.amount * 100) / 100
  if (bankOrder.currency.toUpperCase() !== intent.currency.toUpperCase() || paidAmount <= 0) {
    console.error("[kapitalbank] paid order does not match its intent", { intentId: intent.id, currency: bankOrder.currency })
    return "open"
  }

  let recorded: Awaited<ReturnType<typeof recordInvoicePaymentInTx>> | null = null
  try {
    recorded = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.paymentIntent.updateMany({
        where: { id: intent.id, organizationId: orgId, status: "processing" },
        data: { status: "succeeded", succeededAt: new Date() },
      })
      if (claimed.count !== 1) return null
      if (!intent.invoiceId) return null
      const result = await recordInvoicePaymentInTx(tx, {
        orgId,
        invoiceId: intent.invoiceId,
        amount: paidAmount,
        currency: bankOrder.currency,
        paymentMethod: "card",
        paymentDate: new Date(),
        reference: `Kapital Bank #${intent.externalRef}`,
        notes: null,
      })
      // Roll the claim back: the money is real, and a person has to see why
      // it could not be put on the invoice.
      if (result.kind !== "created") throw new SettlementRefused(result.kind)
      return result
    })
  } catch (error) {
    console.error("[kapitalbank] recording a paid order failed", { intentId: intent.id, error })
    return "open"
  }
  if (recorded?.kind === "created") {
    afterInvoicePaymentRecorded(orgId, recorded.invoice, recorded.newBalanceDue)
  }
  return "paid"
}

/**
 * The cron's pass: ask the bank about the open orders that have waited
 * longest, a bounded number per tick.
 */
export async function reconcileKapitalIntents(limit = 25): Promise<{ checked: number; paid: number; failed: number }> {
  const open = await runWithRlsBypass(() =>
    prisma.paymentIntent.findMany({
      where: {
        status: "processing",
        externalRef: { not: null },
        provider: { type: "kapitalbank" },
        // Give the customer a minute on the bank's page before asking.
        createdAt: { lte: new Date(Date.now() - 60 * 1000) },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { organizationId: true, externalRef: true },
    }),
  )
  const totals = { checked: 0, paid: 0, failed: 0 }
  for (const row of open) {
    if (!row.externalRef) continue
    const outcome = await runWithTenant(row.organizationId, () =>
      settleKapitalOrder({ orgId: row.organizationId, orderId: row.externalRef as string }),
    )
    totals.checked += 1
    if (outcome === "paid") totals.paid += 1
    if (outcome === "failed") totals.failed += 1
  }
  return totals
}
