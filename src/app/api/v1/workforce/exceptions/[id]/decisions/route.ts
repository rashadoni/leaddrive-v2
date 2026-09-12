import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import {
  decidePersistedWorkforceAccess,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import {
  appendAuthorizedPolicyWorkforceExceptionDecision,
  WorkforceExceptionCaseWriterError,
  type WorkforceExceptionCaseWriterDb,
} from "@/lib/workforce/exception-case-writer"
import { WorkforceExceptionCaseLedgerError } from "@/lib/workforce/exception-case-ledger"
import { resolveWorkforceHistoricalTeamMembership } from "@/lib/workforce/team-membership"

type RouteContext = { params: Promise<{ id: string }> }

const ExceptionDecisionSchema = z.object({
  operationId: z.string().trim().min(8).max(100),
  decisionCode: z.enum([
    "ACKNOWLEDGE",
    "REQUEST_EMPLOYEE_RESPONSE",
    "REQUEST_TIME_CORRECTION",
    "ESCALATE_TO_HR",
    "RESOLVE_NO_CHANGE",
    "RESOLVE_WITH_CORRECTION",
    "REOPEN_FOR_REVIEW",
  ]),
  reason: z.string().trim().min(3).max(1_000),
}).strict()

function unavailable() {
  // Do not use a case id as an authorization oracle: a missing case, a case
  // outside the caller's grant and an inactive grant receive the same result.
  return NextResponse.json({
    error: "This Workforce exception is unavailable for a scoped decision",
    code: "WORKFORCE_EXCEPTION_DECISION_UNAVAILABLE",
  }, { status: 404 })
}

function lifecycleConflict(error: WorkforceExceptionCaseLedgerError | WorkforceExceptionCaseWriterError) {
  return NextResponse.json({
    error: "This Workforce exception changed or no longer accepts that decision",
    code: error.code,
  }, { status: 409 })
}

/**
 * Appends an accountable human exception decision. The durable C7 grant
 * ledger is the only privilege input: a legacy CRM admin role, API key or
 * broad session never becomes an implicit exception authority here.
 */
export const POST = withWorkforceSessionAuth<RouteContext>("write", async (req, auth, context) => {
  const { id: caseId } = await context.params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(caseId)) return unavailable()
  const parsed = ExceptionDecisionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid Workforce exception decision",
      code: "WORKFORCE_EXCEPTION_DECISION_INVALID",
    }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const exceptionCase = await tx.workforceExceptionCase.findFirst({
        where: { id: caseId, organizationId: auth.orgId },
        select: {
          id: true,
          agentId: true,
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
      // A no-show case without a historical instant intentionally has no
      // team scope here. An organization HR grant or its persisted segment
      // site scope can still be evaluated; a team manager must not receive
      // access from the employee's current directory assignment.
      const historicalTeam = scopeInstant == null
        ? null
        : await resolveWorkforceHistoricalTeamMembership(tx, {
            organizationId: auth.orgId,
            agentId: exceptionCase.agentId,
            workdayStartedAt: scopeInstant,
          })
      const access = await decidePersistedWorkforceAccess({
        db: tx as unknown as WorkforceAccessGrantReaderDb,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId: null,
        permission: "TEAM_EXCEPTION_DECIDE",
        resource: {
          organizationId: auth.orgId,
          agentId: exceptionCase.agentId,
          teamId: historicalTeam?.teamId ?? null,
          siteId: exceptionCase.segment?.siteId ?? null,
        },
      })
      if (!access.allowed) return null
      return appendAuthorizedPolicyWorkforceExceptionDecision({
        db: {
          // Keep this facade explicit. Spreading a Prisma transaction client
          // relies on proxy enumeration details and can silently omit a model
          // delegate at runtime.
          $executeRaw: tx.$executeRaw,
          workforceExceptionCase: tx.workforceExceptionCase,
          workforceExceptionDecision: tx.workforceExceptionDecision,
          workforceExceptionCaseLookup: {
            findFirst: (args) => tx.workforceExceptionCase.findFirst(args),
          },
          mtmAuditLog: tx.mtmAuditLog,
        } as unknown as WorkforceExceptionCaseWriterDb,
        draft: {
          organizationId: auth.orgId,
          caseId,
          operationId: parsed.data.operationId,
          decisionCode: parsed.data.decisionCode,
          reason: parsed.data.reason,
          actorUserId: auth.userId,
        },
        // Authorization is intentionally resolved inside the serializable
        // transaction from the actual effective scoped grant above.
        authorize: async (request) => request.operation === "DECISION_APPEND"
          && request.organizationId === auth.orgId
          && request.caseId === caseId
          && request.actorUserId === auth.userId,
      })
    }, { isolationLevel: "Serializable" })
    if (!result) return unavailable()
    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: { decisionId: result.decisionId },
    }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof WorkforceExceptionCaseLedgerError || error instanceof WorkforceExceptionCaseWriterError) {
      return lifecycleConflict(error)
    }
    console.error("[workforce/exceptions/:id/decisions POST]", error)
    return NextResponse.json({ error: "Failed to record Workforce exception decision" }, { status: 500 })
  }
})
