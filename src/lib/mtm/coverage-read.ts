import type { MtmCoveragePolicy, MtmCoverageSnapshot, PrismaClient } from "@prisma/client"
import type { z } from "zod"
import {
  CoveragePolicyDefinitionSchema,
  CoverageSnapshotCompletenessSchema,
  CoverageSnapshotTotalsSchema,
  coveragePolicySignatureIsCoherent,
  coverageSnapshotIsComplete,
  coverageSnapshotTotalsReconcile,
} from "@/lib/mtm/coverage-policy"

type CoverageReadDb = Pick<PrismaClient, "mtmCoveragePolicy" | "mtmCoverageSnapshot">
type CoverageTotals = z.infer<typeof CoverageSnapshotTotalsSchema>

export interface GovernedCoverageRead {
  available: boolean
  state: string
  period: { start: string; end: string }
  policy: {
    id: string
    code: string
    version: number
    nameRu: string
    nameAz: string
    nameEn: string
    definitionHash: string
    approvalReference: string | null
    sourceSystem: string
    sourceReference: string | null
    sourceObservedAt: Date
  } | null
  snapshot: {
    id: string
    populationHash: string
    sourceCutoffAt: Date
    sourceFreshnessAt: Date | null
    frozenAt: Date | null
    completeness: unknown
  } | null
  totals: CoverageTotals | null
}

function evaluateGovernedCoverage(
  activePolicy: MtmCoveragePolicy | null,
  snapshot: MtmCoverageSnapshot | null,
  period: { start: string; end: string },
): GovernedCoverageRead {
  if (!activePolicy && !snapshot) {
    return { available: false, state: "UNSIGNED_COVERAGE_POLICY", period, policy: null, snapshot: null, totals: null }
  }
  const definition = activePolicy ? CoveragePolicyDefinitionSchema.safeParse(activePolicy.definition) : null
  if (!activePolicy || !definition?.success || !coveragePolicySignatureIsCoherent(activePolicy)) {
    return { available: false, state: "COVERAGE_POLICY_SIGNATURE_INVALID", period, policy: null, snapshot: null, totals: null }
  }

  const policy = {
    id: activePolicy.id,
    code: activePolicy.code,
    version: activePolicy.version,
    nameRu: activePolicy.nameRu,
    nameAz: activePolicy.nameAz,
    nameEn: activePolicy.nameEn,
    definitionHash: activePolicy.definitionHash,
    approvalReference: activePolicy.approvalReference,
    sourceSystem: activePolicy.sourceSystem,
    sourceReference: activePolicy.sourceReference,
    sourceObservedAt: activePolicy.sourceObservedAt,
  }
  if (!snapshot) {
    return { available: false, state: "NO_COVERAGE_SNAPSHOT", period, policy, snapshot: null, totals: null }
  }

  const snapshotSummary = {
    id: snapshot.id,
    populationHash: snapshot.populationHash,
    sourceCutoffAt: snapshot.sourceCutoffAt,
    sourceFreshnessAt: snapshot.sourceFreshnessAt,
    frozenAt: snapshot.frozenAt,
    completeness: snapshot.completeness,
  }
  const totals = CoverageSnapshotTotalsSchema.safeParse(snapshot.totals)
  const completeness = CoverageSnapshotCompletenessSchema.safeParse(snapshot.completeness)
  if (
    snapshot.policyId !== activePolicy.id
    || snapshot.policyVersion !== activePolicy.version
    || snapshot.timezone !== definition.data.timezone
    || !totals.success
    || !coverageSnapshotTotalsReconcile(totals.data)
    || !completeness.success
    || !coverageSnapshotIsComplete(completeness.data)
  ) {
    return {
      available: false,
      state: "COVERAGE_SNAPSHOT_INCOMPLETE",
      period,
      policy,
      snapshot: snapshotSummary,
      totals: null,
    }
  }

  return {
    available: true,
    state: "READY",
    period,
    policy,
    snapshot: { ...snapshotSummary, completeness: completeness.data },
    totals: totals.data,
  }
}

export async function readGovernedCoverage(
  db: CoverageReadDb,
  input: {
    organizationId: string
    agentId: string
    periodStart: Date
    periodEnd: Date
    periodStartKey: string
    periodEndKey: string
  },
): Promise<GovernedCoverageRead> {
  const period = { start: input.periodStartKey, end: input.periodEndKey }
  const snapshot = await db.mtmCoverageSnapshot.findFirst({
    where: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "FROZEN",
    },
    orderBy: { frozenAt: "desc" },
  })
  const activePolicy = snapshot
    ? await db.mtmCoveragePolicy.findFirst({
        where: {
          id: snapshot.policyId,
          organizationId: input.organizationId,
          status: { in: ["ACTIVE", "RETIRED"] },
          effectiveFrom: { lte: input.periodStart },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.periodEnd } }],
        },
      })
    : await db.mtmCoveragePolicy.findFirst({
        where: {
          organizationId: input.organizationId,
          status: "ACTIVE",
          effectiveFrom: { lte: input.periodStart },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.periodEnd } }],
        },
      })
  return evaluateGovernedCoverage(activePolicy, snapshot, period)
}

export async function readGovernedCoverageMany(
  db: CoverageReadDb,
  input: {
    organizationId: string
    agentIds: string[]
    periodStart: Date
    periodEnd: Date
    periodStartKey: string
    periodEndKey: string
  },
): Promise<Map<string, GovernedCoverageRead>> {
  const agentIds = [...new Set(input.agentIds)]
  if (agentIds.length === 0) return new Map()
  const snapshots = await db.mtmCoverageSnapshot.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: { in: agentIds },
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "FROZEN",
    },
    orderBy: { frozenAt: "desc" },
  })
  const snapshotByAgent = new Map<string, MtmCoverageSnapshot>()
  for (const snapshot of snapshots) {
    if (!snapshotByAgent.has(snapshot.agentId)) snapshotByAgent.set(snapshot.agentId, snapshot)
  }
  const snapshotPolicyIds = [...new Set(snapshots.map((snapshot) => snapshot.policyId))]
  const policies = await db.mtmCoveragePolicy.findMany({
    where: {
      organizationId: input.organizationId,
      effectiveFrom: { lte: input.periodStart },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.periodEnd } }] },
        {
          OR: [
            { id: { in: snapshotPolicyIds }, status: { in: ["ACTIVE", "RETIRED"] } },
            { status: "ACTIVE" },
          ],
        },
      ],
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  })
  const policyById = new Map(policies.map((policy) => [policy.id, policy]))
  const currentActivePolicy = policies.find((policy) => policy.status === "ACTIVE") ?? null
  const period = { start: input.periodStartKey, end: input.periodEndKey }
  return new Map(agentIds.map((agentId) => {
    const snapshot = snapshotByAgent.get(agentId) ?? null
    const policy = snapshot ? policyById.get(snapshot.policyId) ?? null : currentActivePolicy
    return [agentId, evaluateGovernedCoverage(policy, snapshot, period)]
  }))
}
