"use client"

import type { VoiceReceiptField } from "@/lib/ai/voice/receipt-store"

/**
 * Receipt body: the normalized fields, and for an update the before/after
 * (roadmap U1.4, U1.5).
 *
 * Two rules the roadmap states and this file enforces.
 *
 * 1. The user reviews what will actually be written. So values are rendered
 *    from the server's normalized payload, never re-derived from what the
 *    assistant said, and a field the payload does not carry is simply absent
 *    rather than shown as empty.
 * 2. Concurrency and plumbing fields are not part of that review.
 *    `expectedUpdatedAt` is the optimistic-lock token the client must send
 *    back; showing it as "Expected updated at: 2026-09-20T…" invites the user
 *    to reason about a value that is not theirs and is not an edit.
 */

/** Fields that exist for the server's sake, not the reader's. */
const HIDDEN_FIELD_KEYS = new Set(["expectedUpdatedAt"])

export function visibleReceiptFields(
  fields: readonly VoiceReceiptField[],
): readonly VoiceReceiptField[] {
  return fields.filter((field) => !HIDDEN_FIELD_KEYS.has(field.key))
}

/** True when an update actually changes this field. */
export function fieldChanged(field: VoiceReceiptField): boolean {
  if (!Object.prototype.hasOwnProperty.call(field, "before")) return true
  return !Object.is(normalizeForCompare(field.before), normalizeForCompare(field.after))
}

function normalizeForCompare(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null
  return typeof value === "object" ? JSON.stringify(value) : value
}

export type ReceiptValueFormatter = Readonly<{
  empty: string
  yes: string
  no: string
  formatDate: (iso: string) => string
  /**
   * Localized name for a closed-vocabulary value, or null when the field has
   * no vocabulary. Reading "qualified" aloud to an Azerbaijani user is not a
   * confirmation, it is a password.
   */
  enumLabel: (fieldKey: string, value: string) => string | null
}>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Render one payload value as the user would read it in the CRM.
 *
 * Dates are the reason this is not `String(value)`: the payload carries ISO
 * strings, and "2026-09-30T00:00:00.000Z" in a confirmation line is the kind
 * of detail people skim past — which is exactly what a confirmation must not
 * let them do.
 */
export function formatReceiptValue(
  value: unknown,
  format: ReceiptValueFormatter,
  fieldKey = "",
): string {
  if (value === null || value === undefined || value === "") return format.empty
  if (typeof value === "boolean") return value ? format.yes : format.no
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatReceiptValue(item, format, fieldKey))
      .filter((part) => part !== format.empty)
    return parts.length > 0 ? parts.join(", ") : format.empty
  }
  if (typeof value === "string") {
    return format.enumLabel(fieldKey, value)
      ?? (ISO_DATE.test(value) ? format.formatDate(value) : value)
  }
  return JSON.stringify(value)
}

export function VoiceReceiptFieldList({
  fields,
  isUpdate,
  label,
  format,
}: {
  fields: readonly VoiceReceiptField[]
  isUpdate: boolean
  /** Localized field name; falls back to the payload key when untranslated. */
  label: (field: VoiceReceiptField) => string
  format: ReceiptValueFormatter
}) {
  const visible = visibleReceiptFields(fields)
  if (visible.length === 0) return null

  return (
    <dl data-testid="voice-receipt-fields" className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      {visible.map((field) => {
        const changed = fieldChanged(field)
        const hasBefore = isUpdate && Object.prototype.hasOwnProperty.call(field, "before")
        return (
          <div key={field.key} className="contents" data-field={field.key} data-changed={String(changed)}>
            <dt className="truncate text-muted-foreground">{label(field)}</dt>
            <dd data-sentry-mask className="min-w-0 break-words font-medium">
              {hasBefore && changed && (
                <>
                  <span data-testid={`voice-receipt-before-${field.key}`} className="text-muted-foreground line-through decoration-muted-foreground/60">
                    {formatReceiptValue(field.before, format, field.key)}
                  </span>
                  <span aria-hidden="true" className="px-1 text-muted-foreground">→</span>
                </>
              )}
              <span data-testid={`voice-receipt-after-${field.key}`}>
                {formatReceiptValue(field.after, format, field.key)}
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/**
 * What the user typed, per field. A string is what a text input gives back;
 * `null` means the field was cleared.
 */
export type ReceiptEdits = Readonly<Record<string, string | number | boolean | null>>

/**
 * Rebuild the whole payload for a PATCH, because the endpoint replaces rather
 * than merges.
 *
 * Built from EVERY preview field, not just the visible ones, so that hiding a
 * field from the reader stays a presentation choice and can never drop it from
 * the payload. Only the values come from the edits.
 *
 * `expectedUpdatedAt` is not among them: no action previews it, because
 * `bindTarget` re-derives that token from the live record on every draft
 * write. That is what makes an edit revalidate against the record as it is
 * now, rather than as it was when the draft was first prepared.
 *
 * A cleared field is omitted rather than sent as null or "". Omission means
 * "do not set this", which is correct for a create — several create schemas
 * reject null outright — and means "do not change this" for an update. Clearing
 * a saved value is a separate gesture this form does not offer, rather than one
 * it half-implements.
 *
 * Rebuilding from the preview is lossless because the registry previews every
 * field a voice caller may send, except the server-derived `expectedUpdatedAt`;
 * `voice-receipt-edit.test.ts` pins exactly that.
 */
export function buildEditedReceiptPayload(
  fields: readonly VoiceReceiptField[],
  edits: ReceiptEdits,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    const edited = Object.prototype.hasOwnProperty.call(edits, field.key)
    const value = edited ? edits[field.key] : field.after
    if (value === null || value === undefined) continue
    if (typeof value === "string" && value.trim() === "") continue
    payload[field.key] = typeof value === "string" && typeof field.after === "number"
      ? Number(value)
      : value
  }
  return payload
}

/** The value a text input should start from. */
export function editableFieldValue(field: VoiceReceiptField): string | boolean {
  if (typeof field.after === "boolean") return field.after
  if (field.after === null || field.after === undefined) return ""
  if (typeof field.after === "number") return String(field.after)
  if (typeof field.after === "string") return field.after
  return JSON.stringify(field.after)
}

export function VoiceReceiptFieldForm({
  fields,
  edits,
  onChange,
  label,
}: {
  fields: readonly VoiceReceiptField[]
  edits: ReceiptEdits
  onChange: (key: string, value: string | boolean) => void
  label: (field: VoiceReceiptField) => string
}) {
  const visible = visibleReceiptFields(fields)
  if (visible.length === 0) return null

  return (
    <div data-testid="voice-receipt-form" className="space-y-2">
      {visible.map((field) => {
        const current = Object.prototype.hasOwnProperty.call(edits, field.key)
          ? edits[field.key]
          : editableFieldValue(field)
        const isBoolean = typeof editableFieldValue(field) === "boolean"
        const inputId = `voice-receipt-field-${field.key}`
        return (
          <div key={field.key} className="flex items-center gap-2">
            <label htmlFor={inputId} className="w-28 shrink-0 truncate text-muted-foreground">
              {label(field)}
            </label>
            {isBoolean
              ? (
                <input
                  id={inputId}
                  type="checkbox"
                  data-testid={`voice-receipt-input-${field.key}`}
                  checked={current === true}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                  className="h-5 w-5 rounded border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              )
              : (
                <input
                  id={inputId}
                  type="text"
                  data-sentry-mask
                  data-testid={`voice-receipt-input-${field.key}`}
                  value={typeof current === "string" ? current : String(current ?? "")}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              )}
          </div>
        )
      })}
    </div>
  )
}
