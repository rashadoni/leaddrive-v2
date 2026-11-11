/**
 * The one way the CRM gets a Claude client: `anthropicFor(orgId, feature)`.
 *
 *  1. Key: the organization's own, if it entered one; else the platform's, if
 *     the platform superadmin allows this organization to use it
 *     (`organizations.aiPlatformKey`); else `AiUnavailableError("not_connected")`.
 *  2. Budget: on the platform's key, the organization's daily AI budget
 *     (`checkAiBudget`, the organization's own, none unless its admin set one) is checked before the
 *     call; over it — `AiUnavailableError("budget_exceeded")`. On its own key
 *     the organization sets its ceiling at the provider.
 *  3. Journal: every finished `messages.create` / `messages.stream` writes its
 *     tokens and price to `ai_usage`, with the feature and the agent.
 *
 * The client is the ordinary SDK client; only those two methods are watched.
 * A failure to read the key settings or the budget does not stop the call —
 * it falls back to the platform key, as before the gateway, and is logged.
 */
import type Anthropic from "@anthropic-ai/sdk"
import type { ClientOptions } from "@anthropic-ai/sdk"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import type { AiFeature } from "./features"
import { recordAiUsage, type AiKeySource } from "./usage"
import { AiUnavailableError, assertAiBudget, isAiUnavailable, resolveAiKey } from "./access"

export { AiUnavailableError, isAiUnavailable, aiUnavailableText } from "./access"

export type AnthropicForOptions = {
  /** The AI agent (ai_agent_configs.id) the call answers for. */
  agentId?: string | null
  timeout?: ClientOptions["timeout"]
  maxRetries?: ClientOptions["maxRetries"]
  /** Skip the budget check: only for a caller that has just checked it. */
  skipBudget?: boolean
}

export async function anthropicFor(orgId: string, feature: AiFeature, options: AnthropicForOptions = {}): Promise<Anthropic> {
  return (await anthropicAccess(orgId, feature, options))(options.agentId)
}

/**
 * Whether the organization has Claude at all (its key, or the platform's it
 * may use) — for a screen that shows or hides an AI button. Not the budget.
 */
export async function anthropicAvailable(orgId: string): Promise<boolean> {
  try {
    await resolveAiKey(orgId, "anthropic")
    return true
  } catch (error) {
    if (isAiUnavailable(error)) return false
    throw error
  }
}

/**
 * `anthropicFor`, with a refusal returned instead of thrown: for a route that
 * answers "AI is not available" in words rather than failing.
 */
export async function anthropicOrRefusal(
  orgId: string,
  feature: AiFeature,
  options: AnthropicForOptions = {},
): Promise<Anthropic | AiUnavailableError> {
  try {
    return await anthropicFor(orgId, feature, options)
  } catch (error) {
    if (isAiUnavailable(error)) return error
    throw error
  }
}

/**
 * Key and budget now, the client later: for a caller that learns which agent
 * answers only after it has started (the Da Vinci chat picks its agent while
 * the key is read).
 */
export async function anthropicAccess(
  orgId: string,
  feature: AiFeature,
  options: Omit<AnthropicForOptions, "agentId"> = {},
): Promise<(agentId?: string | null) => Anthropic> {
  const { apiKey, keySource } = await resolveAiKey(orgId, "anthropic")
  // The daily limit is the platform's: on its own key the organization sets
  // its ceiling at the provider.
  if (!options.skipBudget && keySource === "platform") await assertAiBudget(orgId)
  return (agentId) => metered(getAnthropicClient({
    apiKey,
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  }), { orgId, feature, keySource, agentId: agentId ?? null })
}

/**
 * The platform's own Claude, for work that belongs to no client organization:
 * the public demo (the prospect is not a tenant; its cost is recorded on the
 * demo's own events). Never for anything a tenant does.
 */
export function platformAnthropic(
  purpose: "demo",
  options: Omit<AnthropicForOptions, "agentId" | "skipBudget"> = {},
): Anthropic {
  void purpose
  return getAnthropicClient({
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  })
}

type Meter = { orgId: string; feature: AiFeature; keySource: AiKeySource; agentId: string | null }

function record(meter: Meter, model: unknown, usage: Partial<Anthropic.Usage> | null | undefined): void {
  if (!usage) return
  void recordAiUsage({
    ...meter,
    provider: "anthropic",
    model: typeof model === "string" ? model : null,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  })
}

type MessagesApi = {
  create: (...args: [params: { model?: string; stream?: boolean }, options?: unknown]) => unknown
  stream?: (...args: [params: { model?: string }, options?: unknown]) => unknown
}

/**
 * The same client with its finished calls watched. Nothing is changed on the
 * client itself: `messages` is answered by an object whose prototype is the
 * client's own, so every other method and field is the original.
 */
function metered(client: Anthropic, meter: Meter): Anthropic {
  const original = client.messages as unknown as MessagesApi
  const messages = Object.create(original) as MessagesApi
  // The arguments go through exactly as given (an absent options argument stays absent).
  messages.create = (...args) => {
    const params = args[0]
    const pending = original.create(...args)
    // A raw event stream (`stream: true`) has no final usage here; the chat
    // uses `messages.stream`, which has. No caller asks for the raw form.
    if (!params?.stream) {
      Promise.resolve(pending).then(
        (message) => {
          const m = message as { model?: string; usage?: Anthropic.Usage } | undefined
          record(meter, m?.model ?? params?.model, m?.usage)
        },
        () => { /* the caller sees the error */ },
      )
    }
    return pending
  }
  if (typeof original.stream === "function") {
    messages.stream = (...args) => {
      const params = args[0]
      const live = original.stream!(...args) as {
        on?: (event: string, listener: (message: Anthropic.Message) => void) => unknown
      }
      live?.on?.("finalMessage", (message) => record(meter, message?.model ?? params?.model, message?.usage))
      return live
    }
  }
  return new Proxy(client, {
    get(target, property) {
      return property === "messages" ? messages : Reflect.get(target, property)
    },
  })
}
