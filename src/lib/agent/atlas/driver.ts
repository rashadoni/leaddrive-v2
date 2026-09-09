/**
 * Atlas planning-loop driver — orchestrates one iteration of an
 * AgentSession's reasoning cycle.
 *
 * Lifecycle of `runIteration`:
 *   1. Build `PlanEnvelope` from the session state + retrieved context.
 *   2. Call `LLMClient.decideNext` to get a `PlanDecision`.
 *   3. Evaluate admissibility (tool whitelist + metadata + input shape).
 *   4. If admissible AND requires approval → return waiting_input outcome
 *      so the caller persists a pending step and pauses the session.
 *   5. Otherwise return the validated decision to the caller, which
 *      executes the tool (via `executeTool`) and appends an AgentStep.
 *
 * The driver itself is Prisma-free + DB-free. Slice 1: driver implements
 * the orchestration shape with the LLM injected; slice 2 wires the real
 * `@anthropic-ai/sdk` client + `executeTool` dispatch + AgentStep
 * persistence in a Prisma transaction.
 *
 * Part of H2 Atlas Reasoning Engine (Phase 3 roadmap, slice 1).
 */
import { buildPlanningPrompt, type ComposedPrompt } from "./prompt-builder"
import { evaluateDecision, resolveAvailableTools } from "./decision-evaluator"
import type {
  DecisionEvaluation,
  LLMCallOptions,
  LLMClient,
  PlanDecision,
  PlanEnvelope,
} from "./types"

export interface DriverInput {
  envelope: PlanEnvelope
  llm: LLMClient
  options?: LLMCallOptions
}

export type IterationOutcome =
  | { kind: "execute"; decision: PlanDecision; evaluation: DecisionEvaluation; prompt: ComposedPrompt }
  | { kind: "approve"; decision: PlanDecision; evaluation: DecisionEvaluation; prompt: ComposedPrompt }
  | { kind: "reject"; decision: PlanDecision; evaluation: DecisionEvaluation; prompt: ComposedPrompt }
  | { kind: "respond"; decision: Extract<PlanDecision, { kind: "respond" }>; prompt: ComposedPrompt }
  | { kind: "ask"; decision: Extract<PlanDecision, { kind: "ask" }>; prompt: ComposedPrompt }

/**
 * Run one planning iteration. Returns an outcome describing what the
 * caller should do next:
 *   - `execute`: dispatch the tool / record the observation/think step
 *   - `approve`: action requires human approval → persist waiting_input step
 *   - `reject`: action was inadmissible (bad tool name, etc.) → record error step
 *   - `respond`: terminal "responded to user" — caller marks session completed
 *   - `ask`: agent paused for user clarification → caller marks waiting_input
 *
 * No DB writes, no tool dispatch — those happen in the caller (slice 2's
 * concrete driver wires them around this pure orchestration).
 */
export async function runIteration(input: DriverInput): Promise<IterationOutcome> {
  const prompt = buildPlanningPrompt(input.envelope)
  const decision = await input.llm.decideNext(input.envelope, input.options ?? {})

  // Terminal-like decisions short-circuit evaluation
  if (decision.kind === "respond") {
    return { kind: "respond", decision, prompt }
  }
  if (decision.kind === "ask") {
    return { kind: "ask", decision, prompt }
  }

  const evaluation = evaluateDecision(decision, input.envelope.availableTools)

  if (!evaluation.admissible) {
    return { kind: "reject", decision, evaluation, prompt }
  }

  if (decision.kind === "act" && evaluation.requiresApproval) {
    return { kind: "approve", decision, evaluation, prompt }
  }

  return { kind: "execute", decision, evaluation, prompt }
}

/** Re-export for caller convenience. */
export { resolveAvailableTools }
