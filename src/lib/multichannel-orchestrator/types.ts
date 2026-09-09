/**
 * C12 Multi-channel Campaign Orchestrator — types + state machines.
 *
 * Slice-1 contract. Types mirror Prisma schema + DB triggers
 * (prisma/migrations/20260519170000_multichannel_orchestrator/migration.sql).
 *
 * Slice-2 dispatcher worker reads these to:
 *   1. resolve channel priority per contact (channel-priority-resolver)
 *   2. check quiet-hours window (quiet-hours-checker)
 *   3. check frequency caps (frequency-cap-checker)
 *   4. dedup across channels (cross-channel-dedup)
 *   5. hand off to channel-specific sender (existing sendEmail/SMS/etc).
 */

// ── Channel taxonomy ────────────────────────────────────────────

export type Channel =
  | "email"
  | "sms"
  | "push"
  | "telegram"
  | "whatsapp"
  | "voice"
  | "postal"

export const CHANNELS: readonly Channel[] = [
  "email",
  "sms",
  "push",
  "telegram",
  "whatsapp",
  "voice",
  "postal",
] as const

// ── Policy lifecycle ────────────────────────────────────────────

export type PolicyStatus = "draft" | "active" | "archived"

export const POLICY_STATUSES: readonly PolicyStatus[] = [
  "draft",
  "active",
  "archived",
] as const

export const POLICY_STATUS_TRANSITIONS: Readonly<
  Record<PolicyStatus, readonly PolicyStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["archived"],
  archived: [],
}

// ── Run lifecycle ───────────────────────────────────────────────

export type RunStatus = "pending" | "running" | "succeeded" | "failed"

export const RUN_STATUSES: readonly RunStatus[] = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const

export const RUN_STATUS_TRANSITIONS: Readonly<
  Record<RunStatus, readonly RunStatus[]>
> = {
  pending: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
}

export type TriggerSource = "cron" | "manual" | "api" | "webhook"

export const TRIGGER_SOURCES: readonly TriggerSource[] = [
  "cron",
  "manual",
  "api",
  "webhook",
] as const

// ── Delivery outcome ────────────────────────────────────────────

export type DeliveryOutcome =
  | "attempted"
  | "no_channel_available"
  | "suppressed_quiet_hours"
  | "suppressed_frequency_cap"
  | "deduped"

export const DELIVERY_OUTCOMES: readonly DeliveryOutcome[] = [
  "attempted",
  "no_channel_available",
  "suppressed_quiet_hours",
  "suppressed_frequency_cap",
  "deduped",
] as const

// ── Quiet-hours window shapes ───────────────────────────────────

/**
 * "any" applies every day; integer is dayOfWeek (0 = Sunday, ..., 6 = Saturday).
 */
export type QuietHoursDayOfWeek = "any" | 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface QuietHoursWindow {
  dayOfWeek: QuietHoursDayOfWeek
  /** "HH:MM" 24-hour. Inclusive. */
  from: string
  /** "HH:MM" 24-hour. Exclusive. `from > to` wraps around midnight. */
  to: string
}

export interface QuietHoursConfig {
  /** IANA timezone (e.g. "Europe/Warsaw"). Defaults to UTC if absent. */
  timezone?: string
  windows: QuietHoursWindow[]
}

// ── Frequency cap shapes ────────────────────────────────────────

export interface PerChannelFrequencyCap {
  channel: Channel
  maxPerDay?: number | null
  maxPerWeek?: number | null
}

export interface OverallFrequencyCap {
  maxPerDay?: number | null
  maxPerWeek?: number | null
}

export interface FrequencyCapConfig {
  perChannel?: PerChannelFrequencyCap[]
  overall?: OverallFrequencyCap
}

// ── Contact channel-pref input ──────────────────────────────────

export interface ChannelPreferenceInput {
  channel: Channel
  /** 1..100 — lower = preferred. NULL = no preference. */
  priority: number | null
  isOptedIn: boolean
}

// ── Resolver result ─────────────────────────────────────────────

/**
 * Output of channel-priority-resolver. Ordered chain of channels
 * the orchestrator should try, opted-in only.
 */
export interface ResolvedChannelChain {
  contactId: string
  /** Ordered: first = most-preferred. Excludes opted-out channels. */
  channels: Channel[]
  /** If empty, contact has no opted-in channels at all. */
  hasAnyOptIn: boolean
}

// ── Quiet-hours check result ────────────────────────────────────

export interface QuietHoursCheckResult {
  inQuietHours: boolean
  /** Diagnostic — which window matched, if any. */
  matchedWindow?: QuietHoursWindow
}

// ── Frequency cap check result ──────────────────────────────────

export interface FrequencyCapCheckResult {
  /** True if sending another delivery is allowed. */
  allowed: boolean
  /** Diagnostic when blocked. */
  reason?: string
  /** All caps in effect, for slice-2 UI display. */
  capsHit: string[]
}

// ── Cross-channel dedup result ──────────────────────────────────

export interface DedupCheckInput {
  /** Past deliveries to the same contact for the same campaign. */
  priorDeliveries: ReadonlyArray<{
    selectedChannel: Channel | null
    outcome: DeliveryOutcome
    decidedAt: Date
  }>
  asOf: Date
  /** Window in seconds. */
  dedupWindowSeconds: number
  /** Channel currently being considered for this contact. */
  candidateChannel: Channel
}

export interface DedupCheckResult {
  /** True if we should suppress this delivery to avoid duplicate. */
  shouldDedup: boolean
  /** Diagnostic — which prior delivery caused the suppression. */
  reason?: string
}

// ── Defaults ────────────────────────────────────────────────────

/** Default dedup window matches DB column default. */
export const DEFAULT_DEDUP_WINDOW_SECONDS = 86_400

/** Max-per-day / max-per-week sane upper bound for validators. */
export const FREQUENCY_CAP_UPPER_BOUND = 1000
