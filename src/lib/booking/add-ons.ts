/**
 * The small things a customer adds to a service when they book it: a hair
 * treatment with the cut, a manicure with the gel. Fresha calls them «service
 * add-ons», and a salon's price list is full of them.
 *
 * Each one carries its own price and its own minutes, because both are true:
 * the add-on costs money and it takes time, and a booking that takes the money
 * without taking the time double-books the master.
 *
 * Stored as one nullable JSON column on the service, like the per-master
 * prices beside it: a service with no add-ons stores nothing at all. The id is
 * the handle a booking keeps, so renaming an add-on never rewrites what an old
 * booking says the customer took.
 */

/**
 * A type alias, not an interface, on purpose: only an alias gets the implicit
 * index signature Prisma's JSON input type asks for, and the booking snapshot
 * stores these as JSON.
 */
export type ServiceAddOn = {
  /** Stable handle; a booking keeps this, not the name. */
  id: string
  name: string
  /** Decimal as text; null = it costs nothing extra. */
  price: string | null
  /** Extra minutes the master needs; 0 = none. */
  durationMinutes: number
}

const MAX_ADD_ONS = 12
const MAX_NAME = 60
const MAX_PRICE = 1_000_000_000
const MAX_EXTRA_MINUTES = 240

function cleanPrice(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE) return trimPrice(value.toFixed(2))
  if (typeof value !== "string") return null
  const text = value.trim().replace(",", ".")
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount > MAX_PRICE) return null
  return trimPrice(text)
}

function trimPrice(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text
}

function cleanMinutes(value: unknown): number {
  const minutes = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_EXTRA_MINUTES) return 0
  return minutes
}

/**
 * The column as it may be read back — from an older release, from a hand-made
 * row, or missing. Anything unreadable is «no add-ons»: a service must still
 * be bookable when its extras cannot be understood.
 */
export function parseAddOns(value: unknown): ServiceAddOn[] {
  if (!Array.isArray(value)) return []
  const out: ServiceAddOn[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === "string" ? entry.id.trim().slice(0, 40) : ""
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_NAME) : ""
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, price: cleanPrice(entry.price), durationMinutes: cleanMinutes(entry.durationMinutes) })
    if (out.length >= MAX_ADD_ONS) break
  }
  return out
}

/** A handle for a new add-on: short, unique within the service, and never reused. */
export function addOnId(existing: ServiceAddOn[]): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = `a${Math.random().toString(36).slice(2, 8)}`
    if (!existing.some((addOn) => addOn.id === id)) return id
  }
  return `a${Date.now().toString(36)}`
}

/** The ones the customer actually ticked, in the order the service lists them. */
export function selectedAddOns(all: ServiceAddOn[], ids: readonly string[]): ServiceAddOn[] {
  const wanted = new Set(ids)
  return all.filter((addOn) => wanted.has(addOn.id))
}

/**
 * What the visit comes to with the extras on it. The minutes matter as much as
 * the money: they are what the slot is cut from, so a service booked with two
 * add-ons holds the master for the whole of it.
 */
export function addOnTotals(base: { price: string | null; durationMinutes: number }, chosen: readonly ServiceAddOn[]): { price: string | null; durationMinutes: number } {
  const extraMinutes = chosen.reduce((sum, addOn) => sum + addOn.durationMinutes, 0)
  const paid = chosen.filter((addOn) => addOn.price !== null)
  if (base.price === null && paid.length === 0) return { price: null, durationMinutes: base.durationMinutes + extraMinutes }
  const total = (base.price === null ? 0 : Number(base.price)) + paid.reduce((sum, addOn) => sum + Number(addOn.price), 0)
  return { price: trimPrice(total.toFixed(2)), durationMinutes: base.durationMinutes + extraMinutes }
}

/** Add-ons ready for the column: named, unique, and no more than a list a person reads. */
export function normalizeAddOns(value: unknown): ServiceAddOn[] {
  return parseAddOns(value)
}
