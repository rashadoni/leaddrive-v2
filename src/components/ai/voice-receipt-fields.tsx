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
export function formatReceiptValue(value: unknown, format: ReceiptValueFormatter): string {
  if (value === null || value === undefined || value === "") return format.empty
  if (typeof value === "boolean") return value ? format.yes : format.no
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    const parts = value.map((item) => formatReceiptValue(item, format)).filter((p) => p !== format.empty)
    return parts.length > 0 ? parts.join(", ") : format.empty
  }
  if (typeof value === "string") {
    return ISO_DATE.test(value) ? format.formatDate(value) : value
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
                    {formatReceiptValue(field.before, format)}
                  </span>
                  <span aria-hidden="true" className="px-1 text-muted-foreground">→</span>
                </>
              )}
              <span data-testid={`voice-receipt-after-${field.key}`}>
                {formatReceiptValue(field.after, format)}
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
