/**
 * Which calls the incoming-call popup shows: these statuses, in this window.
 * Shared by GET /api/v1/calls/active and the shell event watcher, so the
 * watcher announces exactly the changes the popup would see.
 */
export const ACTIVE_CALL_STATUSES = ["ringing", "answering", "in-progress", "initiated"]

export const ACTIVE_CALL_MAX_AGE_MS = 5 * 60 * 1000

/**
 * Provider delivery may be delayed or replayed. Use the provider's observed
 * start, not the database insertion time, so a spooled old ringing event cannot
 * appear as a live call. A call the AI handed to a person rings from the
 * handoff, however long the AI talked.
 */
export function activeCallWindow(now: number) {
  const since = new Date(now - ACTIVE_CALL_MAX_AGE_MS)
  return { OR: [{ startedAt: { gte: since } }, { handoffRequestedAt: { gte: since } }] }
}
