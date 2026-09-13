import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import {
  runWorkforceRawLocationRetention,
  WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH,
  type WorkforceRawLocationRetentionDb,
} from "@/lib/workforce/raw-location-retention"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

function sensitiveJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function parseLimit(value: string | null): number | undefined {
  if (value == null) return undefined
  if (!/^[1-9]\d*$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH
    ? parsed
    : undefined
}

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/**
 * Inspect one bounded tenant batch. This route cannot execute deletion; a
 * destructive retention path remains fenced until its operational gates are
 * proven independently.
 */
export const GET = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return mfaDenied

  const limitParameter = new URL(req.url).searchParams.get("limit")
  const limit = parseLimit(limitParameter)
  if (limitParameter != null && limit == null) {
    return sensitiveJson({
      error: `limit must be an integer from 1 to ${WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH}`,
      code: "WORKFORCE_RAW_RETENTION_LIMIT_INVALID",
    }, 400)
  }

  try {
    const report = await runWorkforceRawLocationRetention(
      prisma as unknown as WorkforceRawLocationRetentionDb,
      { organizationId: auth.orgId, mode: "DRY_RUN", limit },
    )
    const audit = requestAuditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        action: "WORKFORCE_RAW_LOCATION_RETENTION_DRY_RUN_VIEWED",
        entity: "workforce_raw_location_retention",
        entityId: report.rawGpsCutoff,
        metadataKind: "workforce_raw_location_retention",
        newData: {
          mode: report.mode,
          limit: limit ?? WORKFORCE_RAW_LOCATION_RETENTION_MAX_BATCH,
          rawGpsCutoff: report.rawGpsCutoff,
          rawEvidenceDueAt: report.rawEvidenceDueAt,
          candidates: report.candidates,
          remaining: report.remaining,
          morePending: report.morePending,
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })

    return sensitiveJson({
      success: true,
      data: {
        report,
        execution: "NOT_AVAILABLE_OVER_HTTP",
      },
    }, 200)
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "retention-raw-location-dry-run" })
    return sensitiveJson({ error: "Failed to inspect Workforce raw-location retention" }, 500)
  }
})
