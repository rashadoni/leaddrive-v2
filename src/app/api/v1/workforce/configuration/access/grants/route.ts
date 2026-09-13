import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionGrantManagementAuth } from "@/lib/with-workforce-rls-auth"
import {
  createWorkforceAccessGrantDraft,
  WorkforceAccessGrantLedgerError,
} from "@/lib/workforce/access-grant-ledger"
import { validateWorkforceDraftRoleSet, WORKFORCE_ACCESS_ROLES } from "@/lib/workforce/access-control"
import {
  readPersistedWorkforceAccessGrants,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import { canManageWorkforceAccessGrants } from "@/lib/workforce/access-grant-management"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"
import {
  persistAuthorizedWorkforceAccessGrant,
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

const Scope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ORGANIZATION") }).strict(),
  z.object({ kind: z.literal("TEAM"), teamId: Identifier }).strict(),
  z.object({ kind: z.literal("SITE"), siteId: Identifier }).strict(),
  z.object({ kind: z.literal("AGENT"), agentId: Identifier }).strict(),
])

const GrantRequest = z.object({
  operationId: OperationId,
  principalUserId: Identifier,
  role: z.enum(WORKFORCE_ACCESS_ROLES),
  scope: Scope,
  // The server owns the start time. An HTTP caller cannot insert historical
  // authority or defer an assignment without a separately reviewed workflow.
  effectiveUntil: z.string().datetime({ offset: true }).nullable().optional(),
  grantReasonCode: ReasonCode,
}).strict()

type ActiveTenantTargetDb = Pick<Prisma.TransactionClient, "user" | "mtmTeam" | "workforceSite" | "mtmAgent">

class WorkforceAccessGrantTargetUnavailableError extends Error {}

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to apply Workforce access grant.",
    code: "WORKFORCE_ACCESS_GRANT_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

function invalid(): NextResponse {
  return NextResponse.json({
    error: "Invalid Workforce access-grant request.",
    code: "WORKFORCE_ACCESS_GRANT_INVALID",
  }, { status: 400, headers: workforceSensitiveResponseHeaders })
}

