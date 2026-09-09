import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  CoveragePolicyDefinitionSchema,
  CoveragePolicySignSchema,
  coveragePolicyHash,
  coveragePolicySignatureIsCoherent,
} from "@/lib/mtm/coverage-policy"
import {
  COVERAGE_POLICY_ADMIN_REQUIRED,
  requireCurrentCoveragePolicyAdministrator,
  resolveCoveragePolicyAdministrator,
} from "@/lib/mtm/coverage-policy-admin"

type RouteContext = { params: Promise<{ id: string }> }

function accessDenied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Coverage policy configuration is available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_COVERAGE_POLICY_WEB_ONLY"
      : "MTM_COVERAGE_POLICY_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  if (!await resolveCoveragePolicyAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(CoveragePolicySignSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const expectedDefinitionHash = parsed.data.expectedDefinitionHash.toLowerCase()
  const { id } = await params

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-coverage-policy-activation:${auth.orgId}`}, 0))`
      const currentActor = await requireCurrentCoveragePolicyAdministrator(tx as typeof prisma, auth)
      const current = await tx.mtmCoveragePolicy.findFirst({
        where: { id, organizationId: auth.orgId },
      })
      if (!current) return { kind: "NOT_FOUND" as const }

      const definition = CoveragePolicyDefinitionSchema.safeParse(current.definition)
      if (!definition.success || current.definitionHash !== coveragePolicyHash(definition.data)) {
        return { kind: "DEFINITION_INVALID" as const }
      }
      if (current.definitionHash.toLowerCase() !== expectedDefinitionHash) {
        return { kind: "HASH_CONFLICT" as const, actualDefinitionHash: current.definitionHash }
      }
      if (current.status === "ACTIVE") {
        if (!coveragePolicySignatureIsCoherent(current)) return { kind: "SIGNATURE_INCOHERENT" as const }
        if (current.approvalReference !== parsed.data.approvalReference) {
          return { kind: "SIGNATURE_CONFLICT" as const }
        }
        return { kind: "OK" as const, policy: current, idempotent: true }
      }
      if (current.status !== "DRAFT") return { kind: "STATE_CONFLICT" as const, status: current.status }
      if (current.signedByUserId || current.signedAt || current.activatedAt || current.approvalReference || current.retiredAt) {
        return { kind: "SIGNATURE_INCOHERENT" as const }
      }

      const signedAt = new Date()
      const previousActive = await tx.mtmCoveragePolicy.findFirst({
        where: { organizationId: auth.orgId, status: "ACTIVE", id: { not: current.id } },
        select: { id: true, code: true, version: true },
      })
      const retired = await tx.mtmCoveragePolicy.updateMany({
        where: { organizationId: auth.orgId, status: "ACTIVE", id: { not: current.id } },
        data: { status: "RETIRED", retiredAt: signedAt },
      })
      if (previousActive && retired.count !== 1) throw new Error("MTM_COVERAGE_POLICY_CAS_CONFLICT")

      const changed = await tx.mtmCoveragePolicy.updateMany({
        where: {
          id: current.id,
          organizationId: auth.orgId,
          status: "DRAFT",
          definitionHash: expectedDefinitionHash,
          approvalReference: null,
          signedByUserId: null,
          signedAt: null,
          activatedAt: null,
          retiredAt: null,
        },
        data: {
          status: "ACTIVE",
          approvalReference: parsed.data.approvalReference,
          signedByUserId: auth.userId,
          signedAt,
          activatedAt: signedAt,
        },
      })
      if (changed.count !== 1) throw new Error("MTM_COVERAGE_POLICY_CAS_CONFLICT")

      const activated = await tx.mtmCoveragePolicy.findFirst({
        where: { id: current.id, organizationId: auth.orgId },
      })
      if (!activated || !coveragePolicySignatureIsCoherent(activated)) {
        throw new Error("MTM_COVERAGE_POLICY_SIGNATURE_WRITE_INCOHERENT")
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "COVERAGE_POLICY_ACTIVATED",
          entity: "mtm_coverage_policy",
          entityId: activated.id,
          metadataKind: "coverage_policy_configuration",
          oldData: { status: current.status, definitionHash: current.definitionHash },
          newData: {
            status: activated.status,
            code: activated.code,
            version: activated.version,
            definitionHash: activated.definitionHash,
            approvalReference: activated.approvalReference,
            signedByUserId: activated.signedByUserId,
            signedAt: activated.signedAt!.toISOString(),
            activatedAt: activated.activatedAt!.toISOString(),
            retiredPolicyId: previousActive?.id ?? null,
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return { kind: "OK" as const, policy: activated, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Coverage policy not found", code: "MTM_COVERAGE_POLICY_NOT_FOUND" }, { status: 404 })
    }
    if (result.kind === "DEFINITION_INVALID" || result.kind === "SIGNATURE_INCOHERENT") {
      return NextResponse.json({
        error: "Stored coverage policy signature is not coherent",
        code: "MTM_COVERAGE_POLICY_SIGNATURE_INCOHERENT",
      }, { status: 409 })
    }
    if (result.kind === "HASH_CONFLICT") {
      return NextResponse.json({
        error: "Coverage policy definition changed since it was reviewed",
        code: "MTM_COVERAGE_POLICY_HASH_CONFLICT",
        actualDefinitionHash: result.actualDefinitionHash,
      }, { status: 409 })
    }
    if (result.kind === "SIGNATURE_CONFLICT") {
      return NextResponse.json({
        error: "Coverage policy is already active under a different approval reference",
        code: "MTM_COVERAGE_POLICY_SIGNATURE_CONFLICT",
      }, { status: 409 })
    }
    if (result.kind === "STATE_CONFLICT") {
      return NextResponse.json({
        error: "Only draft coverage policies can be activated",
        code: "MTM_COVERAGE_POLICY_STATE_CONFLICT",
        status: result.status,
      }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: result.policy, idempotent: result.idempotent })
  } catch (error) {
    if (error instanceof Error && error.message === COVERAGE_POLICY_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Error && error.message === "MTM_COVERAGE_POLICY_CAS_CONFLICT") {
      return NextResponse.json({
        error: "Coverage policy changed concurrently; reload before activating",
        code: "MTM_COVERAGE_POLICY_CAS_CONFLICT",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({
        error: "Coverage policy activation conflicted with another change",
        code: "MTM_COVERAGE_POLICY_CAS_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/coverage-policies activate]", error)
    return NextResponse.json({
      error: "Failed to activate coverage policy",
      code: "MTM_COVERAGE_POLICY_ACTIVATION_FAILED",
    }, { status: 500 })
  }
})
