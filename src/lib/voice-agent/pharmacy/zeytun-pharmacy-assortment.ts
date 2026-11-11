import type { PrismaClient } from "@prisma/client"

import { runWithTenant } from "../../rls-context"
import { pharmacyOrdersWhere, type CallPharmacy } from "./zeytun-pharmacy-history"

/**
 * What THIS pharmacy orders, as a hint to the line's ear and search
 * (docs/zeytun-line-recognition-plan.md, 4.2: in 11 of 14 "wrong product"
 * cases the right one was not among the candidates at all). One pharmacy
 * orders its own few hundred products, not Zeytun's nine thousand.
 *
 * Only the pharmacy the call already knows (zeytun-pharmacy-history.ts
 * callPharmacy): its number's alone, then its own order's. The model is never
 * told which pharmacy it is or what it orders, and the agent still asks who is
 * calling: its products only come after the five a search finds, when the
 * caller's word sounds like one (zeytun-assortment-ranking.ts), and first
 * among the recognizer's hints. A call without such a pharmacy, or a pharmacy
 * without a history, searches and hears exactly as before.
 */

/** The most products one pharmacy's list holds: the head of its history, most ordered first. */
export const ASSORTMENT_MAX = 300

export interface PharmacyAssortment {
  /** Products, most ordered first, at most ASSORTMENT_MAX. */
  readonly ordered: readonly string[]
  readonly ids: ReadonlySet<string>
  /** Which source(s) it came from, for the log: never the products. */
  readonly sources: readonly string[]
}

/**
 * Where a pharmacy's history comes from: the orders its managers confirmed
 * in the CRM, then 1C's own sales (Get_Sales, zeytun-sales-history.ts, read
 * by a background job into a file per pharmacy; since 2026-11-11).
 */
export interface AssortmentSource {
  readonly name: string
  /** The pharmacy's products, most ordered first; empty when it has none. */
  products(input: { organizationId: string; catalogScopeKey: string; pharmacy: CallPharmacy }): Promise<string[]>
}

/** How far back a pharmacy's confirmed orders count. */
const CONFIRMED_SINCE_MS = 365 * 24 * 60 * 60_000
const CONFIRMED_MAX_LINES = 5000

/** The products of this pharmacy's orders its managers confirmed, on this catalog, most often ordered first. */
export function confirmedOrdersSource(db: PrismaClient, clock: () => number = Date.now): AssortmentSource {
  return {
    name: "crm_confirmed",
    async products({ organizationId, catalogScopeKey, pharmacy }) {
      const where = pharmacyOrdersWhere(pharmacy)
      if (!where.length) return []
      const rows = await runWithTenant(organizationId, async () => await db.pharmacyPhoneOrderLine.findMany({
        where: { organizationId, status: "resolved", externalId: { not: null },
          order: { organizationId, status: "confirmed", catalogScopeKey, confirmedAt: { gte: new Date(clock() - CONFIRMED_SINCE_MS) }, OR: where } },
        select: { externalId: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: CONFIRMED_MAX_LINES,
      }))
      return byCount(rows.map(row => row.externalId!))
    },
  }
}

/** Distinct ids, most frequent first; a tie keeps the first seen (the newest). */
function byCount(ids: string[]) {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].sort(([, a], [, b]) => b - a).map(([id]) => id)
}

/** The sources' lists one after another, without repeats, cut at ASSORTMENT_MAX; null when all are empty. */
export function combineAssortment(lists: Array<{ source: string; products: string[] }>): PharmacyAssortment | null {
  const ordered: string[] = [], sources: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    let added = false
    for (const id of list.products) {
      if (ordered.length === ASSORTMENT_MAX) break
      if (seen.has(id)) continue
      seen.add(id); ordered.push(id); added = true
    }
    if (added) sources.push(list.source)
  }
  return ordered.length ? { ordered, ids: seen, sources } : null
}

// ---- One list per call ----

/** A call's list is read once, when the call starts, and kept this long. */
const KEPT_FOR_MS = 20 * 60_000, KEPT_CALLS = 200

/** A list as read for a call: `pharmacy` names whose it is ("none" without one). */
export type LoadedAssortment = { pharmacy: string; assortment: PharmacyAssortment | null }

export interface CallAssortments {
  /** The call's list once read; starts reading it otherwise. Never waits. */
  get(callId: string, load: () => Promise<LoadedAssortment>): PharmacyAssortment | null
  /** Reads the call's list again when it was read for another pharmacy than `pharmacy` (its order named one). */
  refresh(callId: string, pharmacy: string, load: () => Promise<LoadedAssortment>): void
}

export function createCallAssortments(clock: () => number = Date.now): CallAssortments {
  const calls = new Map<string, { at: number; pharmacy: string | null; value: PharmacyAssortment | null }>()
  const start = (callId: string, load: () => Promise<LoadedAssortment>, keep: PharmacyAssortment | null) => {
    const now = clock()
    for (const [id, entry] of calls) if (now - entry.at >= KEPT_FOR_MS) calls.delete(id)
    const entry = { at: now, pharmacy: null as string | null, value: keep }
    calls.delete(callId)
    calls.set(callId, entry)
    while (calls.size > KEPT_CALLS) calls.delete(calls.keys().next().value!)
    void load().then(loaded => { entry.pharmacy = loaded.pharmacy; entry.value = loaded.assortment },
      // A list that cannot be read is no list: the call searches as before.
      () => { entry.pharmacy = "unreadable" })
    return entry
  }
  return {
    get(callId, load) {
      const known = calls.get(callId)
      return known && clock() - known.at < KEPT_FOR_MS ? known.value : start(callId, load, null).value
    },
    refresh(callId, pharmacy, load) {
      const known = calls.get(callId)
      // Not read yet, or still being read: the reading in flight already sees the order.
      if (!known || known.pharmacy === null || known.pharmacy === pharmacy) return
      start(callId, load, null)
    },
  }
}
