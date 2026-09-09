/** Single source of truth for CPQ quote line-item product types.
 * Used by both the API (Zod enum + conditional quantity validation) and
 * the UI (type dropdown + conditional quantity input). */
export const LINE_TYPES = ["hardware", "license", "subscription", "service", "other"] as const
export type LineType = (typeof LINE_TYPES)[number]

export const DEFAULT_LINE_TYPE: LineType = "other"

/** Only `service` allows a fractional quantity (hours, prorated months).
 * Everything else is a discrete count → integer ≥ 1. */
export function isDecimalLineType(t: string | null | undefined): boolean {
  return t === "service"
}

/** True when `quantity` is acceptable for the given line type. undefined/null
 *  → true (defaults to 1 downstream). `service` allows any finite value > 0;
 *  all other types require an integer ≥ 1. `""` → Number("")=0 → rejected
 *  (no silent zero). Single source imported by BOTH quote routes AND the UI
 *  so the rule cannot drift. */
export function isValidLineQuantity(productType: string | null | undefined, quantity: unknown): boolean {
  if (quantity === undefined || quantity === null) return true
  const n = typeof quantity === "string" ? Number(quantity) : (quantity as number)
  if (!Number.isFinite(n)) return false
  return isDecimalLineType(productType) ? n > 0 : Number.isInteger(n) && n >= 1
}
