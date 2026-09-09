import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  PharmacyPromotionEligibilityDefinitionSchema,
  PharmacyPromotionFormulaDefinitionSchema,
  calculatePharmacyPromotionPoints,
  evaluatePharmacyPromotionEligibility,
  pharmacyPromotionConfigurationState,
  pharmacyPromotionExecutionReadiness,
  pharmacyPromotionFilterHash,
  pharmacyPromotionFilterValidationError,
  pharmacyPromotionFiltersFromSearchParams,
  pharmacyPromotionHash,
  pharmacyPromotionSyncScopeKey,
  pharmacyPromotionSourceFreshness,
  reconcilePharmacyPromotionLedger,
} from "@/lib/mtm/pharmacy-promotion"
import {
  PHARMACY_PROMOTION_SNAPSHOT_ROW_MAX,
  pharmacyPromotionCapabilities,
  pharmacyPromotionExecutionOrderBy,
  pharmacyPromotionExecutionWhere,
  pharmacyPromotionSelectionHash,
  pharmacyPromotionSnapshotSelect,
} from "@/lib/mtm/pharmacy-promotion-query"
import { PharmacyPromotionExecutionDraftSchema } from "@/lib/mtm/pharmacy-promotion-validators"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"

function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

function decimal(value: Prisma.Decimal | string | number | null | undefined): string | null {
  return value == null ? null : new Prisma.Decimal(value).toFixed(4)
}

function ledgerProjection(entries: Array<{ bucket: string; delta: Prisma.Decimal }>) {
  const factEntries = entries.filter((entry) => entry.bucket === "FACT_POINTS")
  const rewardEntries = entries.filter((entry) => entry.bucket === "REWARD_POINTS")
  if (factEntries.length === 0 && rewardEntries.length === 0) {
    return { posted: false, factPoints: null, rewardPoints: null, difference: null }
  }
  const factPoints = reconcilePharmacyPromotionLedger(factEntries)
  const rewardPoints = reconcilePharmacyPromotionLedger(rewardEntries)
  return {
    posted: true,
    factPoints,
    rewardPoints,
    difference: new Prisma.Decimal(factPoints).minus(rewardPoints).toFixed(4),
  }
}

function nonEmptyFacetValues<T>(rows: T[], read: (row: T) => string | null): string[] {
  return rows
    .map(read)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
}

