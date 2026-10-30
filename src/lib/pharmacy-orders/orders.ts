import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"

import { decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import type { SheetSpec } from "@/lib/export/tabular"
import { featureFlagsToArray } from "@/lib/modules"
import {
  erpConnection, erpDifferences, erpOrderPayload, sendErpOrder, type ErpConnection, type ErpError, type ErpOutcome,
} from "@/lib/pharmacy-orders/erp-order"
import { notifyPharmacyOfDecision } from "@/lib/pharmacy-orders/manager-notice"
import { readableProductName } from "@/lib/pharmacy-orders/product-label"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { PHONE_ORDERS_TABLE, PHONE_ORDER_MAX_LINES, phoneOrderLabel } from "@/lib/voice-agent/pharmacy/phone-orders"
import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { listPrice } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"

/** Organization feature flag (Organization.features) that opens phone orders. */
export const PHONE_ORDERS_FEATURE = "pharmacy_phone_orders"

export async function phoneOrdersEnabled(orgId: string): Promise<boolean> {
  const org = await runWithRlsBypass(() => prisma.organization.findUnique({ where: { id: orgId }, select: { features: true } }))
  return featureFlagsToArray(org?.features).includes(PHONE_ORDERS_FEATURE)
}

export class PhoneOrderError extends Error {
  constructor(readonly code: "not_found" | "stale_revision" | "not_pending" | "invalid" | "catalog_unavailable" | "call_in_progress"
    // 1C: a send is under way or got no clear answer; a line not in 1C's base unit; no 1C pharmacy; the connection is broken; another warehouse.
    | "erp_pending" | "erp_unit" | "erp_pharmacy" | "erp_unavailable" | "erp_catalog", readonly status: number) {
    super(code)
  }
}

const money = (value: Prisma.Decimal | null) => value === null ? null : value.toFixed(2)

/** Last four digits only; the full number is for the call button. */
function maskPhone(phone: string) {
  return phone.length > 4 ? `${phone.slice(0, Math.min(7, phone.length - 4))} ••• ${phone.slice(-2)}` : "•••"
}

export async function listPhoneOrders(orgId: string, status?: string) {
  const orders = await prisma.pharmacyPhoneOrder.findMany({
    where: { organizationId: orgId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { lines: { select: { status: true } }, company: { select: { name: true } } },
  })
  return orders.map(order => ({
    id: order.id, label: phoneOrderLabel(order.number), status: order.status, createdAt: order.createdAt.toISOString(),
    callStartedAt: order.callStartedAt.toISOString(), pharmacyName: order.company?.name ?? order.pharmacyName,
    pharmacyIdentification: order.pharmacyIdentification, total: money(order.totalAmount), currency: order.currency,
    lineCount: order.lines.length, notFoundCount: order.lines.filter(line => line.status === "not_found").length,
  }))
}

export async function getPhoneOrder(orgId: string, id: string) {
  const order = await prisma.pharmacyPhoneOrder.findFirst({
    where: { id, organizationId: orgId },
    include: { lines: { orderBy: { position: "asc" } }, company: { select: { id: true, name: true, address: true, city: true } } },
  })
  if (!order) throw new PhoneOrderError("not_found", 404)
  const phone = decryptForTenantBound(orgId, PHONE_ORDERS_TABLE, "callerPhone", order.callerPhone)
  const people = [order.confirmedById, order.rejectedById].filter((value): value is string => Boolean(value))
  const users = people.length
    ? await prisma.user.findMany({ where: { organizationId: orgId, id: { in: people } }, select: { id: true, name: true } })
    : []
  const nameOf = (userId: string | null) => users.find(user => user.id === userId)?.name ?? null
  let connection: "on" | "off" | "broken"
  try { connection = (await erpConnection(orgId)) ? "on" : "off" } catch { connection = "broken" }
  const positionOf = (externalId: string | null) =>
    externalId ? order.lines.find(line => line.externalId?.toLowerCase() === externalId)?.position ?? null : null
  const result = (order.erpResult ?? {}) as { errors?: ErpError[]; differences?: unknown[]; error?: string }
  return {
    id: order.id, label: phoneOrderLabel(order.number), status: order.status, revision: order.revision,
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
    callStartedAt: order.callStartedAt.toISOString(),
    // `callerPhone` is masked for operators by withCustomerPhonePrivacy when the
    // organization hides customer phones; the masked twin is for display.
    callerPhone: phone, callerPhoneMasked: maskPhone(phone),
    pharmacy: { identification: order.pharmacyIdentification, guid: order.pharmacyGuid, name: order.pharmacyName, address: order.pharmacyAddress,
      company: order.company },
    catalog: { version: order.catalogVersion, observedAt: order.catalogObservedAt.toISOString() },
    total: money(order.totalAmount), currency: order.currency,
    confirmedAt: order.confirmedAt?.toISOString() ?? null, confirmedBy: nameOf(order.confirmedById),
    rejectedAt: order.rejectedAt?.toISOString() ?? null, rejectedBy: nameOf(order.rejectedById), rejectReason: order.rejectReason,
    managerNotice: order.managerNotice, pharmacyReceipt: order.pharmacyReceipt, pharmacyNotice: order.pharmacyNotice,
    erp: { connection, state: order.erpState, attemptAt: order.erpAttemptAt?.toISOString() ?? null, document: order.erpDocument,
      errors: (result.errors ?? []).map(error => ({ ...error, position: positionOf(error.externalId) })),
      differences: result.differences ?? [], error: result.error ?? null },
    edits: Array.isArray(order.managerEdits) ? order.managerEdits.length : 0,
    lines: order.lines.map(line => ({
      id: line.id, position: line.position, status: line.status, externalId: line.externalId, itemCode: line.itemCode,
      productName: line.productName, spokenText: line.spokenText, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice === null ? null : line.unitPrice.toFixed(2), lineTotal: money(line.lineTotal),
    })),
  }
}

/* ─── Catalog for the manager's product picker ─────────────────────── */

type CatalogHandle = { version: string; observedAt: string; feed: ZeytunAvailableBalances; source: string }
const catalogCache = new Map<string, { at: number; value: Promise<CatalogHandle> }>()

/** The newest snapshot of the order's catalog, parsed once per 10 minutes. */
async function orderCatalog(source: string, scopeKey: string): Promise<CatalogHandle> {
  const root = process.env.ZEYTUN_CACHE_DIR ?? ""
  if (!root) throw new PhoneOrderError("catalog_unavailable", 503)
  const key = `${source}:${scopeKey}`
  const cached = catalogCache.get(key)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value
  const value = (async () => {
    const snapshot = await new ZeytunSnapshotStore(root, source, scopeKey).load()
    if (!snapshot) throw new PhoneOrderError("catalog_unavailable", 503)
    return { version: snapshot.version, observedAt: snapshot.context.observedAt, source,
      feed: await ZeytunAvailableBalances.build(snapshot.payload, snapshot.context) }
  })()
  catalogCache.set(key, { at: Date.now(), value })
  value.catch(() => catalogCache.delete(key))
  return value
}

type PickedItem = { externalId: string; itemCode: string; name: string; sourceName: string; price: { amount: string; per: string } | null }

function project(catalog: CatalogHandle, item: { externalId: string; itemCode: string; name: string; nameAz: string | null
  priceAsReported?: unknown; baseUnitAsReported?: unknown }): PickedItem {
  const price = listPrice(item, catalog.observedAt)
  return { externalId: item.externalId, itemCode: item.itemCode, name: item.nameAz?.trim() || item.name, sourceName: item.name,
    price: price ? { amount: price.amount, per: price.per } : null }
}

export async function searchPhoneOrderCatalog(orgId: string, id: string, text: string) {
  const order = await prisma.pharmacyPhoneOrder.findFirst({ where: { id, organizationId: orgId },
    select: { catalogSource: true, catalogScopeKey: true } })
  if (!order) throw new PhoneOrderError("not_found", 404)
  const catalog = await orderCatalog(order.catalogSource, order.catalogScopeKey)
  const result = catalog.feed.search(catalog.source, { text: text.slice(0, 240) })
  return { observedAt: catalog.observedAt, items: result.candidates.slice(0, 8).map(item => project(catalog, item)) }
}

async function pickedItem(source: string, scopeKey: string, externalId: string): Promise<PickedItem> {
  const catalog = await orderCatalog(source, scopeKey)
  const item = catalog.feed.search(catalog.source, { externalId }).candidates.find(candidate => candidate.externalId === externalId)
  if (!item) throw new PhoneOrderError("invalid", 400)
  return project(catalog, item)
}

/* ─── Manager actions ──────────────────────────────────────────────── */

const unit = z.string().trim().toLowerCase().min(1).max(24)
export const phoneOrderActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("confirm"), revision: z.number().int().positive() }),
  z.strictObject({ action: z.literal("reject"), revision: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }),
  z.strictObject({ action: z.literal("set_quantity"), revision: z.number().int().positive(), lineId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(100_000) }),
  z.strictObject({ action: z.literal("pick_product"), revision: z.number().int().positive(), lineId: z.string().min(1).max(64),
    externalId: z.uuid() }),
  z.strictObject({ action: z.literal("add_line"), revision: z.number().int().positive(), externalId: z.uuid(),
    quantity: z.number().int().min(1).max(100_000), unit }),
  z.strictObject({ action: z.literal("remove_line"), revision: z.number().int().positive(), lineId: z.string().min(1).max(64) }),
])
export type PhoneOrderAction = z.infer<typeof phoneOrderActionSchema>

