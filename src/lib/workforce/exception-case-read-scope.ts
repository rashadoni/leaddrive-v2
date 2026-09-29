import type { Prisma, PrismaClient } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"
import {
  parseWorkforceShiftDefinition,
  resolveWorkforceShiftDay,
  workforceShiftDefinitionHash,
} from "@/lib/workforce/shift-definition"
import {
  resolveWorkforceShiftTemplate,
  type WorkforceShiftTemplateCandidate,
} from "@/lib/workforce/shift-resolution"
import { resolveWorkforceHistoricalTeamMemberships } from "@/lib/workforce/team-membership"

export const MAX_WORKFORCE_EXCEPTION_SCOPE_SEGMENTS = 1_000

export type WorkforceExceptionCaseScopeCandidate = {
  id: string
  agentId: string
  segmentId: string | null
  expectedWorkDate: Date | null
  workdayEvent: { occurredAt: Date } | null
  workday: { startedAt: Date } | null
}

export type WorkforceExceptionCaseAuthorizedCandidate = {
  id: string
  agentId: string
  siteId: string | null
}

export type WorkforceExceptionCaseReadScopes = {
  candidates: readonly WorkforceExceptionCaseAuthorizedCandidate[]
  historicalTeamByCaseId: ReadonlyMap<string, string | null>
}

type WorkforceExceptionCaseReadScopeDb = Pick<
  PrismaClient,
  "$queryRaw" | "workforceShiftSegment"
>

const scopeTemplateSelect = {
  id: true,
  name: true,
  teamId: true,
  isDefault: true,
  version: true,
  status: true,
  timezone: true,
  activatedAt: true,
  retiredAt: true,
  definition: true,
  definitionHash: true,
} satisfies Prisma.WorkforceShiftTemplateSelect

const scopeSegmentSelect = {
  id: true,
  siteId: true,
  sequence: true,
  startTime: true,
  template: { select: scopeTemplateSelect },
} satisfies Prisma.WorkforceShiftSegmentSelect

type ScopeSegment = Prisma.WorkforceShiftSegmentGetPayload<{
  select: typeof scopeSegmentSelect
}>

type ScheduleOnlyScope = {
  date: string
  plannedStartAt: Date
  segment: ScopeSegment
}

function validInstant(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function canonicalDate(value: Date | null): string | null {
  if (!validInstant(value)) return null
  const serialized = value.toISOString()
  const date = serialized.slice(0, 10)
  return serialized === `${date}T00:00:00.000Z` && isDateKey(date) ? date : null
}

function scheduleOnlyScope(
  candidate: WorkforceExceptionCaseScopeCandidate,
  segmentById: ReadonlyMap<string, ScopeSegment>,
): ScheduleOnlyScope | null {
  if (
    candidate.workdayEvent != null
    || candidate.workday != null
    || candidate.segmentId == null
  ) return null
  const date = canonicalDate(candidate.expectedWorkDate)
  const segment = segmentById.get(candidate.segmentId)
  if (!date || !segment || segment.sequence !== 1) return null
  try {
    const definition = parseWorkforceShiftDefinition(segment.template.definition)
    if (
      segment.startTime !== definition.startTime
      || !/^[a-f0-9]{64}$/i.test(segment.template.definitionHash)
      || workforceShiftDefinitionHash(segment.template.definition)
        !== segment.template.definitionHash.toLowerCase()
    ) return null
    const schedule = resolveWorkforceShiftDay({
      workDate: date,
      definition: segment.template.definition,
      templateTimezone: segment.template.timezone,
    })
    if (!schedule) return null
    const plannedStartAt = new Date(schedule.plannedStartAt)
    return validInstant(plannedStartAt) ? { date, plannedStartAt, segment } : null
  } catch {
    return null
  }
}

function validatedHistoricalTeam(input: {
  scope: ScheduleOnlyScope
  teamId: string | null
  resolutionAt: Date
}): string | null {
  try {
    const template = input.scope.segment.template satisfies WorkforceShiftTemplateCandidate
    const resolved = resolveWorkforceShiftTemplate({
      workDate: input.scope.date,
      workdayStartedAt: input.scope.plannedStartAt,
      resolutionAt: input.resolutionAt,
      teamMembershipId: null,
      teamIdAtWorkday: input.teamId,
      template,
    })
    return resolved.schedule?.plannedStartAt === input.scope.plannedStartAt.toISOString()
      ? input.teamId
      : null
  } catch {
    return null
  }
}

/**
 * Resolves the historical team/site metadata required before any exception
 * kind, decision, reason or employee name is read. Schedule-only cases derive
 * their scope instant solely from the case-bound first segment and immutable
 * template definition; mutable directory team, case creation time and tenant
 * midnight are deliberately never used as authorization facts.
 */
export async function resolveWorkforceExceptionCaseReadScopes(
  db: WorkforceExceptionCaseReadScopeDb,
  input: {
    organizationId: string
    candidates: readonly WorkforceExceptionCaseScopeCandidate[]
    resolutionAt: Date
  },
): Promise<WorkforceExceptionCaseReadScopes> {
  if (!input.organizationId || !validInstant(input.resolutionAt)) {
    throw new Error("Workforce exception read scope input is invalid")
  }
  if (input.candidates.length > MAX_WORKFORCE_EXCEPTION_SCOPE_SEGMENTS) {
    throw new Error("Workforce exception read scope exceeds the safe limit")
  }
  const candidateIds = new Set<string>()
  const segmentIds = new Set<string>()
  for (const candidate of input.candidates) {
    if (!candidate.id || !candidate.agentId || candidateIds.has(candidate.id)) {
      throw new Error("Workforce exception read scope candidate is invalid")
    }
    candidateIds.add(candidate.id)
    if (candidate.segmentId) segmentIds.add(candidate.segmentId)
  }
  const segments = segmentIds.size === 0 ? [] : await db.workforceShiftSegment.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: [...segmentIds] },
    },
    select: scopeSegmentSelect,
  })
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  const scheduleOnlyByCaseId = new Map<string, ScheduleOnlyScope>()
  const membershipCandidates = input.candidates.flatMap((candidate) => {
    const directInstant = candidate.workdayEvent?.occurredAt ?? candidate.workday?.startedAt ?? null
    if (validInstant(directInstant)) {
      return [{
        requestId: candidate.id,
        agentId: candidate.agentId,
        workdayStartedAt: directInstant,
      }]
    }
    const derived = scheduleOnlyScope(candidate, segmentById)
    if (!derived) return []
    scheduleOnlyByCaseId.set(candidate.id, derived)
    return [{
      requestId: candidate.id,
      agentId: candidate.agentId,
      workdayStartedAt: derived.plannedStartAt,
    }]
  })
  const resolvedTeams = await resolveWorkforceHistoricalTeamMemberships(db, {
    organizationId: input.organizationId,
    candidates: membershipCandidates,
  })
  const historicalTeamByCaseId = new Map<string, string | null>()
  for (const candidate of input.candidates) {
    const teamId = resolvedTeams.get(candidate.id) ?? null
    const scheduleOnly = scheduleOnlyByCaseId.get(candidate.id)
    historicalTeamByCaseId.set(candidate.id, scheduleOnly
      ? validatedHistoricalTeam({ scope: scheduleOnly, teamId, resolutionAt: input.resolutionAt })
      : teamId)
  }
  return {
    candidates: input.candidates.map((candidate) => ({
      id: candidate.id,
      agentId: candidate.agentId,
      siteId: candidate.segmentId == null
        ? null
        : segmentById.get(candidate.segmentId)?.siteId ?? null,
    })),
    historicalTeamByCaseId,
  }
}
