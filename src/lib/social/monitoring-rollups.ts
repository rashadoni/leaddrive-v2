import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

type SurfaceRow = { surface: string; platform: string; count: bigint | number }
type ProviderCostRow = {
  providerKey: string
  phase: string
  runCount: bigint | number
  receivedCount: bigint | number
  acceptedCount: bigint | number
  reviewCount: bigint | number
  rejectedCount: bigint | number
  chargeUsd: string | number | null
}
type CoverageRow = {
  platform: string
  capability: string
  acquisitionMode: string
  adapterKey: string
  status: string
  routeCount: bigint | number
}
type UsageRow = {
  day: string
  unit: SocialBillableUnit
  dimension: string
  quantity: string | number | bigint
  actualCostUsd: string | number | null
  reservedExposureUsd: string | number | null
}

export const SOCIAL_BILLABLE_UNITS = [
  "ACTIVE_SUBJECT",
  "ACTIVE_SOURCE",
  "ACCEPTED_MENTION",
  "PROVIDER_RUN",
  "PROVIDER_ITEM",
  "OCR_FRAME",
  "ASR_MINUTE",
  "AI_CALL",
] as const

export type SocialBillableUnit = (typeof SOCIAL_BILLABLE_UNITS)[number]

export type SocialUsageLedgerEntry = {
  day: string
  unit: SocialBillableUnit
  dimension: string
  quantity: number
  actualCostUsd: number
  reservedExposureUsd: number
}

export type SocialCommercialRateCard = {
  currency: "USD"
  monthlyBaseRevenueUsd: number
  unitRevenueUsd: Partial<Record<SocialBillableUnit, number>>
  scenarioMultipliers: { low: number; base: number; high: number }
}