function priced(item: PickedItem, quantity: number, lineUnit: string) {
  const price = item.price && item.price.per === lineUnit ? new Prisma.Decimal(item.price.amount) : null
  return { unitPrice: price, lineTotal: price ? price.mul(quantity).toDecimalPlaces(2) : null }
}

/** A call this old is over even if its end was never reported (the line's ceiling is 15 minutes). */
const CALL_RUNNING_MAX_MS = 20 * 60_000

/** Whether the order's call is still on the line. */
async function callStillRunning(orgId: string, providerCallId: string) {
  const call = await prisma.callLog.findFirst({
    where: { organizationId: orgId, provider: "asterisk", providerCallId, endedAt: null,
      startedAt: { gte: new Date(Date.now() - CALL_RUNNING_MAX_MS) } },
    select: { id: true },
  })
  return Boolean(call)
}

/* ─── 1C and the manager's edits ──────────────────────────────────── */

/** What a manager changed after the call; the record decides when clean orders may skip review. */
export type ManagerEdit = {
  action: "set_quantity" | "pick_product" | "add_line" | "remove_line" | "set_pharmacy"
  at: string; by: string; position?: number; product?: string | null
  from?: string | number | null; to?: string | number | null; quantity?: number
}
const EDITS_KEPT = 200
export function withEdit(previous: Prisma.JsonValue | null, entry: ManagerEdit): Prisma.InputJsonValue {
  return [...(Array.isArray(previous) ? previous : []), entry].slice(-EDITS_KEPT) as Prisma.InputJsonValue
}

