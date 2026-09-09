/**
 * Household / KYC / Account / Goal / LifeEvent state machines — R1 slice 1.
 *
 * 5 separate state machines sharing the same canTransition pattern.
 * DB CHECKs enforce enum membership; helper enforces transition allow-list.
 *
 * Pure synchronous.
 */
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TRANSITIONS,
  GOAL_STATUSES,
  GOAL_TRANSITIONS,
  HOUSEHOLD_STATUSES,
  HOUSEHOLD_TRANSITIONS,
  KYC_STATUSES,
  KYC_TRANSITIONS,
  LIFE_EVENT_OUTREACH_STATUSES,
  LIFE_EVENT_OUTREACH_TRANSITIONS,
  type AccountStatus,
  type GoalStatus,
  type HouseholdStatus,
  type KycStatus,
  type LifeEventOutreachStatus,
  type TransitionResult,
} from "./types"

export function isHouseholdStatus(s: unknown): s is HouseholdStatus {
  return typeof s === "string" && (HOUSEHOLD_STATUSES as readonly string[]).includes(s)
}

export function isKycStatus(s: unknown): s is KycStatus {
  return typeof s === "string" && (KYC_STATUSES as readonly string[]).includes(s)
}

export function isAccountStatus(s: unknown): s is AccountStatus {
  return typeof s === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(s)
}

export function isGoalStatus(s: unknown): s is GoalStatus {
  return typeof s === "string" && (GOAL_STATUSES as readonly string[]).includes(s)
}

export function isLifeEventOutreachStatus(s: unknown): s is LifeEventOutreachStatus {
  return (
    typeof s === "string" &&
    (LIFE_EVENT_OUTREACH_STATUSES as readonly string[]).includes(s)
  )
}

function check<T extends string>(
  from: T,
  to: T,
  table: Readonly<Record<T, readonly T[]>>,
  kind: string
): TransitionResult {
  if (from === to) {
    return { ok: false, error: `${kind}: cannot transition from "${from}" to itself` }
  }
  const allowed = table[from]
  if (!allowed) {
    return { ok: false, error: `${kind}: unknown from-status "${String(from)}"` }
  }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `${kind}: "${from}" is a terminal status — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canHouseholdTransition(
  from: HouseholdStatus,
  to: HouseholdStatus
): TransitionResult {
  if (!isHouseholdStatus(from)) {
    return { ok: false, error: `household: from "${String(from)}" is not a known status` }
  }
  if (!isHouseholdStatus(to)) {
    return { ok: false, error: `household: to "${String(to)}" is not a known status` }
  }
  return check(from, to, HOUSEHOLD_TRANSITIONS, "household")
}

export function canKycTransition(from: KycStatus, to: KycStatus): TransitionResult {
  if (!isKycStatus(from)) {
    return { ok: false, error: `kyc: from "${String(from)}" is not a known status` }
  }
  if (!isKycStatus(to)) {
    return { ok: false, error: `kyc: to "${String(to)}" is not a known status` }
  }
  return check(from, to, KYC_TRANSITIONS, "kyc")
}

export function canAccountTransition(
  from: AccountStatus,
  to: AccountStatus
): TransitionResult {
  if (!isAccountStatus(from)) {
    return { ok: false, error: `account: from "${String(from)}" is not a known status` }
  }
  if (!isAccountStatus(to)) {
    return { ok: false, error: `account: to "${String(to)}" is not a known status` }
  }
  return check(from, to, ACCOUNT_TRANSITIONS, "account")
}

export function canGoalTransition(from: GoalStatus, to: GoalStatus): TransitionResult {
  if (!isGoalStatus(from)) {
    return { ok: false, error: `goal: from "${String(from)}" is not a known status` }
  }
  if (!isGoalStatus(to)) {
    return { ok: false, error: `goal: to "${String(to)}" is not a known status` }
  }
  return check(from, to, GOAL_TRANSITIONS, "goal")
}

export function canLifeEventOutreachTransition(
  from: LifeEventOutreachStatus,
  to: LifeEventOutreachStatus
): TransitionResult {
  if (!isLifeEventOutreachStatus(from)) {
    return {
      ok: false,
      error: `life_event: from "${String(from)}" is not a known status`,
    }
  }
  if (!isLifeEventOutreachStatus(to)) {
    return {
      ok: false,
      error: `life_event: to "${String(to)}" is not a known status`,
    }
  }
  return check(from, to, LIFE_EVENT_OUTREACH_TRANSITIONS, "life_event")
}

export function householdAllowedNext(s: HouseholdStatus): readonly HouseholdStatus[] {
  return HOUSEHOLD_TRANSITIONS[s] ?? []
}
export function kycAllowedNext(s: KycStatus): readonly KycStatus[] {
  return KYC_TRANSITIONS[s] ?? []
}
export function accountAllowedNext(s: AccountStatus): readonly AccountStatus[] {
  return ACCOUNT_TRANSITIONS[s] ?? []
}
export function goalAllowedNext(s: GoalStatus): readonly GoalStatus[] {
  return GOAL_TRANSITIONS[s] ?? []
}
export function lifeEventOutreachAllowedNext(
  s: LifeEventOutreachStatus
): readonly LifeEventOutreachStatus[] {
  return LIFE_EVENT_OUTREACH_TRANSITIONS[s] ?? []
}

export function isHouseholdTerminal(s: HouseholdStatus): boolean {
  return HOUSEHOLD_TRANSITIONS[s].length === 0
}
/**
 * KYC has no terminal statuses today — every state (including
 * `approved` and `rejected`) can transition forward (approved→expired
 * for re-verification, rejected→in_review for reapply). Returns
 * `false` for all canonical statuses; presence of this helper +
 * paired drift-guard test pins the invariant against future changes.
 * Architect-pass-1 close-out suggestion.
 */
export function isKycTerminal(s: KycStatus): boolean {
  return KYC_TRANSITIONS[s].length === 0
}
export function isAccountTerminal(s: AccountStatus): boolean {
  return ACCOUNT_TRANSITIONS[s].length === 0
}
export function isGoalTerminal(s: GoalStatus): boolean {
  return GOAL_TRANSITIONS[s].length === 0
}
export function isLifeEventOutreachTerminal(s: LifeEventOutreachStatus): boolean {
  return LIFE_EVENT_OUTREACH_TRANSITIONS[s].length === 0
}
