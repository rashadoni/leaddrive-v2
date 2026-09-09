/**
 * Public Sector state machine — R8 slice 1.
 *
 * Four lifecycles (mirrors R2/R6/R7 pattern):
 *   • Citizen — active → inactive → deceased
 *   • Case    — submitted → intake → assigned → in_progress → resolved
 *                (+ escalated / denied / withdrawn side exits)
 *   • License — applied → under_review → issued → expired/suspended/revoked
 *   • Grant   — submitted → under_review → approved → disbursing → disbursed
 *                (+ denied / withdrawn / cancelled side exits)
 *
 * Pure synchronous.
 */
import {
  CASE_STATUSES,
  CASE_TRANSITIONS,
  CITIZEN_STATUSES,
  CITIZEN_TRANSITIONS,
  GRANT_STATUSES,
  GRANT_TRANSITIONS,
  LICENSE_STATUSES,
  LICENSE_TRANSITIONS,
  type AuthorityLevel,
  type CaseStatus,
  type CitizenStatus,
  type GrantStatus,
  type LicenseStatus,
  type TransitionResult,
} from "./types"

function isCitizenStatus(v: unknown): v is CitizenStatus {
  return (
    typeof v === "string" &&
    (CITIZEN_STATUSES as readonly string[]).includes(v)
  )
}

function isCaseStatus(v: unknown): v is CaseStatus {
  return (
    typeof v === "string" && (CASE_STATUSES as readonly string[]).includes(v)
  )
}

function isLicenseStatus(v: unknown): v is LicenseStatus {
  return (
    typeof v === "string" &&
    (LICENSE_STATUSES as readonly string[]).includes(v)
  )
}

function isGrantStatus(v: unknown): v is GrantStatus {
  return (
    typeof v === "string" && (GRANT_STATUSES as readonly string[]).includes(v)
  )
}

/* ─── Citizen lifecycle ──────────────────────────────────────────────── */

export function transitionCitizen(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isCitizenStatus(from)) {
    return { ok: false, error: `unknown citizen status "${String(from)}"` }
  }
  if (!isCitizenStatus(to)) {
    return {
      ok: false,
      error: `unknown citizen target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!CITIZEN_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal citizen transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isCitizenTerminal(status: CitizenStatus): boolean {
  return CITIZEN_TRANSITIONS[status].length === 0
}

export function allowedNextCitizen(
  from: CitizenStatus
): readonly CitizenStatus[] {
  return CITIZEN_TRANSITIONS[from]
}

/* ─── Case lifecycle ─────────────────────────────────────────────────── */

export function transitionCase(from: unknown, to: unknown): TransitionResult {
  if (!isCaseStatus(from)) {
    return { ok: false, error: `unknown case status "${String(from)}"` }
  }
  if (!isCaseStatus(to)) {
    return { ok: false, error: `unknown case target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!CASE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal case transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isCaseTerminal(status: CaseStatus): boolean {
  return CASE_TRANSITIONS[status].length === 0
}

export function allowedNextCase(from: CaseStatus): readonly CaseStatus[] {
  return CASE_TRANSITIONS[from]
}

/* ─── Context-aware case transition (slice-2) ───────────────────────── */

/**
 * Context for a case transition decision. Mirrors R6
 * `OutageTransitionContext` (PR #85) + R7 `ClaimTransitionContext`
 * (PR #87) — third copy of the pattern, completing the trio across
 * Phase 7 industry clouds.
 */
export interface CaseTransitionContext {
  /**
   * The assigned official's `authorityLevel`. NULL when the case
   * has no assignedOfficialId set (intake queue stage).
   *
   * AUTHORITY_LEVELS = "line" | "supervisor" | "director" — defined
   * at types.ts:28-29 and enforced by DB CHECK on
   * `public_sector_officials.authorityLevel`.
   */
  assignedAuthorityLevel: AuthorityLevel | null
  /** Caller-supplied "now" for testability. Defaults to current time. */
  asOf?: Date
}

/**
 * Authority levels that can drive `escalated → resolved | denied`.
 * Line-level officials need to walk the case BACK through `in_progress`
 * (which is illegal per state-machine — escalation is a one-way
 * promotion). In practice they must request supervisor override. The
 * helper rejects with the operator-friendly error.
 */
const ESCALATED_DECISION_AUTHORITIES: readonly AuthorityLevel[] = [
  "supervisor",
  "director",
]

/**
 * Context-aware case transition wrapper. Layers operational gates
 * over the pure state machine for transitions that require row
 * context.
 *
 * Inventory item 14.5 (R8 PSCC slice-2):
 *   > "caseworker-line cannot cancel a case in `escalated` status
 *   > without supervisor authority. Currently state-machine allows
 *   > `escalated → resolved | denied | cancelled` but `escalated →
 *   > cancelled` requires no caller-context check."
 * (Note: R8 schema has no `cancelled` terminal — the equivalent
 * gated transitions are `escalated → resolved` and `escalated →
 * denied`. We gate BOTH.)
 *
 * Rules:
 *   • From `escalated`, to `resolved` or `denied` — require
 *     `ctx.assignedAuthorityLevel ∈ {supervisor, director}`.
 *     Line-level operators get a friendly "supervisor authority
 *     required" error.
 *   • Other transitions: pure state-machine passthrough.
 *
 * Returns the same TransitionResult shape — drop-in for `transitionCase`.
 */
export function canTransitionCase(
  from: unknown,
  to: unknown,
  ctx: CaseTransitionContext,
): TransitionResult {
  // Pure state-machine gate first — illegal transitions short-circuit
  // BEFORE context check (clearer error attribution).
  const stateMachine = transitionCase(from, to)
  if (!stateMachine.ok) return stateMachine

  // Authority gate only on escalated decision-out paths.
  if (from === "escalated" && (to === "resolved" || to === "denied")) {
    if (
      ctx.assignedAuthorityLevel === null ||
      ctx.assignedAuthorityLevel === undefined ||
      !ESCALATED_DECISION_AUTHORITIES.includes(ctx.assignedAuthorityLevel)
    ) {
      return {
        ok: false,
        error: `Resolving an escalated case requires supervisor authority. Current assigned authority: ${
          ctx.assignedAuthorityLevel ?? "unassigned"
        }. Request supervisor reassignment before driving the decision.`,
      }
    }
  }

  return { ok: true }
}

/* ─── License lifecycle ──────────────────────────────────────────────── */

export function transitionLicense(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isLicenseStatus(from)) {
    return { ok: false, error: `unknown license status "${String(from)}"` }
  }
  if (!isLicenseStatus(to)) {
    return {
      ok: false,
      error: `unknown license target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!LICENSE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal license transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isLicenseTerminal(status: LicenseStatus): boolean {
  return LICENSE_TRANSITIONS[status].length === 0
}

export function allowedNextLicense(
  from: LicenseStatus
): readonly LicenseStatus[] {
  return LICENSE_TRANSITIONS[from]
}

/* ─── Grant lifecycle ────────────────────────────────────────────────── */

export function transitionGrant(from: unknown, to: unknown): TransitionResult {
  if (!isGrantStatus(from)) {
    return { ok: false, error: `unknown grant status "${String(from)}"` }
  }
  if (!isGrantStatus(to)) {
    return { ok: false, error: `unknown grant target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!GRANT_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal grant transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isGrantTerminal(status: GrantStatus): boolean {
  return GRANT_TRANSITIONS[status].length === 0
}

export function allowedNextGrant(from: GrantStatus): readonly GrantStatus[] {
  return GRANT_TRANSITIONS[from]
}
