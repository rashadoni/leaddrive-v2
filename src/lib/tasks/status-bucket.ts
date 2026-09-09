import { STATUS_TO_STAGE } from "./board-columns"

/**
 * Pure status-bucketing helpers — NO server-only imports.
 * Safe to import from both client components AND server code.
 * Extracted from list-query.ts to break the
 *   report/page.tsx → report-aggregate → list-query → prisma
 * bundling chain that caused PrismaClient-in-browser errors.
 */

export type StatusBucket = "planned" | "ongoing" | "completed" | "cancelled"

const BUCKET_LABEL: Record<StatusBucket, string> = {
  planned: "Planned",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
}

/**
 * Fold a task status into the client's operational buckets:
 * planned (backlog/todo/pending) · ongoing (in_progress/testing/review) ·
 * completed (done) · cancelled (its own bucket — NOT folded into completed).
 */
export function statusBucket(status: string): StatusBucket {
  if (status === "cancelled") return "cancelled"
  const stage = STATUS_TO_STAGE[status] ?? "backlog"
  if (stage === "done") return "completed"
  if (stage === "in_progress" || stage === "testing" || stage === "review") return "ongoing"
  return "planned"
}

export function statusBucketLabel(status: string): string {
  return BUCKET_LABEL[statusBucket(status)]
}
