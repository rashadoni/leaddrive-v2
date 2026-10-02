/**
 * The tenant's list of client specialties (MTM setting `contactSpecialties`).
 *
 * Owner 2026-10-02: the list a medical representative picks from when adding a
 * doctor, and the list the «Клиенты» filter offers. It is tenant configuration
 * — add and remove in MTM settings — because not every tenant visits doctors.
 * A specialty is stored on the contact as plain text (`specialtyName`), so
 * removing one from the list never rewrites a contact that already has it.
 */
export const MTM_CONTACT_SPECIALTY_MAX_LENGTH = 80
export const MTM_CONTACT_SPECIALTY_MAX_COUNT = 300

/** The list the owner supplied; a tenant starts with it and edits from there. */
export const MTM_CONTACT_SPECIALTY_DEFAULTS: readonly string[] = [
  "Ginekoloq",
  "Qastroenteroloq",
  "Proktoloq",
  "Endokrinoloq",
  "Terapevt",
  "Pediatr",
  "Lor",
  "Pulmanoloq",
  "Allerqoloq",
  "İnfeksionist",
  "Dermatoveneroloq",
  "Kosmetoloq",
  "Fitizatr",
  "Nevropatoloq",
  "Uroloq",
  "Nefroloq",
  "Kardioloq",
  "Oftalmoloq",
  "Hematoloq",
  "Reanimatoloq",
  "Psixoloq",
  "Narkoloq",
  "Stomatoloq",
  "Neonatoloq",
  "Cərrah ümumi",
  "Cərrah proktoloq",
  "Cərrah estetik",
  "Cərrah damar",
  "Cərrah kardioloq",
  "Neyrocərrah",
  "Revmatoloq",
  "Endoskopist",
  "Travmotoloq",
  "Fizioterapevt",
]

/**
 * Two spellings are one specialty when they differ only in case or spacing.
 * All four Azerbaijani/Turkish i's fold to one: «İnfeksionist», «infeksionist»
 * and «INFEKSIONIST» must meet whatever keyboard typed them (plain
 * lowercasing leaves İ as i + a combining dot, and ı as itself).
 */
export function contactSpecialtyKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase().replace(/̇/g, "").replace(/ı/g, "i")
}

function cleanSpecialty(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

/**
 * Trimmed, de-duplicated, in the order given. An empty list is a real answer
 * («we keep no specialties») and stays empty; only a value that is not a list
 * at all falls back to the defaults.
 */
export function coerceMtmContactSpecialties(value: unknown): string[] {
  if (!Array.isArray(value)) return [...MTM_CONTACT_SPECIALTY_DEFAULTS]
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const name = cleanSpecialty(entry).slice(0, MTM_CONTACT_SPECIALTY_MAX_LENGTH)
    if (!name) continue
    const key = contactSpecialtyKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
    if (result.length >= MTM_CONTACT_SPECIALTY_MAX_COUNT) break
  }
  return result
}

export type MtmContactSpecialtiesParse =
  | { success: true; data: string[] }
  | { success: false; error: string }

/** Strict form for the settings PUT: a bad list is refused, not trimmed. */
export function parseMtmContactSpecialties(value: unknown): MtmContactSpecialtiesParse {
  if (!Array.isArray(value)) return { success: false, error: "Specialties must be a list" }
  if (value.length > MTM_CONTACT_SPECIALTY_MAX_COUNT) {
    return { success: false, error: `At most ${MTM_CONTACT_SPECIALTY_MAX_COUNT} specialties` }
  }
  for (const entry of value) {
    if (typeof entry !== "string") return { success: false, error: "A specialty must be text" }
    if (cleanSpecialty(entry).length > MTM_CONTACT_SPECIALTY_MAX_LENGTH) {
      return { success: false, error: `A specialty is at most ${MTM_CONTACT_SPECIALTY_MAX_LENGTH} characters` }
    }
  }
  return { success: true, data: coerceMtmContactSpecialties(value) }
}

/**
 * Splits what a person pasted or typed into separate specialties: one per line,
 * or separated by commas / semicolons — a column copied out of Excel works.
 */
export function splitContactSpecialtyInput(value: string): string[] {
  return value.split(/[\n\r,;]+/).map(cleanSpecialty).filter(Boolean)
}

/**
 * What a filter or a form offers: the configured list first, in its order,
 * then every specialty that contacts already carry but the list does not (old
 * records, an import, a specialty since removed) — alphabetically. Without the
 * second part a removed specialty would become impossible to filter by while
 * contacts still have it.
 */
export function contactSpecialtyOptions(
  configured: readonly string[],
  inUse: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of configured) {
    const key = contactSpecialtyKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(name.trim())
  }
  const extra: string[] = []
  for (const raw of inUse) {
    const name = cleanSpecialty(raw)
    const key = contactSpecialtyKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    extra.push(name)
  }
  extra.sort((left, right) => left.localeCompare(right, "az", { sensitivity: "base" }))
  return [...result, ...extra]
}
