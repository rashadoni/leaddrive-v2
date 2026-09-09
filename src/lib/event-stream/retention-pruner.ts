/**
 * G6 retention-pruner — slice-1 pure helper.
 *
 * Computes deletion cutoff for a stream given its retentionSeconds + a
 * reference "now". Slice-2 cron worker reads the cutoff and DELETEs
 * events older than it (subscriptions + delivery rows cascade).
 *
 * Pure function: no DB access, no clock dependency (caller supplies
 * `now` so tests are reproducible).
 */

import type { RetentionPlan } from "./types"

export interface RetentionInput {
  streamId: string
  /** NULL means "retain forever" — pruner skips. */
  retentionSeconds: number | null
  /** Reference time for the cutoff calculation. */
  now: Date
}

/**
 * Build a deletion plan for a single stream.
 *
 *   cutoff = now - retentionSeconds
 *
 * Returns `cutoff: null` if retentionSeconds is null or non-positive
 * (defensive — DB CHECK already excludes the non-positive case but
 * we tolerate it here in case migration order drifts).
 */
export function planRetention(input: RetentionInput): RetentionPlan {
  const { streamId, retentionSeconds, now } = input
  if (retentionSeconds === null || retentionSeconds === undefined) {
    return { streamId, cutoff: null }
  }
  if (
    !Number.isFinite(retentionSeconds) ||
    retentionSeconds <= 0 ||
    !Number.isInteger(retentionSeconds)
  ) {
    return { streamId, cutoff: null }
  }
  const cutoff = new Date(now.getTime() - retentionSeconds * 1000)
  return { streamId, cutoff }
}

/**
 * Batch-plan for many streams. Slice-2 cron worker calls this once per
 * run with the active-streams snapshot.
 *
 * Streams whose plan resolves to `null` are filtered out so the worker
 * only iterates prunable ones.
 */
export function planRetentionBatch(
  streams: ReadonlyArray<Omit<RetentionInput, "now">>,
  now: Date,
): RetentionPlan[] {
  return streams
    .map((s) =>
      planRetention({
        streamId: s.streamId,
        retentionSeconds: s.retentionSeconds,
        now,
      }),
    )
    .filter((plan): plan is RetentionPlan & { cutoff: Date } => plan.cutoff !== null)
}

/**
 * Helper for slice-2: given an event's occurredAt + a stream's cutoff,
 * decide if the event is eligible for deletion.
 */
export function isEventEligibleForDeletion(
  eventOccurredAt: Date,
  cutoff: Date | null,
): boolean {
  if (cutoff === null) return false
  return eventOccurredAt.getTime() < cutoff.getTime()
}
