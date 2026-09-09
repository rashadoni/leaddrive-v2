/**
 * Atlas prompt construction — pure functions that assemble the
 * planning-prompt text from a `PlanEnvelope`.
 *
 * Three responsibilities, all pure:
 *   1. Truncate retrieved docs to per-doc + total budgets so the prompt
 *      doesn't blow the model context.
 *   2. Format prior steps into a compact trace section.
 *   3. Compose the final system + user message pair.
 *
 * Slice 1 ships text-template format. Slice 2 may swap to structured
 * JSON tool-use envelopes once the driver is wired.
 *
 * Part of H2 Atlas Reasoning Engine (Phase 3 roadmap).
 */
import type { PlanEnvelope, PlanStepRecord, RetrievedDoc } from "./types"

/** Per-doc character cap in the prompt. Beyond this, body is `…` truncated. */
export const MAX_DOC_CHARS = 1200

/** Total chars across all retrieved docs in the prompt. */
export const MAX_TOTAL_RAG_CHARS = 12000

/** Number of recent steps included in the trace. Older steps elided. */
export const MAX_TRACE_STEPS = 12

/* ─── Section formatters ──────────────────────────────────────────────── */

export function formatDoc(doc: RetrievedDoc, maxChars: number = MAX_DOC_CHARS): string {
  const body = doc.content.length > maxChars
    ? `${doc.content.slice(0, maxChars - 1)}…`
    : doc.content
  const scoreSuffix = doc.score !== undefined ? ` (score=${doc.score.toFixed(2)})` : ""
  return `### ${doc.kind}: ${doc.title}${scoreSuffix}\n${body}`
}

/**
 * Format the retrieved docs section with a hard total-char budget. Docs are
 * consumed in order (caller ranks by relevance); once budget is exhausted,
 * remaining docs are summarised as `[N more docs not shown — total budget exceeded]`.
 */
export function formatRagSection(docs: RetrievedDoc[], totalBudget: number = MAX_TOTAL_RAG_CHARS): string {
  if (docs.length === 0) return "_No relevant documents retrieved._"
  const SEPARATOR = "\n\n"
  const formatted: string[] = []
  let used = 0
  let skipped = 0
  for (let i = 0; i < docs.length; i++) {
    const piece = formatDoc(docs[i])
    // Account for separator BEFORE every doc after the first.
    const projected = used + (i === 0 ? 0 : SEPARATOR.length) + piece.length
    if (projected > totalBudget) {
      skipped = docs.length - formatted.length
      break
    }
    formatted.push(piece)
    used = projected
  }
  if (skipped > 0) {
    // Even when nothing fit, still emit the tail-marker so the caller sees
    // "N docs not shown" instead of the empty-state placeholder.
    formatted.push(`_[${skipped} more docs not shown — total budget ${totalBudget} chars exceeded]_`)
  }
  return formatted.join(SEPARATOR)
}

/**
 * Format one step into a compact trace line. Tool inputs/outputs are
 * truncated to `briefMax` chars so a single mega-payload doesn't drown
 * the trace section.
 */
export function formatStepRecord(step: PlanStepRecord, briefMax: number = 240): string {
  const parts: string[] = [`#${step.stepIndex} [${step.kind}]`]
  if (step.thought) parts.push(`thought: ${brief(step.thought, briefMax)}`)
  if (step.observation) parts.push(`obs: ${brief(step.observation, briefMax)}`)
  if (step.action) parts.push(`action: ${brief(step.action, briefMax)}`)
  if (step.toolName) parts.push(`tool: ${step.toolName}`)
  if (step.toolInputBrief) parts.push(`input: ${brief(step.toolInputBrief, briefMax)}`)
  if (step.toolOutputBrief) parts.push(`output: ${brief(step.toolOutputBrief, briefMax)}`)
  if (step.outcome !== "ok") parts.push(`outcome: ${step.outcome}${step.errorMessage ? ` (${step.errorMessage})` : ""}`)
  return parts.join(" · ")
}

export function formatTraceSection(steps: PlanStepRecord[], maxSteps: number = MAX_TRACE_STEPS): string {
  if (steps.length === 0) return "_No prior steps. This is the first iteration._"
  const recent = steps.slice(-maxSteps)
  const elided = steps.length - recent.length
  const header = elided > 0
    ? `_[${elided} earlier step(s) elided; showing last ${recent.length}]_\n`
    : ""
  return header + recent.map(formatStepRecord).join("\n")
}

export function formatToolList(tools: string[]): string {
  if (tools.length === 0) return "_No tools available — you can only `respond`, `think`, or `ask`._"
  return tools.map(t => `- ${t}`).join("\n")
}

export function formatBudgetSection(env: PlanEnvelope): string {
  const stepsLine = `Steps: ${env.stepCount}/${env.maxSteps}`
  const budgetLine = env.budgetUsd !== null
    ? `Cost: $${env.costSoFarUsd.toFixed(4)} / $${env.budgetUsd.toFixed(4)} (${((env.costSoFarUsd / env.budgetUsd) * 100).toFixed(0)}% used)`
    : `Cost so far: $${env.costSoFarUsd.toFixed(4)}`
  return `${stepsLine}\n${budgetLine}`
}

/* ─── Final assembly ──────────────────────────────────────────────────── */

export interface ComposedPrompt {
  system: string
  user: string
}

/**
 * Build the system + user message pair for the next Claude planning call.
 * Pure — no I/O, no Date.now (caller injects timestamps if needed).
 *
 * Structure:
 *   system: agent's role + system prompt + planning protocol
 *   user:   goal + budget + tools + retrieved docs + memory + trace + ask
 */
export function buildPlanningPrompt(env: PlanEnvelope): ComposedPrompt {
  const system = [
    `You are an autonomous AI agent acting in the role of: ${env.agentRole}.`,
    "",
    "PLANNING PROTOCOL:",
    "On each turn, return ONE of these decisions:",
    "  - `observe`: gather information (no side effects).",
    "  - `think`: reason about next step (no side effects).",
    "  - `act`: invoke an available tool. Provide `toolName` and `toolInput`.",
    "  - `respond`: terminate the session by reporting the final answer to the user.",
    "  - `ask`: pause for user clarification when the goal is ambiguous.",
    "",
    "Use `respond` when you have completed the goal. Do not act past the budget.",
    "",
    env.systemPrompt || "",
  ].filter(Boolean).join("\n")

  const user = [
    `GOAL\n${env.goal}`,
    "",
    `BUDGET\n${formatBudgetSection(env)}`,
    "",
    `AVAILABLE TOOLS\n${formatToolList(env.availableTools)}`,
    "",
    `RETRIEVED CONTEXT\n${formatRagSection(env.rag.docs)}`,
    env.rag.memory ? `\nSESSION MEMORY\n${env.rag.memory}` : "",
    "",
    `TRACE\n${formatTraceSection(env.recentSteps)}`,
    "",
    "Decide your next move and return it as a single tool call to `decide_next`.",
  ].filter(Boolean).join("\n")

  return { system, user }
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function brief(s: string, max: number): string {
  if (s.length <= max) return s
  // TODO H2 slice 2: unicode-naive — String.slice can split a surrogate pair
  // if the cut falls between high/low surrogates, leaving a stray replacement
  // glyph in the prompt. Use `[...s].slice(0, max - 1).join("")` once slice 2
  // benchmarks the perf cost on long trace bodies.
  return s.slice(0, max - 1) + "…"
}
