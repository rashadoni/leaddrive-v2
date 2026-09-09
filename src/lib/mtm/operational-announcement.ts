export type OperationalLocale = "en" | "ru" | "az"

export type OperationalAnnouncementMetadata = {
  keyMessage: true
  messageId: string
  threadId: string
  effectiveFrom: string
  effectiveUntil: string
  fallbackBody: string
  localizations: Partial<Record<OperationalLocale, string>>
}

const localePattern = /^(en|ru|az)(?:[-_]|$)/i

export function operationalLocale(value: string | null | undefined): OperationalLocale {
  const match = value?.match(localePattern)?.[1]?.toLowerCase()
  return match === "ru" || match === "az" ? match : "en"
}

export function sanitizeOperationalText(value: string, maxLength = 4000): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength)
}

export function parseOperationalAnnouncementMetadata(value: unknown): OperationalAnnouncementMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    record.keyMessage !== true
    || typeof record.messageId !== "string"
    || typeof record.threadId !== "string"
    || typeof record.effectiveFrom !== "string"
    || typeof record.effectiveUntil !== "string"
  ) return null
  const from = new Date(record.effectiveFrom)
  const until = new Date(record.effectiveUntil)
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) return null
  const rawLocalizations = record.localizations
  const fallbackBody = typeof record.fallbackBody === "string"
    ? sanitizeOperationalText(record.fallbackBody)
    : ""
  const localizations: Partial<Record<OperationalLocale, string>> = {}
  if (rawLocalizations && typeof rawLocalizations === "object" && !Array.isArray(rawLocalizations)) {
    for (const locale of ["en", "ru", "az"] as const) {
      const text = (rawLocalizations as Record<string, unknown>)[locale]
      if (typeof text === "string" && sanitizeOperationalText(text)) {
        localizations[locale] = sanitizeOperationalText(text)
      }
    }
  }
  return {
    keyMessage: true,
    messageId: record.messageId,
    threadId: record.threadId,
    effectiveFrom: from.toISOString(),
    effectiveUntil: until.toISOString(),
    fallbackBody,
    localizations,
  }
}

export function isOperationalAnnouncementActive(
  metadata: OperationalAnnouncementMetadata,
  now = new Date(),
): boolean {
  return new Date(metadata.effectiveFrom) <= now && now < new Date(metadata.effectiveUntil)
}

export function localizedOperationalText(
  metadata: OperationalAnnouncementMetadata,
  fallback: string,
  locale: OperationalLocale,
): string {
  return metadata.localizations[locale]
    || metadata.localizations.en
    || metadata.localizations.ru
    || metadata.localizations.az
    || metadata.fallbackBody
    || sanitizeOperationalText(fallback)
}
