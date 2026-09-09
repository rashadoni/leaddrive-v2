/**
 * Mobile Studio types — C2 Phase 6 Block G first slice.
 *
 * Salesforce Marketing Cloud Mobile Studio analogue. Shared shape
 * between 5 pure helpers:
 *   1. state-machine            — campaign + delivery transitions
 *   2. audience-filter-validator — JSONB filter shape + safety
 *   3. content-validator        — per-channel body+title limits
 *   4. delivery-scheduler       — quiet-hours + timezone gating
 *   5. (re-exported)            — typed I/O for slice-2 caller code
 *
 * Pure — no Prisma imports.
 */

/* ─── Channels ────────────────────────────────────────────────────────── */

export const MOBILE_CHANNELS = ["push", "in_app", "sms"] as const
export type MobileChannel = (typeof MOBILE_CHANNELS)[number]

/* ─── Campaign status + transitions ───────────────────────────────────── */

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "in_flight",
  "completed",
  "cancelled",
  "failed",
] as const

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/**
 *   draft → scheduled | cancelled
 *   scheduled → in_flight | cancelled | failed (pre-flight error)
 *   in_flight → completed | failed (mid-flight hard error)
 *   completed → []
 *   cancelled → []
 *   failed → []
 *
 * "Cancelled" is admin-driven (clicked stop before send). "Failed"
 * is dispatcher-driven (auth/quota/config error).
 */
export const CAMPAIGN_TRANSITIONS: Readonly<
  Record<CampaignStatus, readonly CampaignStatus[]>
> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["in_flight", "cancelled", "failed"],
  in_flight: ["completed", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
}

/* ─── Delivery status + transitions ───────────────────────────────────── */

export const DELIVERY_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "failed",
  "bounced",
  "suppressed",
] as const

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

/**
 *   pending → sent | suppressed
 *   sent → delivered | failed | bounced
 *   delivered → []
 *   failed → []
 *   bounced → []
 *   suppressed → []
 *
 * Slice-2 may add `pending → pending` retry-from-bounce branch by
 * extending the table; today bounced is terminal so retry = new row.
 */
export const DELIVERY_TRANSITIONS: Readonly<
  Record<DeliveryStatus, readonly DeliveryStatus[]>
> = {
  pending: ["sent", "suppressed"],
  sent: ["delivered", "failed", "bounced"],
  delivered: [],
  failed: [],
  bounced: [],
  suppressed: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── Audience filter ─────────────────────────────────────────────────── */

/**
 * Slice-1 supported filter shape. Slice-2 may extend with attribute
 * predicates (custom field equals, recency thresholds, etc.) — the
 * audience-filter-validator is the gate for new shape additions.
 */
export interface AudienceFilter {
  /** Contact tags to require (AND across tags). */
  contactTags?: readonly string[]
  /** Segment slugs to require (AND). */
  segmentSlugs?: readonly string[]
  /** Required channel opt-in (push/in_app/sms). */
  channelOptIn?: MobileChannel
  /** Contact IDs to exclude (suppressions, do-not-mail). */
  excludeContactIds?: readonly string[]
}

export interface ValidateAudienceFilterInput {
  filter: unknown
}

export type ValidateAudienceFilterResult =
  | { ok: true; filter: AudienceFilter }
  | { ok: false; errors: string[] }

/* ─── Content validator ──────────────────────────────────────────────── */

export interface MobileContent {
  channel: MobileChannel
  /** Push/in_app title. Null for SMS. */
  title?: string | null
  body: string
  /** Optional deep-link URL — slice-2 push payload includes. */
  deepLinkUrl?: string | null
}

export interface ContentLimits {
  /** Push: combined title + body cap (iOS/Android effective truncation). */
  pushTitleMax: number
  pushBodyMax: number
  /** SMS: single + multi-part guidance. Multi-part fees apply slice-2. */
  smsBodyMax: number
  /** In-app: HTML body (slice-2 sanitises before render). */
  inAppTitleMax: number
  inAppBodyMax: number
  /** Deep-link URL length cap. */
  deepLinkUrlMax: number
}

export const DEFAULT_CONTENT_LIMITS: Readonly<ContentLimits> = {
  pushTitleMax: 100,
  pushBodyMax: 240,
  smsBodyMax: 1600,
  inAppTitleMax: 200,
  inAppBodyMax: 5000,
  deepLinkUrlMax: 2048,
}

export interface ValidateContentInput {
  content: MobileContent
  limits?: Partial<ContentLimits>
}

export type ValidateContentResult =
  | { ok: true; content: MobileContent }
  | { ok: false; errors: string[] }

/* ─── Delivery scheduler ──────────────────────────────────────────────── */

/**
 * Tenant delivery-window config. `quietHoursStart`/`End` are integer
 * hours (0..23) — e.g. start=22, end=8 means "no delivery between
 * 22:00 and 08:00 local". If start === end, treated as "no quiet
 * hours" (always-on). `timezone` is an IANA name — slice-1 helper
 * does NOT do per-recipient timezone lookup; it uses the tenant's
 * configured tz uniformly.
 */
export interface DeliveryWindow {
  quietHoursStart?: number
  quietHoursEnd?: number
  timezone?: string
}

export interface CheckDeliveryInput {
  /** Tenant-level window config (typically MobileCampaign.deliveryWindow). */
  window: DeliveryWindow
  /** Caller-supplied "now" for testability. */
  asOf: Date
}

export interface DeliveryCheckResult {
  /** True if the asOf falls within an active window (NOT in quiet hours). */
  canDeliver: boolean
  /**
   * If canDeliver=false, the next allowed delivery time. NULL if
   * window config is invalid.
   */
  nextDeliveryAt: Date | null
  /** Local hour computed at evaluation time (0..23) for caller logging. */
  localHourAtAsOf: number | null
}

export type CheckDeliveryResult =
  | { ok: true; check: DeliveryCheckResult }
  | { ok: false; error: string }
