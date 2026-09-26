import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import {
  decidePersistedWorkforceAccess,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import {
  appendAuthorizedPolicyWorkforceExceptionDecision,
  type WorkforceExceptionCaseWriterDb,
} from "@/lib/workforce/exception-case-writer"
import { resolveWorkforceHistoricalTeamMembership } from "@/lib/workforce/team-membership"
import {
  evaluateWorkforceExceptionWorkbenchContext,
  MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS,
  requireWorkforceExceptionWorkbenchDecision,
  WorkforceExceptionWorkbenchContextError,
  type WorkforceExceptionWorkbenchDecision,
} from "@/lib/workforce/exception-workbench"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"

export type RecordWorkforceExceptionDecisionInput = {
  organizationId: string
  principalUserId: string
  caseId: string
  expectedDecisionCount: number
  operationId: string
  decisionCode: WorkforceExceptionWorkbenchDecision
  reason: string
}

/**
 * Appends a scoped v1 manager decision. The action token is intentionally not
 * an input here: callers may use it only to recover `caseId`, while this
 * service independently rechecks the tenant case, historical resource scope,
 * live grant and linked lifecycle context in one transaction.
 */
export async function recordScopedWorkforceExceptionDecision(
  input: RecordWorkforceExceptionDecisionInput,
): Promise<{ decisionId: string; idempotent: boolean } | null> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // This is an authorization preflight, not the write-side authority proof.
    // A token issued before tenant rollback is only a locator and cannot
    // preserve the old mode after granular access or Workforce is disabled;
    // validateContext repeats the mutable checks after the per-case lock.
    const organization = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    if (!organization || !isTenantCapabilityEnabled("workforce-hrm", organization)
      || !workforceGranularAccessEnabled(organization.features)) return null

    const exceptionCase = await tx.workforceExceptionCase.findFirst({
      where: { id: input.caseId, organizationId: input.organizationId },
      select: {
        id: true,
        agentId: true,
        kind: true,
        workdayId: true,
        // A mutable directory team cannot authorize a decision about an old
        // attendance fact after the employee moves to another branch.
        workdayEvent: { select: { occurredAt: true } },
        workday: { select: { startedAt: true } },
        segment: { select: { siteId: true } },
      },
    })
    if (!exceptionCase) return null
    const scopeInstant = exceptionCase.workdayEvent?.occurredAt
      ?? exceptionCase.workday?.startedAt
      ?? null
    // A schedule-only no-show has no accepted historical attendance instant.
    // Organization HR or the persisted segment-site scope can still match;
    // current directory membership must never manufacture team authority.
    const historicalTeam = scopeInstant == null
      ? null
      : await resolveWorkforceHistoricalTeamMembership(tx, {
          organizationId: input.organizationId,
          agentId: exceptionCase.agentId,
          workdayStartedAt: scopeInstant,
        })
    const resource = {
      organizationId: input.organizationId,
      agentId: exceptionCase.agentId,
      teamId: historicalTeam?.teamId ?? null,
      siteId: exceptionCase.segment?.siteId ?? null,
    }
    const canDecide = async (candidateResource: typeof resource) => (await decidePersistedWorkforceAccess({
      db: tx as unknown as WorkforceAccessGrantReaderDb,
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: "TEAM_EXCEPTION_DECIDE",
      resource: candidateResource,
    })).allowed
    if (!await canDecide(resource)) return null

    return appendAuthorizedPolicyWorkforceExceptionDecision({
      db: {
        $executeRaw: tx.$executeRaw,
        workforceExceptionCase: tx.workforceExceptionCase,
        workforceExceptionDecision: tx.workforceExceptionDecision,
        workforceExceptionCaseLookup: {
          findFirst: (args) => tx.workforceExceptionCase.findFirst(args),
        },
        mtmAuditLog: tx.mtmAuditLog,
      } as unknown as WorkforceExceptionCaseWriterDb,
      draft: {
        organizationId: input.organizationId,
        caseId: input.caseId,
        operationId: input.operationId,
        decisionCode: input.decisionCode,
        reason: input.reason,
        actorUserId: input.principalUserId,
      },
      authorize: async (request) => request.operation === "DECISION_APPEND"
        && request.organizationId === input.organizationId
        && request.caseId === input.caseId
        && request.actorUserId === input.principalUserId,
      validateContext: async ({ draft, priorDecisions }) => {
        // Re-read tenant mode and authority after the per-case decision lock.
        // The token and every earlier read are locators/previews only, never
        // capabilities.
        const currentOrganization = await tx.organization.findUnique({
          where: { id: input.organizationId },
          select: { plan: true, addons: true, features: true, modules: true },
        })
        if (!currentOrganization
          || !isTenantCapabilityEnabled("workforce-hrm", currentOrganization)
          || !workforceGranularAccessEnabled(currentOrganization.features)) {
          throw new WorkforceExceptionWorkbenchContextError()
        }
        if (priorDecisions.length !== input.expectedDecisionCount) {
          throw new WorkforceExceptionWorkbenchContextError("WORKFORCE_EXCEPTION_ACTION_TOKEN_STALE")
        }
        const contextCase = await tx.workforceExceptionCase.findFirst({
          where: { id: input.caseId, organizationId: input.organizationId },
          select: {
            id: true,
            agentId: true,
            kind: true,
            workdayId: true,
            workdayEvent: { select: { occurredAt: true } },
            workday: { select: { startedAt: true } },
            segment: { select: { siteId: true } },
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
        if (!contextCase || contextCase.agentId !== exceptionCase.agentId
          || contextCase.kind !== exceptionCase.kind
          || contextCase.workdayId !== exceptionCase.workdayId) {
          throw new WorkforceExceptionWorkbenchContextError()
        }
        // A linked correction may change the workday start while this
        // transaction waits for the case fence. Rebuild the historical scope
        // from the post-lock row instead of authorizing against the preflight
        // resource captured above.
        const currentScopeInstant = contextCase.workdayEvent?.occurredAt
          ?? contextCase.workday?.startedAt
          ?? null
        const currentHistoricalTeam = currentScopeInstant == null
          ? null
          : await resolveWorkforceHistoricalTeamMembership(tx, {
              organizationId: input.organizationId,
              agentId: contextCase.agentId,
              workdayStartedAt: currentScopeInstant,
            })
        const currentResource = {
          organizationId: input.organizationId,
          agentId: contextCase.agentId,
          teamId: currentHistoricalTeam?.teamId ?? null,
          siteId: contextCase.segment?.siteId ?? null,
        }
        if (!await canDecide(currentResource)) {
          throw new WorkforceExceptionWorkbenchContextError()
        }
        const context = evaluateWorkforceExceptionWorkbenchContext({
          kind: contextCase.kind,
          workdayId: contextCase.workdayId,
          priorDecisions,
          decisionHistoryComplete: true,
          employeeResponseInstants: contextCase.employeeResponses.map((response) => response.createdAt),
          correctionRequests: contextCase.correctionRequests
            .slice(0, MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS)
            .map((request) => ({
              type: request.type,
              status: request.status,
              submittedAt: request.submittedAt,
              appliedCorrectionCount: request.workforceTimeCorrections.length,
            })),
          correctionContextComplete: contextCase.correctionRequests.length
            <= MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS
            && contextCase.correctionRequests.every((request) => (
              request.agentId === contextCase.agentId
              && request.correctionWorkdayId === contextCase.workdayId
              && request.exceptionCaseId === contextCase.id
              && request.workforceTimeCorrections.every((correction) => correction.requestId === request.id)
            )),
        })
        requireWorkforceExceptionWorkbenchDecision({
          context,
          decisionCode: draft.decisionCode,
        })
      },
    })
  // The per-case advisory lock may wait behind an employee response or linked
  // request writer. READ COMMITTED is intentional: a repeatable/serializable
  // snapshot opened by the authorization preflight could stay older than the
  // writer that committed while this transaction waited, defeating the
  // post-lock context read. Mutable authorization is re-read in
  // validateContext immediately before the immutable decision append.
  }, { isolationLevel: "ReadCommitted" })
}
