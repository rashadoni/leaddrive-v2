/**
 * A booking page IS the service — what is offered and how long it takes. For a
 * salon that is not enough: the service also costs something, belongs to a
 * group («Saç», «Dırnaq») and is usually taken again after a known number of
 * days. These are the three readings every screen shares, so the services
 * list, the booking form and the meeting card cannot disagree.
 */
import { getCurrencySymbol } from "@/lib/currency"

export interface ServicePrice {
  /** Prisma Decimal arrives as a string; a form hands over a number. */
  price?: string | number | null
  priceCurrency?: string | null
}

/**
 * «25 ₼», or null when the service has no price.
 *
 * With no currency code stored the bare number goes out. Falling back to
 * `DEFAULT_CURRENCY` would print dollars in a salon that works in manats: in
 * the browser bundle that constant is "USD" whatever the server reads — the
 * trap `resolveOrgDefaultCurrency` exists for. The code is stamped next to the
 * price when it is saved, so there is nothing to guess.
 */
export function servicePriceLabel(service: ServicePrice | null | undefined, locale = "az"): string | null {
  const raw = service?.price
  if (raw === null || raw === undefined || raw === "") return null
  const amount = typeof raw === "string" ? Number(raw) : raw
  if (!Number.isFinite(amount)) return null
  let text: string
  try {
    text = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)
  } catch {
    text = String(amount)
  }
  const code = service?.priceCurrency?.trim()
  return code ? `${text} ${getCurrencySymbol(code)}` : text
}

/**
 * Services in the order a screen shows them: categories by name, and the
 * services nobody filed under one last — a salon that never touched the field
 * keeps a plain single list.
 */
export function groupByCategory<T extends { category?: string | null }>(items: T[], locale = "az"): { category: string | null; items: T[] }[] {
  const groups: { category: string | null; items: T[] }[] = []
  for (const item of items) {
    const category = item.category?.trim() || null
    const group = groups.find((row) => row.category === category)
    if (group) group.items.push(item)
    else groups.push({ category, items: [item] })
  }
  return groups.sort((a, b) => {
    if (a.category === b.category) return 0
    if (a.category === null) return 1
    if (b.category === null) return -1
    try {
      return a.category.localeCompare(b.category, locale)
    } catch {
      return a.category < b.category ? -1 : 1
    }
  })
}

/**
 * The moment the client is due back for this service, by its own cycle. The
 * caller turns it into a day on the organization's clock — the cycle is in
 * days, not in hours.
 */
export function nextVisitAt(startsAt: string | Date, repeatCycleDays: number | null | undefined): Date | null {
  if (!repeatCycleDays || !Number.isFinite(repeatCycleDays) || repeatCycleDays <= 0) return null
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt)
  if (Number.isNaN(start.getTime())) return null
  return new Date(start.getTime() + Math.round(repeatCycleDays) * 86_400_000)
}

/** The cycles a salon picks from; 0 means «does not come back on a cycle». */
export const REPEAT_CYCLE_DAYS = [0, 14, 21, 28, 42, 60, 90] as const

/**
 * The link a service gets from its own name: «Saç kəsimi» → `sac-kesimi`.
 *
 * The name is Azerbaijani or Russian and the link must be latin letters,
 * digits and dashes, so asking a salon owner to invent one by hand asked them
 * to transliterate — the one field in the form nobody could answer. Lower-case
 * in the Azerbaijani locale first, so «I» becomes «ı» and not «i» before the
 * table below folds it; then the letters that carry a tail or a dot are folded
 * by Unicode decomposition, which covers every accent we do not list.
 */
const SLUG_LETTERS: Record<string, string> = {
  "ə": "e", "ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g",
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
  "и": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
  "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh",
  "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

export function bookingSlug(title: string): string {
  const lowered = title.toLocaleLowerCase("az")
  let out = ""
  for (const character of lowered) out += SLUG_LETTERS[character] ?? character
  return out
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
}
