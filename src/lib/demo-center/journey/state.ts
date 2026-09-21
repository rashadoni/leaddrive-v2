/**
 * Journey state machine. Pure: no persistence, no side effects.
 *
 * The map lists forward moves only. EXPIRED and REVOKED are reachable from
 * every non-terminal state and are handled in `canTransition` rather than
 * repeated on each row. Terminal states have no exits — a finished, expired
 * or revoked journey never moves again (a re-issued grant starts a new one).
 */
import type { DemoJourneyState } from "./types"

const CALL_OUTCOMES: readonly DemoJourneyState[] = [
  "CALL_RESULT_RECORDED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
  "CALL_ATTENTION_REQUIRED",
]

export const DEMO_JOURNEY_TRANSITIONS: Readonly<Record<DemoJourneyState, readonly DemoJourneyState[]>> = {
  PREPARED: ["STARTED"],
  STARTED: ["SOURCE_SEEN"],
  SOURCE_SEEN: ["CONVERSATION_OPENED"],
  CONVERSATION_OPENED: ["AI_REPLIED"],
  AI_REPLIED: ["LEAD_CREATED"],
  LEAD_CREATED: ["LEAD_QUALIFIED"],
  // The call exercise is optional by design: disabled grants skip it, the
  // prospect may decline, and a preflight may block it. All three continue.
  LEAD_QUALIFIED: ["CALL_SKIPPED", "CALL_DECLINED", "CALL_QUEUED", "CALL_BLOCKED"],
  CALL_QUEUED: ["CALLING", "CALL_BLOCKED", "CALL_FAILED", "CALL_ATTENTION_REQUIRED"],
  CALLING: CALL_OUTCOMES,
  CALL_SKIPPED: ["TASK_CREATED"],
  CALL_DECLINED: ["TASK_CREATED"],
  CALL_RESULT_RECORDED: ["TASK_CREATED"],
  CALL_NO_ANSWER: ["TASK_CREATED"],
  CALL_BUSY: ["TASK_CREATED"],
  CALL_BLOCKED: ["TASK_CREATED"],
  CALL_FAILED: ["TASK_CREATED"],
  // Unknown provider delivery never redials; the journey continues on the
  // non-call path and the attention flag stays on the attempt record.
  CALL_ATTENTION_REQUIRED: ["TASK_CREATED"],
  TASK_CREATED: ["DEAL_CREATED"],
  DEAL_CREATED: ["DEAL_ADVANCED"],
  DEAL_ADVANCED: ["QUOTE_CREATED"],
  QUOTE_CREATED: ["QUOTE_SENT"],
  QUOTE_SENT: ["QUOTE_ACCEPTED"],
  QUOTE_ACCEPTED: ["CLOSED_WON"],
  CLOSED_WON: ["COMPLETED"],
  COMPLETED: [],
  EXPIRED: [],
  REVOKED: [],
}

export const DEMO_JOURNEY_TERMINAL_STATES: readonly DemoJourneyState[] = ["COMPLETED", "EXPIRED", "REVOKED"]

/** The straight line used for progress percentages; call alternatives map
 *  onto the CALL_SKIPPED slot. */
export const DEMO_JOURNEY_HAPPY_PATH: readonly DemoJourneyState[] = [
  "PREPARED",
  "STARTED",
  "SOURCE_SEEN",
  "CONVERSATION_OPENED",
  "AI_REPLIED",
  "LEAD_CREATED",
  "LEAD_QUALIFIED",
  "CALL_SKIPPED",
  "TASK_CREATED",
  "DEAL_CREATED",
  "DEAL_ADVANCED",
  "QUOTE_CREATED",
  "QUOTE_SENT",
  "QUOTE_ACCEPTED",
  "CLOSED_WON",
  "COMPLETED",
]

export function isTerminalJourneyState(state: DemoJourneyState): boolean {
  return DEMO_JOURNEY_TERMINAL_STATES.includes(state)
}

/**
 * The shortest legal walk from `from` to `to`, excluding `from` itself, or
 * null if the transitions do not connect them. An `outcome` step uses it to
 * pass through the states the world went through (queued, calling) on the way
 * to what actually happened.
 */
export function journeyPath(from: DemoJourneyState, to: DemoJourneyState): readonly DemoJourneyState[] | null {
  if (from === to) return null
  const previous = new Map<DemoJourneyState, DemoJourneyState>()
  const queue: DemoJourneyState[] = [from]
  const seen = new Set<DemoJourneyState>([from])
  while (queue.length) {
    const current = queue.shift()!
    for (const next of DEMO_JOURNEY_TRANSITIONS[current]) {
      if (seen.has(next)) continue
      seen.add(next)
      previous.set(next, current)
      if (next === to) {
        const path: DemoJourneyState[] = [to]
        let cursor = current
        while (cursor !== from) {
          path.unshift(cursor)
          cursor = previous.get(cursor)!
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}

export function canTransition(from: DemoJourneyState, to: DemoJourneyState): boolean {
  if (from === to) return false
  if (isTerminalJourneyState(from)) return false
  if (to === "EXPIRED" || to === "REVOKED") return true
  return DEMO_JOURNEY_TRANSITIONS[from].includes(to)
}

export type JourneyTransitionResult =
  | { readonly ok: true; readonly state: DemoJourneyState }
  | { readonly ok: false; readonly state: DemoJourneyState; readonly error: string }

export function applyTransition(from: DemoJourneyState, to: DemoJourneyState): JourneyTransitionResult {
  if (canTransition(from, to)) return { ok: true, state: to }
  return { ok: false, state: from, error: `Transition ${from} → ${to} is not allowed` }
}

/** 0–100 along the happy path; alternative call outcomes count as the call
 *  slot so a declined call does not read as «less progress». */
export function journeyProgressPercent(state: DemoJourneyState): number {
  const slot = state.startsWith("CALL_") ? "CALL_SKIPPED" : state
  const index = DEMO_JOURNEY_HAPPY_PATH.indexOf(slot)
  if (index < 0) return state === "COMPLETED" ? 100 : 0
  return Math.round((index / (DEMO_JOURNEY_HAPPY_PATH.length - 1)) * 100)
}
