import type { PrismaClient } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { resolveWorkforceHistoricalTeamMembership } from "@/lib/workforce/team-membership"

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
  /** The team known at workday start wins over the organization fallback. */
  scope: "TEAM" | "ORGANIZATION"
  teamMembershipId: string | null
  teamIdAtWorkday: string | null
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

function isHistoricalPolicy(
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

function onePolicy(
  candidates: readonly WorkforcePolicyCandidate[],
  scope: "TEAM" | "ORGANIZATION",
  teamMembershipId: string | null,
  teamIdAtWorkday: string | null,
): ResolvedWorkforcePolicy | null {
  if (candidates.length === 0) return null
  if (candidates.length !== 1) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_AMBIGUOUS",
      `More than one applicable ${scope.toLowerCase()} Workforce policy applies`,
    )
  }
  return { ...candidates[0]!, scope, teamMembershipId, teamIdAtWorkday }
}

/**
 * Resolves an already-loaded policy set against an immutable team membership
 * known at workday start. Missing membership history deliberately falls back
 * only to organization policy; it never substitutes the mutable current team.
 */
export function resolveWorkforcePolicy(input: {
  workDate: string
  workdayStartedAt: Date
  /** Server-supplied instant: client timestamps cannot activate a policy early. */
  resolutionAt: Date
  teamMembershipId: string | null
  teamIdAtWorkday: string | null
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
  const teamPolicy = input.teamIdAtWorkday == null
    ? null
    : onePolicy(effective.filter((policy) => (
      policy.teamId === input.teamIdAtWorkday && isHistoricalPolicy(policy, input.workdayStartedAt)
    )), "TEAM", input.teamMembershipId, input.teamIdAtWorkday)
  if (teamPolicy) return teamPolicy

  const organizationPolicy = onePolicy(effective.filter((policy) => (
    policy.teamId === null && isHistoricalPolicy(policy, input.workdayStartedAt)
  )), "ORGANIZATION", input.teamMembershipId, input.teamIdAtWorkday)
  if (organizationPolicy) return organizationPolicy
  throw new WorkforcePolicyResolutionError(
    "WORKFORCE_POLICY_MISSING",
    "No applicable Workforce policy applies to this workday",
  )
}

type WorkforcePolicyResolverDb = Pick<PrismaClient, "mtmAgent" | "workforcePolicy" | "$queryRaw">

/**
 * Resolves team policy from the membership timeline at workday start. The
 * directory row only proves the employee exists; it cannot rewrite a delayed
 * attendance fact after a transfer. Snapshot writers persist the result and
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
    where: { id: input.agentId, organizationId: input.organizationId },
    select: { id: true },
  })
  if (!agent) {
    throw new WorkforcePolicyResolutionError(
      "WORKFORCE_POLICY_AGENT_NOT_FOUND",
      "Workforce employee is unavailable",
    )
  }
  const membership = await resolveWorkforceHistoricalTeamMembership(db, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    workdayStartedAt: input.workdayStartedAt,
  })
  const policies = await db.workforcePolicy.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: ["ACTIVE", "RETIRED"] },
      effectiveFrom: { lte: workDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      AND: [{ OR: [{ teamId: null }, ...(membership?.teamId ? [{ teamId: membership.teamId }] : [])] }],
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
    teamMembershipId: membership?.id ?? null,
    teamIdAtWorkday: membership?.teamId ?? null,
    policies,
  })
}
