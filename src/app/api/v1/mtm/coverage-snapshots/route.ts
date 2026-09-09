import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  CoveragePolicyDefinitionSchema,
  CoverageSnapshotImportSchema,
  coveragePolicyHash,
  coveragePolicySignatureIsCoherent,
} from "@/lib/mtm/coverage-policy"
import { prepareCoverageSnapshot } from "@/lib/mtm/coverage-snapshot"
import {
  COVERAGE_POLICY_ADMIN_REQUIRED,
  coveragePolicyDate,
  requireCurrentCoveragePolicyAdministrator,
  resolveCoveragePolicyAdministrator,
} from "@/lib/mtm/coverage-policy-admin"

function accessDenied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Coverage snapshot import is available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_COVERAGE_SNAPSHOT_WEB_ONLY"
      : "MTM_COVERAGE_POLICY_ADMIN_REQUIRED",
  }, { status: 403 })
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (!await resolveCoveragePolicyAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(CoverageSnapshotImportSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const expectedDefinitionHash = parsed.data.expectedDefinitionHash.toLowerCase()
  const periodStart = coveragePolicyDate(parsed.data.periodStart)
  const periodEnd = coveragePolicyDate(parsed.data.periodEnd)
  const durationDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1
  if (durationDays > 366) {
    return NextResponse.json({
      error: "Coverage period cannot exceed 366 days",
      code: "MTM_COVERAGE_PERIOD_TOO_LARGE",
    }, { status: 400 })
  }
  const sourceCutoffAt = new Date(parsed.data.sourceCutoffAt)
  const sourceFreshnessAt = parsed.data.sourceFreshnessAt ? new Date(parsed.data.sourceFreshnessAt) : null

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-coverage-snapshot:${auth.orgId}:${parsed.data.agentId}:${parsed.data.periodStart}:${parsed.data.periodEnd}:${parsed.data.policyId}`}, 0))`
      const currentActor = await requireCurrentCoveragePolicyAdministrator(tx as typeof prisma, auth)
      const policy = await tx.mtmCoveragePolicy.findFirst({
        where: {
          id: parsed.data.policyId,
          organizationId: auth.orgId,
          status: "ACTIVE",
          effectiveFrom: { lte: periodStart },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodEnd } }],
        },
      })
      if (!policy) return { kind: "POLICY_NOT_FOUND" as const }
      const definition = CoveragePolicyDefinitionSchema.safeParse(policy.definition)
      if (!definition.success || !coveragePolicySignatureIsCoherent(policy)) {
        return { kind: "POLICY_INVALID" as const }
      }
      if (policy.definitionHash.toLowerCase() !== expectedDefinitionHash || coveragePolicyHash(definition.data) !== expectedDefinitionHash) {
        return { kind: "POLICY_HASH_CONFLICT" as const, actualDefinitionHash: policy.definitionHash }
      }

      const agent = await tx.mtmAgent.findFirst({
        where: { id: parsed.data.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true, name: true },
      })
      if (!agent) return { kind: "AGENT_NOT_FOUND" as const }

      const normalizedInput = {
        ...parsed.data,
        rows: parsed.data.rows.map((row) => ({
          ...row,
          ...(row.subjectType === "PHARMACY"
            ? { customerId: row.subjectId, customerName: row.subjectName }
            : {}),
          sourceEvidence: {
            ...row.sourceEvidence,
            sourceBatchReference: parsed.data.sourceBatchReference,
          },
        })),
      }
      const prepared = prepareCoverageSnapshot(definition.data, normalizedInput, agent)
      if (!prepared.ok) return { kind: "ROWS_INVALID" as const, issues: prepared.issues }

      const contactIds = [...new Set(prepared.value.rows
        .filter((row) => row.subjectType === "DOCTOR")
        .map((row) => row.subjectId))]
      const customerIds = [...new Set(prepared.value.rows.flatMap((row) => [
        ...(row.subjectType === "PHARMACY" ? [row.subjectId] : []),
        ...(row.customerId ? [row.customerId] : []),
      ]))]
      const [contacts, customers] = await Promise.all([
        contactIds.length ? tx.mtmContact.findMany({
          where: { organizationId: auth.orgId, id: { in: contactIds }, type: "DOCTOR", deletedAt: null },
          select: { id: true },
        }) : [],
        customerIds.length ? tx.mtmCustomer.findMany({
          where: { organizationId: auth.orgId, id: { in: customerIds }, deletedAt: null },
          select: { id: true, objectType: true },
        }) : [],
      ])
      const foundContacts = new Set(contacts.map((contact) => contact.id))
      const foundCustomers = new Map(customers.map((customer) => [customer.id, customer.objectType]))
      const missingContacts = contactIds.filter((id) => !foundContacts.has(id))
      const missingCustomers = customerIds.filter((id) => !foundCustomers.has(id))
      const nonPharmacySubjects = prepared.value.rows
        .filter((row) => row.subjectType === "PHARMACY" && foundCustomers.get(row.subjectId) !== "PHARMACY")
        .map((row) => row.subjectId)
      if (missingContacts.length || missingCustomers.length || nonPharmacySubjects.length) {
        return {
          kind: "SUBJECTS_INVALID" as const,
          missingContacts,
          missingCustomers,
          nonPharmacySubjects: [...new Set(nonPharmacySubjects)],
        }
      }

      const existing = await tx.mtmCoverageSnapshot.findFirst({
        where: {
          organizationId: auth.orgId,
          agentId: agent.id,
          periodStart,
          periodEnd,
          policyId: policy.id,
        },
      })
      if (existing) {
        const replay = existing.status === "FROZEN"
          && existing.populationHash === prepared.value.populationHash
          && existing.policyVersion === policy.version
          && existing.timezone === definition.data.timezone
          && existing.sourceCutoffAt.getTime() === sourceCutoffAt.getTime()
          && sameInstant(existing.sourceFreshnessAt, sourceFreshnessAt)
        return replay
          ? { kind: "OK" as const, snapshot: existing, idempotent: true }
          : { kind: "SNAPSHOT_CONFLICT" as const, snapshotId: existing.id, status: existing.status }
      }

      const snapshot = await tx.mtmCoverageSnapshot.create({
        data: {
          organizationId: auth.orgId,
          policyId: policy.id,
          policyVersion: policy.version,
          agentId: agent.id,
          agentName: agent.name,
          periodStart,
          periodEnd,
          timezone: definition.data.timezone,
          status: "BUILDING",
          sourceCutoffAt,
          sourceFreshnessAt,
          populationHash: prepared.value.populationHash,
          createdByUserId: auth.userId,
        },
      })
      const inserted = await tx.mtmCoverageSnapshotRow.createMany({
        data: prepared.value.rows.map((row) => ({
          organizationId: auth.orgId,
          snapshotId: snapshot.id,
          rowHash: row.rowHash,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          customerId: row.customerId,
          customerName: row.customerName,
          ownerAgentId: row.ownerAgentId,
          ownerAgentName: row.ownerAgentName,
          groupKey: row.groupKey,
          groupLabel: row.groupLabel,
          groupOrder: row.groupOrder,
          categoryCode: row.categoryCode,
          categoryLabel: row.categoryLabel,
          specialtyCode: row.specialtyCode,
          specialtyName: row.specialtyName,
          requiredCoverage: row.requiredCoverage,
          actualMoi: row.actualMoi,
          target: row.target,
          actualCoverage: row.actualCoverage,
          uncoveredMoi: row.uncoveredMoi,
          explanation: row.explanation as Prisma.InputJsonValue,
          planningContext: row.planningContext as Prisma.InputJsonValue,
          sourceEvidence: row.sourceEvidence as Prisma.InputJsonValue,
        })),
      })
      if (inserted.count !== prepared.value.rows.length) throw new Error("MTM_COVERAGE_SNAPSHOT_ROW_COUNT_MISMATCH")

      const completeness = {
        schemaVersion: 1 as const,
        complete: true,
        expectedRows: prepared.value.rows.length,
        persistedRows: inserted.count,
        missingSources: [] as string[],
        warnings: [] as string[],
      }
      const frozenAt = new Date()
      const changed = await tx.mtmCoverageSnapshot.updateMany({
        where: {
          id: snapshot.id,
          organizationId: auth.orgId,
          status: "BUILDING",
          populationHash: prepared.value.populationHash,
        },
        data: {
          status: "FROZEN",
          totals: prepared.value.totals as unknown as Prisma.InputJsonValue,
          completeness,
          frozenByUserId: auth.userId,
          frozenAt,
        },
      })
      if (changed.count !== 1) throw new Error("MTM_COVERAGE_SNAPSHOT_CAS_CONFLICT")
      const frozen = await tx.mtmCoverageSnapshot.findFirst({
        where: { id: snapshot.id, organizationId: auth.orgId, status: "FROZEN" },
      })
      if (!frozen) throw new Error("MTM_COVERAGE_SNAPSHOT_FREEZE_FAILED")

      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "COVERAGE_SNAPSHOT_FROZEN",
          entity: "mtm_coverage_snapshot",
          entityId: frozen.id,
          metadataKind: "coverage_snapshot_freeze",
          newData: {
            policyId: policy.id,
            policyVersion: policy.version,
            definitionHash: policy.definitionHash,
            agentId: agent.id,
            periodStart: parsed.data.periodStart,
            periodEnd: parsed.data.periodEnd,
            populationHash: frozen.populationHash,
            sourceCutoffAt: sourceCutoffAt.toISOString(),
            sourceFreshnessAt: sourceFreshnessAt?.toISOString() ?? null,
            sourceBatchReference: parsed.data.sourceBatchReference,
            rowCount: inserted.count,
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return { kind: "OK" as const, snapshot: frozen, idempotent: false }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    })

    if (result.kind === "POLICY_NOT_FOUND") {
      return NextResponse.json({ error: "Active coverage policy not found for this period", code: "MTM_COVERAGE_POLICY_NOT_FOUND" }, { status: 404 })
    }
    if (result.kind === "POLICY_INVALID") {
      return NextResponse.json({ error: "Coverage policy signature is not coherent", code: "MTM_COVERAGE_POLICY_SIGNATURE_INCOHERENT" }, { status: 409 })
    }
    if (result.kind === "POLICY_HASH_CONFLICT") {
      return NextResponse.json({
        error: "Coverage policy changed since the snapshot source was prepared",
        code: "MTM_COVERAGE_POLICY_HASH_CONFLICT",
        actualDefinitionHash: result.actualDefinitionHash,
      }, { status: 409 })
    }
    if (result.kind === "AGENT_NOT_FOUND") {
      return NextResponse.json({ error: "Agent not found", code: "MTM_COVERAGE_AGENT_NOT_FOUND" }, { status: 404 })
    }
    if (result.kind === "ROWS_INVALID") {
      return NextResponse.json({ error: "Coverage snapshot rows do not match the signed policy", code: "MTM_COVERAGE_SNAPSHOT_ROWS_INVALID", issues: result.issues }, { status: 422 })
    }
    if (result.kind === "SUBJECTS_INVALID") {
      return NextResponse.json({
        error: "Coverage snapshot contains unknown or incompatible tenant subjects",
        code: "MTM_COVERAGE_SNAPSHOT_SUBJECTS_INVALID",
        missingContacts: result.missingContacts,
        missingCustomers: result.missingCustomers,
        nonPharmacySubjects: result.nonPharmacySubjects,
      }, { status: 422 })
    }
    if (result.kind === "SNAPSHOT_CONFLICT") {
      return NextResponse.json({
        error: "A different snapshot already exists for this employee, period and policy",
        code: "MTM_COVERAGE_SNAPSHOT_CONFLICT",
        snapshotId: result.snapshotId,
        status: result.status,
      }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: result.snapshot, idempotent: result.idempotent }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof Error && error.message === COVERAGE_POLICY_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Error && [
      "MTM_COVERAGE_SNAPSHOT_ROW_COUNT_MISMATCH",
      "MTM_COVERAGE_SNAPSHOT_CAS_CONFLICT",
      "MTM_COVERAGE_SNAPSHOT_FREEZE_FAILED",
    ].includes(error.message)) {
      return NextResponse.json({ error: "Coverage snapshot could not be frozen atomically", code: error.message }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({ error: "Coverage snapshot conflicted with another import", code: "MTM_COVERAGE_SNAPSHOT_CAS_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/coverage-snapshots POST]", error)
    return NextResponse.json({ error: "Failed to freeze coverage snapshot", code: "MTM_COVERAGE_SNAPSHOT_FREEZE_FAILED" }, { status: 500 })
  }
})
