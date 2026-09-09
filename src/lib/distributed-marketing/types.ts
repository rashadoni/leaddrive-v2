/**
 * C7 Distributed Marketing — types + state machines.
 *
 * Slice-1 contract for the corporate + local template engine.
 * Types mirror Prisma schema + DB triggers
 * (prisma/migrations/20260519190000_distributed_marketing/migration.sql).
 *
 * NOT to be confused with:
 *   • C12 Multi-channel Orchestrator (which channel to use)
 *   • C1 Email Studio personalization tokens (general-purpose template engine)
 * C7 is specifically the corporate-locked vs rep-fillable variable split.
 */

// ── Template channel ────────────────────────────────────────────

export type TemplateChannel = "email" | "sms" | "push" | "telegram" | "whatsapp"

export const TEMPLATE_CHANNELS: readonly TemplateChannel[] = [
  "email",
  "sms",
  "push",
  "telegram",
  "whatsapp",
] as const

/** Channels that require a subject — must align with DB coherence check. */
export const CHANNELS_REQUIRING_SUBJECT: readonly TemplateChannel[] = [
  "email",
  "push",
] as const

/**
 * Reserved placeholder prefixes for per-send variables that DON'T need
 * declaration in lockedVariables or unlockedVariables. These are filled
 * at send time by slice-2 from the contact profile or per-send context:
 *
 *   contact_*  — contact profile (firstName, lastName, email, phone, ...)
 *   today_*    — date helpers (today_iso, today_human)
 *   sender_*   — sender user profile (sender_name, sender_email)
 *
 * Templates can use `{{contact_first_name}}` etc. without declaring it.
 * The validator skips these prefixes; the renderer expects the slice-2
 * caller to populate `contactVariables` with the matching keys.
 */
export const RESERVED_PLACEHOLDER_PREFIXES: readonly string[] = [
  "contact_",
  "today_",
  "sender_",
] as const

// ── Template lifecycle ──────────────────────────────────────────

export type TemplateStatus = "draft" | "active" | "archived"

export const TEMPLATE_STATUSES: readonly TemplateStatus[] = [
  "draft",
  "active",
  "archived",
] as const

export const TEMPLATE_STATUS_TRANSITIONS: Readonly<
  Record<TemplateStatus, readonly TemplateStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["draft", "archived"], // pull-back to draft permitted
  archived: [],
}

// ── Personalization lifecycle ───────────────────────────────────

export type PersonalizationStatus = "draft" | "active" | "archived"

export const PERSONALIZATION_STATUSES: readonly PersonalizationStatus[] = [
  "draft",
  "active",
  "archived",
] as const

export const PERSONALIZATION_STATUS_TRANSITIONS: Readonly<
  Record<PersonalizationStatus, readonly PersonalizationStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["draft", "archived"],
  archived: [],
}

// ── Distribution scope ──────────────────────────────────────────

export type DistributionType = "all" | "user" | "role" | "team"

export const DISTRIBUTION_TYPES: readonly DistributionType[] = [
  "all",
  "user",
  "role",
  "team",
] as const

// ── Send outcome ────────────────────────────────────────────────

export type SendOutcome = "sent" | "failed" | "bounced"

export const SEND_OUTCOMES: readonly SendOutcome[] = [
  "sent",
  "failed",
  "bounced",
] as const

// ── Variable slot ───────────────────────────────────────────────

/**
 * Type-tag for unlockedVariables[] slot definitions. Validator does
 * light shape-check (string non-empty / url URL.parse / number numeric).
 * Slice-2 admin UI surfaces these as form-field types.
 */
export type VariableSlotType =
  | "string"
  | "text"
  | "url"
  | "email"
  | "number"
  | "boolean"

export const VARIABLE_SLOT_TYPES: readonly VariableSlotType[] = [
  "string",
  "text",
  "url",
  "email",
  "number",
  "boolean",
] as const

export interface VariableSlot {
  /** {{placeholder}} name in the template body. */
  name: string
  /** Display label for the rep-facing form. */
  label: string
  /** Slot type for slice-2 UI + slice-1 validator. */
  type: VariableSlotType
  /** If true, personalization can't transition to active without this slot. */
  required?: boolean
  /** Optional default value (rep can override). */
  defaultValue?: unknown
}

// ── Render input ────────────────────────────────────────────────

export interface RenderInput {
  /** Template's subject line (may be undefined for body-only channels). */
  subjectTemplate?: string | null
  bodyTemplate: string
  /** Corporate-locked vars (always applied). */
  lockedVariables: Record<string, unknown>
  /** Rep-filled vars from the personalization. */
  personalizationValues: Record<string, unknown>
  /**
   * Optional per-send contact-level vars (slice-2 will fill from contact
   * profile: contact.firstName, contact.companyName, etc.).
   */
  contactVariables?: Record<string, unknown>
}

export interface RenderOutput {
  subject: string | null
  body: string
  /** Placeholders that had NO value — useful for slice-2 warnings. */
  unfilledPlaceholders: string[]
}

// ── Distribution resolver input ─────────────────────────────────

export interface UserAccessProfile {
  userId: string
  role: string
  /** Slice-2 team membership — slice-1 takes opaque ref array. */
  teamRefs: readonly string[]
}

export interface DistributionRule {
  distributionType: DistributionType
  targetUserId?: string | null
  targetRole?: string | null
  targetTeamRef?: string | null
}

export interface AccessCheckResult {
  hasAccess: boolean
  /** Diagnostic — which rule granted access (or null if no rule matched). */
  grantedBy: DistributionRule | null
}
