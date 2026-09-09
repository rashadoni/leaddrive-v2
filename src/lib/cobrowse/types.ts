/**
 * T8 Cobrowse — shared types + enums.
 *
 * Mirrors the DB CHECK list in
 * `prisma/migrations/20260529190000_add_t8_cobrowse_sessions/migration.sql`
 * and the lifecycle described inline on `CobrowseSession` in schema.prisma.
 */

/** Lifecycle states. Order is roughly temporal (pending → ended)
 *  but transitions are NOT linear (see `state-machine.ts` for the
 *  allowed transition graph — pause loops back to active, etc.). */
export const COBROWSE_STATUSES = [
  "pending",
  "awaiting_consent",
  "active",
  "paused",
  "ended",
] as const
export type CobrowseStatus = (typeof COBROWSE_STATUSES)[number]

/** End-reason taxonomy. Stored on the row when `status` transitions
 *  to `ended`. Slice-2 telemetry filters analytics by this enum. */
export const COBROWSE_END_REASONS = [
  "agent_ended",
  "customer_left",
  "timeout",
  "error",
] as const
export type CobrowseEndReason = (typeof COBROWSE_END_REASONS)[number]
