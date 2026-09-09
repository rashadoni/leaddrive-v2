import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  CoveragePolicyDefinitionSchema,
  CoverageSnapshotCompletenessSchema,
  CoverageSnapshotExplanationSchema,
  coveragePolicySignatureIsCoherent,
  coverageSnapshotIsComplete,
} from "@/lib/mtm/coverage-policy"

type RouteContext = { params: Promise<{ id: string }> }

function integerParam(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export const GET = withRouteFieldRlsAuth<RouteContext>("read", async (req, auth, { params }) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden", code: "MTM_COVERAGE_SCOPE_DENIED" }, { status: 403 })

  const { id } = await params
  const query = new URL(req.url).searchParams
  const groupKey = query.get("groupKey")?.trim() || null
  const uncoveredOnlyValue = query.get("uncoveredOnly")
  const uncoveredOnly = uncoveredOnlyValue === null || uncoveredOnlyValue === "true"
    ? true
    : uncoveredOnlyValue === "false"
      ? false
      : null
  const page = integerParam(query.get("page"), 1, 1, 200)
  const limit = integerParam(query.get("limit"), 20, 1, 50)
  if (uncoveredOnly === null || page === null || limit === null || (groupKey && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(groupKey))) {
    return NextResponse.json({ error: "Invalid coverage row filters", code: "MTM_COVERAGE_ROWS_INPUT_INVALID" }, { status: 400 })
  }

  const snapshot = await prisma.mtmCoverageSnapshot.findFirst({
    where: { id, organizationId: auth.orgId, status: "FROZEN" },
  })
  if (!snapshot || !isAgentInRouteScope(actor, snapshot.agentId)) {
    return NextResponse.json({ error: "Not found", code: "MTM_COVERAGE_SNAPSHOT_NOT_FOUND" }, { status: 404 })
  }

  const policy = await prisma.mtmCoveragePolicy.findFirst({
    where: {
      id: snapshot.policyId,
      organizationId: auth.orgId,
      status: { in: ["ACTIVE", "RETIRED"] },
    },
  })
  const definition = policy ? CoveragePolicyDefinitionSchema.safeParse(policy.definition) : null
  const completeness = CoverageSnapshotCompletenessSchema.safeParse(snapshot.completeness)
  if (
    !policy
    || !definition
    || !definition.success
    || !coveragePolicySignatureIsCoherent(policy)
    || snapshot.policyVersion !== policy.version
    || snapshot.timezone !== definition.data.timezone
    || !completeness.success
    || !coverageSnapshotIsComplete(completeness.data)
  ) {
    return NextResponse.json({
      error: "Coverage snapshot integrity check failed",
      code: "MTM_COVERAGE_SNAPSHOT_INCOMPLETE",
    }, { status: 409 })
  }
  const group = groupKey ? definition.data.groups.find((candidate) => candidate.key === groupKey) : null
  if (groupKey && !group) {
    return NextResponse.json({ error: "Coverage group not found", code: "MTM_COVERAGE_GROUP_NOT_FOUND" }, { status: 404 })
  }

  const where = {
    organizationId: auth.orgId,
    snapshotId: snapshot.id,
    ...(groupKey ? { groupKey } : {}),
    ...(uncoveredOnly ? { uncoveredMoi: { gt: 0 } } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.mtmCoverageSnapshotRow.count({ where }),
    prisma.mtmCoverageSnapshotRow.findMany({
      where,
      orderBy: [{ groupOrder: "asc" }, { subjectName: "asc" }, { subjectId: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        subjectName: true,
        customerId: true,
        customerName: true,
        groupKey: true,
        groupLabel: true,
        groupOrder: true,
        categoryCode: true,
        categoryLabel: true,
        specialtyCode: true,
        specialtyName: true,
        requiredCoverage: true,
        actualMoi: true,
        target: true,
        actualCoverage: true,
        uncoveredMoi: true,
        explanation: true,
        planningContext: true,
      },
    }),
  ])
  const normalizedRows = rows.map((row) => {
    const explanation = CoverageSnapshotExplanationSchema.safeParse(row.explanation)
    return explanation.success ? {
      ...row,
      requiredCoverage: row.requiredCoverage.toString(),
      actualMoi: row.actualMoi.toString(),
      target: row.target.toString(),
      actualCoverage: row.actualCoverage.toString(),
      uncoveredMoi: row.uncoveredMoi.toString(),
      explanation: explanation.data,
      planningTarget: row.customerId ? {
        customerId: row.customerId,
        contactId: row.subjectType === "DOCTOR" ? row.subjectId : null,
      } : null,
    } : null
  })
  if (normalizedRows.some((row) => row === null)) {
    return NextResponse.json({
      error: "Coverage row explanation is incomplete",
      code: "MTM_COVERAGE_ROW_EXPLANATION_INVALID",
    }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    data: {
      snapshot: {
        id: snapshot.id,
        agentId: snapshot.agentId,
        agentName: snapshot.agentName,
        periodStart: snapshot.periodStart.toISOString().slice(0, 10),
        periodEnd: snapshot.periodEnd.toISOString().slice(0, 10),
        frozenAt: snapshot.frozenAt,
      },
      policy: {
        id: policy.id,
        code: policy.code,
        version: policy.version,
        definitionHash: policy.definitionHash,
        approvalReference: policy.approvalReference,
      },
      filter: { groupKey, uncoveredOnly, page, limit },
      total,
      hasMore: page * limit < total,
      rows: normalizedRows,
    },
  })
})
