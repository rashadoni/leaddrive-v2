/**
 * Close-with-outcome disposition (Whelp-style). v1 uses a fixed set with i18n
 * labels; per-tenant configurable outcomes would later live on ChannelConfig or
 * an org settings row and be validated against that list instead of this const.
 */
export const CLOSE_OUTCOMES = ["won", "lost", "none"] as const

export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number]

/**
 * Normalize an untrusted outcome value: empty/undefined → null (unclassified),
 * a known outcome → itself, anything else → throws so the route returns 400.
 * `none` is stored as an explicit value (operator chose "no outcome"), distinct
 * from null (never picked) — analytics keeps them separate.
 */
export function normalizeCloseOutcome(value: unknown): CloseOutcome | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "string" && (CLOSE_OUTCOMES as readonly string[]).includes(value)) {
    return value as CloseOutcome
  }
  throw new Error("Invalid close outcome")
}
