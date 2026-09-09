/**
 * Allowlist for the self-service feature-flag toggle
 * (`PATCH /api/v1/settings/ai-features`).
 *
 * WHY THIS EXISTS — the flag string written by that route lands in
 * `Organization.features`, and `moduleRecordFromOrgFields` (src/lib/modules.ts)
 * turns EVERY entry of that array into `modules[<entry>] = true`. `hasModule`
 * step 2 then treats `modules[id] === true` as the authoritative grant, and
 * `requireAuth` gates the whole API on it (src/lib/api-auth.ts:468). So an
 * unvalidated flag name is not cosmetic: writing `"mtm"` (or any other
 * ModuleId) through the toggle grants the tenant a paid module nobody sold
 * them. The allowlist below is the boundary that keeps a *feature* flag from
 * being spent as a *module* entitlement.
 *
 * Two independent guards, deliberately not collapsed into one:
 *   1. the flag must be a known toggle (exact name or approved prefix), and
 *   2. it must not be a ModuleId, whatever the list above says.
 * Guard 2 keeps holding if someone later widens the list without re-reading
 * this comment.
 */
import { MODULE_REGISTRY, GROUP_MODULE_IDS, type ModuleId } from "@/lib/modules"
import {
  CHATBOT_CHANNEL_DISABLED_PREFIX,
  INBOX_QUALIFICATION_FLAG,
  INBOX_QUALIFICATION_BOARD_PREFIX,
} from "@/lib/chatbot-engine"
import {
  OMNICHANNEL_AI_FEATURE,
  SUPPORT_AI_DISABLED_FEATURE,
} from "@/lib/ai/feature-keys"

/**
 * AI automation toggles surfaced in Settings → AI automation. The
 * `AI_FEATURE_KEYS` table in that page is typed against this union, so adding a
 * row there without adding it here is a compile error rather than a silent 400
 * at runtime.
 */
export const AI_AUTOMATION_FLAGS = [
  "ai_daily_briefing",
  "ai_anomaly_detection",
  "ai_lead_scoring",
  "ai_auto_acknowledge_shadow",
  "ai_auto_acknowledge",
  "ai_auto_followup_shadow",
  "ai_auto_followup",
  "ai_auto_payment_reminder_shadow",
  "ai_auto_payment_reminder",
  "ai_auto_renewal_shadow",
  "ai_auto_renewal",
  "ai_auto_hot_lead_shadow",
  "ai_auto_hot_lead",
  "ai_auto_triage_shadow",
  "ai_auto_triage",
  "ai_auto_stage_advance_shadow",
  "ai_auto_stage_advance",
  "ai_auto_sentiment_shadow",
  "ai_auto_sentiment",
  "ai_auto_kb_close_shadow",
  "ai_auto_kb_close",
  "ai_auto_duplicate_shadow",
  "ai_auto_duplicate",
  "ai_auto_credit_limit_shadow",
  "ai_auto_credit_limit",
  "ai_auto_meeting_recap_shadow",
  "ai_auto_meeting_recap",
  "ai_auto_social_reply_shadow",
  "ai_auto_social_reply",
  "ai_auto_social_viral_shadow",
  "ai_auto_social_viral",
] as const

export type AiAutomationFlag = (typeof AI_AUTOMATION_FLAGS)[number]

/** Inbox toggles that share the same endpoint but are not `ai_*` names. */
export const INBOX_TOGGLE_FLAGS = [
  OMNICHANNEL_AI_FEATURE,
  "chatbotAutoReply",
  INBOX_QUALIFICATION_FLAG,
] as const

/** Module master switches that reuse the same audited settings endpoint. */
export const MODULE_AI_TOGGLE_FLAGS = [
  SUPPORT_AI_DISABLED_FEATURE,
] as const

/**
 * Toggles whose suffix is tenant data (a channel name, a board id), so they
 * cannot be enumerated. The suffix is charset- and length-bounded instead —
 * `features` is a shared JSON array, and an unbounded suffix is a cheap way to
 * bloat every subsequent auth lookup that materialises it.
 */
const PREFIXED_FLAGS = [
  CHATBOT_CHANNEL_DISABLED_PREFIX,
  INBOX_QUALIFICATION_BOARD_PREFIX,
] as const

const SUFFIX_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const EXACT_FLAGS: ReadonlySet<string> = new Set<string>([
  ...AI_AUTOMATION_FLAGS,
  ...INBOX_TOGGLE_FLAGS,
  ...MODULE_AI_TOGGLE_FLAGS,
])

/** Every id that `hasModule` can grant — never writable through this endpoint. */
const MODULE_IDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(MODULE_REGISTRY),
  ...GROUP_MODULE_IDS,
])

export function isModuleId(flag: string): flag is ModuleId {
  return MODULE_IDS.has(flag)
}

/**
 * Whether `PATCH /api/v1/settings/ai-features` may write this flag.
 * Rejects module ids unconditionally — see the guard-2 note at the top.
 */
export function isToggleableFeatureFlag(flag: string): boolean {
  if (typeof flag !== "string" || flag.length === 0 || flag.length > 128) return false
  if (isModuleId(flag)) return false
  if (EXACT_FLAGS.has(flag)) return true
  return PREFIXED_FLAGS.some(
    (prefix) => flag.startsWith(prefix) && SUFFIX_PATTERN.test(flag.slice(prefix.length)),
  )
}
