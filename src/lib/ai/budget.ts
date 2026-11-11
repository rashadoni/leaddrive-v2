import { prisma } from "@/lib/prisma"
import {
  latestMonitoringResetBudgetCarryForward,
  monitoringResetAiCostCarrySince,
} from "@/lib/social/paid-provider-run-scope"
import { featureFlagsToArray } from "@/lib/modules"
import { aiCallCostUsd, MODEL_PRICING } from "@/lib/ai/gateway/pricing"

/**
 * The organization's own daily AI limit, in USD, or null when it set none.
 *
 * Owner, 2026-11-11: «зачем ты ставишь лимит? лимит в балансе сколько
 * загрузил… если клиент захочет, то пусть ставит лимит». No limit is imposed:
 * until 2026-11-11 every organization without one stopped at $5 a day (and
 * the Advisor suite wrote $10). The organization's admin sets or clears it in
 * «Настройки → ИИ и расходы»; anything but a positive number is no limit.
 */
export function readDailyAiLimit(settings: unknown): number | null {
  const value = settings && typeof settings === "object" ? (settings as Record<string, unknown>).aiDailyBudgetUsd : undefined
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

// One price table for every metered AI call: src/lib/ai/gateway/pricing.ts.
export { MODEL_PRICING, CACHE_READ_PRICE_FACTOR, CACHE_WRITE_5M_PRICE_FACTOR } from "@/lib/ai/gateway/pricing"

/**
 * Model IDs Anthropic no longer serves. Kept priced, because historical
 * interaction logs reference them and their cost must still add up, but never
 * offered for new configuration and never sent to the API.
 *
 * A retired ID is not a soft failure: the API answers 404 and the whole assistant
 * turn dies. On 2026-08-20 two stored agent configs and this repository's own
 * chat default still pointed at `claude-sonnet-4-20250514`, retired months
 * earlier — verified dead against the live account the same day, along with
 * `claude-sonnet-4-5-20250514` and `claude-sonnet-4-6-20250514`, two IDs that
 * never existed at all.
 */
const RETIRED_AI_MODELS = new Set([
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-5-20250514",
  "claude-sonnet-4-6-20250514",
])

/** What an un-configured caller gets, and what a retired ID falls back to. */
export const DEFAULT_AI_MODEL = "claude-sonnet-4-6"

/**
 * Allowlist of configurable agent model IDs — a model is valid iff we price it
 * and Anthropic still serves it. Tying the allowlist to MODEL_PRICING keys means
 * an un-priced (typo'd or rogue) model can never be stored, so it can't break
 * the AI call or be metered at the wrong rate. Used by the ai-configs validators.
 */
export const KNOWN_AI_MODELS = Object.keys(MODEL_PRICING)
  // Agents talk through the Claude client; the price table also prices the
  // gateway's other providers, which an agent cannot be configured to.
  .filter((model) => model.startsWith("claude-") && !RETIRED_AI_MODELS.has(model))

/**
 * The model to actually call, given whatever a tenant's config happens to hold.
 *
 * Configs outlive model generations. Rather than let a stored ID that Anthropic
 * has since retired take the assistant down, substitute the current default and
 * say so in the log — the tenant keeps a working assistant, and the stale row is
 * visible to whoever cleans it up.
 */
export function resolveAiModel(stored?: string | null, fallback: string = DEFAULT_AI_MODEL): string {
  if (!stored) return fallback
  if (!RETIRED_AI_MODELS.has(stored)) return stored
  console.warn(`[ai] configured model ${stored} is retired; using ${fallback}`)
  return fallback
}

/**
 * Calculate cost in USD for a given model + token usage.
 * Centralised pricing — use this everywhere instead of inline formulas.
 *
 * With prompt caching Anthropic's `input_tokens` is only the uncached rest of
 * the prompt; the cached part comes back separately as read and written
 * tokens. A caller that caches must pass them, or the budget misses that part
 * of the prompt entirely.
 */
export function calculateAiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache?: { readTokens?: number; writeTokens?: number },
): number {
  return aiCallCostUsd(model, inputTokens, outputTokens, cache)
}

/**
 * Check if organization has remaining AI budget for today.
 * Sums today's (UTC) spend in the gateway's journal `ai_usage` — every paid
 * AI call on the platform's key (src/lib/ai/gateway); calls on the
 * organization's own key are its own business at its provider. Until 2026-11-09 it
 * summed AiInteractionLog.costUsd, which only the features that remembered to
 * log wrote, and only for Claude.
 * Returns { allowed, spent, limit, remaining }; limit and remaining are null
 * when the organization set no limit (`readDailyAiLimit`), and then it is
 * always allowed.
 */
export async function checkAiBudget(orgId: string): Promise<{
  allowed: boolean
  spent: number
  limit: number | null
  remaining: number | null
}> {
  const now = new Date()
  const todayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ))

  const [result, resetCarry] = await Promise.all([
    prisma.aiUsage.aggregate({
      where: {
        organizationId: orgId,
        createdAt: { gte: todayStart },
        // The limit guards the platform's key. A call on the organization's
        // own key is paid by the organization at its provider.
        keySource: "platform",
      },
      _sum: { costUsd: true },
    }),
    latestMonitoringResetBudgetCarryForward(prisma, orgId),
  ])

  const spent = (result._sum.costUsd || 0)
    + monitoringResetAiCostCarrySince(resetCarry, todayStart)

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const limit = readDailyAiLimit(org?.settings)

  return {
    allowed: limit === null || spent < limit,
    spent: Math.round(spent * 1000) / 1000,
    limit,
    remaining: limit === null ? null : Math.round(Math.max(0, limit - spent) * 1000) / 1000,
  }
}

