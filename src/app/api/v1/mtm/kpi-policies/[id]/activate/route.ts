import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  KpiPolicyDefinitionSchema, KpiPolicySignSchema, kpiPolicyHash,
  kpiPolicySignatureIsCoherent, reconcileKpiPolicyDefinition,
} from "@/lib/mtm/kpi-policy"
import {
  KPI_POLICY_ADMIN_REQUIRED, requireCurrentKpiPolicyAdministrator, resolveKpiPolicyAdministrator,
} from "@/lib/mtm/kpi-policy-admin"

type Context = { params: Promise<{ id: string }> }
function denied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile" ? "KPI policy configuration is available only to web administrators" : "MTM administrator access required",
    code: auth.principal === "mobile" ? "MTM_KPI_POLICY_WEB_ONLY" : "MTM_KPI_POLICY_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const POST = withRouteFieldRlsAuth<Context>("write", async (req, auth, { params }) => {
  if (!await resolveKpiPolicyAdministrator(prisma, auth)) return denied(auth)
  const parsed = parseBody(KpiPolicySignSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const expectedHash = parsed.data.expectedDefinitionHash.toLowerCase()
  const { id } = await params
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-kpi-policy-activation:${auth.orgId}`}, 0))`
      const actor = await requireCurrentKpiPolicyAdministrator(tx as typeof prisma, auth)
      const current = await tx.mtmKpiPolicy.findFirst({ where: { id, organizationId: auth.orgId } })
      if (!current) return { kind: "NOT_FOUND" as const }
      const definition = KpiPolicyDefinitionSchema.safeParse(current.definition)
      if (!definition.success || current.definitionHash.toLowerCase() !== kpiPolicyHash(definition.data)) return { kind: "INVALID" as const }
      const reconciliation = reconcileKpiPolicyDefinition(definition.data)
      if (!reconciliation.ok) return { kind: "RECONCILIATION" as const, caseName: reconciliation.caseName }
      if (current.definitionHash.toLowerCase() !== expectedHash) return { kind: "HASH" as const, actual: current.definitionHash }
      if (current.status === "ACTIVE") {
        if (!kpiPolicySignatureIsCoherent(current) || current.approvalReference !== parsed.data.approvalReference) return { kind: "INVALID" as const }
        return { kind: "OK" as const, policy: current, idempotent: true }
      }
      if (current.status !== "DRAFT") return { kind: "STATE" as const, status: current.status }
      const signedAt = new Date()
      const previous = await tx.mtmKpiPolicy.findFirst({
        where: { organizationId: auth.orgId, status: "ACTIVE", id: { not: current.id } }, select: { id: true },
      })
      const retired = await tx.mtmKpiPolicy.updateMany({
        where: { organizationId: auth.orgId, status: "ACTIVE", id: { not: current.id } },
        data: { status: "RETIRED", retiredAt: signedAt },
      })
      if (previous && retired.count !== 1) throw new Error("MTM_KPI_POLICY_CAS_CONFLICT")
      const changed = await tx.mtmKpiPolicy.updateMany({
        where: { id: current.id, organizationId: auth.orgId, status: "DRAFT", definitionHash: expectedHash,
          approvalReference: null, signedByUserId: null, signedAt: null, activatedAt: null, retiredAt: null },
        data: { status: "ACTIVE", approvalReference: parsed.data.approvalReference,
          signedByUserId: auth.userId, signedAt, activatedAt: signedAt },
      })
      if (changed.count !== 1) throw new Error("MTM_KPI_POLICY_CAS_CONFLICT")
      const activated = await tx.mtmKpiPolicy.findFirst({ where: { id: current.id, organizationId: auth.orgId } })
      if (!activated || !kpiPolicySignatureIsCoherent(activated)) throw new Error("MTM_KPI_POLICY_SIGNATURE_INCOHERENT")
      await tx.mtmAuditLog.create({ data: {
        organizationId: auth.orgId, agentId: actor.agentId,
        action: "KPI_POLICY_ACTIVATED", entity: "mtm_kpi_policy", entityId: activated.id,
        metadataKind: "kpi_policy_configuration",
        oldData: { status: current.status, definitionHash: current.definitionHash } as Prisma.InputJsonValue,
        newData: { status: activated.status, definitionHash: activated.definitionHash,
          approvalReference: activated.approvalReference, retiredPolicyId: previous?.id ?? null } as Prisma.InputJsonValue,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip"),
        userAgent: req.headers.get("user-agent"),
      } })
      return { kind: "OK" as const, policy: activated, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") return NextResponse.json({ error: "KPI policy not found", code: "MTM_KPI_POLICY_NOT_FOUND" }, { status: 404 })
    if (result.kind === "HASH") return NextResponse.json({ error: "KPI policy changed since review", code: "MTM_KPI_POLICY_HASH_CONFLICT", actualDefinitionHash: result.actual }, { status: 409 })
    if (result.kind === "STATE") return NextResponse.json({ error: `KPI policy cannot be activated from ${result.status}`, code: "MTM_KPI_POLICY_STATE_CONFLICT" }, { status: 409 })
    if (result.kind === "RECONCILIATION") return NextResponse.json({ error: `KPI reconciliation case failed: ${result.caseName}`, code: "MTM_KPI_POLICY_RECONCILIATION_FAILED" }, { status: 422 })
    if (result.kind === "INVALID") return NextResponse.json({ error: "Stored KPI policy signature is not coherent", code: "MTM_KPI_POLICY_SIGNATURE_INCOHERENT" }, { status: 409 })
    return NextResponse.json({ success: true, data: { policy: result.policy, idempotent: result.idempotent } })
  } catch (error) {
    if (error instanceof Error && error.message === KPI_POLICY_ADMIN_REQUIRED) return denied(auth)
    if (error instanceof Error && (error.message === "MTM_KPI_POLICY_CAS_CONFLICT" || error.message === "MTM_KPI_POLICY_SIGNATURE_INCOHERENT")) {
      return NextResponse.json({ error: "KPI policy activation conflicted with another change", code: error.message }, { status: 409 })
    }
    console.error("[MTM/kpi-policies activate]", error)
    return NextResponse.json({ error: "Failed to activate KPI policy", code: "MTM_KPI_POLICY_ACTIVATE_FAILED" }, { status: 500 })
  }
})
