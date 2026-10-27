/**
 * Which calls the incoming-call popup shows: these statuses, started within the
 * last five minutes. Shared by GET /api/v1/calls/active and the shell event
 * watcher, so the watcher announces exactly the changes the popup would see.
 */
export const ACTIVE_CALL_STATUSES = ["ringing", "answering", "in-progress", "initiated"]

// Provider delivery may be delayed or replayed. Use the provider's observed
// start, not the database insertion time, so a spooled old ringing event cannot
// appear as a live call.
export const ACTIVE_CALL_MAX_AGE_MS = 5 * 60 * 1000
