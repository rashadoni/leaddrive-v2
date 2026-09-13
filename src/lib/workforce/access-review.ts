import {
  WORKFORCE_ACCESS_ROLES,
  validateWorkforceDraftRoleSet,
  type WorkforceAccessGrant,
} from "@/lib/workforce/access-control"

const MAX_GRANTS = 1_000
const MAX_ACTIONS = 5_000
const DEFAULT_STALE_AFTER_DAYS = 90
const MIN_STALE_AFTER_DAYS = 30
const MAX_STALE_AFTER_DAYS = 365

export type WorkforceAccessReviewFindingCode =
  | "EXPIRED_UNREVOKED"
  | "PRINCIPAL_INACTIVE"
  | "STALE_PRIVILEGED_ASSIGNMENT"
  | "INCOMPATIBLE_ACTIVE_ROLES"
  | "ACTION_OUTSIDE_GRANT_WINDOW"

export type WorkforceAccessReviewGrant = WorkforceAccessGrant & {
  principalState: "ACTIVE" | "INACTIVE" | "MISSING"
}

export type WorkforceAccessReviewAction = {
  grantId: string
  occurredAt: Date
}

export type WorkforceAccessReviewResult = {
  reviewedAt: string
  staleAfterDays: number
  grantsExamined: number
  actionsExamined: number
  findingCounts: Partial<Record<WorkforceAccessReviewFindingCode, number>>
  findings: ReadonlyArray<{
    grantId: string
    codes: readonly WorkforceAccessReviewFindingCode[]
  }>
  automaticAction: "NONE"
  nextAction: "ACCOUNTABLE_HUMAN_REVIEW"
}

export class WorkforceAccessReviewError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_ACCESS_REVIEW_INPUT_INVALID"
      | "WORKFORCE_ACCESS_REVIEW_SCOPE_MISMATCH"
      | "WORKFORCE_ACCESS_REVIEW_LIMIT_EXCEEDED",
  ) {
    super(code)
  }
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9_-]{1,160}$/.test(value)
}

function activeAt(grant: WorkforceAccessReviewGrant, instant: Date): boolean {
  return grant.effectiveFrom <= instant
    && (grant.effectiveUntil == null || instant < grant.effectiveUntil)
    && (grant.revokedAt == null || instant < grant.revokedAt)
}

function actionInsideGrant(
  grant: WorkforceAccessReviewGrant,
  occurredAt: Date,
): boolean {
  return grant.effectiveFrom <= occurredAt
    && (grant.effectiveUntil == null || occurredAt < grant.effectiveUntil)
    && (grant.revokedAt == null || occurredAt < grant.revokedAt)
}

/**
 * Produces a bounded, dry-run access review. It never revokes a grant: a later
 * accountable workflow must re-read the grant, show the reason and append an
 * immutable revocation. Activity is attributed by exact grant ID rather than
 * by user so use of one privilege cannot keep another stale privilege alive.
 */
