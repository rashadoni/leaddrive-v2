/**
 * The door for every provider: whose key, whether the budget allows it, and
 * one journal line per finished call. `anthropicFor` (anthropic.ts) wraps the
 * Claude client in it; the others — Gemini, OpenAI, Voyage, Google Vision —
 * are plain HTTP, so their callers get the key and a `journal` to call with
 * what the provider answered.
 *
 *  1. Key: the organization's own, if it entered one; else the platform's, if
 *     the platform superadmin allows this organization to use it
 *     (`organizations.aiPlatformKey`); else `AiUnavailableError("not_connected")`.
 *  2. Budget: only on the platform's key (its daily limit is the platform's).
 *  3. Journal: `journal({...})` writes `ai_usage` with the feature, the agent,
 *     the provider and whose key paid.
 *
 * A failure to read the key settings or the budget does not stop the call: it
 * falls back to the platform key, as before the gateway, and is logged.
 */
import { logOperationalFailure } from "@/lib/telemetry/operational-failure"
import { runWithTenant } from "@/lib/rls-context"
import { tenantAiAccess } from "./credentials"
import type { AiFeature, AiProvider } from "./features"
import { recordAiUsage, type AiKeySource, type AiUsageEntry } from "./usage"
import { aiRefusalText } from "./refusal-text"
import { platformAiKey } from "./platform-key"

export { platformAiKey }

export class AiUnavailableError extends Error {
  constructor(readonly reason: "not_connected" | "budget_exceeded") {
    super(reason === "not_connected"
      ? "AI is not connected for this organization"
      : "The organization's daily AI budget is used up")
    this.name = "AiUnavailableError"
  }
}

export function isAiUnavailable(error: unknown): error is AiUnavailableError {
  return error instanceof AiUnavailableError
}

/** What the person sees when the gateway refuses, in their language. */
export function aiUnavailableText(error: AiUnavailableError, locale?: string | null): string {
  return aiRefusalText(error.reason, locale)
}

export async function resolveAiKey(orgId: string, provider: AiProvider): Promise<{ apiKey: string; keySource: AiKeySource }> {
  try {
    const access = await tenantAiAccess(orgId, provider)
    if (access.secret) return { apiKey: access.secret, keySource: "tenant" }
    if (!access.platformAllowed) throw new AiUnavailableError("not_connected")
  } catch (error) {
    if (isAiUnavailable(error)) throw error
    logOperationalFailure("ai-gateway-access", "warn")
  }
  // An installation without a platform key has nothing to fall back to.
  const platform = platformAiKey(provider)
  if (!platform) throw new AiUnavailableError("not_connected")
  return { apiKey: platform, keySource: "platform" }
}

export async function assertAiBudget(orgId: string): Promise<void> {
  let allowed = true
  try {
    // Loaded on use: the budget module reaches the social-monitoring carry-forward,
    // which modules that only journal (the phone line's host) need not load.
    const { checkAiBudget } = await import("@/lib/ai/budget")
    // In the organization's own scope: a cron or webhook caller may have none.
    allowed = (await runWithTenant(orgId, () => checkAiBudget(orgId))).allowed
  } catch {
    logOperationalFailure("ai-gateway-budget", "warn")
  }
  if (!allowed) throw new AiUnavailableError("budget_exceeded")
}

export type AiAccessOptions = {
  /** The AI agent (ai_agent_configs.id) the call answers for. */
  agentId?: string | null
  /** Skip the budget check: only for a caller that has just checked it. */
  skipBudget?: boolean
}

/** What a finished call cost: tokens to price, or a cost already priced (seconds, images). */
export type AiJournalEntry = Pick<AiUsageEntry, "model" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd">

export type AiKeyAccess = {
  apiKey: string
  keySource: AiKeySource
  /** Write the finished call to `ai_usage`. Never throws; never waits for the write. */
  journal: (entry: AiJournalEntry) => void
}

/** Key, budget and journal for one call to a provider other than Claude. */
export async function aiKeyFor(
  orgId: string,
  provider: Exclude<AiProvider, "anthropic" | "google_speech">,
  feature: AiFeature,
  options: AiAccessOptions = {},
): Promise<AiKeyAccess> {
  const { apiKey, keySource } = await resolveAiKey(orgId, provider)
  if (!options.skipBudget && keySource === "platform") await assertAiBudget(orgId)
  const meter = { orgId, feature, provider, keySource, agentId: options.agentId ?? null }
  return { apiKey, keySource, journal: (entry) => { void recordAiUsage({ ...meter, ...entry }) } }
}

/** `aiKeyFor`, with a refusal returned instead of thrown. */
export async function aiKeyOrRefusal(
  orgId: string,
  provider: Exclude<AiProvider, "anthropic" | "google_speech">,
  feature: AiFeature,
  options: AiAccessOptions = {},
): Promise<AiKeyAccess | AiUnavailableError> {
  try {
    return await aiKeyFor(orgId, provider, feature, options)
  } catch (error) {
    if (isAiUnavailable(error)) return error
    throw error
  }
}

/** Whether the organization has this provider at all (its key, or the platform's it may use). Not the budget. */
export async function aiProviderAvailable(orgId: string, provider: AiProvider): Promise<boolean> {
  try {
    await resolveAiKey(orgId, provider)
    return true
  } catch (error) {
    if (isAiUnavailable(error)) return false
    throw error
  }
}

/**
 * A paid call the organization cannot bring its own key for — Vertex speech
 * and the phone line's Speech-to-Text run on the platform's service
 * credentials — still goes into the organization's journal.
 */
export function journalPlatformAiCall(
  orgId: string,
  provider: AiProvider,
  feature: AiFeature,
  entry: AiJournalEntry,
  agentId: string | null = null,
): void {
  void recordAiUsage({ orgId, feature, provider, keySource: "platform", agentId, ...entry })
}

/**
 * A call settled after the fact (a voice session closed by the tab or by the
 * reaper): journaled on the key the organization has for the provider now —
 * its own if it holds one, else the platform's.
 */
export async function journalAiCallOnCurrentKey(
  orgId: string,
  provider: AiProvider,
  feature: AiFeature,
  entry: AiJournalEntry,
  agentId: string | null = null,
): Promise<void> {
  let keySource: AiKeySource = "platform"
  try {
    if ((await tenantAiAccess(orgId, provider)).secret) keySource = "tenant"
  } catch {
    logOperationalFailure("ai-gateway-access", "warn")
  }
  await recordAiUsage({ orgId, feature, provider, keySource, agentId, ...entry })
}
