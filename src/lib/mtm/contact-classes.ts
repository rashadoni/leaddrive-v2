/**
 * Client classes — the letter a company grades a doctor with: A, B, C, D, VIP.
 *
 * Stored on the contact as `category` (MtmCustomerCategory). The product
 * offered A..D only and the list lived in six separate dropdowns, so a pharma
 * tenant that grades its doctors "A, B, C, VIP" (owner, 2026-10-04) could
 * neither store VIP nor find where the list is set. Now the values are named
 * once, here, and WHICH of them a tenant uses is its MTM setting
 * `contactClasses` — edited under «Карточка клиента» in MTM settings.
 *
 * Two orders, on purpose:
 *   - the order a person reads the list in (A, B, C, D, VIP — as the tenant
 *     wrote it);
 *   - the order of importance (VIP, A, B, C, D), which is what "this class and
 *     the ones below it" means for route candidates.
 */
export const MTM_CONTACT_CLASS_VALUES = ["A", "B", "C", "D", "VIP"] as const
export type MtmContactClass = typeof MTM_CONTACT_CLASS_VALUES[number]

/** What every tenant had before the setting existed — unchanged for them. */
export const MTM_CONTACT_CLASS_DEFAULTS: readonly MtmContactClass[] = ["A", "B", "C", "D"]

/** Most important first. */
export const MTM_CONTACT_CLASS_PRIORITY: readonly MtmContactClass[] = ["VIP", "A", "B", "C", "D"]

const KNOWN = new Set<string>(MTM_CONTACT_CLASS_VALUES)

export function isMtmContactClass(value: unknown): value is MtmContactClass {
  return typeof value === "string" && KNOWN.has(value)
}

/**
 * The tenant's list as stored: known classes only, in reading order, never
 * empty — a card with no class to choose from would make the field unusable.
 */
export function coerceMtmContactClasses(raw: unknown): MtmContactClass[] {
  const chosen = new Set(Array.isArray(raw) ? raw.filter(isMtmContactClass) : [])
  const classes = MTM_CONTACT_CLASS_VALUES.filter((value) => chosen.has(value))
  return classes.length > 0 ? classes : [...MTM_CONTACT_CLASS_DEFAULTS]
}

/** Strict form for the settings API: a typo is a 400, not a silently shorter list. */
export function parseMtmContactClasses(
  raw: unknown,
): { success: true; data: MtmContactClass[] } | { success: false; error: string } {
  if (!Array.isArray(raw)) return { success: false, error: "Client classes must be a list" }
  if (!raw.every(isMtmContactClass)) {
    return { success: false, error: `Client classes may only contain ${MTM_CONTACT_CLASS_VALUES.join(", ")}` }
  }
  if (raw.length === 0) return { success: false, error: "At least one client class must stay enabled" }
  return { success: true, data: coerceMtmContactClasses(raw) }
}

/**
 * What a dropdown offers for one client: the tenant's classes, plus the class
 * this client already has when the tenant no longer offers it. Without that a
 * doctor graded "D" before the tenant switched to "A, B, C, VIP" would open
 * with an empty field and lose the grade on the next save.
 */
export function contactClassOptions(enabled: unknown, current?: string | null): MtmContactClass[] {
  const classes = coerceMtmContactClasses(enabled)
  if (isMtmContactClass(current) && !classes.includes(current)) {
    return MTM_CONTACT_CLASS_VALUES.filter((value) => value === current || classes.includes(value))
  }
  return classes
}
