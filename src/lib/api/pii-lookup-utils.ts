/**
 * Shared utilities for PII-safe POST lookup endpoints.
 *
 * Extracted from the four /lookup routes so that any future fix lands
 * once, not four times (the architect's primary drift concern).
 *
 * Intentionally minimal — only code that is truly identical across all
 * four route files lives here. Entity-specific WHERE shapes, select
 * projections, orderBy, and audit helpers stay in each route file.
 */

export const MAX_PAGE_SIZE = 200

/**
 * Trim and bounds-check a string field from an unknown request body.
 * Returns null when the value is absent, non-string, or whitespace-only.
 */
export function strField(
  v: unknown,
  max: number = 200,
): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

/**
 * Parse a pagination limit from a request body field.
 * Accepts both `number` and numeric-string values.
 * Returns 50 (default) for absent / invalid inputs.
 * Caps at MAX_PAGE_SIZE.
 */
export function parseLimit(v: unknown): number {
  if (v === undefined || v === null) return 50
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isInteger(n) || n <= 0) return 50
  return Math.min(n, MAX_PAGE_SIZE)
}
