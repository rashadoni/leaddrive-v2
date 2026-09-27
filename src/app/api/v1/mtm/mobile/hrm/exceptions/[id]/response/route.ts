import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse,
  WorkforceExceptionEmployeeResponseWriterError,
  type WorkforceExceptionEmployeeResponseWriterDb,
} from "@/lib/workforce/exception-employee-response-writer"
import { requireWorkforceExceptionEmployeeResponseRateLimit } from "@/lib/workforce/exception-employee-response-rate-limit"
import { MAX_WORKFORCE_EXCEPTION_DECISIONS } from "@/lib/workforce/exception-workbench"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"

const MobileExceptionAcknowledgementSchema = z.object({
  operationId: z.string().uuid(),
  expectedCaseRevision: z.number().int().min(0).max(MAX_WORKFORCE_EXCEPTION_DECISIONS - 1),
}).strict()

type RouteContext = { params: Promise<{ id: string }> }

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function responseConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2003" || error.code === "P2004" || error.code === "P2010")
}

/**
 * POST /api/v1/mtm/mobile/hrm/exceptions/:id/response
 *
 * Records only a fixed acknowledgement for the employee's exact own case and
 * exact decision revision shown by the GET projection. The client supplies no
 * response code, correction reference, reason, proof, actor or timestamp.
 */
export const POST = withMobileRls<RouteContext>(async (
  req: NextRequest,
  auth,
  { params },
) => {
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_MUTATE")
  if (forbidden) return applyWorkforceSensitiveResponseHeaders(forbidden)

  if (!auth.userId) {
    return response({
      error: "An accountable linked user is required to acknowledge a Workforce exception",
      code: "WORKFORCE_EXCEPTION_RESPONSE_ACCOUNT_LINK_REQUIRED",
    }, 403)
  }

  const { id: caseId } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(caseId)) {
    return response({
      error: "Invalid Workforce exception acknowledgement",
      code: "WORKFORCE_EXCEPTION_RESPONSE_INVALID",
    }, 400)
  }
  const parsed = MobileExceptionAcknowledgementSchema.safeParse(
    await req.json().catch(() => ({})),
  )
  if (!parsed.success) {
    return response({
      error: "Invalid Workforce exception acknowledgement",
      code: "WORKFORCE_EXCEPTION_RESPONSE_INVALID",
    }, 400)
  }

  if (auth.tenantCapabilities.workforceExceptionResponse !== true) {
    return response({
      error: "Employee exception acknowledgement is not available for this organization",
      code: "WORKFORCE_EXCEPTION_RESPONSE_MIGRATION_REQUIRED",
    }, 409)
  }

  const rateLimited = await requireWorkforceExceptionEmployeeResponseRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return applyWorkforceSensitiveResponseHeaders(rateLimited)

  try {
    const exceptionCase = await prisma.workforceExceptionCase.findFirst({
      where: {
        id: caseId,
        organizationId: auth.orgId,
        agentId: auth.agentId,
        workdayId: { not: null },
      },
      select: { workdayId: true, segmentId: true },
    })
    if (!exceptionCase?.workdayId) {
      return response({
        error: "This exception is unavailable for an employee response",
        code: "WORKFORCE_EXCEPTION_RESPONSE_UNAVAILABLE",
      }, 404)
    }

    const result = await prisma.$transaction((tx) => (
      appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse({
        db: tx as unknown as WorkforceExceptionEmployeeResponseWriterDb,
        draft: {
          organizationId: auth.orgId,
          caseId,
          agentId: auth.agentId,
          workdayId: exceptionCase.workdayId,
          segmentId: exceptionCase.segmentId,
          correctionRequestId: null,
          responseCode: "ACKNOWLEDGED",
          clientResponseId: parsed.data.operationId,
          actorUserId: auth.userId,
        },
        expectedCaseRevision: parsed.data.expectedCaseRevision,
        authorize: async (request) => request.organizationId === auth.orgId
          && request.caseId === caseId
          && request.agentId === auth.agentId
          && request.actorUserId === auth.userId,
      })
    ))

    return response({
      success: true,
      idempotent: result.idempotent,
      data: { caseId, responseCode: "ACKNOWLEDGED" },
    }, result.idempotent ? 200 : 201)
  } catch (error) {
    if (error instanceof WorkforceExceptionEmployeeResponseWriterError) {
      if (error.code === "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_NOT_AUTHORIZED") {
        return response({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, 403)
      }
      if (error.code === "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT") {
        return response({
          error: "This exception changed; refresh it before acknowledging",
          code: error.code,
        }, 409)
      }
      if (error.code === "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE") {
        return response({
          error: "This exception is unavailable for an employee response",
          code: error.code,
        }, 409)
      }
      return response({
        error: "This acknowledgement id was already used for different details",
        code: error.code,
      }, 409)
    }
    if (responseConstraint(error)) {
      return response({
        error: "This exception is unavailable for that employee response",
        code: "WORKFORCE_EXCEPTION_RESPONSE_LINK_INVALID",
      }, 409)
    }
    logWorkforceSensitiveOperationFailure({ operation: "review-exception-response-write" })
    return response({ error: "Failed to record Workforce exception acknowledgement" }, 500)
  }
}, { requiredCapability: "workforce-hrm" })
