/**
 * What one master charges for a service, and how long they take over it.
 *
 * A salon almost never has one price for a haircut: the senior stylist takes
 * an hour and charges forty, the junior takes forty minutes and charges
 * twenty-five. Altegio, Square and Dikidi all carry this on the service;
 * without it the price list on the public page is a lie for everybody but one
 * master.
 *
 * It is stored as one nullable JSON column on the service rather than a table
 * of its own, for the same reason `hostIds` is an array: the rows would carry
 * no meaning the service does not already carry, and a service with no
 * differences stores nothing at all.
 *
 * A missing field means «as the service says» — never zero, never «free».
 */

export interface HostVariant {
  /** Decimal as text, like the page's own price; null = the service's price. */
  price: string | null
  /** null = the service's own duration. */
  durationMinutes: number | null
}

export type HostVariants = Record<string, HostVariant>

/** What a service costs and how long it takes when nobody differs. */
export interface ServiceBase {
  price: string | null
  durationMinutes: number
}

const MAX_HOSTS = 20
const MIN_DURATION = 5
const MAX_DURATION = 480
const MAX_PRICE = 1_000_000_000

/** A price as the column holds it: digits, an optional decimal part, no sign. */
function cleanPrice(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE) return trimPrice(value.toFixed(2))
  if (typeof value !== "string") return null
  const text = value.trim().replace(",", ".")
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount > MAX_PRICE) return null
  return trimPrice(text)
}

/** «40.00» and «40» are the same price; the shorter one is what a person wrote. */
function trimPrice(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text
}

function cleanDuration(value: unknown): number | null {
  const minutes = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(minutes) || minutes < MIN_DURATION || minutes > MAX_DURATION) return null
  return minutes
}

/**
 * The column as it may be read back — written by an older release, by hand, or
 * not at all. Anything unreadable is «no difference», because a service that
 * cannot say what a master charges must fall back to its own price, not fail.
 */
export function parseHostVariants(value: unknown): HostVariants {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: HostVariants = {}
  for (const [hostId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!hostId || hostId.length > 64 || !raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const price = cleanPrice(entry.price)
    const durationMinutes = cleanDuration(entry.durationMinutes)
    if (price === null && durationMinutes === null) continue
    out[hostId] = { price, durationMinutes }
    if (Object.keys(out).length >= MAX_HOSTS) break
  }
  return out
}

/**
 * What is worth storing: only masters who still take this service, and only
 * where they really differ from it. A row saying «the same as the service» is
 * a second place to change the price, and the two would drift apart.
 */
export function normalizeHostVariants(value: unknown, hostIds: string[], base: ServiceBase): HostVariants {
  const parsed = parseHostVariants(value)
  const out: HostVariants = {}
  for (const hostId of hostIds) {
    const entry = parsed[hostId]
    if (!entry) continue
    const price = entry.price !== null && samePrice(entry.price, base.price) ? null : entry.price
    const durationMinutes = entry.durationMinutes === base.durationMinutes ? null : entry.durationMinutes
    if (price === null && durationMinutes === null) continue
    out[hostId] = { price, durationMinutes }
  }
  return out
}

export function samePrice(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return Number(left) === Number(right)
}

/** What this master charges and how long they take — the service's own where they do not differ. */
export function hostService(page: { price: string | null; durationMinutes: number; hostVariants?: unknown }, hostId: string): ServiceBase {
  const entry = parseHostVariants(page.hostVariants)[hostId]
  return {
    price: entry?.price ?? page.price,
    durationMinutes: entry?.durationMinutes ?? page.durationMinutes,
  }
}

/**
 * The prices a customer may end up paying, for a page that has not chosen a
 * master yet: one number when everybody agrees, a span when they do not.
 * Masters who are no longer on the service are not counted.
 */
export function servicePriceSpan(
  page: { price: string | null; durationMinutes: number; hostVariants?: unknown },
  hostIds: string[],
): { min: string | null; max: string | null; varies: boolean } {
  const prices = hostIds.map((hostId) => hostService(page, hostId).price)
  const known = prices.filter((price): price is string => price !== null)
  if (known.length === 0) return { min: null, max: null, varies: false }
  // A master with no price at all is «ask us», which no span can state.
  const incomplete = known.length !== prices.length
  const sorted = [...known].sort((left, right) => Number(left) - Number(right))
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  return { min, max, varies: incomplete || !samePrice(min, max) }
}

/** Whether this service says anything different about any of its masters. */
export function hasHostVariants(page: { hostVariants?: unknown }, hostIds: string[]): boolean {
  const variants = parseHostVariants(page.hostVariants)
  return hostIds.some((hostId) => variants[hostId])
}
