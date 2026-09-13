import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { resolveWorkforceExceptionResponseRecording } from "@/lib/workforce/exception-response-rollout"
import {
  appendAuthorizedWorkforceExceptionEmployeeResponse,
  WorkforceExceptionEmployeeResponseWriterError,
  type WorkforceExceptionEmployeeResponseWriterDb,
} from "@/lib/workforce/exception-employee-response-writer"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const EmployeeExceptionResponseSchema = z.object({
  responseCode: z.enum(["ACKNOWLEDGED", "CORRECTION_REQUESTED"]),
  clientResponseId: z.string().trim().min(8).max(100),
  correctionRequestId: z.string().trim().min(1).max(191).optional(),
}).strict().superRefine((value, context) => {
  if ((value.responseCode === "ACKNOWLEDGED" && value.correctionRequestId)
    || (value.responseCode === "CORRECTION_REQUESTED" && !value.correctionRequestId)) {
    context.addIssue({
      code: "custom",
      path: ["correctionRequestId"],
      message: "A correction request reference is required only for a correction response",
    })
  }
})

type EmployeeExceptionResponseRouteContext = { params: Promise<{ id: string }> }

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

function responseConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2003" || error.code === "P2004" || error.code === "P2010")
}

/**
 * POST /api/v1/workforce/exceptions/:id/response
 *
 * A session-bound employee can acknowledge only an exact own case or link it
 * to a pre-existing own correction request. This route never accepts an
 * explanation, coordinates, QR/device proof, direct time correction or an HR
 * decision. The migration's transaction trigger re-checks ownership/topology.
 */
export const POST = withWorkforceSessionAuth<EmployeeExceptionResponseRouteContext>("write", async (req, auth, context) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId) return workforceScopeDenied()

  const { id: caseId } = await context.params
  if (!caseId || caseId.length > 191 || /[\u0000-\u001f]/.test(caseId)) {
    return NextResponse.json({ error: "Invalid Workforce exception reference", code: "WORKFORCE_EXCEPTION_RESPONSE_INVALID" }, { status: 400 })
  }
  const parsed = EmployeeExceptionResponseSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid Workforce exception response",
      code: "WORKFORCE_EXCEPTION_RESPONSE_INVALID",
    }, { status: 400 })
  }

  try {
    // This protects the endpoint itself, rather than relying on the web
    // client to hide its button. The additive ledger is not safe to use until
    // its migration is applied and the tenant's rehearsed rollout is
    // explicitly enabled.
    const organization = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { features: true },
    })
    if (resolveWorkforceExceptionResponseRecording(organization?.features) !== "AVAILABLE") {
      return NextResponse.json({
        error: "Employee exception acknowledgement is not available for this organization",
        code: "WORKFORCE_EXCEPTION_RESPONSE_MIGRATION_REQUIRED",
      }, { status: 409, headers: workforceSensitiveResponseHeaders })
    }
    const exceptionCase = await prisma.workforceExceptionCase.findFirst({
      where: { organizationId: auth.orgId, id: caseId, agentId: actor.agentId, workdayId: { not: null } },
      select: { workdayId: true, segmentId: true },
    })
    // Do not distinguish a missing case from another employee's case. The
    // employee never receives an oracle for case ids outside their own scope.
    if (!exceptionCase?.workdayId) {
      return NextResponse.json({ error: "This exception is unavailable for an employee response", code: "WORKFORCE_EXCEPTION_RESPONSE_UNAVAILABLE" }, { status: 404 })
    }
    const result = await prisma.$transaction((tx) => appendAuthorizedWorkforceExceptionEmployeeResponse({
      db: tx as unknown as WorkforceExceptionEmployeeResponseWriterDb,
      draft: {
        organizationId: auth.orgId,
        caseId,
        agentId: actor.agentId!,
        workdayId: exceptionCase.workdayId,
        segmentId: exceptionCase.segmentId,
        correctionRequestId: parsed.data.correctionRequestId ?? null,
        responseCode: parsed.data.responseCode,
        clientResponseId: parsed.data.clientResponseId,
        actorUserId: auth.userId,
      },
      authorize: async (request) => request.agentId === actor.agentId && request.actorUserId === auth.userId,
    }))
    return NextResponse.json({ success: true, idempotent: result.idempotent, data: { responseId: result.responseId } }, {
      status: result.idempotent ? 200 : 201,
      headers: workforceSensitiveResponseHeaders,
    })
  } catch (error) {
    if (error instanceof WorkforceExceptionEmployeeResponseWriterError) {
      if (error.code === "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_NOT_AUTHORIZED") return workforceScopeDenied()
      return NextResponse.json({ error: "This response id was already used for different case details", code: error.code }, { status: 409 })
    }
    if (responseConstraint(error)) {
      return NextResponse.json({ error: "This exception is unavailable for that employee response", code: "WORKFORCE_EXCEPTION_RESPONSE_LINK_INVALID" }, { status: 409 })
    }
    console.error("[workforce/exceptions response POST]", error)
    return NextResponse.json({ error: "Failed to record Workforce exception response" }, { status: 500 })
  }
})
