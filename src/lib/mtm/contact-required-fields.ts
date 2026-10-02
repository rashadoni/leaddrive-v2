import { coerceMtmContactHiddenFields } from "@/lib/mtm/contact-field-visibility"

export const MTM_CONTACT_REQUIRED_FIELD_KEYS = [
  "firstName",
  "lastName",
  "middleName",
  "externalCode",
  "birthDate",
  "gender",
  "specialtyName",
  "qualificationCategory",
  "profile",
  "email",
  "phone",
  "mobilePhone",
  "workPhone",
  "messengerPhone",
  "postalCode",
  "addressRegion",
  "addressLocality",
  "addressDistrict",
  "addressStreet",
  "productCategory",
] as const

export type MtmContactRequiredField = typeof MTM_CONTACT_REQUIRED_FIELD_KEYS[number]

export const MTM_CONTACT_REQUIRED_FIELD_DEFAULTS: readonly MtmContactRequiredField[] = [
  "firstName",
  "lastName",
]

const REQUIRED_FIELD_SET = new Set<string>(MTM_CONTACT_REQUIRED_FIELD_KEYS)

export function coerceMtmContactRequiredFields(value: unknown): MtmContactRequiredField[] {
  const configured = Array.isArray(value)
    ? value.filter((field): field is MtmContactRequiredField => typeof field === "string" && REQUIRED_FIELD_SET.has(field))
    : []

  return [...new Set<MtmContactRequiredField>([
    ...MTM_CONTACT_REQUIRED_FIELD_DEFAULTS,
    ...configured,
  ])]
}

function hasRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return true
}

/**
 * What must be filled: the configured fields, minus the ones the tenant has
 * switched off. A field nobody can see cannot be demanded — hiding wins, so a
 * list saved with both never locks every card.
 */
export function effectiveMtmContactRequiredFields(
  configuredFields: unknown,
  hiddenFields?: unknown,
): MtmContactRequiredField[] {
  const hidden = new Set<string>(coerceMtmContactHiddenFields(hiddenFields))
  return coerceMtmContactRequiredFields(configuredFields).filter((field) => !hidden.has(field))
}

export function missingMtmContactRequiredFields(
  contact: Record<string, unknown>,
  configuredFields: unknown,
  hiddenFields?: unknown,
): MtmContactRequiredField[] {
  return effectiveMtmContactRequiredFields(configuredFields, hiddenFields)
    .filter((field) => !hasRequiredValue(contact[field]))
}

export function mergedMtmContactState(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...patch }
}
