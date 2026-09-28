import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import {
  runWorkforceExceptionResponseCycleAudit,
  type WorkforceExceptionResponseCycleAuditDb,
} from "@/lib/workforce/exception-response-cycle-audit"
import { requireWorkforceExceptionResponseCycleAuditRateLimit } from "@/lib/workforce/exception-response-cycle-audit-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Workforce exception-response cycle audit is unavailable.",
    code: "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

const authorizedGet = withWorkforceSessionExceptionQueueAuth(async (req: NextRequest, auth) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return applyWorkforceSensitiveResponseHeaders(mfaDenied)

  const rateLimited = await requireWorkforceExceptionResponseCycleAuditRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return applyWorkforceSensitiveResponseHeaders(rateLimited)

  try {
    const report = await runWorkforceExceptionResponseCycleAudit(
      prisma as unknown as WorkforceExceptionResponseCycleAuditDb,
      { organizationId: auth.orgId },
    )
    const audit = workforceConfigurationRequestAuditContext(req, auth.userId)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: null,
        actorUserId: audit.actorUserId,
        action: "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_VIEWED",
        entity: "workforce_exception_response_cycle_audit",
        entityId: report.observedAt,
        metadataKind: "workforce_exception_response_cycle_audit",
        newData: {
          version: report.version,
          mode: report.mode,
          status: report.status,
          observedAt: report.observedAt,
          duplicateCycleGroups: report.duplicateCycleGroups,
          duplicateResponseRows: report.duplicateResponseRows,
          excessResponseRows: report.excessResponseRows,
          legacyNullRevisionRows: report.legacyNullRevisionRows,
          automaticAction: report.automaticAction,
          uniquenessMigrationAuthorized: report.uniquenessMigrationAuthorized,
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })

    return NextResponse.json({ success: true, data: { report } }, {
      headers: workforceSensitiveResponseHeaders,
    })
  } catch {
    // A timeout, malformed aggregate or failed append-only audit is
    // unavailable. Never translate it into a zero-count migration signal.
    logWorkforceSensitiveOperationFailure({
      operation: "configuration-exception-response-cycle-audit",
    })
    return unavailable()
  }
})

/** Apply privacy headers to wrapper-level session/capability/grant denials too. */
export async function GET(req: NextRequest, context?: unknown): Promise<Response> {
  try {
    const response = context === undefined
      ? await authorizedGet(req)
      : await authorizedGet(req, context)
    return applyWorkforceSensitiveResponseHeaders(response)
  } catch {
    logWorkforceSensitiveOperationFailure({
      operation: "configuration-exception-response-cycle-audit",
    })
    return applyWorkforceSensitiveResponseHeaders(unavailable())
  }
}
