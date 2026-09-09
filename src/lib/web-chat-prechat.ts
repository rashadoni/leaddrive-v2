/**
 * Pre-chat form configuration for the web chat widget (competitor-parity with
 * Whelp's "Profile bot"): per-field enable + required flags for name/email/phone.
 *
 * Stored as WebChatWidget.preChatForm (JSONB, nullable). NULL / garbage parses
 * to DEFAULT_PRECHAT_FORM = the exact legacy behavior (all three fields shown,
 * none required), so existing widgets change nothing until an admin edits the
 * settings card.
 */

export type PreChatFieldKey = "name" | "email" | "phone"

export type PreChatField = { enabled: boolean; required: boolean }

export type PreChatForm = Record<PreChatFieldKey, PreChatField>

export const PRECHAT_FIELD_KEYS: PreChatFieldKey[] = ["name", "email", "phone"]

export const DEFAULT_PRECHAT_FORM: PreChatForm = {
  name: { enabled: true, required: false },
  email: { enabled: true, required: false },
  phone: { enabled: true, required: false },
}

function parseField(raw: unknown, fallback: PreChatField): PreChatField {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback }
  const record = raw as Record<string, unknown>
  const required = record.required === true
  // required implies enabled — a required-but-hidden field would deadlock the form.
  const enabled = required || record.enabled !== false
  return { enabled, required }
}

export function parsePreChatForm(raw: unknown): PreChatForm {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { name: { ...DEFAULT_PRECHAT_FORM.name }, email: { ...DEFAULT_PRECHAT_FORM.email }, phone: { ...DEFAULT_PRECHAT_FORM.phone } }
  }
  const record = raw as Record<string, unknown>
  return {
    name: parseField(record.name, DEFAULT_PRECHAT_FORM.name),
    email: parseField(record.email, DEFAULT_PRECHAT_FORM.email),
    phone: parseField(record.phone, DEFAULT_PRECHAT_FORM.phone),
  }
}

export type PreChatSubmission = {
  visitorName?: string | null
  visitorEmail?: string | null
  visitorPhone?: string | null
}

export type PreChatValidation =
  | { ok: true; values: { visitorName: string | null; visitorEmail: string | null; visitorPhone: string | null } }
  | { ok: false; missing: PreChatFieldKey[] }

/**
 * Server-side enforcement: required fields must be non-empty; values of
 * DISABLED fields are stripped (never store data the org turned off).
 */
export function validatePreChatSubmission(form: PreChatForm, submission: PreChatSubmission): PreChatValidation {
  const values = {
    visitorName: form.name.enabled ? submission.visitorName?.trim() || null : null,
    visitorEmail: form.email.enabled ? submission.visitorEmail?.trim() || null : null,
    visitorPhone: form.phone.enabled ? submission.visitorPhone?.trim() || null : null,
  }
  const missing: PreChatFieldKey[] = []
  if (form.name.required && !values.visitorName) missing.push("name")
  if (form.email.required && !values.visitorEmail) missing.push("email")
  if (form.phone.required && !values.visitorPhone) missing.push("phone")
  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, values }
}