function rowProjection(
  row: ExecutionRow,
  postingEnabled: boolean,
  now: Date,
) {
  const formulaDefinition = PharmacyPromotionFormulaDefinitionSchema.safeParse(row.formula.definition)
  const eligibilityDefinition = PharmacyPromotionEligibilityDefinitionSchema.safeParse(
    row.target.promotionVersion.eligibilityDefinition,
  )
  const configuration = pharmacyPromotionConfigurationState({
    formula: {
      status: row.formula.status,
      definition: row.formula.definition,
      definitionHash: row.formula.definitionHash,
      signedAt: row.formula.signedAt,
      approvalReference: row.formula.approvalReference,
      version: String(row.formula.version),
    },
    approvalPolicy: {
      status: row.approvalPolicy.status,
      definition: row.approvalPolicy.definition,
      definitionHash: row.approvalPolicy.definitionHash,
      signedAt: row.approvalPolicy.signedAt,
      approvalReference: row.approvalPolicy.approvalReference,
      version: String(row.approvalPolicy.version),
    },
    eligibilityDefinition: row.target.promotionVersion.eligibilityDefinition,
    eligibilityDefinitionHash: row.target.promotionVersion.eligibilityDefinitionHash,
    eligibilityApprovedAt: row.target.promotionVersion.eligibilityApprovedAt,
    eligibilityApprovalReference: row.target.promotionVersion.eligibilityApprovalReference,
    postingEnabled,
    allowRetiredDefinitions: row.target.promotionVersion.status === "RETIRED",
  })
  const freshness = pharmacyPromotionSourceFreshness({
    observedAt: row.sourceObservedAt,
    receivedAt: row.sourceReceivedAt,
    now,
    thresholdMinutes: formulaDefinition.success
      ? formulaDefinition.data.sourceFreshnessMinutes
      : 1,
  })
  const overrideReason = typeof row.target.eligibilityOverrideReason === "string"
    ? row.target.eligibilityOverrideReason.trim()
    : ""
  const overrideActive = row.target.eligibilityStatus === "OVERRIDDEN" && overrideReason.length > 0
  const overrideAuditMissing = row.target.eligibilityStatus === "OVERRIDDEN" && !overrideActive
  const eligibilityEvaluation = eligibilityDefinition.success
    ? evaluatePharmacyPromotionEligibility(eligibilityDefinition.data, {
        customerObjectType: row.target.customer.objectType,
        customerActive: row.target.customer.status === "ACTIVE" && !row.target.customer.deletedAt,
        visitCompleted: row.visit?.status === "CHECKED_OUT",
        evidenceCount: row._count.evidence,
      })
    : null
  const eligibilityReasons = eligibilityEvaluation?.status === "INELIGIBLE"
    ? eligibilityEvaluation.reasons
    : []
  const eligibilityBlockers = eligibilityReasons.flatMap((reason) => {
    if (reason === "CUSTOMER_TYPE" || reason === "CUSTOMER_INACTIVE") return ["MTM_PHARMACY_TARGET_INVALID"]
    if (overrideActive) return []
    if (reason === "VISIT_INCOMPLETE") return ["MTM_PHARMACY_VISIT_INCOMPLETE"]
    if (reason === "EVIDENCE_INCOMPLETE") return ["MTM_PHARMACY_EVIDENCE_INCOMPLETE"]
    return ["MTM_PHARMACY_EXECUTION_INELIGIBLE"]
  })
  if (!overrideActive && row.target.eligibilityStatus === "INELIGIBLE") {
    eligibilityBlockers.push("MTM_PHARMACY_EXECUTION_INELIGIBLE")
  }
  const readiness = pharmacyPromotionExecutionReadiness({
    configuration,
    source: freshness,
    evidenceCount: row._count.evidence,
    minimumEvidenceCount: overrideActive
      ? 0
      : eligibilityDefinition.success
      ? eligibilityDefinition.data.minimumEvidenceCount
      : Number.MAX_SAFE_INTEGER,
  })
  const readinessBlockers = [...new Set([
    ...(overrideAuditMissing ? ["MTM_PHARMACY_TARGET_OVERRIDE_AUDIT_MISSING"] : []),
    ...(readiness.ready ? [] : readiness.blockers),
    ...eligibilityBlockers,
  ])]

  return {
    id: row.id,
    version: row.version,
    status: row.status,
    l1State: row.l1State,
    l2State: row.l2State,
    currentStep: row.l1State === "READY" ? "L1" : row.l2State === "READY" ? "L2" : null,
    nextResponsible: row.l1State === "READY" ? "L1_REVIEWER" : row.l2State === "READY" ? "L2_REVIEWER" : null,
    target: {
      id: row.target.id,
      status: row.target.status,
      customerId: row.target.customerId,
      customerName: row.target.customerNameSnapshot,
      customerCode: row.target.customerCodeSnapshot,
      registrationCode: row.target.customerRegistrationSnapshot,
      address: row.target.customerAddressSnapshot,
      locality: row.target.customer.locality,
      territoryCode: row.target.customer.territoryCode,
      contact: row.target.contact ? { id: row.target.contact.id, name: row.target.contact.displayName } : null,
      planQuantity: decimal(row.planQuantitySnapshot),
      unit: row.unit,
    },
    employee: {
      id: row.agent.id,
      name: row.target.agentNameSnapshot,
      team: row.target.assignedTeamId ? { id: row.target.assignedTeamId, name: row.target.teamNameSnapshot } : null,
      manager: row.target.managingManagerId
        ? { id: row.target.managingManagerId, name: row.target.managerNameSnapshot }
        : null,
    },
    promotion: {
      id: row.target.promotionVersion.promotion.id,
      code: row.target.promotionVersion.promotion.code,
      versionId: row.target.promotionVersion.id,
      revision: row.target.promotionVersion.revision,
      type: {
        id: row.target.promotionVersion.type.id,
        code: row.target.promotionVersion.type.code,
        nameRu: row.target.promotionVersion.type.nameRu,
        nameAz: row.target.promotionVersion.type.nameAz,
        nameEn: row.target.promotionVersion.type.nameEn,
      },
      nameRu: row.target.promotionVersion.nameRu,
      nameAz: row.target.promotionVersion.nameAz,
      nameEn: row.target.promotionVersion.nameEn,
    },
    visit: row.visit ? {
      id: row.visit.id,
      status: row.visit.status,
      checkInAt: row.visit.checkInAt,
      checkOutAt: row.visit.checkOutAt,
    } : null,
    factQuantity: decimal(row.actualQuantity),
    preview: {
      calculated: row.factPointsPreview !== null || row.rewardPointsPreview !== null,
      factPoints: decimal(row.factPointsPreview),
      rewardPoints: decimal(row.rewardPointsPreview),
      difference: decimal(row.differencePointsPreview),
    },
    ledger: ledgerProjection(row.ledgerEntries),
    evidenceCount: row._count.evidence,
    eligibility: {
      status: row.target.eligibilityStatus,
      overridden: overrideActive,
      overrideReason: overrideActive ? overrideReason : null,
      evaluatedStatus: eligibilityEvaluation?.status ?? "UNKNOWN",
      reasons: eligibilityReasons,
    },
    policy: {
      ready: readiness.ready && !overrideAuditMissing && eligibilityBlockers.length === 0,
      blockers: readiness.ready && !overrideAuditMissing && eligibilityBlockers.length === 0 ? [] : readinessBlockers,
      formulaVersion: row.formulaVersion,
      formulaHash: row.formulaHash,
      approvalPolicyVersion: row.approvalPolicyVersion,
      approvalPolicyHash: row.approvalPolicyHash,
    },
    source: {
      system: row.sourceSystem,
      reference: row.sourceReference,
      observedAt: row.sourceObservedAt,
      receivedAt: row.sourceReceivedAt,
      freshness,
    },
    submittedAt: row.submittedAt,
    readyAt: row.readyAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const executionInclude = {
  agent: { select: { id: true, name: true, teamId: true } },
  target: {
    include: {
      customer: { select: { id: true, locality: true, territoryCode: true, objectType: true, status: true, deletedAt: true } },
      contact: { select: { id: true, displayName: true } },
      assignedTeam: { select: { id: true, name: true, regionId: true } },
      promotionVersion: {
        include: {
          promotion: { select: { id: true, code: true } },
          type: { select: { id: true, code: true, nameRu: true, nameAz: true, nameEn: true } },
        },
      },
    },
  },
  visit: { select: { id: true, status: true, checkInAt: true, checkOutAt: true } },
  formula: {
    select: {
      id: true,
      version: true,
      definition: true,
      definitionHash: true,
      status: true,
      signedAt: true,
      approvalReference: true,
    },
  },
  approvalPolicy: {
    select: {
      id: true,
      version: true,
      definition: true,
      definitionHash: true,
      status: true,
      signedAt: true,
      approvalReference: true,
    },
  },
  ledgerEntries: { select: { bucket: true, delta: true } },
  _count: { select: { evidence: true } },
} satisfies Prisma.MtmPharmacyPromotionExecutionInclude

type ExecutionRow = Prisma.MtmPharmacyPromotionExecutionGetPayload<{
  include: typeof executionInclude
}>

export const GET = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const actor = await actorFor(auth)
  if (!actor) {
    return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  }
  const filters = pharmacyPromotionFiltersFromSearchParams(new URL(req.url).searchParams)
  const invalid = pharmacyPromotionFilterValidationError(filters)
  if (invalid) {
    return NextResponse.json({ error: "Invalid promotion filter", ...invalid }, { status: 400 })
  }

  try {
    const settings = await getMtmSettings(auth.orgId)
    const where = pharmacyPromotionExecutionWhere({
      organizationId: auth.orgId,
      actor,
      filters,
      timezone: settings.timezone,
    })
    const ids = actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds]
    const targetScope = {
      organizationId: auth.orgId,
      ...(ids === null ? {} : { assignedAgentId: { in: ids } }),
    } satisfies Prisma.MtmPharmacyPromotionTargetWhereInput
    const [
      rows,
      total,
      readyL1,
      readyL2,
      ledgerTotals,
      executionFreshness,
      ledgerFreshness,
      visitFreshness,
      snapshotRows,
      agents,
      teams,
      promotionVersions,
      regions,
      localityRows,
      territoryRows,
      contacts,
      managers,
    ] = await prisma.$transaction(async (tx: Prisma.TransactionClient) => Promise.all([
      tx.mtmPharmacyPromotionExecution.findMany({
        where,
        include: executionInclude,
        orderBy: pharmacyPromotionExecutionOrderBy(filters),
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      tx.mtmPharmacyPromotionExecution.count({ where }),
      tx.mtmPharmacyPromotionExecution.count({ where: { ...where, l1State: "READY" } }),
      tx.mtmPharmacyPromotionExecution.count({ where: { ...where, l2State: "READY" } }),
      tx.mtmPharmacyPointsLedgerEntry.groupBy({
        by: ["bucket"],
        where: { organizationId: auth.orgId, execution: where },
        _sum: { delta: true },
        orderBy: { bucket: "asc" },
      }),
      tx.mtmPharmacyPromotionExecution.aggregate({ where, _max: { updatedAt: true } }),
      tx.mtmPharmacyPointsLedgerEntry.aggregate({
        where: { organizationId: auth.orgId, execution: where },
        _max: { occurredAt: true },
      }),
      tx.mtmVisit.aggregate({
        where: {
          organizationId: auth.orgId,
          pharmacyPromotionExecutions: { some: where },
        },
        _max: { updatedAt: true },
      }),
      tx.mtmPharmacyPromotionExecution.findMany({
        where,
        orderBy: { id: "asc" },
        take: PHARMACY_PROMOTION_SNAPSHOT_ROW_MAX,
        select: pharmacyPromotionSnapshotSelect,
      }),
      tx.mtmAgent.findMany({
        where: { organizationId: auth.orgId, status: "ACTIVE", ...(ids === null ? {} : { id: { in: ids } }) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, teamId: true },
      }),
      tx.mtmTeam.findMany({
        where: {
          organizationId: auth.orgId,
          pharmacyPromotionTargets: { some: targetScope },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, regionId: true },
        take: 500,
      }),
      tx.mtmPharmacyPromotionVersion.findMany({
        where: {
          organizationId: auth.orgId,
          targets: { some: targetScope },
        },
        orderBy: [{ startsOn: "desc" }, { revision: "desc" }],
        select: {
          id: true,
          revision: true,
          nameRu: true,
          nameAz: true,
          nameEn: true,
          status: true,
          promotion: { select: { id: true, code: true } },
          type: { select: { id: true, code: true, nameRu: true, nameAz: true, nameEn: true } },
        },
      }),
      tx.mtmRegion.findMany({
        where: {
          organizationId: auth.orgId,
          teams: {
            some: {
              pharmacyPromotionTargets: { some: targetScope },
            },
          },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
        take: 500,
      }),
      tx.mtmCustomer.findMany({
        where: {
          organizationId: auth.orgId,
          locality: { not: null },
          pharmacyPromotionTargets: { some: targetScope },
        },
        distinct: ["locality"],
        orderBy: { locality: "asc" },
        select: { locality: true },
        take: 500,
      }),
      tx.mtmCustomer.findMany({
        where: {
          organizationId: auth.orgId,
          territoryCode: { not: null },
          pharmacyPromotionTargets: { some: targetScope },
        },
        distinct: ["territoryCode"],
        orderBy: { territoryCode: "asc" },
        select: { territoryCode: true },
        take: 500,
      }),
      tx.mtmContact.findMany({
        where: {
          organizationId: auth.orgId,
          pharmacyPromotionTargets: { some: targetScope },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        select: { id: true, displayName: true },
        take: 500,
      }),
      tx.mtmAgent.findMany({
        where: {
          organizationId: auth.orgId,
          managedPharmacyTargets: { some: targetScope },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
        take: 500,
      }),
    ]), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    })
    const now = new Date()
    const bucketTotal = (bucket: string) => {
      const value = ledgerTotals.find((entry: {
        bucket: string
        _sum: { delta: Prisma.Decimal | null }
      }) => entry.bucket === bucket)?._sum.delta
      return value == null ? null : decimal(value)
    }
    const factPoints = bucketTotal("FACT_POINTS")
    const rewardPoints = bucketTotal("REWARD_POINTS")
    const filterHash = pharmacyPromotionFilterHash(filters)
    const scopeHash = pharmacyPromotionHash({
      organizationId: auth.orgId,
      role: actor.role,
      agentId: actor.agentId,
      scopedAgentIds: ids === null ? null : [...ids].sort(),
    })
    const snapshotId = pharmacyPromotionHash({
      filterHash,
      scopeHash,
      total,
      executionUpdatedAt: executionFreshness._max.updatedAt,
      ledgerOccurredAt: ledgerFreshness._max.occurredAt,
      visitUpdatedAt: visitFreshness._max.updatedAt,
      ledgerTotals,
      selectionHash: pharmacyPromotionSelectionHash(snapshotRows),
    })

    return NextResponse.json({
      success: true,
      data: {
        rows: rows.map((row: ExecutionRow) => rowProjection(row, settings.pharmacyPromotionPostingEnabled, now)),
        pageInfo: {
          page: filters.page,
          pageSize: filters.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
        },
        summary: {
          executions: total,
          readyL1,
          readyL2,
          factPoints,
          rewardPoints,
          difference: factPoints === null && rewardPoints === null
            ? null
            : new Prisma.Decimal(factPoints ?? 0).minus(rewardPoints ?? 0).toFixed(4),
        },
        filters: {
          agents,
          teams,
          promotionVersions,
          regions,
          localities: nonEmptyFacetValues(
            localityRows as Array<{ locality: string | null }>,
            (row) => row.locality,
          )
            .map((value) => ({ id: value, name: value })),
          territories: nonEmptyFacetValues(
            territoryRows as Array<{ territoryCode: string | null }>,
            (row) => row.territoryCode,
          )
            .map((value) => ({ id: value, name: value })),
          contacts: contacts.map((contact: { id: string; displayName: string }) => ({
            id: contact.id,
            name: contact.displayName,
          })),
          managers,
          // Legacy "user group" is backed by the current MTM team hierarchy;
          // userGroupId is enforced as assignedTeamId by the canonical query helper.
          userGroups: teams.map((team: { id: string; name: string }) => ({ id: team.id, name: team.name })),
        },
        normalizedFilters: filters,
        filterHash,
        snapshotId,
        syncScopeKey: pharmacyPromotionSyncScopeKey({
          organizationId: auth.orgId,
          userId: auth.userId,
          agentId: actor.agentId,
        }),
        asOf: now,
        timezone: settings.timezone,
        capabilities: pharmacyPromotionCapabilities(actor, settings.pharmacyPromotionPostingEnabled),
      },
    })
  } catch (error) {
    console.error("[MTM/pharmacy-promotion-executions GET]", error)
    return NextResponse.json({ error: "Failed to load promotion executions", code: "MTM_PHARMACY_LIST_FAILED" }, { status: 500 })
  }
})

function clientObservedAt(value: string | undefined, receivedAt: Date): Date | null {
  if (!value) return receivedAt
  const parsed = new Date(value)
  const futureClockToleranceMs = 5 * 60_000
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > receivedAt.getTime() + futureClockToleranceMs) {
    return null
  }
  // A supplied old timestamp is factual provenance. Never rewrite it to now:
  // freshness and campaign-period gates must evaluate the original observation.
  return parsed
}

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  if (auth.principal === "mobile") {
    const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
    if (forbidden) return forbidden
  }
  const actor = await actorFor(auth)
  if (!actor) {
    return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  }
  if (actor.role !== "AGENT" || !actor.agentId) {
    return NextResponse.json({
      error: "Only the assigned field employee can record promotion facts",
      code: "MTM_PHARMACY_FIELD_EXECUTE_DENIED",
    }, { status: 403 })
  }
  const parsed = PharmacyPromotionExecutionDraftSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid promotion execution",
      code: "MTM_PHARMACY_EXECUTION_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  const requestHash = pharmacyPromotionHash({
    targetId: body.targetId,
    supersedesExecutionId: body.supersedesExecutionId ?? null,
    clientExecutionId: body.clientExecutionId,
    operationId: body.operationId,
    expectedVersion: body.expectedVersion ?? 0,
    visitId: body.visitId ?? null,
    factQuantity: new Prisma.Decimal(body.factQuantity).toString(),
    unit: body.unit,
    clientOccurredAt: body.clientOccurredAt ?? null,
  })

  const replay = await prisma.mtmPharmacyPromotionExecution.findFirst({
    where: {
      organizationId: auth.orgId,
      agentId: actor.agentId,
      clientExecutionId: body.clientExecutionId,
    },
    include: executionInclude,
  })
  if (replay) {
    if (replay.requestHash !== requestHash || replay.targetId !== body.targetId) {
      return NextResponse.json({
        error: "Client execution ID was already used with different facts",
        code: "MTM_PHARMACY_EXECUTION_IDEMPOTENCY_CONFLICT",
      }, { status: 409 })
    }
    const settings = await getMtmSettings(auth.orgId)
    return NextResponse.json({
      success: true,
      data: rowProjection(replay, settings.pharmacyPromotionPostingEnabled, new Date()),
      idempotent: true,
    })
  }

  const target = await prisma.mtmPharmacyPromotionTarget.findFirst({
    where: {
      id: body.targetId,
      organizationId: auth.orgId,
      assignedAgentId: actor.agentId,
      status: { in: ["PLANNED", "CONNECTED"] },
    },
    include: {
      customer: { select: { id: true, objectType: true, status: true, deletedAt: true } },
      promotionVersion: {
        include: {
          formula: true,
          approvalPolicy: true,
        },
      },
    },
  })
  if (!target) {
    return NextResponse.json({ error: "Promotion target not found", code: "MTM_PHARMACY_TARGET_NOT_FOUND" }, { status: 404 })
  }
  if (!new Set(["PUBLISHED", "RETIRED"]).has(target.promotionVersion.status)) {
    return NextResponse.json({
      error: "The campaign version no longer accepts new execution drafts",
      code: "MTM_PHARMACY_PROMOTION_NOT_PUBLISHED",
    }, { status: 409 })
  }
  if (target.customer.objectType !== "PHARMACY" || target.customer.status !== "ACTIVE" || target.customer.deletedAt) {
    return NextResponse.json({ error: "Target is not an active pharmacy", code: "MTM_PHARMACY_TARGET_INVALID" }, { status: 409 })
  }
  if (body.unit !== target.unit) {
    return NextResponse.json({ error: "Fact unit differs from the plan", code: "MTM_PHARMACY_UNIT_MISMATCH" }, { status: 409 })
  }
  if (body.visitId) {
    const visit = await prisma.mtmVisit.findFirst({
      where: {
        id: body.visitId,
        organizationId: auth.orgId,
        agentId: actor.agentId,
        customerId: target.customerId,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!visit) {
      return NextResponse.json({ error: "Visit does not match this execution", code: "MTM_PHARMACY_VISIT_MISMATCH" }, { status: 409 })
    }
  }

  if (body.supersedesExecutionId) {
    const predecessor = await prisma.mtmPharmacyPromotionExecution.findFirst({
      where: {
        id: body.supersedesExecutionId,
        organizationId: auth.orgId,
        targetId: target.id,
        agentId: actor.agentId,
        status: { in: ["RETURNED", "REJECTED"] },
        successorExecution: { is: null },
      },
      select: { id: true },
    })
    if (!predecessor) {
      return NextResponse.json({
        error: "A correction must supersede the current returned or rejected execution",
        code: "MTM_PHARMACY_CORRECTION_PREDECESSOR_INVALID",
      }, { status: 409 })
    }
  }

  const receivedAt = new Date()
  const observedAt = clientObservedAt(body.clientOccurredAt, receivedAt)
  if (!observedAt) {
    return NextResponse.json({
      error: "Client observation time is more than five minutes in the future",
      code: "MTM_PHARMACY_SOURCE_TIME_INVALID",
    }, { status: 400 })
  }
  const formula = target.promotionVersion.formula
  const policy = target.promotionVersion.approvalPolicy
  const formulaDefinition = PharmacyPromotionFormulaDefinitionSchema.safeParse(formula.definition)
  const drainsRetiredDefinition = target.promotionVersion.status === "RETIRED"
  const formulaReady = (formula.status === "ACTIVE" || (drainsRetiredDefinition && formula.status === "RETIRED"))
    && Boolean(formula.signedAt && formula.approvalReference)
    && formulaDefinition.success
    && formula.definitionHash === pharmacyPromotionHash(formula.definition)
  let calculation: ReturnType<typeof calculatePharmacyPromotionPoints> | null = null
  if (formulaReady && formulaDefinition.success) {
    try {
      calculation = calculatePharmacyPromotionPoints(formulaDefinition.data, body.factQuantity)
    } catch (error) {
      const code = error instanceof Error ? error.message : "MTM_PHARMACY_CALCULATION_OUT_OF_RANGE"
      if (code === "MTM_PHARMACY_CALCULATION_OUT_OF_RANGE" || code === "MTM_PHARMACY_FACT_QUANTITY_INVALID") {
        return NextResponse.json({
          error: "Promotion calculation is outside the supported DECIMAL(18,4) range",
          code,
        }, { status: 409 })
      }
      return NextResponse.json({
        error: "Promotion calculation could not be validated",
        code: "MTM_PHARMACY_CALCULATION_INVALID",
      }, { status: 409 })
    }
  }
  const calculationInput = {
    targetId: target.id,
    promotionVersionId: target.promotionVersionId,
    planQuantity: target.planQuantity.toString(),
    factQuantity: new Prisma.Decimal(body.factQuantity).toString(),
    unit: body.unit,
    formulaId: formula.id,
    formulaVersion: formula.version,
    formulaHash: formula.definitionHash,
    sourceObservedAt: observedAt.toISOString(),
  }
  const calculationOutput = calculation ?? {
    status: "BLOCKED",
    code: "MTM_PHARMACY_FORMULA_NOT_SIGNED",
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-execution:${auth.orgId}:${actor.agentId}:${body.clientExecutionId}`}, 0))`
      const currentActor = await resolveMtmRouteActor(tx as typeof prisma, {
        organizationId: auth.orgId,
        userId: auth.userId,
        webRole: auth.role,
        agentId: auth.agentId,
      })
      if (
        !currentActor
        || currentActor.role !== "AGENT"
        || !currentActor.agentId
        || currentActor.agentId !== actor.agentId
      ) {
        throw new Error("MTM_PHARMACY_FIELD_EXECUTE_DENIED")
      }
      const concurrent = await tx.mtmPharmacyPromotionExecution.findFirst({
        where: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          clientExecutionId: body.clientExecutionId,
        },
        include: executionInclude,
      })
      if (concurrent) return { execution: concurrent, idempotent: true }
      const canonicalIdCollision = await tx.mtmPharmacyPromotionExecution.findFirst({
        where: {
          id: body.clientExecutionId,
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
        },
        select: { id: true },
      })
      if (canonicalIdCollision) throw new Error("MTM_PHARMACY_EXECUTION_REFERENCE_CONFLICT")

      // Serialize with campaign retirement. Already-planned targets and
      // corrections may drain a RETIRED version, while target planning itself
      // remains PUBLISHED-only.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-version:${auth.orgId}:${target.promotionVersionId}`}, 0))`
      if (body.supersedesExecutionId) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-correction:${auth.orgId}:${body.supersedesExecutionId}`}, 0))`
      }
      const currentVersion = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: {
          id: target.promotionVersionId,
          organizationId: auth.orgId,
          status: { in: ["PUBLISHED", "RETIRED"] },
        },
        select: {
          id: true,
          status: true,
          formula: { select: { status: true } },
          approvalPolicy: { select: { status: true } },
        },
      })
      if (!currentVersion) throw new Error("MTM_PHARMACY_PROMOTION_NOT_PUBLISHED")
      const acceptedDefinitionStatuses = currentVersion.status === "RETIRED"
        ? new Set(["ACTIVE", "RETIRED"])
        : new Set(["ACTIVE"])
      if (
        !acceptedDefinitionStatuses.has(currentVersion.formula.status)
        || !acceptedDefinitionStatuses.has(currentVersion.approvalPolicy.status)
      ) {
        throw new Error("MTM_PHARMACY_CONFIGURATION_NOT_SIGNED")
      }
      const currentTarget = await tx.mtmPharmacyPromotionTarget.findFirst({
        where: {
          id: target.id,
          organizationId: auth.orgId,
          assignedAgentId: currentActor.agentId,
          status: { in: ["PLANNED", "CONNECTED"] },
        },
        select: { id: true },
      })
      if (!currentTarget) throw new Error("MTM_PHARMACY_TARGET_CLOSED")
      if (body.supersedesExecutionId) {
        const predecessor = await tx.mtmPharmacyPromotionExecution.findFirst({
          where: {
            id: body.supersedesExecutionId,
            organizationId: auth.orgId,
            targetId: target.id,
            agentId: currentActor.agentId,
            status: { in: ["RETURNED", "REJECTED"] },
            successorExecution: { is: null },
          },
          select: { id: true },
        })
        if (!predecessor) throw new Error("MTM_PHARMACY_CORRECTION_PREDECESSOR_INVALID")
      }

      const execution = await tx.mtmPharmacyPromotionExecution.create({
        data: {
          organizationId: auth.orgId,
          targetId: target.id,
          visitId: body.visitId ?? null,
          agentId: currentActor.agentId,
          clientExecutionId: body.clientExecutionId,
          requestHash,
          supersedesExecutionId: body.supersedesExecutionId ?? null,
          planQuantitySnapshot: target.planQuantity,
          actualQuantity: new Prisma.Decimal(body.factQuantity),
          unit: body.unit,
          formulaId: formula.id,
          formulaVersion: formula.version,
          formulaHash: formula.definitionHash,
          approvalPolicyId: policy.id,
          approvalPolicyVersion: policy.version,
          approvalPolicyHash: policy.definitionHash,
          calculationInput: calculationInput as Prisma.InputJsonValue,
          calculationOutput: calculationOutput as unknown as Prisma.InputJsonValue,
          factPointsPreview: calculation ? new Prisma.Decimal(calculation.factPoints) : null,
          rewardPointsPreview: calculation ? new Prisma.Decimal(calculation.rewardPoints) : null,
          differencePointsPreview: calculation ? new Prisma.Decimal(calculation.difference) : null,
          sourceSystem: auth.principal === "mobile" ? "FIELD_AGENT_MOBILE" : "FIELD_AGENT_WEB",
          sourceReference: body.operationId,
          sourceObservedAt: observedAt,
          sourceReceivedAt: receivedAt,
          status: "DRAFT",
          l1State: "NOT_READY",
          l2State: "NOT_READY",
        },
        include: executionInclude,
      })
      await tx.mtmPharmacyPromotionTarget.updateMany({
        where: { id: target.id, organizationId: auth.orgId, status: "PLANNED" },
        data: { status: "CONNECTED", connectedAt: receivedAt },
      })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          targetId: target.id,
          executionId: execution.id,
          eventType: "EXECUTION_DRAFT_CREATED",
          toState: "DRAFT",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.principal === "web" ? auth.userId : null,
          sourceKey: `execution:${execution.id}:draft`,
          requestHash,
          payload: {
            clientExecutionId: body.clientExecutionId,
            supersedesExecutionId: body.supersedesExecutionId ?? null,
            operationId: body.operationId,
            sourceObservedAt: observedAt.toISOString(),
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "PHARMACY_PROMOTION_EXECUTION_DRAFT_CREATED",
          entity: "mtm_pharmacy_promotion_execution",
          entityId: execution.id,
          metadataKind: "pharmacy_promotion_execution",
          newData: { targetId: target.id, requestHash },
        },
      })
      return { execution, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (created.idempotent && created.execution.requestHash !== requestHash) {
      return NextResponse.json({
        error: "Client execution ID was already used with different facts",
        code: "MTM_PHARMACY_EXECUTION_IDEMPOTENCY_CONFLICT",
      }, { status: 409 })
    }
    const settings = await getMtmSettings(auth.orgId)
    return NextResponse.json({
      success: true,
      data: rowProjection(created.execution, settings.pharmacyPromotionPostingEnabled, new Date()),
      idempotent: created.idempotent,
    }, { status: created.idempotent ? 200 : 201 })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (new Set([
      "MTM_PHARMACY_FIELD_EXECUTE_DENIED",
      "MTM_PHARMACY_PROMOTION_NOT_PUBLISHED",
      "MTM_PHARMACY_CONFIGURATION_NOT_SIGNED",
      "MTM_PHARMACY_TARGET_CLOSED",
      "MTM_PHARMACY_CORRECTION_PREDECESSOR_INVALID",
      "MTM_PHARMACY_EXECUTION_REFERENCE_CONFLICT",
    ]).has(code)) {
      return NextResponse.json({ error: "Promotion execution cannot be created", code }, {
        status: code === "MTM_PHARMACY_FIELD_EXECUTE_DENIED" ? 403 : 409,
      })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.mtmPharmacyPromotionExecution.findFirst({
        where: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          clientExecutionId: body.clientExecutionId,
        },
        include: executionInclude,
      })
      if (concurrent?.requestHash === requestHash) {
        const settings = await getMtmSettings(auth.orgId)
        return NextResponse.json({
          success: true,
          data: rowProjection(concurrent, settings.pharmacyPromotionPostingEnabled, new Date()),
          idempotent: true,
        })
      }
      if (body.supersedesExecutionId) {
        return NextResponse.json({
          error: "A correction already exists for this execution",
          code: "MTM_PHARMACY_CORRECTION_ALREADY_EXISTS",
        }, { status: 409 })
      }
      return NextResponse.json({
        error: "Client execution ID was already used with different facts",
        code: "MTM_PHARMACY_EXECUTION_IDEMPOTENCY_CONFLICT",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({
        error: "Promotion execution changed concurrently; retry with the same client identity",
        code: "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion-executions POST]", error)
    return NextResponse.json({ error: "Failed to save promotion execution", code: "MTM_PHARMACY_EXECUTION_FAILED" }, { status: 500 })
  }
})
