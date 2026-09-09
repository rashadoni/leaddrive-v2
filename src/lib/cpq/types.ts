/**
 * S6 CPQ — type contracts shared by routes + state machine + tests.
 *
 * Single source of truth for the Quote state taxonomy. The Prisma
 * migration `20260529100000_add_cpq_quote_lineitem` carries a SQL
 * CHECK constraint mirroring `QUOTE_STATUSES` exactly — if one
 * changes, the other MUST be migrated in lock-step.
 */

/** Valid `Quote.status` values. Mirror the SQL CHECK constraint. */
export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
] as const

export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/**
 * Allowed transitions per current state. The state machine is pure;
 * the route layer stamps the corresponding `*At` timestamp + (for
 * `rejected`) encrypts the optional `rejectedReason` via bound-AAD.
 *
 * Lifecycle:
 *   draft → sent (sales rep sends to customer)
 *         → expired (validUntil passed before send — admin housekeeping)
 *   sent → viewed (email open / tracking pixel)
 *        → expired (validUntil passed after send, before view)
 *        → rejected (customer rejects without opening — rare, manual)
 *   viewed → accepted (customer signs)
 *          → rejected (customer declines)
 *          → expired (validUntil passed after view, no decision)
 *
 * Terminal states: `accepted`, `rejected`, `expired`. No transition
 * back to `draft` — to revise, create a new quote with bumped version
 * sharing the same quoteNumber (slice-3 "Revise quote" UX).
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent", "expired"],
  sent: ["viewed", "expired", "rejected"],
  viewed: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
}

export interface TransitionResult {
  ok: boolean
  error?: string
}
