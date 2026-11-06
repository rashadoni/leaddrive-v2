import type { PrismaClient } from "@prisma/client"

import { runWithTenant } from "../../rls-context"
import { confirmedOrdersSource } from "./zeytun-pharmacy-assortment"
import { callPharmacy, pharmacyOrdersWhere, type CallPharmacy } from "./zeytun-pharmacy-history"
import type { ArrivedItem } from "./zeytun-arrived-items"

/**
 * The waiting list and the news of arrivals (owner's client, 2026-11-06:
 * «если был отказ во время заказа из-за того, что не было на складе — режим
 * ожидания»; «после разговора до следующего звонка, если были новые
 * поступления — хотите ли узнать?»; owner chose «А»: only what this pharmacy
 * ordered or asked for).
 *
 * A sold-out product the pharmacy still wants stays in the call's order as it
 * always did (a line nobody could resolve) and is written here as well, with
 * its 1C id, so it is not lost. The catalog refresh stamps `arrivedAt` when
 * 1C has it again. When the same pharmacy calls next, the agent offers first
 * what it waited for, then what came back of the products it orders.
 */

/** A sold-out product a call wrote, as the sold-out list knew it. */
export type WaitlistLine = { externalId: string; itemCode: string; productName: string; spokenText: string; quantity: number; unit: string }

/** What the agent offers at most, waited-for first. */
export const ARRIVALS_OFFERED_MAX = 3
/** How far back a request on the waiting list still counts. */
export const WAITLIST_KEPT_MS = 90 * 24 * 3_600_000
/** Without an earlier call of the pharmacy, arrivals of this long count as news. */
export const ARRIVALS_FIRST_CALL_MS = 7 * 24 * 3_600_000

/**
 * The call's waiting list as its latest save has it: one row per product,
 * the pharmacy as the call's order names it. A product the caller took back
 * leaves the list; one a manager took off stays off.
 */
export async function recordCallWaitlist(db: PrismaClient, input: {
  organizationId: string; providerCallId: string; catalogScopeKey: string; lines: readonly WaitlistLine[]
}): Promise<void> {
  const orgId = input.organizationId
  const lines = [...new Map(input.lines.map(line => [line.externalId.toLowerCase(), line])).values()]
  await runWithTenant(orgId, () => db.$transaction(async tx => {
    const order = await tx.pharmacyPhoneOrder.findUnique({
      where: { organizationId_providerCallId: { organizationId: orgId, providerCallId: input.providerCallId } },
      select: { id: true, companyId: true, pharmacyGuid: true, pharmacyName: true, callStartedAt: true },
    })
    const pharmacy = { orderId: order?.id ?? null, companyId: order?.companyId ?? null,
      pharmacyGuid: order?.pharmacyGuid ?? null, pharmacyName: order?.pharmacyName ?? null }
    await tx.pharmacyWaitlistItem.deleteMany({ where: { organizationId: orgId, providerCallId: input.providerCallId,
      dismissedAt: null, externalId: { notIn: lines.map(line => line.externalId.toLowerCase()) } } })
    for (const line of lines) {
      const externalId = line.externalId.toLowerCase()
      const fields = { itemCode: line.itemCode, productName: line.productName, spokenText: line.spokenText,
        quantity: line.quantity, unit: line.unit, catalogScopeKey: input.catalogScopeKey, ...pharmacy }
      await tx.pharmacyWaitlistItem.upsert({
        where: { organizationId_providerCallId_externalId: { organizationId: orgId, providerCallId: input.providerCallId, externalId } },
        // Asked on the call's own day, not when this save reached the CRM.
        create: { organizationId: orgId, providerCallId: input.providerCallId, externalId, ...fields,
          ...(order ? { requestedAt: order.callStartedAt } : {}) },
        update: fields,
      })
    }
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 }))
}

