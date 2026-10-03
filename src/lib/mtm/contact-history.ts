/**
 * The client card's change log, in words.
 *
 * The log rendered the audit row as stored: «CONTACT_CREATE» as the title and
 * «Saida Qojayeva · contact_create» under it (owner, 2026-10-04: "what is this
 * missing translation"). Those are codes for queries and integrations, not
 * text for a person — and a change made by an office user who has no employee
 * card was signed «Система», because only `agent` was looked at.
 *
 * This names every action the card's history query can return, and reads out
 * of an update WHAT changed. Anything unknown falls back to a neutral label
 * instead of leaking the code again.
 */

/** Every action the history query returns (contacts/[id]/route.ts). */
export const CONTACT_HISTORY_ACTIONS = [
  "CONTACT_CREATE",
  "CONTACT_UPDATE",
  "CONTACT_DELETE",
  "CONTACT_CHANGE_REQUEST_SUBMIT",
  "CONTACT_CHANGE_REQUEST_DECISION",
  "CONTACT_DICTIONARY_ASSIGNMENTS_UPDATE",
  "CONTACT_WORKPLACE_CREATE",
  "CONTACT_WORKPLACE_UPDATE",
  "CONTACT_WORKPLACE_END",
  "DOCTOR_ASSESSMENT_CREATE",
  "DOCTOR_ASSESSMENT_VERIFIED",
  "DOCTOR_ASSESSMENT_REJECTED",
  "BRAND_POTENTIAL_CREATE",
  "BRAND_POTENTIAL_VERIFIED",
  "BRAND_POTENTIAL_REJECTED",
  "BRAND_POTENTIAL_END",
  "FIELD_POTENTIAL_CREATE",
  "FIELD_POTENTIAL_UPDATE",
  "FIELD_POTENTIAL_DELETE",
] as const

export type ContactHistoryActionKey = typeof CONTACT_HISTORY_ACTIONS[number] | "OTHER"

const KNOWN_ACTIONS = new Set<string>(CONTACT_HISTORY_ACTIONS)

/** The message key under `mtmContactDetail.historyActions`. */
export function contactHistoryActionKey(action: string): ContactHistoryActionKey {
  return KNOWN_ACTIONS.has(action) ? (action as ContactHistoryActionKey) : "OTHER"
}

/**
 * Card fields the log can name. `values: true` — the stored value is already
 * what a person reads (a letter, a name, a phone), so the change is shown as
 * «B → VIP». The rest hold codes (ACTIVE, DOCTOR…); for those the log names the
 * field only, rather than print a code where a word is expected.
 */
export const CONTACT_HISTORY_FIELDS = {
  category: { values: true },
  lastName: { values: true },
  firstName: { values: true },
  middleName: { values: true },
  specialtyName: { values: true },
  externalCode: { values: true },
  phone: { values: true },
  mobilePhone: { values: true },
  workPhone: { values: true },
  email: { values: true },
  qualificationCategory: { values: true },
  addressStreet: { values: true },
  notes: { values: false },
  status: { values: false },
  type: { values: false },
  verificationStatus: { values: false },
} as const satisfies Record<string, { values: boolean }>

export type ContactHistoryField = keyof typeof CONTACT_HISTORY_FIELDS

export interface ContactHistoryChange {
  field: ContactHistoryField
  /** Null when the field holds codes, or had no value before. */
  from: string | null
  to: string | null
}

const text = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number") return String(value)
  return null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * What an update changed, from the audit row: `newData` is the patch,
 * `oldData` the card before it. A field written with the value it already had
 * is not a change. Other actions have nothing to list.
 */
export function contactHistoryChanges(event: { action: string; oldData?: unknown; newData?: unknown }): ContactHistoryChange[] {
  if (event.action !== "CONTACT_UPDATE") return []
  const before = record(event.oldData)
  const patch = record(event.newData)
  const changes: ContactHistoryChange[] = []
  for (const field of Object.keys(CONTACT_HISTORY_FIELDS) as ContactHistoryField[]) {
    if (!(field in patch)) continue
    const from = text(before[field])
    const to = text(patch[field])
    if (from === to) continue
    const shown = CONTACT_HISTORY_FIELDS[field].values
    changes.push({ field, from: shown ? from : null, to: shown ? to : null })
  }
  return changes
}
