/**
 * Products that left the line's catalog because their stock ran out.
 *
 * 1C's AvailableBalances lists only what the warehouse has: a product sold
 * out drops out of the feed, and the line's search no longer knows it. Live
 * call cac2adb9 (2026-11-04 13:19 UTC): the pharmacy ordered Adefa, the
 * model searched "Adefa", and the catalog of 12:00 had none — 7 boxes at
 * midnight, 0 by noon — so the model heard only Ademta, Adenuric, Adolor and
 * said «"Adefa" adında dərman tapa bilmədim». The owner took it for a
 * recognition failure.
 *
 * So the catalog refresh, when it replaces a snapshot, remembers what left it
 * for DEPARTED_KEPT_MS, and the line's search adds such a product, when the
 * caller's word is its name, as a candidate with stock 0 and no price: the
 * agent can say it has run out and offer a substitute instead of "not found".
 */
import { z } from "zod"

import { PharmacyNameSearch, spokenNameKey, spokenWordsApart } from "./name-search"

/** How long a sold-out product is still known by name. */
export const DEPARTED_KEPT_MS = 14 * 24 * 3_600_000
/** At most this many are kept, the most recently gone first. */
export const DEPARTED_MAX_ITEMS = 5000
/** The caller's word and the product's name are this close (spokenWordsApart): the same word, one sound or one letter off. */
const SAME_NAME = 0.1

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const label = z.string().min(1).max(512)
export const departedItemSchema = z.strictObject({
  externalId: guid, itemCode: label, name: label, nameAz: label.nullable(),
  baseUnitAsReported: z.string().min(1).max(64),
  /** 1C's active substance and item kind, for substitutes of a sold-out product (2026-11-04); a list kept before has neither. */
  pharmacologicalName: label.nullable().optional(), kind: label.optional(),
  goneAt: z.iso.datetime({ offset: true }),
})
export type DepartedItem = z.infer<typeof departedItemSchema>
export const departedListSchema = z.array(departedItemSchema).max(DEPARTED_MAX_ITEMS)

type CatalogItem = Omit<DepartedItem, "goneAt">

/**
 * The list after one snapshot replaced another: what the old one had and the
 * new one lacks is gone now (or since it was first missed), what is back in
 * stock or older than DEPARTED_KEPT_MS is dropped.
 */
export function nextDeparted(options: {
  previous: readonly DepartedItem[]
  before: Iterable<CatalogItem>
  now: Iterable<{ externalId: string }>
  at: number
}): DepartedItem[] {
  const inStock = new Set<string>()
  for (const item of options.now) inStock.add(item.externalId)
  const goneAt = new Date(options.at).toISOString()
  const kept = new Map<string, DepartedItem>()
  for (const item of options.previous) {
    if (inStock.has(item.externalId) || options.at - Date.parse(item.goneAt) >= DEPARTED_KEPT_MS) continue
    kept.set(item.externalId, item)
  }
  for (const item of options.before) {
    if (inStock.has(item.externalId) || kept.has(item.externalId)) continue
    kept.set(item.externalId, { externalId: item.externalId, itemCode: item.itemCode, name: item.name, nameAz: item.nameAz,
      baseUnitAsReported: item.baseUnitAsReported,
      ...(item.pharmacologicalName !== undefined ? { pharmacologicalName: item.pharmacologicalName } : {}),
      ...(item.kind !== undefined ? { kind: item.kind } : {}), goneAt })
  }
  return [...kept.values()].sort((a, b) => Date.parse(b.goneAt) - Date.parse(a.goneAt)).slice(0, DEPARTED_MAX_ITEMS)
}

const firstWord = (text: string) => spokenNameKey(text).split(" ")[0] ?? ""

/** The caller's first word is the product's own name (one sound or letter off, any alphabet): "Ketonal ampula" names «Кетонал 100 мг». */
export function callerNames(text: string, item: { name: string; nameAz: string | null }): boolean {
  const asked = firstWord(text)
  return asked.length >= 4 && [item.name, item.nameAz].some((name) => name && spokenWordsApart(asked, firstWord(name)) <= SAME_NAME)
}

/** Sold-out products found by name, only where the caller's word is the product's own name. */
export function createDepartedSearch(items: readonly DepartedItem[]) {
  const names = new PharmacyNameSearch(true)
  const byId = new Map<string, DepartedItem>()
  for (const item of items) {
    byId.set(item.externalId, item)
    names.add(item.externalId, item.name)
    if (item.nameAz) names.add(item.externalId, item.nameAz)
  }
  return {
    size: byId.size,
    find(text: string, limit = 1): DepartedItem[] {
      if (firstWord(text).length < 4 || !byId.size) return []
      const found: DepartedItem[] = []
      for (const id of names.find(text).slice(0, 5)) {
        const item = byId.get(id)!
        if (callerNames(text, item)) found.push(item)
        if (found.length === limit) break
      }
      return found
    },
  }
}
export type DepartedSearch = ReturnType<typeof createDepartedSearch>
