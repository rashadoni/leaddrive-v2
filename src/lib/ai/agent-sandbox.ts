/**
 * F3 (Creatio 10X roadmap — AI agent builder) — agent test sandbox.
 *
 * Preview how an agent config responds BEFORE it is published, safely: the
 * sandbox runs the config's model + persona (systemPrompt / temperature /
 * maxTokens) against the tester's messages, but executes NO tools and touches NO
 * customer data — so testing a draft never writes a task/ticket or sends mail.
 * The reply is persona-faithful; tool/KB behaviour is exercised only in
 * production, which the UI states plainly.
 *
 * Mirrors meeting-recap / meddpicc-suggest: shared timeout-bounded client, cost
 * logged to aiInteractionLog, strict bounds on input.
 */
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { prisma } from "@/lib/prisma"
import { calculateAiCost, KNOWN_AI_MODELS } from "@/lib/ai/budget"

const DEFAULT_MODEL = "claude-haiku-4-5-20251001"
export const SANDBOX_MAX_MESSAGES = 20
export const SANDBOX_MAX_CONTENT = 4000
/** Cap sandbox output regardless of the config's maxTokens — a preview is short. */
const SANDBOX_MAX_OUTPUT_TOKENS = 1024

export interface SandboxMessage {
  role: "user" | "assistant"
  content: string
}

export interface SandboxConfig {
  model?: string | null
  systemPrompt?: string | null
  temperature?: number | null
  maxTokens?: number | null
  toolsEnabled?: string[] | null
}

export interface SandboxResult {
  reply: string
  model: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  latencyMs: number
  /** Tools the agent WOULD have available in production (not run in the sandbox). */
  toolsAvailable: string[]
}

export type SandboxValidation =
  | { ok: true; messages: SandboxMessage[] }
  | { ok: false; error: "empty" | "too_many" | "too_long" | "not_user_last" }

/** Validate the tester's transcript. Pure — unit-testable without an LLM. */
export function validateSandboxMessages(messages: unknown): SandboxValidation {
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: "empty" }
  if (messages.length > SANDBOX_MAX_MESSAGES) return { ok: false, error: "too_many" }
  const clean: SandboxMessage[] = []
  for (const m of messages) {
    const role = (m as { role?: unknown })?.role
    const content = (m as { content?: unknown })?.content
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "empty" }
    }
    if (content.length > SANDBOX_MAX_CONTENT) return { ok: false, error: "too_long" }
    clean.push({ role, content })
  }
  if (clean[clean.length - 1].role !== "user") return { ok: false, error: "not_user_last" }
  return { ok: true, messages: clean }
}

/**
 * Run one preview turn. `orgId` is used only for the cost log. Throws on an LLM
 * failure so the route can answer 502.
 */
export async function runAgentSandbox(
  orgId: string,
  config: SandboxConfig,
  messages: SandboxMessage[],
): Promise<SandboxResult> {
  const model = config.model && KNOWN_AI_MODELS.includes(config.model) ? config.model : DEFAULT_MODEL
  const temperature = typeof config.temperature === "number" ? Math.min(2, Math.max(0, config.temperature)) : 0.7
  const maxTokens = Math.min(SANDBOX_MAX_OUTPUT_TOKENS, Math.max(64, config.maxTokens ?? SANDBOX_MAX_OUTPUT_TOKENS))

  const anthropic = getAnthropicClient()
  const start = Date.now()
  let response: { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
  try {
    response = (await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })) as typeof response
  } catch (e) {
    console.error("[agent-sandbox] AI call failed:", e)
    throw new Error("ai_call_failed")
  }

  const reply = (response.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim()

  const promptTokens = response.usage?.input_tokens || 0
  const completionTokens = response.usage?.output_tokens || 0
  const costUsd = calculateAiCost(model, promptTokens, completionTokens)
  const latencyMs = Date.now() - start

  await prisma.aiInteractionLog
    .create({
      data: {
        organizationId: orgId,
        userMessage: `agent_sandbox: ${messages[messages.length - 1].content.slice(0, 200)}`,
        aiResponse: reply.slice(0, 2000),
        model,
        promptTokens,
        completionTokens,
        costUsd,
        latencyMs,
      },
    })
    .catch(() => {})

  return {
    reply,
    model,
    promptTokens,
    completionTokens,
    costUsd,
    latencyMs,
    toolsAvailable: Array.isArray(config.toolsEnabled) ? config.toolsEnabled : [],
  }
}
