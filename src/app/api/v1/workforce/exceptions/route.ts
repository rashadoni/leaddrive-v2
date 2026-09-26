import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"
import {
  readPersistedWorkforceAccessGrants,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import {
  decideWorkforceAccess,
  type WorkforceAccessGrant,
} from "@/lib/workforce/access-control"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { authorizeWorkforceExceptionReadCandidates } from "@/lib/workforce/exception-read-access"
import {
  projectWorkforceExceptionQueueItem,
  workforceExceptionQueueEmployeeResponseState,
} from "@/lib/workforce/exception-queue"
import {
  evaluateWorkforceExceptionWorkbenchContext,
  MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS,
  MAX_WORKFORCE_EXCEPTION_DECISIONS,
} from "@/lib/workforce/exception-workbench"
import { issueWorkforceExceptionActionToken } from "@/lib/workforce/exception-workbench-token"
import { resolveWorkforceHistoricalTeamMemberships } from "@/lib/workforce/team-membership"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const MAX_EXCEPTION_SCOPE_CANDIDATES = 1_000
const MAX_EXCEPTION_CASES = 250

type WorkforceExceptionCandidate = {
  id: string
  agentId: string
  workdayEvent: { occurredAt: Date } | null
  workday: { startedAt: Date } | null
  segment: { siteId: string | null } | null
}

function denied(code: string, error: string, status = 403) {
  return NextResponse.json({ error, code }, { status, headers: workforceSensitiveResponseHeaders })
}

function grantResource(
  organizationId: string,
  grant: WorkforceAccessGrant,
): { organizationId: string; agentId?: string; teamId?: string; siteId?: string } {
  switch (grant.scope.kind) {
    case "ORGANIZATION": return { organizationId }
    case "TEAM": return { organizationId, teamId: grant.scope.teamId }
    case "SITE": return { organizationId, siteId: grant.scope.siteId }
    case "AGENT": return { organizationId, agentId: grant.scope.agentId }
  }
}

function knownExceptionReaderGrant(input: {
  grants: readonly WorkforceAccessGrant[]
  organizationId: string
  principalUserId: string
  now: Date
}): boolean {
  return input.grants.some((grant) => decideWorkforceAccess({
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    selfAgentId: null,
    permission: "TEAM_EXCEPTION_READ",
    resource: grantResource(input.organizationId, grant),
    grants: [grant],
    now: input.now,
  }).allowed)
}

/**
 * Scoped C6 review queue. After granular cutover it first loads at most 1,000
 * metadata-only candidates, resolves historical team/site scope and applies
 * per-case read authority. Names, lifecycle details and linked request status
 * are fetched only for the authorized ids. A database id is never returned.
 */
export const GET = withWorkforceSessionExceptionQueueAuth(async (_req: NextRequest, auth) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { features: true },
    })
    if (!organization) {
      return denied("WORKFORCE_EXCEPTION_QUEUE_UNAVAILABLE", "Unable to verify Workforce exception access.", 503)
    }
    const granularAccess = workforceGranularAccessEnabled(organization.features)
    if (!granularAccess && auth.role !== "admin" && auth.role !== "superadmin") {
      return denied("WORKFORCE_POLICY_ADMIN_REQUIRED", "Workforce exception review requires a tenant administrator.")
    }

    const now = new Date()
    const grants = granularAccess
      ? await readPersistedWorkforceAccessGrants({
          db: prisma as unknown as WorkforceAccessGrantReaderDb,
          organizationId: auth.orgId,
          principalUserId: auth.userId,
          now,
        })
      : []
    if (granularAccess && grants == null) {
      return denied("WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE", "Unable to verify Workforce exception access.", 503)
    }
    if (granularAccess && !knownExceptionReaderGrant({
      grants: grants ?? [],
      organizationId: auth.orgId,
      principalUserId: auth.userId,
      now,
    })) {
      return denied("WORKFORCE_GRANULAR_ACCESS_REQUIRED", "This Workforce action requires an effective Workforce role grant.")
    }

    const candidateSelect = {
      id: true,
      agentId: true,
      workdayEvent: { select: { occurredAt: true } },
      workday: { select: { startedAt: true } },
      segment: { select: { siteId: true } },
    } satisfies Prisma.WorkforceExceptionCaseSelect
    const candidates = await prisma.workforceExceptionCase.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_EXCEPTION_SCOPE_CANDIDATES + 1,
      select: candidateSelect,
    }) as WorkforceExceptionCandidate[]
    if (candidates.length > MAX_EXCEPTION_SCOPE_CANDIDATES) {
      return denied(
        "WORKFORCE_EXCEPTION_SCOPE_LIMIT_EXCEEDED",
        "Too many exception cases for one safe scoped review; narrow the review window first.",
        413,
      )
    }

    let authorization: ReadonlyMap<string, { readable: boolean; decidable: boolean }>
    if (!granularAccess) {
      authorization = new Map(candidates.map((candidate) => [candidate.id, { readable: true, decidable: false }]))
    } else {
      const historicalTeamByCaseId = await resolveWorkforceHistoricalTeamMemberships(prisma, {
        organizationId: auth.orgId,
        candidates: candidates.flatMap((candidate) => {
          const scopeInstant = candidate.workdayEvent?.occurredAt ?? candidate.workday?.startedAt ?? null
          return scopeInstant == null ? [] : [{
            requestId: candidate.id,
            agentId: candidate.agentId,
            workdayStartedAt: scopeInstant,
          }]
        }),
      })
      authorization = authorizeWorkforceExceptionReadCandidates({
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          agentId: candidate.agentId,
          siteId: candidate.segment?.siteId ?? null,
        })),
        historicalTeamByCaseId,
        grants: grants!,
        now,
      })
    }

    const readableCandidates = candidates.filter((candidate) => authorization.get(candidate.id)?.readable)
    if (readableCandidates.length > MAX_EXCEPTION_CASES) {
      return denied(
        "WORKFORCE_EXCEPTION_QUEUE_LIMIT_EXCEEDED",
        "Too many authorized exception cases for one safe review page; narrow the review window first.",
        413,
      )
    }
    const readableIds = readableCandidates.map((candidate) => candidate.id)
    const detailRows = readableIds.length === 0 ? [] : await prisma.workforceExceptionCase.findMany({
      where: { organizationId: auth.orgId, id: { in: readableIds } },
      select: {
        id: true,
        agentId: true,
        kind: true,
        createdAt: true,
        evidenceId: true,
        workdayId: true,
        agent: { select: { name: true } },
        decisions: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MAX_WORKFORCE_EXCEPTION_DECISIONS + 1,
          select: { decisionCode: true, createdAt: true },
        },
        employeeResponses: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { createdAt: true },
        },
        correctionRequests: {
          orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
          take: MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS + 1,
          select: {
            id: true,
            agentId: true,
            correctionWorkdayId: true,
            exceptionCaseId: true,
            type: true,
            status: true,
            submittedAt: true,
            workforceTimeCorrections: { take: 2, select: { requestId: true } },
          },
        },
      },
    })
    if (detailRows.length !== readableIds.length) {
      return denied("WORKFORCE_EXCEPTION_QUEUE_UNAVAILABLE", "Unable to load Workforce exception review.", 503)
    }
    const detailById = new Map(detailRows.map((detail) => [detail.id, detail]))
    const cases = readableCandidates.flatMap((candidate) => {
      const item = detailById.get(candidate.id)
      if (!item) return []
      const decisionHistoryComplete = item.decisions.length <= MAX_WORKFORCE_EXCEPTION_DECISIONS
      const priorDecisions = item.decisions.slice(0, MAX_WORKFORCE_EXCEPTION_DECISIONS)
      const correctionContextComplete = item.correctionRequests.length
        <= MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS
        && item.correctionRequests.every((request) => (
          request.agentId === item.agentId
          && request.correctionWorkdayId === item.workdayId
          && request.exceptionCaseId === item.id
          && request.workforceTimeCorrections.every((correction) => correction.requestId === request.id)
        ))
      const correctionRequests = item.correctionRequests
        .slice(0, MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS)
        .map((request) => ({
          type: request.type,
          status: request.status,
          submittedAt: request.submittedAt,
          appliedCorrectionCount: request.workforceTimeCorrections.length,
        }))
      const decisionContext = evaluateWorkforceExceptionWorkbenchContext({
        kind: item.kind,
        workdayId: item.workdayId,
        priorDecisions,
        decisionHistoryComplete,
        employeeResponseInstants: item.employeeResponses.map((response) => response.createdAt),
        correctionRequests,
        correctionContextComplete,
      })
      const decisionCodes = priorDecisions.map((decision) => decision.decisionCode)
      const employeeResponse = workforceExceptionQueueEmployeeResponseState({
        decisionCodes,
        recordedResponseCount: decisionContext.employeeVisibility === "RECORDED" ? 1 : 0,
      })
      const projection = projectWorkforceExceptionQueueItem({
        displayReference: `WF-${item.id.slice(-8)}`,
        employeeDisplayName: item.agent.name,
        type: item.kind,
        createdAt: item.createdAt,
        decisionCodes,
        evidenceState: item.evidenceId ? "LINKED_RESTRICTED" : "NOT_REQUIRED",
        employeeResponse,
        now,
      })
      const safeProjection = decisionContext.stage === "DATA_INTEGRITY_REVIEW"
        ? { ...projection, stage: "DATA_INTEGRITY_REVIEW" as const, nextAction: "ESCALATE_DATA_INTEGRITY_REVIEW" as const }
        : projection
      const actions = authorization.get(item.id)?.decidable
        ? decisionContext.availableDecisions.map((decisionCode) => ({
            decisionCode,
            actionToken: issueWorkforceExceptionActionToken({
              organizationId: auth.orgId,
              principalUserId: auth.userId,
              caseId: item.id,
              decisionCode,
              decisionCount: priorDecisions.length,
              now,
            }),
          }))
        : []
      return [{
        ...safeProjection,
        decisionContext: {
          correctionState: decisionContext.correctionState,
          employeeVisibility: decisionContext.employeeVisibility,
          actions,
        },
      }]
    })
    return NextResponse.json({
      success: true,
      data: {
        cases,
        disposition: granularAccess
          ? "SCOPED_HUMAN_REVIEW"
          : "READ_ONLY_HUMAN_REVIEW_REQUIRED",
      },
    }, { headers: workforceSensitiveResponseHeaders })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "read-exception-queue" })
    return denied("WORKFORCE_EXCEPTION_QUEUE_UNAVAILABLE", "Unable to load Workforce exception review.", 503)
  }
}, "PER_CASE")
