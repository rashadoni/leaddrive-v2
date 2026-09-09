import {
  MtmPharmacyExecutionStatus,
  MtmPharmacyReviewState,
  MtmVisitStatus,
  Prisma,
} from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { pharmacyPromotionHash, type PharmacyPromotionFilters } from "@/lib/mtm/pharmacy-promotion"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { localDateTimeToUtc } from "@/lib/timezone"

function scopedAgentIds(actor: MtmRouteActor): string[] | null {
  if (actor.scopedAgentIds === null) return null
  return [...actor.scopedAgentIds]
}

export const PHARMACY_PROMOTION_SNAPSHOT_ROW_MAX = 20_001

export const pharmacyPromotionSnapshotSelect = {
  id: true,
  updatedAt: true,
  target: {
    select: {
      id: true,
      updatedAt: true,
      customer: { select: { id: true, updatedAt: true } },
      assignedTeam: {
        select: {
          id: true,
          updatedAt: true,
          region: { select: { id: true, updatedAt: true } },
        },
      },
      promotionVersion: {
        select: {
          id: true,
          updatedAt: true,
          promotion: { select: { id: true, updatedAt: true } },
          type: { select: { id: true, updatedAt: true } },
        },
      },
    },
  },
  // Visit state is rendered and exported independently of the execution row.
  // Hash the values themselves as well as updatedAt so even a raw/imported
  // correction that preserves timestamps invalidates the registry snapshot.
  visit: {
    select: {
      id: true,
      status: true,
      checkInAt: true,
      checkOutAt: true,
      updatedAt: true,
    },
  },
  ledgerEntries: {
    orderBy: { id: "asc" },
    select: { id: true, bucket: true, delta: true, occurredAt: true },
  },
} satisfies Prisma.MtmPharmacyPromotionExecutionSelect

export function pharmacyPromotionSelectionHash(rows: readonly unknown[]): string {
  return pharmacyPromotionHash(rows)
}

export function pharmacyPromotionExecutionScopeWhere(
  actor: MtmRouteActor,
  requestedEmployeeId = "",
): Prisma.MtmPharmacyPromotionExecutionWhereInput {
  const ids = scopedAgentIds(actor)
  return {
    ...(ids === null ? {} : { agentId: { in: ids } }),
    ...(requestedEmployeeId ? { AND: [{ agentId: requestedEmployeeId }] } : {}),
  }
}

function dateRange(
  filters: PharmacyPromotionFilters,
  timezone: string,
): Prisma.DateTimeFilter | undefined {
  if (filters.dateMode === "NONE" || (!filters.dateFrom && !filters.dateTo)) return undefined
  return {
    ...(filters.dateFrom ? { gte: localDateTimeToUtc(`${filters.dateFrom}T00:00`, timezone) } : {}),
    ...(filters.dateTo
      ? { lt: localDateTimeToUtc(`${addDateKeyDays(filters.dateTo, 1)}T00:00`, timezone) }
      : {}),
  }
}

function amountRange(
  filters: PharmacyPromotionFilters,
): Prisma.DecimalNullableFilter | undefined {
  if (filters.amountMode === "NONE" || (!filters.amountMin && !filters.amountMax)) return undefined
  return {
    ...(filters.amountMin ? { gte: new Prisma.Decimal(filters.amountMin) } : {}),
    ...(filters.amountMax ? { lte: new Prisma.Decimal(filters.amountMax) } : {}),
  }
}

