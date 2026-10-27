import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"

import { decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import type { SheetSpec } from "@/lib/export/tabular"
import { featureFlagsToArray } from "@/lib/modules"
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
  constructor(readonly code: "not_found" | "stale_revision" | "not_pending" | "invalid" | "catalog_unavailable" | "call_in_progress", readonly status: number) {
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
    managerNotice: order.managerNotice, pharmacyNotice: order.pharmacyNotice,
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
      feed: new ZeytunAvailableBalances(snapshot.payload, snapshot.context) }
  })()
  catalogCache.set(key, { at: Date.now(), value })
  value.catch(() => catalogCache.delete(key))
  return value
}

type PickedItem = { externalId: string; itemCode: string; name: string; price: { amount: string; per: string } | null }

function project(catalog: CatalogHandle, item: { externalId: string; itemCode: string; name: string; nameAz: string | null
  priceAsReported?: unknown; baseUnitAsReported?: unknown }): PickedItem {
  const price = listPrice(item, catalog.observedAt)
  return { externalId: item.externalId, itemCode: item.itemCode, name: item.nameAz?.trim() || item.name,
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
  // The catalog is read before the transaction: parsing it never holds a row lock.
  const item = action.action === "pick_product" || action.action === "add_line"
    ? await pickedItem(head.catalogSource, head.catalogScopeKey, action.externalId) : null
  await prisma.$transaction(async tx => {
    const locked = await tx.pharmacyPhoneOrder.updateMany({
      where: { id, organizationId: orgId, revision: action.revision, status: "pending_review" },
      data: { revision: { increment: 1 } },
    })
    if (locked.count !== 1) {
      const current = await tx.pharmacyPhoneOrder.findFirst({ where: { id, organizationId: orgId }, select: { status: true } })
      if (!current) throw new PhoneOrderError("not_found", 404)
      throw current.status === "pending_review" ? new PhoneOrderError("stale_revision", 409) : new PhoneOrderError("not_pending", 409)
    }
    const lines = await tx.pharmacyPhoneOrderLine.findMany({ where: { orderId: id, organizationId: orgId }, orderBy: { position: "asc" } })
    const line = "lineId" in action ? lines.find(row => row.id === action.lineId) : undefined
    if ("lineId" in action && !line) throw new PhoneOrderError("invalid", 400)
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
        break
      }
      case "pick_product":
        await tx.pharmacyPhoneOrderLine.update({ where: { id: line!.id }, data: { status: "resolved", externalId: item!.externalId,
          itemCode: item!.itemCode, productName: item!.name, ...priced(item!, line!.quantity, line!.unit) } })
        break
      case "add_line": {
        if (lines.length >= PHONE_ORDER_MAX_LINES) throw new PhoneOrderError("invalid", 400)
        const position = (lines.at(-1)?.position ?? 0) + 1
        await tx.pharmacyPhoneOrderLine.create({ data: { organizationId: orgId, orderId: id, position, status: "resolved",
          externalId: item!.externalId, itemCode: item!.itemCode, productName: item!.name, spokenText: "—",
          quantity: action.quantity, unit: action.unit, ...priced(item!, action.quantity, action.unit) } })
        break
      }
      case "remove_line":
        if (lines.length === 1) throw new PhoneOrderError("invalid", 400)
        await tx.pharmacyPhoneOrderLine.delete({ where: { id: line!.id } })
        break
    }
    const after = await tx.pharmacyPhoneOrderLine.findMany({ where: { orderId: id, organizationId: orgId }, select: { lineTotal: true } })
    const total = after.reduce((sum, row) => row.lineTotal ? sum.add(row.lineTotal) : sum, new Prisma.Decimal(0)).toDecimalPlaces(2)
    await tx.pharmacyPhoneOrder.update({ where: { id }, data: { totalAmount: total } })
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
