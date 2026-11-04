import { soundCodes, soundPartApart, spokenNameKey, spokenWordCodes, type RankedItem } from "./name-search"

/**
 * The calling pharmacy's products next to the line's search
 * (zeytun-pharmacy-assortment.ts says whose list it is). Pure: the search
 * (zeytun-available-balances.ts) and the benchmark use it alike.
 *
 * The five candidates the search finds stay exactly as they are — order and
 * set. Measured on the whole catalog (scripts/zeytun-line/search-benchmark.ts
 * --assortment, 2026-11-04): moving the pharmacy's products up within the
 * five put its own product first more often, but a product OUTSIDE its list
 * then came first less often (−0.2 to −2 points), and the owner's rule is
 * that such a product is found no worse than before. So the list only ADDS:
 * up to ASSORTMENT_EXTRA_MAX of its products the five lack, when the caller's
 * word sounds like one of their names with more slack than the whole catalog
 * can afford (ASSORTMENT_WITHIN), also as the name's beginning or end. Among
 * nine thousand names that slack would find noise; among a pharmacy's few
 * hundred it finds what the ear lost: "Adessa" for Adefa, "etanol" for
 * Ketonal, "Alqum" for Spazmalgon (plan 4.2).
 */

/** At most this many of the pharmacy's products come after the five. */
export const ASSORTMENT_EXTRA_MAX = 2
/** How far (0–1, soundPartApart) a spoken word may be from a product name of the list. */
export const ASSORTMENT_WITHIN = 0.35
/**
 * A product of the list is shown only if it sounds no further from the
 * caller's words than the closest of the five, plus this: the list makes a
 * product likelier, it does not make a far one near.
 */
export const ASSORTMENT_MARGIN = 0.05
/** Spoken words shorter than this say too little to point at a product. */
const MIN_SPOKEN = 4

/** A product as the list compares it: its own name ("Но-шпа форте…" → "noşpa"), and every word of its labels. */
export interface ProductSound { name: Int32Array[]; words: ReadonlySet<string> }

/** The first word of each label as a caller says it, and all label words folded (spokenNameKey). */
export function productSound(item: { name: string; nameAz?: string | null }): ProductSound {
  const name = new Map<string, Int32Array>()
  for (const label of [item.name, item.nameAz ?? ""]) {
    const word = label.match(/^[\p{L}][\p{L}\p{M}-]{2,}/u)?.[0]
    const codes = word ? soundCodes(word) : null
    if (codes && codes.length >= MIN_SPOKEN) name.set(String.fromCodePoint(...codes), codes)
  }
  return { name: [...name.values()], words: new Set(spokenNameKey(`${item.name} ${item.nameAz ?? ""}`).split(" ")) }
}

/** Whether the caller clearly said this product: every product word heard is spelled exactly so in it. */
export const saidClearly = (row: RankedItem) => row.words > 0 && row.exact === row.words

/**
 * The pharmacy's products to show after the five: none when one of the five
 * is what the caller clearly said (saidClearly: the ear heard a real name, and
 * a list product near it would only distract), else those not among them, sounding
 * within `within` of a word the caller said, closest first; of one name, the
 * one with more of the other words said ("etanol gel": Ketonal gel before
 * Ketonal ampoules), then the most ordered. `sound` gives a product's
 * productSound, null when the catalog no longer has it.
 */
export function assortmentExtras(text: string, shown: readonly RankedItem[], ordered: readonly string[],
  sound: (id: string) => ProductSound | null, within = ASSORTMENT_WITHIN, max = ASSORTMENT_EXTRA_MAX, margin = ASSORTMENT_MARGIN): string[] {
  const spoken = spokenWordCodes(text).filter(word => word.length >= MIN_SPOKEN)
  if (!spoken.length || !ordered.length || shown.some(saidClearly)) return []
  const said = spokenNameKey(text).split(" ").filter(Boolean)
  const apartFrom = (product: ProductSound | null, limit: number) => {
    let apart = 1
    for (const word of product?.name ?? []) for (const codes of spoken) apart = Math.min(apart, soundPartApart(codes, word, limit))
    return apart
  }
  const nearest = Math.min(1, ...shown.map(row => apartFrom(sound(row.id), 1)))
  const reach = Math.min(within, nearest + margin)
  const skip = new Set(shown.map(row => row.id)), found: Array<{ id: string; apart: number; also: number; rank: number }> = []
  ordered.forEach((id, rank) => {
    if (skip.has(id)) return
    const product = sound(id)
    if (!product) return
    const apart = apartFrom(product, reach)
    if (apart <= reach) found.push({ id, apart, also: said.filter(word => product.words.has(word)).length, rank })
  })
  return found.sort((a, b) => a.apart - b.apart || b.also - a.also || a.rank - b.rank).slice(0, max).map(entry => entry.id)
}
