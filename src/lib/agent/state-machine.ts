/**
 * Agent framework state machine — pure transition rules for an
 * AgentSession's planning loop.
 *
 * Salesforce Agentforce / Atlas-style: each session goes through repeated
 * observe → think → act cycles, optionally pausing for human input
 * (waiting_input) or terminating (completed | failed | cancelled).
 *
 * Slice 1: pure state machine + validation. The actual Claude tool-calling
 * inside each step lands in slice 2 (driver that consumes these transitions
 * and dispatches to `src/lib/ai/tools.ts`).
 *
 * Part of H1 Agent framework (Phase 3 roadmap).
 */

export type SessionStatus =
  | "planning"        // initial; agent is deciding what to do first
  | "executing"       // running steps in the loop
  | "waiting_input"   // paused for the user to clarify or approve a high-risk action
  | "completed"       // success terminal
  | "failed"          // error terminal
  | "cancelled"       // user-aborted terminal

/**
 * Five canonical step kinds. `ask` was added during H2 review so an Atlas
 * `ask` PlanDecision (agent pauses for user clarification) can be persisted
 * as a step rather than synthesised via a respond+deferred bridge — keeps
 * the trace honest. Schema CHECK constraint widened in migration
 * `20260517030000_agent_step_kind_ask`.
 */
export type StepKind = "observe" | "think" | "act" | "respond" | "ask"

export type StepOutcome = "ok" | "error" | "deferred"

export const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "completed", "failed", "cancelled",
])

export interface SessionView {
  status: SessionStatus
  stepCount: number
  maxSteps: number
  costSoFarUsd: number
  budgetUsd: number | null
}

export interface StepInput {
  kind: StepKind
  outcome?: StepOutcome
  costUsd?: number
}

export interface TransitionResult {
  /** Resulting session status after this step. */
  nextStatus: SessionStatus
  /** New `stepCount`. */
  nextStepCount: number
  /** New `costSoFarUsd`. */
  nextCostSoFarUsd: number
  /** Final outcome reason when status is terminal. */
  reason?: string
}

export class AgentStateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "AgentStateError"
  }
}

/**
 * Validate a step can be appended in the session's current state and
 * compute the resulting session view. Pure function — caller writes
 * the step + applies the new status in one DB transaction.
 *
 * Transition rules:
 *   - Session must NOT be in a terminal state.
 *   - `respond` step transitions session to `completed` (unless outcome=error).
 *   - `respond` with outcome=error → failed.
 *   - `act`/`think`/`observe` with outcome=error → failed (one-strike).
 *   - Exceeding `maxSteps` (after increment) → failed with "max_steps".
 *   - Exceeding `budgetUsd` (after cost addition) → failed with "budget_exceeded".
 *   - Otherwise: status stays `executing` (planning auto-promotes on first step).
 */
export function applyStep(session: SessionView, step: StepInput): TransitionResult {
  if (TERMINAL_STATUSES.has(session.status)) {
    throw new AgentStateError("terminal_state",
      `Cannot append step to session in terminal state '${session.status}'`)
  }

  const outcome = step.outcome ?? "ok"
  const nextStepCount = session.stepCount + 1
  const nextCostSoFarUsd = session.costSoFarUsd + (step.costUsd ?? 0)

  // Budget exhaustion takes precedence over everything else — engine
  // owes the user no further LLM spend once they've blown the cap.
  if (session.budgetUsd !== null && nextCostSoFarUsd > session.budgetUsd) {
    return {
      nextStatus: "failed",
      nextStepCount,
      nextCostSoFarUsd,
      reason: `Budget exceeded: $${nextCostSoFarUsd.toFixed(4)} > $${session.budgetUsd.toFixed(4)}`,
    }
  }

  // Hard cap on loop iterations.
  if (nextStepCount > session.maxSteps) {
    return {
      nextStatus: "failed",
      nextStepCount,
      nextCostSoFarUsd,
      reason: `Exceeded max steps (${session.maxSteps})`,
    }
  }

  // One-strike error policy: any failed step ends the session.
  if (outcome === "error") {
    return {
      nextStatus: "failed",
      nextStepCount,
      nextCostSoFarUsd,
      reason: `Step ${step.kind} failed`,
    }
  }

  // Respond step ends the session in success.
  if (step.kind === "respond") {
    return {
      nextStatus: "completed",
      nextStepCount,
      nextCostSoFarUsd,
      reason: "responded",
    }
  }

  // Ask step pauses the session for user clarification — distinct from
  // terminal completion (`respond`) and from one-strike failure (`error`).
  if (step.kind === "ask") {
    return {
      nextStatus: "waiting_input",
      nextStepCount,
      nextCostSoFarUsd,
      reason: "asked_user",
    }
  }

  // Default: keep executing.
  return {
    nextStatus: "executing",
    nextStepCount,
    nextCostSoFarUsd,
  }
}

/**
 * Validate that a status transition requested by a human action (e.g.
 * "cancel", "approve waiting_input") is legal.
 */
export function canTransitionStatus(from: SessionStatus, to: SessionStatus): boolean {
  if (TERMINAL_STATUSES.has(from)) return false // cannot leave terminal
  if (to === "cancelled") return true // cancel always allowed from non-terminal
  if (from === "waiting_input" && to === "executing") return true
  if (from === "planning" && to === "executing") return true
  if (from === "executing" && to === "waiting_input") return true
  return false
}
