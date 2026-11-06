/**
 * Products that came back into the line's catalog (owner's client,
 * 2026-11-06: «после разговора до следующего звонка, если были новые
 * поступления, сразу говорит, что есть новые поступления; хотите ли
 * узнать?»; owner chose «А» — only what this pharmacy ordered or asked for).
 *
 * 1C's AvailableBalances lists only what the warehouse has, so a product that
 * is in the new snapshot and was not in the one before has arrived. The
 * catalog refresh keeps that list beside the sold-out one
 * (zeytun-departed-items.ts) for ARRIVED_KEPT_MS; the line's session picks
 * from it what the calling pharmacy wants (zeytun-arrivals.ts).
 *
 * A product missed by one refresh and back by the next is not news: one that
 * was gone for less than ARRIVAL_MIN_ABSENCE_MS is not an arrival. A
 * snapshot that brings back a large share of the catalog at once looks like a
 * cut-off 1C answer before it, not like a delivery, and records nothing.
 */
import { z } from "zod"

import type { DepartedItem } from "./zeytun-departed-items"

/** How long an arrival is still news. */
export const ARRIVED_KEPT_MS = 14 * 24 * 3_600_000
/** At most this many are kept, the most recent first. */
export const ARRIVED_MAX_ITEMS = 5000
/** Gone for less than this (one or two refreshes missed it): not an arrival. */
export const ARRIVAL_MIN_ABSENCE_MS = 3 * 3_600_000
/** More new products than this in one refresh, and more than ARRIVAL_HOLD_SHARE of the catalog: held as a broken snapshot. */
export const ARRIVAL_HOLD_COUNT = 300
export const ARRIVAL_HOLD_SHARE = 0.2

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
export const arrivedItemSchema = z.strictObject({
  externalId: guid,
  arrivedAt: z.iso.datetime({ offset: true }),
  /** When the sold-out list saw it go; null when it was gone longer than that list remembers, or never seen. */
  goneAt: z.iso.datetime({ offset: true }).nullable(),
})
export type ArrivedItem = z.infer<typeof arrivedItemSchema>
export const arrivedListSchema = z.array(arrivedItemSchema).max(ARRIVED_MAX_ITEMS)

/**
 * The list after one snapshot replaced another: what the new one has and the
 * old one lacked has arrived now; an arrival that is out of stock again, or
 * older than ARRIVED_KEPT_MS, is dropped.
 */
export function nextArrived(options: {
  previous: readonly ArrivedItem[]
  /** The sold-out list as it was before this refresh: when each product went. */
  departed: readonly Pick<DepartedItem, "externalId" | "goneAt">[]
  before: Iterable<{ externalId: string }>
  now: Iterable<{ externalId: string }>
  at: number
}): { items: ArrivedItem[]; held: boolean } {
  const before = new Set<string>(), inStock = new Set<string>()
  for (const item of options.before) before.add(item.externalId)
  for (const item of options.now) inStock.add(item.externalId)
  const kept = new Map<string, ArrivedItem>()
  for (const item of options.previous) {
    if (!inStock.has(item.externalId) || options.at - Date.parse(item.arrivedAt) >= ARRIVED_KEPT_MS) continue
    kept.set(item.externalId, item)
  }
  const fresh = [...inStock].filter(id => !before.has(id))
  const held = fresh.length > ARRIVAL_HOLD_COUNT && fresh.length > inStock.size * ARRIVAL_HOLD_SHARE
  if (!held) {
    const goneAt = new Map(options.departed.map(item => [item.externalId, item.goneAt]))
    const arrivedAt = new Date(options.at).toISOString()
    for (const id of fresh) {
      // Already news: it keeps the day it first came back.
      if (kept.has(id)) continue
      const gone = goneAt.get(id) ?? null
      if (gone && options.at - Date.parse(gone) < ARRIVAL_MIN_ABSENCE_MS) continue
      kept.set(id, { externalId: id, arrivedAt, goneAt: gone })
    }
  }
  const items = [...kept.values()].sort((a, b) => Date.parse(b.arrivedAt) - Date.parse(a.arrivedAt)).slice(0, ARRIVED_MAX_ITEMS)
  return { items, held }
}