/** The order may change: never sent to 1C, or 1C refused it and wrote nothing. */
export const ERP_EDITABLE: Prisma.PharmacyPhoneOrderWhereInput[] = [{ erpState: null }, { erpState: "refused" }]

/** Why a guarded update touched no row. */
export async function refusal(db: Pick<PrismaClient, "pharmacyPhoneOrder">, orgId: string, id: string) {
  const current = await db.pharmacyPhoneOrder.findFirst({ where: { id, organizationId: orgId }, select: { status: true, erpState: true } })
  if (!current) return new PhoneOrderError("not_found", 404)
  if (current.status !== "pending_review") return new PhoneOrderError("not_pending", 409)
  return current.erpState === "sending" || current.erpState === "unknown" ? new PhoneOrderError("erp_pending", 409)
    : new PhoneOrderError("stale_revision", 409)
}

/** A send this old died with its process: it counts as "no clear answer". Two 20 s calls fit well inside. */
const ERP_SENDING_STALE_MS = 2 * 60_000

/**
 * «Подтвердить» while the organization's 1C takes orders: the order is
 * confirmed only once 1C has the document, and the pharmacy hears it only
 * then. 1C posts the document on arrival (Zeytun, 2026-10-28), so only an
 * order whose every line is a 1C product in its base unit, for a 1C pharmacy,
 * goes. Refused — the manager sees each line's reason and may fix it. No
 * clear answer — the order is frozen until the next click asks 1C first.
 */
