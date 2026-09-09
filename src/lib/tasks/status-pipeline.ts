/**
 * Maps a task status to its pipeline "bucket" — the stage key it highlights in
 * the task-detail status pipeline.
 *
 * Equivalences: `pending` ≡ `todo`, `completed` → `done`. `cancelled` stays its
 * OWN bucket: the legacy 4-stage pipeline lists `completed` AND `cancelled` as
 * distinct segments, so collapsing `cancelled` into `done` would light up both
 * (a real regression). Every other status maps to itself.
 *
 * Property (verified in status-pipeline.test.ts): for the legacy stage set
 * [pending, in_progress, completed, cancelled], every status buckets to exactly
 * one stage — so exactly one segment is ever "current".
 */
export function pipeStatusBucket(k: string): string {
  return k === "pending" ? "todo" : k === "completed" ? "done" : k
}
