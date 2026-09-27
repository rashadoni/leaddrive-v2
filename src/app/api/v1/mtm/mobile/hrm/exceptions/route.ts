import { NextResponse } from "next/server"
import {
  hasMobilePermission,
  requireMobilePermission,
} from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { prisma } from "@/lib/prisma"
import {
  MAX_WORKFORCE_EXCEPTION_DECISIONS,
  projectWorkforceExceptionSelfResponseState,
} from "@/lib/workforce/exception-workbench"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"

const MAX_SELF_EXCEPTION_CASES = 100

/**
 * GET /api/v1/mtm/mobile/hrm/exceptions
 *
 * A narrow mobile projection for the authenticated employee's own exception
 * cards. It is intentionally separate from history: an unavailable future
 * exception migration must not make normal Work Time history unavailable.
 * No raw evidence, reason, location, QR, device material or response-ledger
 * identity crosses this boundary. A separately rolled-out tenant receives
 * only a bounded, revision-aware current-cycle response state.
 */
export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_READ")
  if (forbidden) return applyWorkforceSensitiveResponseHeaders(forbidden)

  try {
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) {
      return NextResponse.json({ error: "Workforce employee is not available" }, {
        status: 404,
        headers: workforceSensitiveResponseHeaders,
      })
    }

    const responseRecording = auth.tenantCapabilities.workforceExceptionResponse === true
      ? "AVAILABLE" as const
      : "MIGRATION_REQUIRED" as const
    const cases = await prisma.workforceExceptionCase.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: agent.id,
        workdayId: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SELF_EXCEPTION_CASES + 1,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        workday: { select: { id: true, workDate: true } },
        ...(responseRecording === "AVAILABLE"
          ? {
              decisions: {
                orderBy: { caseRevision: "asc" as const },
                take: MAX_WORKFORCE_EXCEPTION_DECISIONS + 1,
                select: { decisionCode: true, caseRevision: true },
              },
              employeeResponses: {
                where: { observedCaseRevision: { not: null } },
                orderBy: [{ observedCaseRevision: "desc" as const }, { id: "desc" as const }],
                take: 1,
                select: { observedCaseRevision: true },
              },
            }
          : {}),
      },
    })
    if (cases.length > MAX_SELF_EXCEPTION_CASES) {
      return NextResponse.json({
        error: "Too many personal Workforce exceptions for one safe mobile page",
        code: "WORKFORCE_SELF_EXCEPTION_LIMIT_EXCEEDED",
      }, { status: 413, headers: workforceSensitiveResponseHeaders })
    }

    const canMutateResponses = responseRecording === "AVAILABLE"
      && Boolean(auth.userId)
      && hasMobilePermission(auth.role, "WORKTIME_SELF_MUTATE")

    return NextResponse.json({
      success: true,
      data: {
        disposition: "SELF_SERVICE_CORRECTION_ONLY",
        responseRecording,
        cases: cases.flatMap((item) => {
          if (!item.workday) return []
          const decisions = "decisions" in item && Array.isArray(item.decisions)
            ? item.decisions
            : null
          const employeeResponses = "employeeResponses" in item && Array.isArray(item.employeeResponses)
            ? item.employeeResponses
            : null
          const responseState = responseRecording === "AVAILABLE"
            && decisions !== null
            && employeeResponses !== null
            ? projectWorkforceExceptionSelfResponseState({
                workdayId: item.workday.id,
                priorDecisions: decisions.slice(0, MAX_WORKFORCE_EXCEPTION_DECISIONS),
                decisionHistoryComplete: decisions.length <= MAX_WORKFORCE_EXCEPTION_DECISIONS,
                employeeResponses,
              })
            : "UNAVAILABLE" as const
          const availableResponseAction = canMutateResponses
            && responseState === "NOT_ACKNOWLEDGED"
            && decisions !== null
            ? {
                kind: "ACKNOWLEDGE" as const,
                expectedCaseRevision: decisions.length,
              }
            : null
          return [{
            caseId: item.id,
            displayReference: `WF-${item.id.slice(-8)}`,
            type: item.kind,
            createdAt: item.createdAt,
            workdayId: item.workday.id,
            workDate: item.workday.workDate,
            availableAction: "REQUEST_CORRECTION" as const,
            responseState,
            availableResponseAction,
          }]
        }),
      },
    }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "read-exception-queue" })
    return NextResponse.json({ error: "Failed to load personal Workforce exceptions" }, {
      status: 500,
      headers: workforceSensitiveResponseHeaders,
    })
  }
}, { requiredCapability: "workforce-hrm" })