/**
 * A6 (Creatio 10X roadmap) — granular AI limits, one level below the daily USD budget.
 * Stored in Organization.settings.aiLimits (JSON, merged over defaults). Protects
 * against a single flooding customer burning the whole budget: caps replies per
 * conversation (lifetime), per contact per day, and output tokens per reply.
 */
export interface AiGranularLimits {
  /** Lifetime cap of AI replies in one conversation (roadmap default 50). */
  maxRepliesPerConversation: number
  /** AI replies to one CONTACT per rolling day (flooder guard). */
  maxRepliesPerContactPerDay: number
  /** Hard clamp on max_tokens per generated reply. */
  maxOutputTokens: number
}

export const DEFAULT_AI_LIMITS: AiGranularLimits = {
  maxRepliesPerConversation: 50,
  maxRepliesPerContactPerDay: 30,
  maxOutputTokens: 1024,
}

function intInRange(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null
}

/** Org limits merged over defaults; junk values fall back to the default. */
export async function getAiLimits(orgId: string): Promise<AiGranularLimits> {
  const org = await prisma.organization
    .findUnique({ where: { id: orgId }, select: { settings: true } })
    .catch(() => null)
  const raw = ((org?.settings as Record<string, unknown>) || {}).aiLimits
  const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    maxRepliesPerConversation:
      intInRange(l.maxRepliesPerConversation, 1, 1000) ?? DEFAULT_AI_LIMITS.maxRepliesPerConversation,
    maxRepliesPerContactPerDay:
      intInRange(l.maxRepliesPerContactPerDay, 1, 1000) ?? DEFAULT_AI_LIMITS.maxRepliesPerContactPerDay,
    maxOutputTokens: intInRange(l.maxOutputTokens, 64, 4096) ?? DEFAULT_AI_LIMITS.maxOutputTokens,
  }
}

export type AiLimitVerdict =
  | { allowed: true; limits: AiGranularLimits }
  | { allowed: false; limits: AiGranularLimits; reason: "conversation_cap" | "contact_daily_cap" }

/**
 * Counter checks BEFORE generation (an over-cap conversation must not burn tokens).
 * Counts existing AI-marked outbound rows; fail-open on counter errors — the daily
 * USD budget above remains the hard backstop.
 */
export async function checkConversationAiLimits(opts: {
  orgId: string
  conversationId?: string | null
  contactId?: string | null
  webChatSessionId?: string | null
}): Promise<AiLimitVerdict> {
  const limits = await getAiLimits(opts.orgId)
  try {
    if (opts.conversationId) {
      const inConv = await prisma.channelMessage.count({
        where: {
          organizationId: opts.orgId,
          conversationId: opts.conversationId,
          direction: "outbound",
          metadata: { path: ["aiAutoReply"], equals: true },
        },
      })
      if (inConv >= limits.maxRepliesPerConversation) return { allowed: false, limits, reason: "conversation_cap" }
    }
    if (opts.webChatSessionId) {
      // aiGenerated filter: the session-open GREETING is also fromRole "bot" but costs
      // no tokens — only real generated replies count against the cap.
      const inSession = await prisma.webChatMessage.count({
        where: {
          organizationId: opts.orgId,
          sessionId: opts.webChatSessionId,
          fromRole: "bot",
          metadata: { path: ["aiGenerated"], equals: true },
        },
      })
      if (inSession >= limits.maxRepliesPerConversation) return { allowed: false, limits, reason: "conversation_cap" }
    }
    if (opts.contactId) {
      const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const toContact = await prisma.channelMessage.count({
        where: {
          organizationId: opts.orgId,
          contactId: opts.contactId,
          direction: "outbound",
          metadata: { path: ["aiAutoReply"], equals: true },
          createdAt: { gte: dayStart },
        },
      })
      if (toContact >= limits.maxRepliesPerContactPerDay) return { allowed: false, limits, reason: "contact_daily_cap" }
    }
  } catch {
    /* counter failure must not block replies — the USD budget still guards */
  }
  return { allowed: true, limits }
}

/**
 * Check if a specific AI automation feature is enabled for the organization.
 * Features are stored in Organization.features JSON array.
 */
export async function isAiFeatureEnabled(orgId: string, featureName: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { features: true },
  })

  // Флаги живут в JSON-поле и на проде встречались ЗАПАКОВАННЫМИ в строку
  // (brandprotection, 2026-08-03: список внутри строки). Узкая проверка
  // `Array.isArray` отвечала на это «выключено» — и вся автоматика ИИ у
  // тенанта молча останавливалась, а крон рапортовал «ноль действий», что
  // читается как «нечего делать». Разбор обеих форм уже есть в проекте.
  return featureFlagsToArray(org?.features).includes(featureName)
}

/**
 * Guard function: checks both feature flag AND budget before running an AI automation.
 * Returns { proceed: true } or { proceed: false, reason: string }.
 */
export async function canRunAiAutomation(
  orgId: string,
  featureName: string,
): Promise<{ proceed: boolean; reason?: string }> {
  const enabled = await isAiFeatureEnabled(orgId, featureName)
  if (!enabled) {
    return { proceed: false, reason: `Feature "${featureName}" is not enabled` }
  }

  const budget = await checkAiBudget(orgId)
  if (!budget.allowed) {
    return { proceed: false, reason: `Daily AI budget exceeded: $${budget.spent}/$${budget.limit}` }
  }

  return { proceed: true }
}