export function reviewWorkforceAccess(input: {
  organizationId: string
  grants: readonly WorkforceAccessReviewGrant[]
  actions: readonly WorkforceAccessReviewAction[]
  now?: Date
  staleAfterDays?: number
}): WorkforceAccessReviewResult {
  const now = input.now ?? new Date()
  const staleAfterDays = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
  if (
    !validIdentifier(input.organizationId)
    || !validDate(now)
    || !Number.isSafeInteger(staleAfterDays)
    || staleAfterDays < MIN_STALE_AFTER_DAYS
    || staleAfterDays > MAX_STALE_AFTER_DAYS
  ) {
    throw new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_INPUT_INVALID")
  }
  if (input.grants.length > MAX_GRANTS || input.actions.length > MAX_ACTIONS) {
    throw new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_LIMIT_EXCEEDED")
  }

  const grants = new Map<string, WorkforceAccessReviewGrant>()
  for (const grant of input.grants) {
    if (
      !validIdentifier(grant.id)
      || !validIdentifier(grant.organizationId)
      || !validIdentifier(grant.principalUserId)
      || !WORKFORCE_ACCESS_ROLES.includes(grant.role)
      || !validDate(grant.effectiveFrom)
      || (grant.effectiveUntil != null && !validDate(grant.effectiveUntil))
      || (grant.revokedAt != null && !validDate(grant.revokedAt))
      || (grant.effectiveUntil != null && grant.effectiveUntil <= grant.effectiveFrom)
      || grant.organizationId !== input.organizationId
      || grants.has(grant.id)
    ) {
      throw new WorkforceAccessReviewError(
        grant.organizationId !== input.organizationId
          ? "WORKFORCE_ACCESS_REVIEW_SCOPE_MISMATCH"
          : "WORKFORCE_ACCESS_REVIEW_INPUT_INVALID",
      )
    }
    grants.set(grant.id, grant)
  }

  const actionsByGrant = new Map<string, Date[]>()
  const outsideWindow = new Set<string>()
  for (const action of input.actions) {
    if (!validIdentifier(action.grantId) || !validDate(action.occurredAt)) {
      throw new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_INPUT_INVALID")
    }
    const grant = grants.get(action.grantId)
    if (!grant) {
      throw new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_SCOPE_MISMATCH")
    }
    const current = actionsByGrant.get(action.grantId) ?? []
    current.push(action.occurredAt)
    actionsByGrant.set(action.grantId, current)
    if (!actionInsideGrant(grant, action.occurredAt)) outsideWindow.add(grant.id)
  }

  const incompatible = new Set<string>()
  const activeByPrincipal = new Map<string, WorkforceAccessReviewGrant[]>()
  for (const grant of input.grants) {
    if (!activeAt(grant, now)) continue
    const current = activeByPrincipal.get(grant.principalUserId) ?? []
    current.push(grant)
    activeByPrincipal.set(grant.principalUserId, current)
  }
  for (const principalGrants of activeByPrincipal.values()) {
    const validation = validateWorkforceDraftRoleSet(
      principalGrants.map((grant) => grant.role),
    )
    if (!validation.valid) {
      const conflictingRoles = new Set(validation.incompatiblePairs.flat())
      for (const grant of principalGrants) {
        if (conflictingRoles.has(grant.role)) incompatible.add(grant.id)
      }
    }
  }

  const staleCutoff = new Date(now.getTime() - staleAfterDays * 86_400_000)
  const findingCounts: Partial<Record<WorkforceAccessReviewFindingCode, number>> = {}
  const findings: WorkforceAccessReviewResult["findings"][number][] = []
  const increment = (code: WorkforceAccessReviewFindingCode) => {
    findingCounts[code] = (findingCounts[code] ?? 0) + 1
  }

  for (const grant of input.grants) {
    const codes: WorkforceAccessReviewFindingCode[] = []
    if (
      grant.revokedAt == null
      && grant.effectiveUntil != null
      && grant.effectiveUntil <= now
    ) codes.push("EXPIRED_UNREVOKED")
    if (grant.principalState !== "ACTIVE" && grant.revokedAt == null) {
      codes.push("PRINCIPAL_INACTIVE")
    }
    if (activeAt(grant, now) && grant.effectiveFrom <= staleCutoff) {
      const latestAction = (actionsByGrant.get(grant.id) ?? [])
        .filter((instant) => instant <= now)
        .sort((left, right) => right.getTime() - left.getTime())[0]
      if (!latestAction || latestAction <= staleCutoff) {
        codes.push("STALE_PRIVILEGED_ASSIGNMENT")
      }
    }
    if (incompatible.has(grant.id)) codes.push("INCOMPATIBLE_ACTIVE_ROLES")
    if (outsideWindow.has(grant.id)) codes.push("ACTION_OUTSIDE_GRANT_WINDOW")
    if (codes.length > 0) {
      for (const code of codes) increment(code)
      findings.push({ grantId: grant.id, codes })
    }
  }

  return {
    reviewedAt: now.toISOString(),
    staleAfterDays,
    grantsExamined: input.grants.length,
    actionsExamined: input.actions.length,
    findingCounts,
    findings,
    automaticAction: "NONE",
    nextAction: "ACCOUNTABLE_HUMAN_REVIEW",
  }
}