export function pharmacyPromotionExecutionWhere(input: {
  organizationId: string
  actor: MtmRouteActor
  filters: PharmacyPromotionFilters
  timezone: string
}): Prisma.MtmPharmacyPromotionExecutionWhereInput {
  const { organizationId, actor, filters, timezone } = input
  const and: Prisma.MtmPharmacyPromotionExecutionWhereInput[] = [
    pharmacyPromotionExecutionScopeWhere(actor, filters.employeeId),
  ]

  if (filters.q) {
    and.push({
      OR: [
        { target: { customerNameSnapshot: { contains: filters.q, mode: "insensitive" } } },
        { target: { customerAddressSnapshot: { contains: filters.q, mode: "insensitive" } } },
        { target: { customerRegistrationSnapshot: { contains: filters.q, mode: "insensitive" } } },
        { target: { agentNameSnapshot: { contains: filters.q, mode: "insensitive" } } },
        { target: { promotionVersion: { nameRu: { contains: filters.q, mode: "insensitive" } } } },
        { target: { promotionVersion: { nameAz: { contains: filters.q, mode: "insensitive" } } } },
        { target: { promotionVersion: { nameEn: { contains: filters.q, mode: "insensitive" } } } },
        { target: { promotionVersion: { promotion: { code: { contains: filters.q, mode: "insensitive" } } } } },
      ],
    })
  }
  if (filters.departmentId) and.push({ target: { assignedTeamId: filters.departmentId } })
  if (filters.promotionId) and.push({ target: { promotionVersion: { promotionId: filters.promotionId } } })
  if (filters.promotionType) {
    and.push({
      target: {
        promotionVersion: {
          OR: [
            { typeId: filters.promotionType },
            { type: { code: filters.promotionType } },
          ],
        },
      },
    })
  }
  if (filters.code) {
    and.push({ target: { promotionVersion: { promotion: { code: filters.code } } } })
  }
  if (filters.executionStatus) {
    and.push({ status: filters.executionStatus as MtmPharmacyExecutionStatus })
  }
  if (filters.controlledVisitStatus) {
    and.push({ visit: { status: filters.controlledVisitStatus as MtmVisitStatus } })
  }
  if (filters.l1Status) {
    and.push({ l1State: filters.l1Status as MtmPharmacyReviewState })
  }
  if (filters.l2Status) {
    and.push({ l2State: filters.l2Status as MtmPharmacyReviewState })
  }
  if (filters.ready === "L1") and.push({ l1State: "READY" })
  if (filters.ready === "L2") and.push({ l2State: "READY" })
  if (filters.ready === "BLOCKED") {
    and.push({ OR: [{ l1State: "NOT_READY" }, { l2State: "NOT_READY" }] })
  }
  if (filters.view === "review" && !filters.ready) {
    and.push({ OR: [{ l1State: "READY" }, { l2State: "READY" }] })
  }
  if (filters.regionId) and.push({ target: { assignedTeam: { regionId: filters.regionId } } })
  if (filters.localityId) and.push({ target: { customer: { locality: filters.localityId } } })
  if (filters.territoryId) and.push({ target: { customer: { territoryCode: filters.territoryId } } })
  if (filters.contactId) and.push({ target: { contactId: filters.contactId } })
  if (filters.managerId) and.push({ target: { managingManagerId: filters.managerId } })
  if (filters.userGroupId) and.push({ target: { assignedTeamId: filters.userGroupId } })

  const range = dateRange(filters, timezone)
  if (range) {
    if (filters.dateMode === "CREATED_AT") and.push({ createdAt: range })
    if (filters.dateMode === "CONNECTED_AT") and.push({ target: { connectedAt: range } })
    if (filters.dateMode === "CLOSED_AT") and.push({ closedAt: range })
  }
  const points = amountRange(filters)
  if (points) {
    if (filters.amountMode === "FACT_POINTS") and.push({ factPointsPreview: points })
    if (filters.amountMode === "REWARD_POINTS") and.push({ rewardPointsPreview: points })
    if (filters.amountMode === "DIFFERENCE") and.push({ differencePointsPreview: points })
  }

  return { organizationId, AND: and }
}

export function pharmacyPromotionExecutionOrderBy(
  filters: PharmacyPromotionFilters,
): Prisma.MtmPharmacyPromotionExecutionOrderByWithRelationInput[] {
  const direction = filters.direction
  const tieBreakers: Prisma.MtmPharmacyPromotionExecutionOrderByWithRelationInput[] = [
    { createdAt: "desc" },
    { id: "asc" },
  ]
  if (filters.sort === "connectedAt") return [{ target: { connectedAt: { sort: direction, nulls: "last" } } }, ...tieBreakers]
  if (filters.sort === "closedAt") return [{ closedAt: { sort: direction, nulls: "last" } }, ...tieBreakers]
  if (filters.sort === "pharmacy") return [{ target: { customerNameSnapshot: direction } }, ...tieBreakers]
  if (filters.sort === "employee") return [{ target: { agentNameSnapshot: direction } }, ...tieBreakers]
  if (filters.sort === "factPoints") return [{ factPointsPreview: { sort: direction, nulls: "last" } }, ...tieBreakers]
  if (filters.sort === "rewardPoints") return [{ rewardPointsPreview: { sort: direction, nulls: "last" } }, ...tieBreakers]
  if (filters.sort === "difference") return [{ differencePointsPreview: { sort: direction, nulls: "last" } }, ...tieBreakers]
  return [{ createdAt: direction }, { id: "asc" }]
}

export function pharmacyPromotionCapabilities(actor: MtmRouteActor, postingEnabled: boolean) {
  const reviewer = actor.role === "ADMIN" || actor.role === "MANAGER" || actor.role === "SUPERVISOR"
  return {
    canCreateExecution: actor.agentId !== null && actor.role === "AGENT",
    canReview: reviewer,
    canBulkReview: reviewer,
    canExport: reviewer,
    canConfigure: actor.role === "ADMIN",
    canManageTargets: actor.role === "ADMIN" || actor.role === "MANAGER",
    postingEnabled,
  }
}
