import { spokenNameKey } from "./name-search"

/**
 * Promotions on the phone line. Owner, 2026-11-04: the assistant sells
 * between 1C and the pharmacy, not only takes dictation — a pharmacy asked
 * «на что есть акции?», and the assistant knew a promotion only on a product
 * it had found by name. This answers the agent's request
 * `promotions: <filter>`: the "buy N, get M" promotions 1C runs today, every
 * one or those of one product, maker or active substance.
 */

/** The agent's request: `promotions:` alone, or with a word of a product, maker or substance. */
export const PROMOTIONS_PREFIX = /^\s*promotions?\s*:/iu

/** The text after the prefix, trimmed; "" asks for every promotion. Null when the text is no promotions request. */
export function parsePromotionsRequest(text: string): string | null {
  return PROMOTIONS_PREFIX.test(text) ? text.replace(PROMOTIONS_PREFIX, "").trim() : null
}

/** Today in Baku as 1C writes a date: "20261104". */
export function bakuDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now)).replaceAll("-", "")
}

/**
 * The "buy N, get M" promotion 1C runs on the item today (Baku date, both
 * ends included), or null. Owner, 2026-10-27: the AI tells the pharmacy of
 * 1C's «купи/получи». A flag without both numbers (1C writes 0/0 for its
 * other kinds) is some other kind of promotion: not said. The one rule for the
 * candidate's `promotion` (activePromotion) and for this list.
 */
export function runningPromotion(raw: unknown, now: number) {
  const promotion = promotionTerms(raw)
  if (!promotion) return null
  const today = bakuDay(now)
  return today < promotion.from || today > promotion.to ? null : promotion
}

/** The promotion's terms whatever the date: the flag, both numbers at least 1, both dates as 1C writes them. */
function promotionTerms(raw: unknown) {
  const promotion = raw as { enabled?: unknown; buy?: unknown; get?: unknown; validFromRaw?: unknown; validToRaw?: unknown } | null | undefined
  if (!promotion || promotion.enabled !== true) return null
  const { buy, get, validFromRaw: from, validToRaw: to } = promotion
  if (!Number.isInteger(buy) || !Number.isInteger(get) || (buy as number) < 1 || (get as number) < 1) return null
  if (typeof from !== "string" || typeof to !== "string" || !/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return null
  return { buy: buy as number, get: get as number, from, to }
}

export type PromotedItem = {
  externalId: string; name: string; nameAz: string | null; pharmacologicalName: string | null
  quantityAsReported: string; promotionAsReported: unknown
}

/** Where a filter word was found, best first: the product's own name, its active substance, its maker. */
const NAME = 0, SUBSTANCE = 1, MAKER = 2

/** The label parts that name the maker and country (the feed's sourceParts), per label. */
export type ProductMakers = { name: string[]; nameAz: string[] }

function ownName(label: string, makers: string[]): string {
  let own = label
  for (const part of makers) own = own.replace(part, " ")
  return own
}

/** The first word of the product's own name in each label, folded: the name a product goes by ("ketonal"). */
export function productLeads(item: { name: string; nameAz: string | null }, makers: ProductMakers): Set<string> {
  const leads = new Set<string>()
  for (const [label, parts] of [[item.name, makers.name], [item.nameAz ?? "", makers.nameAz]] as const) {
    const lead = spokenNameKey(ownName(label, parts)).split(" ")[0]
    if (lead) leads.add(lead)
  }
  return leads
}

/** `leads`: productLeads. */
type Entry = { id: string; name: string; from: string; to: string; words: Map<string, number>; leads: Set<string> }

/**
 * The feed's items that carry a "buy N, get M" promotion, whatever its dates:
 * the date is asked at each request, so a list built yesterday answers today.
 * Only items in stock: a promotion on nothing to sell is not offered.
 */
export class ZeytunPromotions {
  private readonly entries = new Map<string, Entry>()

  add(item: PromotedItem, makers: ProductMakers): void {
    const terms = promotionTerms(item.promotionAsReported)
    if (!terms || !(Number(item.quantityAsReported) > 0)) return
    const words = new Map<string, number>()
    const note = (text: string, where: number) => {
      for (const word of spokenNameKey(text).split(" ")) {
        if (word && (words.get(word) ?? Infinity) > where) words.set(word, where)
      }
    }
    for (const [label, parts] of [[item.name, makers.name], [item.nameAz ?? "", makers.nameAz]] as const) {
      for (const part of parts) note(part, MAKER)
      note(ownName(label, parts), NAME)
    }
    if (item.pharmacologicalName) note(item.pharmacologicalName, SUBSTANCE)
    this.entries.set(item.externalId, { id: item.externalId, name: item.name, from: terms.from, to: terms.to, words,
      leads: productLeads(item, makers) })
  }

  /**
   * Items whose promotion runs today, for `promotions: <filter>`. Without a
   * filter, every one, the soonest to end first. With one, only items it
   * names: each of its words found in the product's name, substance or maker
   * (any alphabet: "Ketonal" finds «Кетонал»), the product's own name first,
   * then the soonest to end; when no item has those words, the products that
   * go by the name of the catalog's product spelled closest to it, the
   * soonest to end first. `closest`: that product's leads (productLeads) from
   * the feed's own name search, empty when it finds none.
   */
  find(text: string, now: number, closest: (filter: string) => Set<string>): string[] {
    const filter = parsePromotionsRequest(text)
    if (filter === null) return []
    const today = bakuDay(now)
    const running = (entry: Entry) => entry.from <= today && today <= entry.to
    const byEnd = (a: Entry, b: Entry) => a.to.localeCompare(b.to) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    const asked = spokenNameKey(filter).split(" ").filter(Boolean)
    // A filter with no product word in it ("promotions: B", "promotions: 10")
    // names nothing: never the whole list in its place.
    if (!asked.length) return filter ? [] : [...this.entries.values()].filter(running).sort(byEnd).map(entry => entry.id)
    const matched: { entry: Entry; where: number }[] = []
    for (const entry of this.entries.values()) {
      if (!running(entry)) continue
      let where = NAME
      for (const word of asked) {
        const found = entry.words.get(word)
        if (found === undefined) { where = -1; break }
        where = Math.max(where, found)
      }
      if (where >= 0) matched.push({ entry, where })
    }
    if (matched.length) return matched.sort((a, b) => a.where - b.where || byEnd(a.entry, b.entry)).map(row => row.entry.id)
    // A misheard name: the promoted products that go by the name of the
    // product the line's own search puts first, none when that one has no
    // promotion. The closest PROMOTED spelling was wrong twice on the
    // 2026-11-03 snapshot: "Nurofen", which has no promotion, reached
    // Супофен, and "Ketanol" linseed oil ("Ketan toxumu yağı").
    const leads = closest(filter)
    if (!leads.size) return []
    return [...this.entries.values()].filter(entry => running(entry) && [...entry.leads].some(lead => leads.has(lead)))
      .sort(byEnd).map(entry => entry.id)
  }
}
