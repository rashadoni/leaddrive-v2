import { NextResponse } from "next/server"
import { z } from "zod"
import { withWorkforceSessionExceptionDecisionAuth } from "@/lib/with-workforce-rls-auth"
import { WorkforceExceptionCaseWriterError } from "@/lib/workforce/exception-case-writer"
import { WorkforceExceptionCaseLedgerError } from "@/lib/workforce/exception-case-ledger"
import { recordScopedWorkforceExceptionDecision } from "@/lib/workforce/exception-decision-service"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceExceptionDecisionRateLimit } from "@/lib/workforce/exception-decision-rate-limit"
import { readWorkforceExceptionActionToken } from "@/lib/workforce/exception-workbench-token"
import { WorkforceExceptionWorkbenchContextError } from "@/lib/workforce/exception-workbench"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const ExceptionDecisionSchema = z.object({
  actionToken: z.string().min(1).max(2_048),
  operationId: z.string().trim().min(8).max(100),
  reason: z.string().trim().min(3).max(1_000),
}).strict()

function unavailable() {
  return NextResponse.json({
    error: "This Workforce exception action is unavailable",
    code: "WORKFORCE_EXCEPTION_DECISION_UNAVAILABLE",
  }, { status: 404, headers: workforceSensitiveResponseHeaders })
}

function lifecycleConflict(error: WorkforceExceptionCaseLedgerError | WorkforceExceptionCaseWriterError | WorkforceExceptionWorkbenchContextError) {
  return NextResponse.json({
    error: "This Workforce exception changed or no longer accepts that action",
    code: error.code,
  }, { status: 409, headers: workforceSensitiveResponseHeaders })
}

/**
 * Fixed body-only manager action endpoint. The encrypted token binds an exact
 * server-offered decision and decision-stream revision, but remains only a
 * locator: scoped grant and case context are re-read under the transaction's
 * case lock before any append.
 */
export const POST = withWorkforceSessionExceptionDecisionAuth(async (req, auth) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return mfaDenied

  const parsed = ExceptionDecisionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid Workforce exception decision",
      code: "WORKFORCE_EXCEPTION_DECISION_INVALID",
    }, { status: 400, headers: workforceSensitiveResponseHeaders })
  }
  const action = readWorkforceExceptionActionToken({
    token: parsed.data.actionToken,
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (!action) return unavailable()

  const rateLimited = await requireWorkforceExceptionDecisionRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    const result = await recordScopedWorkforceExceptionDecision({
      organizationId: auth.orgId,
      principalUserId: auth.userId,
      caseId: action.caseId,
      expectedDecisionCount: action.decisionCount,
      operationId: parsed.data.operationId,
      decisionCode: action.decisionCode,
      reason: parsed.data.reason,
    })
    if (!result) return unavailable()
    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: { decisionCode: action.decisionCode },
    }, {
      status: result.idempotent ? 200 : 201,
      headers: workforceSensitiveResponseHeaders,
    })
  } catch (error) {
    if (error instanceof WorkforceExceptionCaseLedgerError
      || error instanceof WorkforceExceptionCaseWriterError
      || error instanceof WorkforceExceptionWorkbenchContextError) {
      return lifecycleConflict(error)
    }
    logWorkforceSensitiveOperationFailure({ operation: "review-exception-decision-write" })
    return NextResponse.json({ error: "Failed to record Workforce exception decision" }, {
      status: 500,
      headers: workforceSensitiveResponseHeaders,
    })
  }
})
