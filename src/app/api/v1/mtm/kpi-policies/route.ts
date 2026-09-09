import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { KpiPolicyCreateSchema, kpiPolicyHash, reconcileKpiPolicyDefinition } from "@/lib/mtm/kpi-policy"
import {
  KPI_POLICY_ADMIN_REQUIRED, kpiPolicyDate,
  requireCurrentKpiPolicyAdministrator, resolveKpiPolicyAdministrator,
} from "@/lib/mtm/kpi-policy-admin"

function denied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile" ? "KPI policy configuration is available only to web administrators" : "MTM administrator access required",
    code: auth.principal === "mobile" ? "MTM_KPI_POLICY_WEB_ONLY" : "MTM_KPI_POLICY_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  if (!await resolveKpiPolicyAdministrator(prisma, auth)) return denied(auth)
  const policies = await prisma.mtmKpiPolicy.findMany({
    where: { organizationId: auth.orgId }, orderBy: [{ code: "asc" }, { version: "desc" }],
  })
  return NextResponse.json({ success: true, data: { policies } })
})
export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (!await resolveKpiPolicyAdministrator(prisma, auth)) return denied(auth)
  const parsed = parseBody(KpiPolicyCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const reconciliation = reconcileKpiPolicyDefinition(parsed.data.definition)
  if (!reconciliation.ok) return NextResponse.json({
    error: `KPI reconciliation case failed: ${reconciliation.caseName}`,
    code: "MTM_KPI_POLICY_RECONCILIATION_FAILED",
  }, { status: 422 })
  const definitionHash = kpiPolicyHash(parsed.data.definition)
  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const actor = await requireCurrentKpiPolicyAdministrator(tx as typeof prisma, auth)
      const policy = await tx.mtmKpiPolicy.create({ data: {
        organizationId: auth.orgId, code: parsed.data.code, version: parsed.data.version,
        nameRu: parsed.data.nameRu, nameAz: parsed.data.nameAz, nameEn: parsed.data.nameEn,
        schemaVersion: parsed.data.definition.schemaVersion,
        definition: parsed.data.definition as unknown as Prisma.InputJsonValue,
        definitionHash, sourceSystem: parsed.data.sourceSystem,
        sourceReference: parsed.data.sourceReference,
        sourceObservedAt: new Date(parsed.data.sourceObservedAt),
        effectiveFrom: kpiPolicyDate(parsed.data.effectiveFrom),
        effectiveTo: parsed.data.effectiveTo ? kpiPolicyDate(parsed.data.effectiveTo) : null,
        status: "DRAFT", createdByUserId: auth.userId,
      } })
      await tx.mtmAuditLog.create({ data: {
        organizationId: auth.orgId, agentId: actor.agentId,
        action: "KPI_POLICY_DRAFT_CREATED", entity: "mtm_kpi_policy", entityId: policy.id,
        metadataKind: "kpi_policy_configuration",
        newData: { code: policy.code, version: policy.version, definitionHash } as Prisma.InputJsonValue,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip"),
        userAgent: req.headers.get("user-agent"),
      } })
      return policy
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === KPI_POLICY_ADMIN_REQUIRED) return denied(auth)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "KPI policy code and version already exist", code: "MTM_KPI_POLICY_VERSION_EXISTS" }, { status: 409 })
    }
    console.error("[MTM/kpi-policies POST]", error)
    return NextResponse.json({ error: "Failed to create KPI policy draft", code: "MTM_KPI_POLICY_CREATE_FAILED" }, { status: 500 })
  }
})
