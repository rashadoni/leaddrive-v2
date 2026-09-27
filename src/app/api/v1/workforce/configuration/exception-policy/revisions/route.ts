import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS,
  resolveWorkforceExceptionPolicyDraftRevision,
  type WorkforceExceptionPolicyRevisionRecord,
} from "@/lib/workforce/exception-policy-revision"
import {
  appendAuthorizedWorkforceExceptionPolicyRevision,
  WorkforceExceptionPolicyRevisionWriterError,
  type WorkforceExceptionPolicyRevisionWriterDb,
} from "@/lib/workforce/exception-policy-revision-writer"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const RevisionRequest = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u),
}).strict()

const RevisionRecordSelect: Record<keyof WorkforceExceptionPolicyRevisionRecord, true> = {
  id: true,
  organizationId: true,
  revision: true,
  operationId: true,
  policyVersion: true,
  definition: true,
  definitionHash: true,
  recordedByUserId: true,
  recordReasonCode: true,
  createdAt: true,
}

function invalidRequest(): NextResponse {
  return NextResponse.json({
    error: "Invalid Workforce exception-policy revision request.",
    code: "WORKFORCE_EXCEPTION_POLICY_REVISION_INPUT_INVALID",
  }, { status: 400, headers: workforceSensitiveResponseHeaders })
}

function unavailableReceipt(): NextResponse {
  return NextResponse.json({
    error: "The Workforce exception-policy draft receipt is unavailable.",
    code: "WORKFORCE_EXCEPTION_POLICY_REVISION_RECEIPT_UNAVAILABLE",
  }, { status: 409, headers: workforceSensitiveResponseHeaders })
}

/**
 * Reports only whether this tenant has recorded the exact supported draft.
 * The receipt is not an active/current/effective policy selection and exposes
 * neither ledger history nor policy or actor metadata.
 */
export const GET = withWorkforceSessionPolicyConfigurationAuth(async (
  _req: NextRequest,
  auth,
) => {
  try {
    const history = await prisma.workforceExceptionPolicyRevision.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { revision: "asc" },
      take: MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1,
      select: RevisionRecordSelect,
    })
    if (history.length > MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS) {
      return unavailableReceipt()
    }

    const resolution = resolveWorkforceExceptionPolicyDraftRevision(history)
    if (resolution.status === "INVALID") return unavailableReceipt()
    if (resolution.status === "UNAVAILABLE") {
      return NextResponse.json({
        state: "NOT_RECORDED",
      }, { headers: workforceSensitiveResponseHeaders })
    }
    return NextResponse.json({
      state: "RECORDED_DRAFT",
      revision: resolution.revision,
    }, { headers: workforceSensitiveResponseHeaders })
  } catch {
    logWorkforceSensitiveOperationFailure({
      operation: "configuration-exception-policy-revision-read",
    })
    return NextResponse.json({
      error: "Failed to read Workforce exception-policy draft receipt.",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_RECEIPT_READ_UNAVAILABLE",
    }, { status: 500, headers: workforceSensitiveResponseHeaders })
  }
})

/**
 * Records a tenant administrator's acknowledgement of the exact server-owned
 * recommended-v1 draft. It does not accept policy content, activate a policy,
 * select an effective revision or link any exception decision.
 */
export const POST = withWorkforceSessionPolicyConfigurationAuth(async (
  req: NextRequest,
  auth,
) => {
  const parsed = RevisionRequest.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return invalidRequest()

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => (
      appendAuthorizedWorkforceExceptionPolicyRevision({
        db: tx as unknown as WorkforceExceptionPolicyRevisionWriterDb,
        command: {
          organizationId: auth.orgId,
          operationId: parsed.data.operationId,
          recordedByUserId: auth.userId,
        },
        authorize: (decision) => (
          decision.operation === "POLICY_REVISION_APPEND"
          && decision.organizationId === auth.orgId
          && decision.actorUserId === auth.userId
        ),
      })
    ))

    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: { revision: result.revision },
    }, {
      status: result.idempotent ? 200 : 201,
      headers: workforceSensitiveResponseHeaders,
    })
  } catch (error) {
    if (error instanceof WorkforceExceptionPolicyRevisionWriterError) {
      const status = error.code
        === "WORKFORCE_EXCEPTION_POLICY_REVISION_NOT_AUTHORIZED" ? 403 : 409
      return NextResponse.json({
        error: status === 403
          ? "Workforce policy configuration access is required."
          : "The Workforce exception-policy revision cannot be recorded in the current stream.",
        code: error.code,
      }, { status, headers: workforceSensitiveResponseHeaders })
    }
    logWorkforceSensitiveOperationFailure({
      operation: "configuration-exception-policy-revision-write",
    })
    return NextResponse.json({
      error: "Failed to record Workforce exception-policy revision.",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_UNAVAILABLE",
    }, { status: 500, headers: workforceSensitiveResponseHeaders })
  }
})