async function confirmThroughErp(orgId: string, userId: string, id: string, revision: number, connection: ErpConnection) {
  const order = await prisma.pharmacyPhoneOrder.findFirst({ where: { id, organizationId: orgId },
    include: { lines: { orderBy: { position: "asc" } } } })
  if (!order) throw new PhoneOrderError("not_found", 404)
  if (order.status !== "pending_review") throw new PhoneOrderError("not_pending", 409)
  if (order.revision !== revision) throw new PhoneOrderError("stale_revision", 409)
  const startedAt = new Date()
  const stale = order.erpState === "sending" && (!order.erpAttemptAt || startedAt.getTime() - order.erpAttemptAt.getTime() > ERP_SENDING_STALE_MS)
  if (order.erpState === "sending" && !stale) throw new PhoneOrderError("erp_pending", 409)
  if (order.lines.length === 0 || order.lines.some(line => line.status !== "resolved" || !line.externalId)) throw new PhoneOrderError("invalid", 400)
  if (order.lines.some(line => line.unitPrice === null)) throw new PhoneOrderError("erp_unit", 400)
  if (!order.pharmacyGuid) throw new PhoneOrderError("erp_pharmacy", 400)
  if (order.catalogScopeKey !== connection.catalogScopeKey) throw new PhoneOrderError("erp_catalog", 409)
  const claimed = await prisma.pharmacyPhoneOrder.updateMany({
    where: { id, organizationId: orgId, revision, status: "pending_review" },
    data: { erpState: "sending", erpAttemptAt: startedAt, revision: { increment: 1 } },
  })
  if (claimed.count !== 1) throw await refusal(prisma, orgId, id)

  const confirmer = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId }, select: { name: true } })
  const sent = order.lines.map(line => ({ position: line.position, externalId: line.externalId!, quantity: line.quantity,
    unitPrice: line.unitPrice!.toFixed(4) }))
  const payload = erpOrderPayload({ id: order.id, label: phoneOrderLabel(order.number), callStartedAt: order.callStartedAt,
    pharmacyGuid: order.pharmacyGuid, confirmedBy: confirmer?.name ?? userId, lines: sent }, connection)
  const outcome: ErpOutcome = await sendErpOrder(connection, payload, order.erpState === "unknown" || stale)
    .catch(() => ({ kind: "unknown" as const, error: "send_failed" }))

  const finishedAt = new Date()
  const data: Prisma.PharmacyPhoneOrderUpdateManyMutationInput = outcome.kind === "created"
    ? { erpState: "created", erpDocument: outcome.document, erpResult: { differences: erpDifferences(sent, outcome.goods) },
      status: "confirmed", confirmedAt: finishedAt, confirmedById: userId }
    : outcome.kind === "refused" ? { erpState: "refused", erpDocument: Prisma.DbNull, erpResult: { errors: outcome.errors } }
    : { erpState: "unknown", erpResult: { error: outcome.error } }
  // Only the send this click claimed may settle the order.
  const settled = await prisma.pharmacyPhoneOrder.updateMany({
    where: { id, organizationId: orgId, erpState: "sending", erpAttemptAt: startedAt },
    data: { ...data, revision: { increment: 1 } },
  })
  if (settled.count === 1 && outcome.kind === "created") {
    void notifyPharmacyOfDecision(prisma as unknown as PrismaClient, orgId, id)
      .catch((error: unknown) => console.warn("[phone-orders] pharmacy notice failed", error instanceof Error ? error.name : typeof error))
  }
  if (outcome.kind !== "created") {
    // The order id and the kind only: 1C's texts and the account stay out of the log.
    console.warn("[phone-orders] 1C order not created", JSON.stringify({ orderId: id, kind: outcome.kind,
      error: outcome.kind === "unknown" ? outcome.error : outcome.errors.map(error => error.code).join(",") }))
  }
  return getPhoneOrder(orgId, id)
}

/**
 * One manager action under the order's revision: a card opened before another
 * person's change gets 409 instead of overwriting it. Lines change only while
 * the order waits for review; confirm and reject close it.
 */
