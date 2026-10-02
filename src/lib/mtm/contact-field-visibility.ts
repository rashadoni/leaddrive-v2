/**
 * Which client fields a tenant has switched off (MTM setting
 * `contactHiddenFields`).
 *
 * Owner 2026-10-02: «в настройках сделай так, чтобы завтра, если буду
 * продавать другому профилю, была возможность отключать ненужные поля — не
 * все мои клиенты будут работать с врачами». A hidden field leaves the client
 * form, the card, the list and the filter. Nothing is deleted: the value stays
 * on the contact and comes back when the field is switched on again.
 *
 * First and last name are not here — a client without a name is not a client.
 */
export const MTM_CONTACT_SWITCHABLE_FIELD_KEYS = [
  "middleName",
  "externalCode",
  "birthDate",
  "gender",
  "specialtyName",
  "specialtyCode",
  "qualificationCategory",
  "profile",
  "productCategory",
  // Not a column: the doctor-coverage figure in the list and its month filter.
  "coverage",
  "email",
  "phone",
  "mobilePhone",
  "workPhone",
  "homePhone",
  "messengerPhone",
  "viberPhone",
  "whatsappPhone",
  "telegramPhone",
  "postalCode",
  "addressRegion",
  "addressLocality",
  "addressDistrict",
  "addressStreet",
] as const

export type MtmContactSwitchableField = typeof MTM_CONTACT_SWITCHABLE_FIELD_KEYS[number]

/** Nothing is hidden until the tenant says so: existing tenants see no change. */
export const MTM_CONTACT_HIDDEN_FIELD_DEFAULTS: readonly MtmContactSwitchableField[] = []

const SWITCHABLE = new Set<string>(MTM_CONTACT_SWITCHABLE_FIELD_KEYS)

export function isMtmContactSwitchableField(value: unknown): value is MtmContactSwitchableField {
  return typeof value === "string" && SWITCHABLE.has(value)
}

/** Known keys only, each once, in the canonical order. */
export function coerceMtmContactHiddenFields(value: unknown): MtmContactSwitchableField[] {
  if (!Array.isArray(value)) return []
  const hidden = new Set(value.filter(isMtmContactSwitchableField))
  return MTM_CONTACT_SWITCHABLE_FIELD_KEYS.filter((field) => hidden.has(field))
}

/** `shows("specialtyName")` — false only for a field the tenant switched off. */
export function contactFieldVisibility(hidden: unknown): (field: MtmContactSwitchableField) => boolean {
  const off = new Set(coerceMtmContactHiddenFields(hidden))
  return (field) => !off.has(field)
}