/** Stamps the products 1C has again; returns how many. Run by the catalog refresh, in the line's process. */
export async function markWaitlistArrivals(db: PrismaClient, input: {
  organizationId: string; catalogScopeKey: string; inStock: (externalId: string) => boolean; now?: Date
}): Promise<number> {
  const orgId = input.organizationId
  return runWithTenant(orgId, async () => {
    const waiting = await db.pharmacyWaitlistItem.findMany({
      where: { organizationId: orgId, catalogScopeKey: input.catalogScopeKey, arrivedAt: null, dismissedAt: null },
      select: { id: true, externalId: true }, take: 5000,
    })
    const ids = waiting.filter(row => input.inStock(row.externalId)).map(row => row.id)
    if (!ids.length) return 0
    const done = await db.pharmacyWaitlistItem.updateMany({ where: { organizationId: orgId, id: { in: ids }, arrivedAt: null },
      data: { arrivedAt: input.now ?? new Date() } })
    return done.count
  })
}

/** Products the pharmacy has ordered on any order since `since`, by its company or 1C GUID. */
async function orderedSince(db: PrismaClient, orgId: string, pharmacy: CallPharmacy, externalIds: string[], since: Date, exceptOrderId: string | null) {
  if (!externalIds.length) return new Set<string>()
  const rows = await db.pharmacyPhoneOrderLine.findMany({
    where: { organizationId: orgId, status: "resolved", externalId: { in: externalIds },
      order: { organizationId: orgId, status: { not: "rejected" }, callStartedAt: { gt: since },
        ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}), OR: pharmacyOrdersWhere(pharmacy) } },
    select: { externalId: true }, take: 1000,
  })
  return new Set(rows.map(row => row.externalId!))
}

export type ArrivalOffer = { externalId: string; name: string; waited: boolean }

/**
 * What the calling pharmacy may hear of at the start of the call: products it
 * asked to wait for that 1C has now (and it has not ordered since), then
 * products of its confirmed orders that came back since its last call. Only
 * the pharmacy the call itself vouches for (callPharmacy: its number's alone);
 * none otherwise. `inStock` names a product the catalog has now.
 */
export async function pharmacyArrivals(db: PrismaClient, input: {
  organizationId: string; providerCallId: string; callStartedAt: string; numberPharmacyGuid: string | null
  catalogScopeKey: string; arrived: readonly ArrivedItem[]; inStock: (externalId: string) => { name: string } | null; now?: number
}): Promise<ArrivalOffer[]> {
  const orgId = input.organizationId, now = input.now ?? Date.now()
  const { pharmacy, orderId } = await callPharmacy(db, { organizationId: orgId, providerCallId: input.providerCallId,
    numberPharmacyGuid: input.numberPharmacyGuid })
  if (!pharmacy) return []
  const where = pharmacyOrdersWhere(pharmacy)
  const startedAt = new Date(input.callStartedAt)
  const [waiting, last] = await runWithTenant(orgId, async () => await Promise.all([
    db.pharmacyWaitlistItem.findMany({
      where: { organizationId: orgId, catalogScopeKey: input.catalogScopeKey, dismissedAt: null, providerCallId: { not: input.providerCallId },
        requestedAt: { gte: new Date(now - WAITLIST_KEPT_MS) }, OR: [
          ...(pharmacy.companyId ? [{ companyId: pharmacy.companyId }] : []), ...(pharmacy.guid ? [{ pharmacyGuid: pharmacy.guid }] : [])] },
      orderBy: { requestedAt: "desc" }, select: { externalId: true, requestedAt: true }, take: 50,
    }),
    db.pharmacyPhoneOrder.findFirst({
      where: { organizationId: orgId, callStartedAt: { lt: startedAt }, ...(orderId ? { id: { not: orderId } } : {}), OR: where },
      orderBy: { callStartedAt: "desc" }, select: { callStartedAt: true },
    }),
  ]))
  const offers: ArrivalOffer[] = []
  const taken = new Set<string>()
  const offer = (externalId: string, waited: boolean) => {
    if (offers.length >= ARRIVALS_OFFERED_MAX || taken.has(externalId)) return
    const item = input.inStock(externalId)
    if (!item) return
    taken.add(externalId)
    offers.push({ externalId, name: item.name, waited })
  }
  const earliest = waiting.reduce((min, row) => row.requestedAt < min ? row.requestedAt : min, startedAt)
  const ordered = await runWithTenant(orgId, async () => await orderedSince(db, orgId, pharmacy, waiting.map(row => row.externalId), earliest, orderId))
  for (const row of waiting) if (!ordered.has(row.externalId)) offer(row.externalId, true)
  if (offers.length < ARRIVALS_OFFERED_MAX && input.arrived.length) {
    const since = Math.max(last ? last.callStartedAt.getTime() : now - ARRIVALS_FIRST_CALL_MS, now - ARRIVALS_FIRST_CALL_MS * 2)
    const news = new Set(input.arrived.filter(item => Date.parse(item.arrivedAt) > since).map(item => item.externalId))
    if (news.size) {
      const products = await confirmedOrdersSource(db).products({ organizationId: orgId, catalogScopeKey: input.catalogScopeKey, pharmacy })
      for (const id of products) if (news.has(id)) offer(id, false)
    }
  }
  return offers
}

