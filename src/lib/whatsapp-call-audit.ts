const PREFIX = "[WhatsApp Calling]"
const MAX_NOTES_LENGTH = 4_000
const MAX_VALUE_LENGTH = 180

type AuditValue = string | number | boolean | null | undefined

function cleanValue(value: AuditValue): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, " ").trim()
  if (!text) return null
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}...` : text
}

export function formatWhatsAppCallAuditLine(
  event: string,
  details: Record<string, AuditValue> = {},
  at = new Date(),
): string {
  const parts = Object.entries(details)
    .map(([key, value]) => {
      const clean = cleanValue(value)
      return clean ? `${key}=${clean}` : null
    })
    .filter(Boolean)
  return `${PREFIX} ${at.toISOString()} ${event}${parts.length ? ` (${parts.join(", ")})` : ""}`
}

export function appendWhatsAppCallAuditNote(
  existingNotes: string | null | undefined,
  auditLine: string | null | undefined,
): string | undefined {
  const line = cleanValue(auditLine)
  if (!line) return existingNotes ?? undefined

  const existing = typeof existingNotes === "string" ? existingNotes.trim() : ""
  const next = existing ? `${existing}\n${line}` : line
  if (next.length <= MAX_NOTES_LENGTH) return next

  return `[trimmed]\n${next.slice(next.length - MAX_NOTES_LENGTH + 10)}`
}

export function whatsappCallAuditLines(notes: string | null | undefined): string[] {
  if (typeof notes !== "string") return []
  return notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PREFIX))
}