export async function applyPhoneOrderAction(orgId: string, userId: string, id: string, action: PhoneOrderAction) {
  const head = await prisma.pharmacyPhoneOrder.findFirst({ where: { id, organizationId: orgId },
    select: { catalogSource: true, catalogScopeKey: true, providerCallId: true } })
  if (!head) throw new PhoneOrderError("not_found", 404)
  // The agent saves the list after every line and each save replaces it: a
  // manager's change made while the call still runs would be overwritten.
  if (await callStillRunning(orgId, head.providerCallId)) throw new PhoneOrderError("call_in_progress", 409)
  if (action.action === "confirm") {
    let connection: ErpConnection | null
    try { connection = await erpConnection(orgId) } catch { throw new PhoneOrderError("erp_unavailable", 503) }
    if (connection) return confirmThroughErp(orgId, userId, id, action.revision, connection)
  }
  // The catalog is read before the transaction: parsing it never holds a row lock.
  const item = action.action === "pick_product" || action.action === "add_line"
    ? await pickedItem(head.catalogSource, head.catalogScopeKey, action.externalId) : null
  await prisma.$transaction(async tx => {
    // An order 1C may already hold (a send under way, or one with no clear
    // answer) stays as it was sent until 1C is asked: see confirmThroughErp.
    const locked = await tx.pharmacyPhoneOrder.updateMany({
      where: { id, organizationId: orgId, revision: action.revision, status: "pending_review", OR: ERP_EDITABLE },
      data: { revision: { increment: 1 } },
    })
    if (locked.count !== 1) throw await refusal(tx, orgId, id)
    const lines = await tx.pharmacyPhoneOrderLine.findMany({ where: { orderId: id, organizationId: orgId }, orderBy: { position: "asc" } })
    const line = "lineId" in action ? lines.find(row => row.id === action.lineId) : undefined
    if ("lineId" in action && !line) throw new PhoneOrderError("invalid", 400)
    const edit = (entry: Omit<ManagerEdit, "at" | "by">) => ({ ...entry, at: new Date().toISOString(), by: userId })
    let made: ManagerEdit | null = null
    switch (action.action) {
      case "confirm":
        if (lines.length === 0 || lines.some(row => row.status !== "resolved")) throw new PhoneOrderError("invalid", 400)
        await tx.pharmacyPhoneOrder.update({ where: { id }, data: { status: "confirmed", confirmedAt: new Date(), confirmedById: userId } })
        return
      case "reject":
        await tx.pharmacyPhoneOrder.update({ where: { id }, data: { status: "rejected", rejectedAt: new Date(), rejectedById: userId, rejectReason: action.reason } })
        return
      case "set_quantity": {
        const unitPrice = line!.unitPrice
        await tx.pharmacyPhoneOrderLine.update({ where: { id: line!.id }, data: { quantity: action.quantity,
          lineTotal: unitPrice ? unitPrice.mul(action.quantity).toDecimalPlaces(2) : null } })
        made = edit({ action: "set_quantity", position: line!.position, product: line!.externalId, from: line!.quantity, to: action.quantity })
        break
      }
      case "pick_product":
        await tx.pharmacyPhoneOrderLine.update({ where: { id: line!.id }, data: { status: "resolved", externalId: item!.externalId,
          itemCode: item!.itemCode, productName: item!.name, sourceName: item!.sourceName, ...priced(item!, line!.quantity, line!.unit) } })
        made = edit({ action: "pick_product", position: line!.position, from: line!.externalId, to: item!.externalId })
        break
      case "add_line": {
        if (lines.length >= PHONE_ORDER_MAX_LINES) throw new PhoneOrderError("invalid", 400)
        const position = (lines.at(-1)?.position ?? 0) + 1
        await tx.pharmacyPhoneOrderLine.create({ data: { organizationId: orgId, orderId: id, position, status: "resolved",
          externalId: item!.externalId, itemCode: item!.itemCode, productName: item!.name, sourceName: item!.sourceName, spokenText: "—",
          quantity: action.quantity, unit: action.unit, ...priced(item!, action.quantity, action.unit) } })
        made = edit({ action: "add_line", position, to: item!.externalId, quantity: action.quantity })
        break
      }
      case "remove_line":
        if (lines.length === 1) throw new PhoneOrderError("invalid", 400)
        await tx.pharmacyPhoneOrderLine.delete({ where: { id: line!.id } })
        made = edit({ action: "remove_line", position: line!.position, from: line!.externalId, quantity: line!.quantity })
        break
    }
    const after = await tx.pharmacyPhoneOrderLine.findMany({ where: { orderId: id, organizationId: orgId }, select: { lineTotal: true } })
    const total = after.reduce((sum, row) => row.lineTotal ? sum.add(row.lineTotal) : sum, new Prisma.Decimal(0)).toDecimalPlaces(2)
    const before = await tx.pharmacyPhoneOrder.findFirst({ where: { id, organizationId: orgId }, select: { managerEdits: true } })
    await tx.pharmacyPhoneOrder.update({ where: { id }, data: { totalAmount: total, managerEdits: made ? withEdit(before?.managerEdits ?? null, made) : undefined } })
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 })
  // The pharmacy hears the decision on WhatsApp; the manager does not wait for it.
  if (action.action === "confirm" || action.action === "reject") {
    void notifyPharmacyOfDecision(prisma as unknown as PrismaClient, orgId, id)
      .catch((error: unknown) => console.warn("[phone-orders] pharmacy notice failed", error instanceof Error ? error.name : typeof error))
  }
  return getPhoneOrder(orgId, id)
}

/** The order as a spreadsheet the manager can paste into 1C. ExcelJS keeps a
 * string cell a string, so a caller's words starting with "=" stay text. */
export function phoneOrderSheet(order: Awaited<ReturnType<typeof getPhoneOrder>>): SheetSpec {
  return {
    name: order.label,
    headers: ["#", "Kod", "Məhsul", "Miqdar", "Vahid", "Qiymət", "Məbləğ", "Zəngdə deyilən"],
    rows: order.lines.map(line => [line.position, line.itemCode ?? "", line.productName ? readableProductName(line.productName) : "Kataloqda tapılmadı",
      line.quantity, line.unit, line.unitPrice === null ? "" : Number(line.unitPrice),
      line.lineTotal === null ? "" : Number(line.lineTotal), line.spokenText]),
  }
}