export type WaitlistState = "waiting" | "arrived" | "ordered" | "dismissed"
export type WaitlistRow = {
  id: string; state: WaitlistState; pharmacyName: string | null; companyId: string | null
  productName: string; spokenText: string; quantity: number; unit: string
  requestedAt: string; arrivedAt: string | null; orderId: string | null; orderNumber: number | null
}

/** The organization's waiting list for the CRM, newest first, each row's state read now. */
export async function listWaitlist(db: PrismaClient, organizationId: string, options: { limit?: number } = {}): Promise<WaitlistRow[]> {
  return runWithTenant(organizationId, async () => {
    const rows = await db.pharmacyWaitlistItem.findMany({
      where: { organizationId, requestedAt: { gte: new Date(Date.now() - WAITLIST_KEPT_MS) } },
      orderBy: [{ requestedAt: "desc" }, { id: "asc" }], take: Math.min(options.limit ?? 300, 1000),
      include: { order: { select: { number: true } } },
    })
    if (!rows.length) return []
    // Every later order line of these products in one read; matched to each row's pharmacy below.
    const earliest = rows.reduce((min, row) => row.requestedAt < min ? row.requestedAt : min, rows[0].requestedAt)
    const later = await db.pharmacyPhoneOrderLine.findMany({
      where: { organizationId, status: "resolved", externalId: { in: [...new Set(rows.map(row => row.externalId))] },
        order: { organizationId, status: { not: "rejected" }, callStartedAt: { gt: earliest } } },
      select: { externalId: true, orderId: true, order: { select: { companyId: true, pharmacyGuid: true, callStartedAt: true } } },
      take: 5000,
    })
    return rows.map((row): WaitlistRow => {
      const ordered = !row.dismissedAt && (row.companyId || row.pharmacyGuid) && later.some(line => line.externalId === row.externalId
        && line.orderId !== row.orderId && line.order.callStartedAt > row.requestedAt
        && ((row.companyId && line.order.companyId === row.companyId) || (row.pharmacyGuid && line.order.pharmacyGuid === row.pharmacyGuid)))
      const state: WaitlistState = row.dismissedAt ? "dismissed" : ordered ? "ordered" : row.arrivedAt ? "arrived" : "waiting"
      return { id: row.id, state, pharmacyName: row.pharmacyName, companyId: row.companyId, productName: row.productName,
        spokenText: row.spokenText, quantity: row.quantity, unit: row.unit, requestedAt: row.requestedAt.toISOString(),
        arrivedAt: row.arrivedAt?.toISOString() ?? null, orderId: row.orderId, orderNumber: row.order?.number ?? null }
    })
  })
}

/** A manager takes a row off the list (or puts it back). */
export async function setWaitlistDismissed(db: PrismaClient, input: { organizationId: string; id: string; userId: string; dismissed: boolean }) {
  return runWithTenant(input.organizationId, async () => {
    const done = await db.pharmacyWaitlistItem.updateMany({ where: { organizationId: input.organizationId, id: input.id },
      data: input.dismissed ? { dismissedAt: new Date(), dismissedById: input.userId } : { dismissedAt: null, dismissedById: null } })
    return done.count === 1
  })
}
