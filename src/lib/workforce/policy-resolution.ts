import type { PrismaClient } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"

export type WorkforcePolicyCandidate = {
  id: string
  teamId: string | null
  version: number
  status: string
  name: string
  effectiveFrom: Date
  effectiveTo: Date | null
  activatedAt: Date | null
  retiredAt: Date | null
  definition: unknown
  definitionHash: string
}

export type ResolvedWorkforcePolicy = WorkforcePolicyCandidate & {
  /** The current employee team wins over the organization fallback. */
  scope: "TEAM" | "ORGANIZATION"
}

export class WorkforcePolicyResolutionError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_POLICY_AGENT_NOT_FOUND"
      | "WORKFORCE_POLICY_WORKDATE_INVALID"
      | "WORKFORCE_POLICY_RESOLUTION_TIME_INVALID"
      | "WORKFORCE_POLICY_MISSING"
      | "WORKFORCE_POLICY_AMBIGUOUS",
    message: string = code,
  ) {
    super(message)
  }
}

function dateKey(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_WORKDATE_INVALID",
      "Workforce policy effective date is invalid",
    )
  }
  return value.toISOString().slice(0, 10)
}

function isEffectiveOn(policy: WorkforcePolicyCandidate, workDate: string): boolean {
  return dateKey(policy.effectiveFrom) <= workDate
    && (policy.effectiveTo == null || dateKey(policy.effectiveTo) >= workDate)
}

function validInstant(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function isHistoricalOrganizationPolicy(
  policy: WorkforcePolicyCandidate,
  workdayStartedAt: Date,
): boolean {
  if ((policy.status !== "ACTIVE" && policy.status !== "RETIRED") || !validInstant(policy.activatedAt)) {
    return false
  }
  if (workdayStartedAt.getTime() < policy.activatedAt.getTime()) return false
  return policy.status !== "RETIRED" || (
    validInstant(policy.retiredAt) && workdayStartedAt.getTime() <= policy.retiredAt.getTime()
  )
}

function isCurrentTeamPolicy(
  policy: WorkforcePolicyCandidate,
  resolutionAt: Date,
): boolean {
  return policy.status === "ACTIVE"
    && validInstant(policy.activatedAt)
    && policy.activatedAt.getTime() <= resolutionAt.getTime()
}

function onePolicy(
  candidates: readonly WorkforcePolicyCandidate[],
  scope: "TEAM" | "ORGANIZATION",
): ResolvedWorkforcePolicy | null {
  if (candidates.length === 0) return null
  if (candidates.length !== 1) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_AMBIGUOUS",
      `More than one applicable ${scope.toLowerCase()} Workforce policy applies`,
    )
  }
  return { ...candidates[0]!, scope }
}

/**
 * Resolves an already-loaded policy set. The owner selected two explicit
 * rules: a matching team policy overrides the organization policy, and a
 * delayed offline workday uses the employee's current team when the server
 * processes it. The function intentionally has no historical-team fallback.
 */
export function resolveWorkforcePolicy(input: {
  workDate: string
  workdayStartedAt: Date
  /** Server-supplied instant: client timestamps cannot activate a policy early. */
  resolutionAt: Date
  currentTeamId: string | null
  policies: readonly WorkforcePolicyCandidate[]
}): ResolvedWorkforcePolicy {
  if (!isDateKey(input.workDate)) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_WORKDATE_INVALID",
      "Workforce workDate must be YYYY-MM-DD",
    )
  }
  if (!validInstant(input.workdayStartedAt)) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_WORKDATE_INVALID",
      "Workforce workday start is invalid",
    )
  }
  if (!validInstant(input.resolutionAt)) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_RESOLUTION_TIME_INVALID",
      "Workforce policy resolution time is invalid",
    )
  }
  const effective = input.policies.filter((policy) => isEffectiveOn(policy, input.workDate))
  const teamPolicy = input.currentTeamId == null
    ? null
    : onePolicy(effective.filter((policy) => (
      policy.teamId === input.currentTeamId && isCurrentTeamPolicy(policy, input.resolutionAt)
    )), "TEAM")
  if (teamPolicy) return teamPolicy

  const organizationPolicy = onePolicy(effective.filter((policy) => (
    policy.teamId === null && isHistoricalOrganizationPolicy(policy, input.workdayStartedAt)
  )), "ORGANIZATION")
  if (organizationPolicy) return organizationPolicy
  throw new WorkforcePolicyResolutionError(
    "WORKFORCE_POLICY_MISSING",
    "No applicable Workforce policy applies to this workday",
  )
}

type WorkforcePolicyResolverDb = Pick<PrismaClient, "mtmAgent" | "workforcePolicy">

/**
 * Loads the agent's current team at server processing time. A matching team
 * policy must be active now; organization candidates retain the historical
 * workday eligibility rule. Snapshot writers must persist the returned policy;
 * later timesheet reads never invoke this live resolver.
 */
export async function resolveCurrentWorkforcePolicy(
  db: WorkforcePolicyResolverDb,
  input: {
    organizationId: string
    agentId: string
    workDate: string
    workdayStartedAt: Date
    resolutionAt: Date
  },
): Promise<ResolvedWorkforcePolicy> {
  if (!isDateKey(input.workDate)) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_WORKDATE_INVALID",
      "Workforce workDate must be YYYY-MM-DD",
    )
  }
  if (!validInstant(input.workdayStartedAt)) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_WORKDATE_INVALID",
      "Workforce workday start is invalid",
    )
  }
  if (!validInstant(input.resolutionAt)) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_RESOLUTION_TIME_INVALID",
      "Workforce policy resolution time is invalid",
    )
  }
  const workDate = new Date(`${input.workDate}T00:00:00.000Z`)
  const agent = await db.mtmAgent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId, status: "ACTIVE" },
    select: { id: true, teamId: true },
  })
  if (!agent) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_AGENT_NOT_FOUND",
      "Active Workforce employee is unavailable",
    )
  }
  const policies = await db.workforcePolicy.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: ["ACTIVE", "RETIRED"] },
      effectiveFrom: { lte: workDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      AND: [{ OR: [{ teamId: null }, ...(agent.teamId ? [{ teamId: agent.teamId }] : [])] }],
    },
    select: {
      id: true,
      teamId: true,
      version: true,
      status: true,
      name: true,
      effectiveFrom: true,
      effectiveTo: true,
      activatedAt: true,
      retiredAt: true,
      definition: true,
      definitionHash: true,
    },
  })
  return resolveWorkforcePolicy({
    workDate: input.workDate,
    workdayStartedAt: input.workdayStartedAt,
    resolutionAt: input.resolutionAt,
    currentTeamId: agent.teamId,
    policies,
  })
}
