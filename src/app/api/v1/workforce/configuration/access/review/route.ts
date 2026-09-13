import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionGrantManagementAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"
import {
  reviewWorkforceAccess,
  WorkforceAccessReviewError,
  type WorkforceAccessReviewGrant,
} from "@/lib/workforce/access-review"
import type { WorkforceAccessRole, WorkforceAccessScope } from "@/lib/workforce/access-control"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"

const MAX_REVIEW_GRANTS = 1_000

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to review Workforce access.",
    code: "WORKFORCE_ACCESS_REVIEW_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

function scopeFromRow(row: {
  scopeKind: string
  scopeTeamId: string | null
  scopeSiteId: string | null
  scopeAgentId: string | null
}): WorkforceAccessScope {
  const scopedIds = [row.scopeTeamId, row.scopeSiteId, row.scopeAgentId].filter(Boolean)
  if (row.scopeKind === "ORGANIZATION" && scopedIds.length === 0) return { kind: "ORGANIZATION" }
  if (row.scopeKind === "TEAM" && row.scopeTeamId && scopedIds.length === 1) {
    return { kind: "TEAM", teamId: row.scopeTeamId }
  }
  if (row.scopeKind === "SITE" && row.scopeSiteId && scopedIds.length === 1) {
    return { kind: "SITE", siteId: row.scopeSiteId }
  }
  if (row.scopeKind === "AGENT" && row.scopeAgentId && scopedIds.length === 1) {
    return { kind: "AGENT", agentId: row.scopeAgentId }
  }
  throw new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_INPUT_INVALID")
}

/**
 * GET /api/v1/workforce/configuration/access/review
 *
 * Reads the durable tenant grant ledger into the bounded pure reviewer. Exact
 * per-grant usage is not stored yet, so this endpoint explicitly suppresses
 * stale-use findings rather than presenting missing telemetry as inactivity.
 * Expiry, inactive-principal and incompatible-role findings remain valid and
 * actionable through the existing append-only revocation endpoint.
 */
export const GET = withWorkforceSessionGrantManagementAuth(async (req: NextRequest, auth) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return applyWorkforceSensitiveResponseHeaders(mfaDenied)
  const rateLimited = await requireWorkforceAccessGrantRateLimit({
    operation: "INVENTORY",
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    const rows = await prisma.workforceAccessGrant.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      take: MAX_REVIEW_GRANTS + 1,
      select: {
        id: true,
        organizationId: true,
        principalUserId: true,
        role: true,
        scopeKind: true,
        scopeTeamId: true,
        scopeSiteId: true,
        scopeAgentId: true,
        effectiveFrom: true,
        effectiveUntil: true,
        principalUser: { select: { isActive: true } },
        revocation: { select: { revokedAt: true } },
      },
    })
    if (rows.length > MAX_REVIEW_GRANTS) {
      return NextResponse.json({
        error: "Too many Workforce grants for one bounded review.",
        code: "WORKFORCE_ACCESS_REVIEW_LIMIT_EXCEEDED",
      }, { status: 413, headers: workforceSensitiveResponseHeaders })
    }
    const grants: WorkforceAccessReviewGrant[] = rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      principalUserId: row.principalUserId,
      role: row.role as WorkforceAccessRole,
      scope: scopeFromRow(row),
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      revokedAt: row.revocation?.revokedAt ?? null,
      principalState: row.principalUser.isActive ? "ACTIVE" : "INACTIVE",
    }))
    const review = reviewWorkforceAccess({
      organizationId: auth.orgId,
      grants,
      actions: [],
      activityEvidenceComplete: false,
    })
    const audit = workforceConfigurationRequestAuditContext(req, auth.userId)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: null,
        action: "WORKFORCE_ACCESS_REVIEW_VIEWED",
        entity: "workforce_access_review",
        entityId: review.reviewedAt,
        metadataKind: "workforce_access_control",
        newData: {
          grantsExamined: review.grantsExamined,
          findingCounts: review.findingCounts,
          activityEvidence: review.activityEvidence,
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })
    return NextResponse.json({ success: true, data: { review } }, {
      headers: workforceSensitiveResponseHeaders,
    })
  } catch (error) {
    if (error instanceof WorkforceAccessReviewError && error.code === "WORKFORCE_ACCESS_REVIEW_LIMIT_EXCEEDED") {
      return NextResponse.json({
        error: "Too many Workforce grants for one bounded review.",
        code: error.code,
      }, { status: 413, headers: workforceSensitiveResponseHeaders })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-access-review" })
    return unavailable()
  }
})
