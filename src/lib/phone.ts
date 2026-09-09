/**
 * Canonical phone normalization for inbound-message contact resolution.
 *
 * Strips every character except digits and a leading `+`, so formatting variants of the same E.164
 * number collapse to one key:  "+994 50 123-45-67" → "+994501234567",  "(994) 50..." → "99450...".
 *
 * Use this for the inbound SMS contact lookup (A2). NOTE: the inbox GET grouping in
 * `api/v1/inbox/route.ts` deliberately keeps its own variants (some strip the `+` too, for matching
 * stored numbers saved without a country prefix) — those are a different match strategy and are left
 * as-is to avoid changing existing contact-matching behavior. Adopt this helper there only with tests
 * proving the match set is preserved.
 */
export function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^\d+]/g, "")
}