function integer(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

function decimal(value: string | number | null): number {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rounded(value: number): number {
  return Number(value.toFixed(6))
}

function aggregateUsage(entries: SocialUsageLedgerEntry[], bucket: "day" | "month") {
  const buckets = new Map<string, {
    period: string
    quantities: Partial<Record<SocialBillableUnit, number>>
    actualCostUsd: number
    reservedExposureUsd: number
  }>()
  for (const entry of entries) {
    const period = bucket === "day" ? entry.day : entry.day.slice(0, 7)
    const current = buckets.get(period) ?? { period, quantities: {}, actualCostUsd: 0, reservedExposureUsd: 0 }
    current.quantities[entry.unit] = (current.quantities[entry.unit] ?? 0) + entry.quantity
    current.actualCostUsd += entry.actualCostUsd
    current.reservedExposureUsd += entry.reservedExposureUsd
    buckets.set(period, current)
  }
  return Array.from(buckets.values())
    .map(item => ({
      ...item,
      actualCostUsd: rounded(item.actualCostUsd),
      reservedExposureUsd: rounded(item.reservedExposureUsd),
    }))
    .sort((a, b) => a.period.localeCompare(b.period))
}

export function calculateSocialMonitoringMargin(
  quantities: Partial<Record<SocialBillableUnit, number>>,
  actualCostUsd: number,
  reservedExposureUsd: number,
  rateCard?: SocialCommercialRateCard,
) {
  if (!rateCard) {
    return {
      status: "UNCONFIGURED" as const,
      reason: "owner_rate_card_required",
      currency: "USD" as const,
      scenarios: [],
    }
  }
  const values = [
    rateCard.monthlyBaseRevenueUsd,
    rateCard.scenarioMultipliers.low,
    rateCard.scenarioMultipliers.base,
    rateCard.scenarioMultipliers.high,
    ...Object.values(rateCard.unitRevenueUsd),
  ]
  if (rateCard.currency !== "USD" || values.some(value => value === undefined || !Number.isFinite(value) || value < 0)) {
    return {
      status: "INVALID_CONFIGURATION" as const,
      reason: "rate_card_values_must_be_non_negative_usd",
      currency: "USD" as const,
      scenarios: [],
    }
  }

  const scenarios = (Object.entries(rateCard.scenarioMultipliers) as Array<["low" | "base" | "high", number]>).map(([name, multiplier]) => {
    const usageRevenue = SOCIAL_BILLABLE_UNITS.reduce((sum, unit) => (
      sum + (quantities[unit] ?? 0) * multiplier * (rateCard.unitRevenueUsd[unit] ?? 0)
    ), 0)
    const revenueUsd = rateCard.monthlyBaseRevenueUsd + usageRevenue
    const scenarioActualCostUsd = actualCostUsd * multiplier
    const maximumCostExposureUsd = (actualCostUsd + reservedExposureUsd) * multiplier
    const grossMarginUsd = revenueUsd - scenarioActualCostUsd
    const conservativeGrossMarginUsd = revenueUsd - maximumCostExposureUsd
    return {
      name,
      usageMultiplier: multiplier,
      revenueUsd: rounded(revenueUsd),
      actualCostUsd: rounded(scenarioActualCostUsd),
      maximumCostExposureUsd: rounded(maximumCostExposureUsd),
      grossMarginUsd: rounded(grossMarginUsd),
      conservativeGrossMarginUsd: rounded(conservativeGrossMarginUsd),
      grossMarginPct: revenueUsd > 0 ? rounded((grossMarginUsd / revenueUsd) * 100) : null,
      conservativeGrossMarginPct: revenueUsd > 0 ? rounded((conservativeGrossMarginUsd / revenueUsd) * 100) : null,
    }
  })
  return { status: "CONFIGURED" as const, currency: "USD" as const, scenarios }
}

export async function getSocialMonitoringRollups(
  organizationId: string,
  since: Date,
  rateCard?: SocialCommercialRateCard,
) {
  const queryRaw = prisma.$queryRaw.bind(prisma) as <T>(query: Prisma.Sql) => Promise<T>
  // The reset boundary describes the generation in which a row was imported;
  // it is independent from the item's publication date. Keeping those two
  // predicates separate means a fresh archive/global-search import can report
  // an older post that still falls inside the caller's requested time window.
  const resetBoundary = Prisma.sql`
    COALESCE((
      SELECT MAX(boundary."createdAt")
      FROM "audit_logs" AS boundary
      WHERE boundary."organizationId" = ${organizationId}
        AND boundary."entityType" = 'social_paid_run_authorization'
        AND boundary.action = 'reset_boundary'
        AND boundary."userId" IS NULL
        AND boundary."entityName" = 'Social Monitoring clean slate'
        AND boundary."entityId" LIKE 'clean-slate:%'
    ), '-infinity'::timestamptz)
  `
  const [surfaceRows, providerRows, coverageRows, usageRows] = await Promise.all([
    queryRaw<SurfaceRow[]>(Prisma.sql`
      SELECT
        CASE
          WHEN UPPER("contentKind"::text) = 'REPLY' OR LOWER(BTRIM(COALESCE("sourceType", ''))) = 'reply' THEN 'replies'
          WHEN UPPER("contentKind"::text) = 'COMMENT' OR LOWER(BTRIM(COALESCE("sourceType", ''))) = 'comment' THEN 'comments'
          WHEN UPPER("contentKind"::text) IN ('POST', 'MENTION') OR LOWER(BTRIM(COALESCE("sourceType", ''))) IN ('post', 'mention') THEN 'posts'
          ELSE 'other'
        END AS surface,
        platform,
        COUNT(*)::BIGINT AS count
      FROM "social_mentions"
      WHERE "organizationId" = ${organizationId}
        AND COALESCE("publishedAt", "createdAt") >= ${since}
        AND "createdAt" >= ${resetBoundary}
        AND "externalId" <> '__tg_offset__'
        AND "purgedAt" IS NULL
        AND "deletedAtSource" IS NULL
        AND (
          NOT (
            UPPER("contentKind"::text) IN ('COMMENT', 'REPLY')
            OR LOWER(BTRIM(COALESCE("sourceType", ''))) IN ('comment', 'reply')
          )
          OR LOWER(BTRIM(COALESCE(sentiment, ''))) IN ('negative', 'neutral')
        )
      GROUP BY 1, platform
      ORDER BY 1, platform
    `),
    queryRaw<ProviderCostRow[]>(Prisma.sql`
      SELECT
        "providerKey",
        phase,
        COUNT(*)::BIGINT AS "runCount",
        COALESCE(SUM("receivedCount"), 0)::BIGINT AS "receivedCount",
        COALESCE(SUM("acceptedCount"), 0)::BIGINT AS "acceptedCount",
        COALESCE(SUM("reviewCount"), 0)::BIGINT AS "reviewCount",
        COALESCE(SUM("rejectedCount"), 0)::BIGINT AS "rejectedCount",
        COALESCE(SUM(COALESCE("actualChargeUsd", "reservedChargeUsd")), 0)::TEXT AS "chargeUsd"
      FROM "social_provider_runs"
      WHERE "organizationId" = ${organizationId}
        AND "createdAt" >= ${since}
        AND "createdAt" >= ${resetBoundary}
        AND "purgedAt" IS NULL
      GROUP BY "providerKey", phase
      ORDER BY "providerKey", phase
    `),
    queryRaw<CoverageRow[]>(Prisma.sql`
      SELECT
        platform,
        capability,
        "acquisitionMode",
        "primaryAdapter" AS "adapterKey",
        status,
        COUNT(*)::BIGINT AS "routeCount"
      FROM "source_route_plans"
      WHERE "organizationId" = ${organizationId}
      GROUP BY platform, capability, "acquisitionMode", "primaryAdapter", status
      ORDER BY platform, capability, "primaryAdapter"
    `),
    queryRaw<UsageRow[]>(Prisma.sql`
      WITH usage AS (
        SELECT
          DATE_TRUNC('day', COALESCE("publishedAt", "createdAt")) AS day,
          'ACCEPTED_MENTION'::TEXT AS unit,
          platform::TEXT AS dimension,
          COUNT(*)::NUMERIC AS quantity,
          0::NUMERIC AS "actualCostUsd",
          0::NUMERIC AS "reservedExposureUsd"
        FROM "social_mentions"
        WHERE "organizationId" = ${organizationId}
          AND COALESCE("publishedAt", "createdAt") >= ${since}
          AND "createdAt" >= ${resetBoundary}
          AND "externalId" <> '__tg_offset__'
          AND "purgedAt" IS NULL
          AND "deletedAtSource" IS NULL
        GROUP BY 1, platform

        UNION ALL

        SELECT
          DATE_TRUNC('day', "createdAt") AS day,
          'PROVIDER_RUN'::TEXT AS unit,
          "providerKey"::TEXT AS dimension,
          COUNT(*)::NUMERIC AS quantity,
          COALESCE(SUM("actualChargeUsd"), 0)::NUMERIC AS "actualCostUsd",
          COALESCE(SUM(CASE WHEN "actualChargeUsd" IS NULL THEN "reservedChargeUsd" ELSE 0 END), 0)::NUMERIC AS "reservedExposureUsd"
        FROM "social_provider_runs"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${since}
          AND "createdAt" >= ${resetBoundary}
          AND "purgedAt" IS NULL
        GROUP BY 1, "providerKey"

        UNION ALL

        SELECT
          DATE_TRUNC('day', "createdAt") AS day,
          'PROVIDER_ITEM'::TEXT AS unit,
          "providerKey"::TEXT AS dimension,
          COALESCE(SUM("receivedCount"), 0)::NUMERIC AS quantity,
          0::NUMERIC AS "actualCostUsd",
          0::NUMERIC AS "reservedExposureUsd"
        FROM "social_provider_runs"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${since}
          AND "createdAt" >= ${resetBoundary}
          AND "purgedAt" IS NULL
        GROUP BY 1, "providerKey"

        UNION ALL

        SELECT
          DATE_TRUNC('day', "createdAt") AS day,
          'OCR_FRAME'::TEXT AS unit,
          provider::TEXT AS dimension,
          COALESCE(SUM(GREATEST("frameCount", 1)), 0)::NUMERIC AS quantity,
          COALESCE(SUM("actualCostUsd"), 0)::NUMERIC AS "actualCostUsd",
          COALESCE(SUM(CASE WHEN "actualCostUsd" IS NULL THEN "reservedCostUsd" ELSE 0 END), 0)::NUMERIC AS "reservedExposureUsd"
        FROM "media_processing_runs"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${since}
          AND "createdAt" >= ${resetBoundary}
          AND stage IN ('COVER_OCR', 'FRAME_OCR')
          AND status IN ('SUCCEEDED', 'PARTIAL')
        GROUP BY 1, provider

        UNION ALL

        SELECT
          DATE_TRUNC('day', run."createdAt") AS day,
          'ASR_MINUTE'::TEXT AS unit,
          run.provider::TEXT AS dimension,
          COALESCE(SUM(CEIL(COALESCE(observation."durationMs", 0)::NUMERIC / 60000)), 0)::NUMERIC AS quantity,
          COALESCE(SUM(run."actualCostUsd"), 0)::NUMERIC AS "actualCostUsd",
          COALESCE(SUM(CASE WHEN run."actualCostUsd" IS NULL THEN run."reservedCostUsd" ELSE 0 END), 0)::NUMERIC AS "reservedExposureUsd"
        FROM "media_processing_runs" run
        JOIN "media_observations" observation
          ON observation."organizationId" = run."organizationId" AND observation.id = run."observationId"
        WHERE run."organizationId" = ${organizationId}
          AND run."createdAt" >= ${since}
          AND run."createdAt" >= ${resetBoundary}
          AND run.stage = 'ASR'
          AND run.status IN ('SUCCEEDED', 'PARTIAL')
        GROUP BY 1, run.provider

        UNION ALL

        SELECT
          DATE_TRUNC('day', "createdAt") AS day,
          'AI_CALL'::TEXT AS unit,
          COALESCE(model, 'unknown')::TEXT AS dimension,
          COUNT(*)::NUMERIC AS quantity,
          COALESCE(SUM("costUsd"), 0)::NUMERIC AS "actualCostUsd",
          0::NUMERIC AS "reservedExposureUsd"
        FROM "ai_interaction_logs"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${since}
          AND "createdAt" >= ${resetBoundary}
          AND ("agentType" = 'social_monitoring' OR LEFT("userMessage", 7) = 'social_')
        GROUP BY 1, model

        UNION ALL

        SELECT
          DATE_TRUNC('day', CURRENT_TIMESTAMP) AS day,
          'ACTIVE_SUBJECT'::TEXT AS unit,
          type::TEXT AS dimension,
          COUNT(*)::NUMERIC AS quantity,
          0::NUMERIC AS "actualCostUsd",
          0::NUMERIC AS "reservedExposureUsd"
        FROM "monitoring_subjects"
        WHERE "organizationId" = ${organizationId} AND status = 'active'
        GROUP BY type

        UNION ALL

        SELECT
          DATE_TRUNC('day', CURRENT_TIMESTAMP) AS day,
          'ACTIVE_SOURCE'::TEXT AS unit,
          platform::TEXT AS dimension,
          COUNT(*)::NUMERIC AS quantity,
          0::NUMERIC AS "actualCostUsd",
          0::NUMERIC AS "reservedExposureUsd"
        FROM "monitoring_sources"
        WHERE "organizationId" = ${organizationId} AND status IN ('active', 'limited', 'needs_setup')
        GROUP BY platform
      )
      SELECT
        TO_CHAR(day, 'YYYY-MM-DD') AS day,
        unit,
        dimension,
        quantity::TEXT AS quantity,
        "actualCostUsd"::TEXT AS "actualCostUsd",
        "reservedExposureUsd"::TEXT AS "reservedExposureUsd"
      FROM usage
      WHERE quantity > 0 OR "actualCostUsd" > 0 OR "reservedExposureUsd" > 0
      ORDER BY day, unit, dimension
    `),
  ])

  const surfaces = { posts: 0, comments: 0, replies: 0, other: 0 }
  const surfaceByPlatform = new Map<string, { posts: number; comments: number; replies: number; other: number }>()
  for (const row of surfaceRows) {
    const surface = row.surface as keyof typeof surfaces
    if (!(surface in surfaces)) continue
    const count = integer(row.count)
    surfaces[surface] += count
    const platform = surfaceByPlatform.get(row.platform) ?? { posts: 0, comments: 0, replies: 0, other: 0 }
    platform[surface] += count
    surfaceByPlatform.set(row.platform, platform)
  }

  const providerCosts = providerRows.map((row: ProviderCostRow) => {
    const chargeUsd = decimal(row.chargeUsd)
    const acceptedCount = integer(row.acceptedCount)
    return {
      providerKey: row.providerKey,
      phase: row.phase,
      runCount: integer(row.runCount),
      receivedCount: integer(row.receivedCount),
      acceptedCount,
      reviewCount: integer(row.reviewCount),
      rejectedCount: integer(row.rejectedCount),
      chargeUsd,
      costPerAcceptedUsd: acceptedCount > 0 ? Number((chargeUsd / acceptedCount).toFixed(6)) : null,
    }
  })

  const usageLedger: SocialUsageLedgerEntry[] = usageRows.map(row => ({
    day: row.day,
    unit: row.unit,
    dimension: row.dimension,
    quantity: decimal(typeof row.quantity === "bigint" ? Number(row.quantity) : row.quantity),
    actualCostUsd: decimal(row.actualCostUsd),
    reservedExposureUsd: decimal(row.reservedExposureUsd),
  }))
  const usageQuantities = usageLedger.reduce<Partial<Record<SocialBillableUnit, number>>>((totals, entry) => {
    totals[entry.unit] = (totals[entry.unit] ?? 0) + entry.quantity
    return totals
  }, {})
  const usageActualCostUsd = rounded(usageLedger.reduce((sum, entry) => sum + entry.actualCostUsd, 0))
  const usageReservedExposureUsd = rounded(usageLedger.reduce((sum, entry) => sum + entry.reservedExposureUsd, 0))

  return {
    surfaces,
    surfaceByPlatform: Array.from(surfaceByPlatform.entries()).map(([platform, counts]) => ({ platform, ...counts })),
    providerCosts,
    providerTotals: {
      chargeUsd: Number(providerCosts.reduce((sum: number, row) => sum + row.chargeUsd, 0).toFixed(6)),
      acceptedCount: providerCosts.reduce((sum: number, row) => sum + row.acceptedCount, 0),
      receivedCount: providerCosts.reduce((sum: number, row) => sum + row.receivedCount, 0),
    },
    coverage: coverageRows.map((row: CoverageRow) => ({
      platform: row.platform,
      capability: row.capability,
      acquisitionMode: row.acquisitionMode,
      adapterKey: row.adapterKey,
      status: row.status,
      routeCount: integer(row.routeCount),
    })),
    usage: {
      ledger: usageLedger,
      daily: aggregateUsage(usageLedger, "day"),
      monthly: aggregateUsage(usageLedger, "month"),
      totals: {
        quantities: usageQuantities,
        actualCostUsd: usageActualCostUsd,
        reservedExposureUsd: usageReservedExposureUsd,
        maximumCostExposureUsd: rounded(usageActualCostUsd + usageReservedExposureUsd),
      },
      measurementGaps: [
        {
          unit: "STORAGE_GB_DAY",
          status: "UNAVAILABLE",
          reason: "durable_object_byte_counters_not_implemented",
        },
        {
          unit: "RETENTION_GB_DAY",
          status: "UNAVAILABLE",
          reason: "retained_byte_day_counters_not_implemented",
        },
      ],
      margin: calculateSocialMonitoringMargin(
        usageQuantities,
        usageActualCostUsd,
        usageReservedExposureUsd,
        rateCard,
      ),
    },
  }
}
