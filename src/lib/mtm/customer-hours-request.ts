/**
 * «Часы не те?» (owner, 2026-11-02, mockup «MTM: часы приёма клиентов»,
 * approved with «Давай, делай»): an agent who comes to a place and finds its
 * «часы приёма» wrong — another sign on the door, a lunch nobody wrote —
 * proposes the real ones from the spot.
 *
 * The agent never changes a place himself (owner, 2026-10-02): what he sends is
 * a question, and a manager accepts the new hours or leaves the old ones, as
 * with «Клиент здесь» (customer-location-request.ts). One question about a
 * place waits at a time; the database holds that.
 *
 * Pure: the routes read and write, this decides what is said.
 */
import { readWorkingHours, sameWorkingHours, type MtmWorkingHours } from "@/lib/mtm/customer-hours"

export const HOURS_REQUEST_COMMENT_MAX = 300
/** How long the answer to a request stays on the place's card in the field app. */
export const HOURS_REQUEST_ANSWER_SHOWN_DAYS = 7

export const MTM_HOURS_REQUEST_PENDING = "MTM_HOURS_REQUEST_PENDING"
export const MTM_HOURS_REQUEST_NOT_FOUND = "MTM_HOURS_REQUEST_NOT_FOUND"
export const MTM_HOURS_REQUEST_IDEMPOTENCY_MISMATCH = "MTM_HOURS_REQUEST_IDEMPOTENCY_MISMATCH"
export const MTM_HOURS_REQUEST_UNCHANGED = "MTM_HOURS_REQUEST_UNCHANGED"
export const MTM_HOURS_REQUEST_INVALID = "MTM_HOURS_REQUEST_INVALID"
/** The place's hours changed after the agent asked: accepting now would undo somebody's edit. */
export const MTM_HOURS_REQUEST_CUSTOMER_CHANGED = "MTM_HOURS_REQUEST_CUSTOMER_CHANGED"

/** Whether the proposal says anything new about the place. */
export function hoursRequestChangesSomething(current: unknown, proposed: MtmWorkingHours): boolean {
  return !sameWorkingHours(readWorkingHours(current), proposed)
}

/** Whether the place's hours are still those the agent saw when he asked. */
export function placeHoursUnchangedSince(previous: unknown, current: unknown): boolean {
  return sameWorkingHours(readWorkingHours(previous), readWorkingHours(current))
}

/** What the field app is told about a request: its own, or the one that is waiting about this place. */
export function customerHoursRequestForAgent(
  request: {
    id: string
    status: string
    requestedByAgentId: string
    proposedHours: unknown
    decisionComment: string | null
    submittedAt: Date
    reviewedAt: Date | null
  },
  agentId: string,
) {
  const mine = request.requestedByAgentId === agentId
  return {
    id: request.id,
    status: request.status,
    mine,
    proposedHours: readWorkingHours(request.proposedHours),
    // What a manager wrote is for whoever asked.
    decisionComment: mine ? request.decisionComment : null,
    submittedAt: request.submittedAt.toISOString(),
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
  }
}
