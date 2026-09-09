/**
 * Atlas reasoning engine type contracts — H2 Phase 3.
 *
 * Salesforce Atlas analogue: structured multi-step planning loop with
 * retrieval-augmented context, tool dispatch, and self-reflection. The
 * driver consumes these types; pure prompt builders produce them; the
 * H1 state machine validates the resulting state transitions.
 *
 * Slice 1 ships the contract surface + pure helpers. The driver class
 * orchestrating actual Claude calls + tool dispatch — slice 2.
 */

import type { StepKind } from "../state-machine"

/* ─── Retrieval-augmented context ─────────────────────────────────────── */

/**
 * One piece of context retrieved before the next planning iteration —
 * KB article, recent deal, related contact, etc. The driver injects
 * these into the planning prompt to ground the agent's reasoning.
 */
export interface RetrievedDoc {
  /** Stable id — `${kind}:${recordId}` for dedup across retrieval rounds. */
  id: string
  /** Source classifier. Drives how the driver formats it in the prompt. */
  kind: "kb_article" | "deal" | "lead" | "contact" | "company" | "ticket" | "activity" | "note" | "custom"
  /** Short human-readable label shown in trace + UI. */
  title: string
  /** Body — markdown allowed; driver truncates per-doc to `MAX_DOC_CHARS`. */
  content: string
  /** Optional relevance score 0-1 from the retriever. Used for ranking + cap. */
  score?: number
  /** Optional originating record reference (e.g. `dealId`) for UI deep-links. */
  recordId?: string
}

export interface RagContext {
  /** Docs the retriever surfaced for this iteration, ordered most→least relevant. */
  docs: RetrievedDoc[]
  /**
   * Free-form summary of conversation/session memory — usually computed by
   * the driver from prior steps via a separate Claude call. Slice 2 wires
   * the summariser; slice 1 accepts caller-provided strings.
   */
  memory?: string
}

/* ─── Plan envelope ───────────────────────────────────────────────────── */

/**
 * Snapshot of session state assembled by the driver before each Claude
 * call. Includes the goal, prior steps trace, retrieved docs, available
 * tools (filtered by agent config's `toolsEnabled`).
 */
export interface PlanEnvelope {
  /** AgentSession.goal — what the user asked the agent to do. */
  goal: string
  /** Agent's role description (e.g. "Sales SDR", "Support Engineer"). */
  agentRole: string
  /** Agent's system prompt — verbatim from AiAgentConfig.systemPrompt. */
  systemPrompt: string
  /** Last N AgentSteps in chronological order, for the trace section. */
  recentSteps: PlanStepRecord[]
  /** Currently-eligible tool names (subset of TOOL_META keys). */
  availableTools: string[]
  /** Retrieved context for this iteration. */
  rag: RagContext
  /** Cumulative cost + step count — agent's self-awareness of budget. */
  costSoFarUsd: number
  budgetUsd: number | null
  stepCount: number
  maxSteps: number
}

/** Compact view of a step suitable for inclusion in the planning prompt. */
export interface PlanStepRecord {
  stepIndex: number
  kind: StepKind
  observation?: string | null
  thought?: string | null
  action?: string | null
  toolName?: string | null
  /** Stringified tool input — caller decides truncation policy. */
  toolInputBrief?: string | null
  toolOutputBrief?: string | null
  outcome: "ok" | "error" | "deferred"
  errorMessage?: string | null
}

/* ─── LLM client interface (DI for testability) ───────────────────────── */

/**
 * Minimal interface the driver depends on. Production wires it to
 * `@anthropic-ai/sdk`; tests inject a stub returning canned plans.
 * No coupling to a specific provider — slice 3 could route Sonnet for
 * planning and Haiku for tactical execution behind this interface.
 */
export interface LLMClient {
  /** Generate the next planning decision given the envelope. */
  decideNext(envelope: PlanEnvelope, opts: LLMCallOptions): Promise<PlanDecision>
}

export interface LLMCallOptions {
  /** Hard timeout in ms — driver aborts the call after this. Default 30s. */
  timeoutMs?: number
  /** Override agent config's model — useful for Sonnet/Haiku routing. */
  modelOverride?: string
}

/**
 * The structured decision the LLM is asked to return. The driver enforces
 * this shape via Anthropic tool-use mode (slice 2 wires); slice 1 ships
 * the type contract.
 */
export type PlanDecision =
  | { kind: "observe"; observation: string; thought?: string }
  | { kind: "think"; thought: string }
  | { kind: "act"; thought?: string; toolName: string; toolInput: Record<string, unknown> }
  | { kind: "respond"; thought?: string; message: string }
  | { kind: "ask"; thought?: string; question: string } // pauses → waiting_input

/* ─── Decision evaluation ─────────────────────────────────────────────── */

/**
 * Result of validating a `PlanDecision` against current session state.
 * Caller (driver) uses this to either dispatch the action or short-circuit
 * the session with a controlled failure.
 */
export interface DecisionEvaluation {
  /** True when the decision is admissible given current state and tools. */
  admissible: boolean
  /** Human-readable rejection reason when `admissible=false`. */
  reason?: string
  /** Tool-metadata lookup for `act` decisions — risk level, approval flag. */
  toolRisk?: "low" | "medium" | "high"
  /** True when an `act` decision must pause for human approval. */
  requiresApproval?: boolean
}
