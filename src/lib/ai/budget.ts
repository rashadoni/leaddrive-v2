import { prisma } from "@/lib/prisma"
import {
  latestMonitoringResetBudgetCarryForward,
  monitoringResetAiCostCarrySince,
} from "@/lib/social/paid-provider-run-scope"
import { featureFlagsToArray } from "@/lib/modules"

const DEFAULT_DAILY_LIMIT_USD = 5.0

// Model pricing per million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  // Current Anthropic aliases (latest tiers, verified 2026-06 via Perplexity;
  // sonnet/opus aliases carry no date suffix — the prior "*-4-6-20250514" IDs
  // were fictional and 502'd at the API).
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-8": { input: 15.0, output: 75.0 },
}

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
  .filter((model) => !RETIRED_AI_MODELS.has(model))

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
 */
export function calculateAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["claude-haiku-4-5-20251001"]
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

/**
 * Check if organization has remaining AI budget for today.
 * Sums costUsd from AiInteractionLog for the current day.
 * Returns { allowed, spent, limit, remaining }.
 */
export async function checkAiBudget(orgId: string): Promise<{
  allowed: boolean
  spent: number
  limit: number
  remaining: number
}> {
  const now = new Date()
  const todayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ))

  const [result, resetCarry] = await Promise.all([
    prisma.aiInteractionLog.aggregate({
      where: {
        organizationId: orgId,
        createdAt: { gte: todayStart },
        costUsd: { not: null },
      },
      _sum: { costUsd: true },
    }),
    latestMonitoringResetBudgetCarryForward(prisma, orgId),
  ])

  const spent = (result._sum.costUsd || 0)
    + monitoringResetAiCostCarrySince(resetCarry, todayStart)

  // Get org-level limit from settings, fallback to default
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const settings = (org?.settings as Record<string, any>) || {}
  const limit = typeof settings.aiDailyBudgetUsd === "number"
    ? settings.aiDailyBudgetUsd
    : DEFAULT_DAILY_LIMIT_USD

  const remaining = Math.max(0, limit - spent)

  return {
    allowed: spent < limit,
    spent: Math.round(spent * 1000) / 1000,
    limit,
    remaining: Math.round(remaining * 1000) / 1000,
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
