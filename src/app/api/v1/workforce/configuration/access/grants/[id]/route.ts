import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionGrantManagementAuth } from "@/lib/with-workforce-rls-auth"
import { createWorkforceAccessGrantRevocationDraft } from "@/lib/workforce/access-grant-ledger"
import { canManageWorkforceAccessGrants } from "@/lib/workforce/access-grant-management"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"
import type { WorkforceAccessGrantReaderDb } from "@/lib/workforce/access-grant-resolution"
import {
  appendAuthorizedWorkforceAccessGrantRevocation,
  WorkforceAccessGrantWriterError,
  type WorkforceAccessGrantWriterDb,
} from "@/lib/workforce/access-grant-writer"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"

const Identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
const OperationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/)
const ReasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)
const RevocationRequest = z.object({
  operationId: OperationId,
  revocationReasonCode: ReasonCode,
}).strict()

type RouteContext = { params: Promise<{ id: string }> }

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to revoke Workforce access grant.",
    code: "WORKFORCE_ACCESS_REVOCATION_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

function targetUnavailable(): NextResponse {
  return NextResponse.json({
    error: "The requested Workforce grant is unavailable.",
    code: "WORKFORCE_ACCESS_REVOCATION_TARGET_UNAVAILABLE",
  }, { status: 404, headers: workforceSensitiveResponseHeaders })
}

function missingGrantSchema(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2021"
}

/**
 * DELETE /api/v1/workforce/configuration/access/grants/:id
 *
 * Appends a role revocation; it never deletes or mutates an immutable grant.
 * Tenant-admin revocation remains controlled bootstrap/change management so a
 * browser mutation cannot remove the last tenant authority or create a
 * bootstrap/revocation escalation loop.
 */
export const DELETE = withWorkforceSessionGrantManagementAuth<RouteContext>(async (req, auth, ctx) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return applyWorkforceSensitiveResponseHeaders(mfaDenied)

  const parsed = RevocationRequest.safeParse(await req.json().catch(() => ({})))
  const id = Identifier.safeParse((await ctx.params).id)
  if (!parsed.success || !id.success) {
    return NextResponse.json({
      error: "Invalid Workforce access-revocation request.",
      code: "WORKFORCE_ACCESS_REVOCATION_INVALID",
    }, { status: 400, headers: workforceSensitiveResponseHeaders })
  }
  const rateLimited = await requireWorkforceAccessGrantRateLimit({
    operation: "MUTATION",
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    const grant = await prisma.workforceAccessGrant.findFirst({
      where: { id: id.data, organizationId: auth.orgId },
      select: { id: true, principalUserId: true, role: true, effectiveFrom: true },
    })
    if (!grant) return targetUnavailable()
    if (grant.role === "TENANT_ADMIN") {
      return NextResponse.json({
        error: "Tenant-admin revocation requires controlled change management outside this endpoint.",
        code: "WORKFORCE_ACCESS_REVOCATION_BOOTSTRAP_ONLY",
      }, { status: 409, headers: workforceSensitiveResponseHeaders })
    }

    const requestAudit = workforceConfigurationRequestAuditContext(req, auth.userId)
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => (
      appendAuthorizedWorkforceAccessGrantRevocation({
        db: tx as unknown as WorkforceAccessGrantWriterDb,
        draft: createWorkforceAccessGrantRevocationDraft({
          organizationId: auth.orgId,
          grantId: grant.id,
          operationId: parsed.data.operationId,
          grantEffectiveFrom: grant.effectiveFrom,
          revokedByUserId: auth.userId,
          revocationReasonCode: parsed.data.revocationReasonCode,
          revokedAt: new Date(),
        }),
        authorize: async (input) => (
          input.operation === "REVOKE"
          && input.organizationId === auth.orgId
          && input.actorUserId === auth.userId
          && await canManageWorkforceAccessGrants({
            db: tx as unknown as WorkforceAccessGrantReaderDb,
            organizationId: auth.orgId,
            userId: auth.userId,
          })
        ),
        audit: {
          ipAddress: requestAudit.ipAddress,
          userAgent: requestAudit.userAgent,
        },
      })
    ), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: { revocationId: result.revocationId },
    }, { status: 201, headers: workforceSensitiveResponseHeaders })
  } catch (error) {
    if (missingGrantSchema(error)) return unavailable()
    if (error instanceof WorkforceAccessGrantWriterError) {
      if (error.code === "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED") {
        return NextResponse.json({
          error: "Workforce grant-management access is required.",
          code: error.code,
        }, { status: 403, headers: workforceSensitiveResponseHeaders })
      }
      if (error.code === "WORKFORCE_ACCESS_REVOCATION_GRANT_NOT_FOUND") return targetUnavailable()
      return NextResponse.json({
        error: "The Workforce access-revocation request conflicts with the immutable grant record.",
        code: error.code,
      }, { status: 409, headers: workforceSensitiveResponseHeaders })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-access-grant-write" })
    return unavailable()
  }
})