async function activeTenantTarget(input: {
  db: ActiveTenantTargetDb
  organizationId: string
  principalUserId: string
  scope: z.infer<typeof Scope>
}): Promise<boolean> {
  const principal = await input.db.user.findFirst({
    where: { id: input.principalUserId, organizationId: input.organizationId, isActive: true },
    select: { id: true },
  })
  if (!principal) return false

  switch (input.scope.kind) {
    case "ORGANIZATION":
      return true
    case "TEAM":
      return Boolean(await input.db.mtmTeam.findFirst({
        where: { id: input.scope.teamId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }))
    case "SITE":
      return Boolean(await input.db.workforceSite.findFirst({
        where: { id: input.scope.siteId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      }))
    case "AGENT":
      return Boolean(await input.db.mtmAgent.findFirst({
        where: { id: input.scope.agentId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      }))
  }
}

function missingGrantSchema(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2021"
}

/**
 * POST /api/v1/workforce/configuration/access/grants
 *
 * The first live C7 mutation path is deliberately narrow: only an already
 * persisted organization-scoped TENANT_ADMIN can grant a non-admin Workforce
 * role after explicit granular-access cutover. It has mandatory MFA, no CRM
 * admin fallback, no self-grant, no HTTP Tenant Admin bootstrap, server-owned
 * effectiveFrom, tenant-owned scope validation and a transaction recheck.
 */
export const POST = withWorkforceSessionGrantManagementAuth(async (req: NextRequest, auth) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return applyWorkforceSensitiveResponseHeaders(mfaDenied)

  const parsed = GrantRequest.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return invalid()
  if (parsed.data.principalUserId === auth.userId) {
    return NextResponse.json({
      error: "A Workforce administrator cannot grant a role to themselves.",
      code: "WORKFORCE_ACCESS_GRANT_SELF_GRANT_DENIED",
    }, { status: 409, headers: workforceSensitiveResponseHeaders })
  }
  if (parsed.data.role === "TENANT_ADMIN") {
    return NextResponse.json({
      error: "Tenant-admin grants require controlled bootstrap outside this endpoint.",
      code: "WORKFORCE_ACCESS_GRANT_BOOTSTRAP_ONLY",
    }, { status: 409, headers: workforceSensitiveResponseHeaders })
  }
  const rateLimited = await requireWorkforceAccessGrantRateLimit({
    operation: "MUTATION",
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    if (!await activeTenantTarget({
      db: prisma,
      organizationId: auth.orgId,
      principalUserId: parsed.data.principalUserId,
      scope: parsed.data.scope,
    })) {
      // Keep non-membership, archived targets and cross-tenant identifiers
      // indistinguishable to avoid a workforce-directory oracle.
      return NextResponse.json({
        error: "The requested Workforce grant target is unavailable.",
        code: "WORKFORCE_ACCESS_GRANT_TARGET_UNAVAILABLE",
      }, { status: 404, headers: workforceSensitiveResponseHeaders })
    }

    const existing = await readPersistedWorkforceAccessGrants({
      db: prisma,
      organizationId: auth.orgId,
      principalUserId: parsed.data.principalUserId,
    })
    if (!existing) return unavailable()
    if (!validateWorkforceDraftRoleSet([...existing.map((grant) => grant.role), parsed.data.role]).valid) {
      // Do not disclose pre-existing roles or the incompatible pair to the
      // caller; the immutable ledger's database constraint remains the
      // durable race-safe fence inside the write transaction.
      return NextResponse.json({
        error: "The requested Workforce role combination is not permitted.",
        code: "WORKFORCE_ACCESS_GRANT_INCOMPATIBLE_ROLE",
      }, { status: 409, headers: workforceSensitiveResponseHeaders })
    }
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "configuration-access-grant-write" })
    return unavailable()
  }

  try {
    const now = new Date()
    const effectiveUntil = parsed.data.effectiveUntil == null ? null : new Date(parsed.data.effectiveUntil)
    const draft = createWorkforceAccessGrantDraft({
      organizationId: auth.orgId,
      principalUserId: parsed.data.principalUserId,
      operationId: parsed.data.operationId,
      role: parsed.data.role,
      scope: parsed.data.scope,
      effectiveFrom: now,
      effectiveUntil,
      grantedByUserId: auth.userId,
      grantReasonCode: parsed.data.grantReasonCode,
    })
    const requestAudit = workforceConfigurationRequestAuditContext(req, auth.userId)
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const db = tx as unknown as WorkforceAccessGrantWriterDb
      if (!await activeTenantTarget({
        db: tx,
        organizationId: auth.orgId,
        principalUserId: parsed.data.principalUserId,
        scope: parsed.data.scope,
      })) {
        throw new WorkforceAccessGrantTargetUnavailableError()
      }
      return persistAuthorizedWorkforceAccessGrant({
        db,
        draft,
        // Recheck against the transaction snapshot so a role revocation
        // between boundary evaluation and insert cannot issue a new grant.
        authorize: async (input) => (
          input.operation === "GRANT"
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
        replayMode: "SERVER_ASSIGNED_TIMESTAMPS",
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: { grantId: result.grantId },
    }, { status: 201, headers: workforceSensitiveResponseHeaders })
  } catch (error) {
    if (missingGrantSchema(error)) return unavailable()
    if (error instanceof WorkforceAccessGrantTargetUnavailableError) {
      return NextResponse.json({
        error: "The requested Workforce grant target is unavailable.",
        code: "WORKFORCE_ACCESS_GRANT_TARGET_UNAVAILABLE",
      }, { status: 404, headers: workforceSensitiveResponseHeaders })
    }
    if (error instanceof WorkforceAccessGrantLedgerError) return invalid()
    if (error instanceof WorkforceAccessGrantWriterError) {
      const status = error.code === "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED" ? 403 : 409
      return NextResponse.json({
        error: status === 403 ? "Workforce grant-management access is required." : "The Workforce grant request conflicts with an existing operation.",
        code: error.code,
      }, { status, headers: workforceSensitiveResponseHeaders })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-access-grant-write" })
    return unavailable()
  }
})
