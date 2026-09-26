import type { Prisma } from "@prisma/client"

/**
 * «Awaiting review»: a completed task the manager has neither accepted nor
 * returned.
 *
 * Tasks audit 2026-09-24: the server knew each task's review state, but only
 * the task card showed it — in the list all 1 152 completed tasks wore the
 * same green «Completed», and one finished on 10 August still offered its
 * review panel six weeks later. Owner decision 2026-09-25: as usual when a
 * review step is introduced, everything completed before it counts as
 * accepted (nobody reviewed then); from the start date on, every completed
 * task waits until it is accepted or returned. No auto-accept: the number
 * stays until someone deals with it.
 *
 * A return moves the task back to IN_PROGRESS, so a COMPLETED task with no
 * review event since the start date is exactly one waiting for review.
 */
export const MTM_TASK_REVIEW_SINCE = new Date("2026-09-25T00:00:00.000Z")

export function mtmAwaitingReviewTaskWhere(): Prisma.MtmTaskWhereInput {
  return {
    status: "COMPLETED",
    completedAt: { gte: MTM_TASK_REVIEW_SINCE },
    events: {
      none: {
        type: "EDITED",
        occurredAt: { gte: MTM_TASK_REVIEW_SINCE },
        evidence: { path: ["kind"], equals: "MTM_TASK_REVIEW" },
      },
    },
  }
}
