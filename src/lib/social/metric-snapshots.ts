import { prisma } from "@/lib/prisma"
import { canonicalProviderUrl, type ProviderMetricRecord } from "@/lib/social/provider-capability-contract"

type MetricCount = bigint | number | string | null | undefined

export interface SocialMetricSnapshotInput {
  organizationId: string
  mentionId?: string | null
  providerRunId?: string | null
  platform: string
  externalId: string
  parentUrl: string
  observedAt: Date | string
  views?: MetricCount
  likes?: MetricCount
  comments?: MetricCount
  shares?: MetricCount
  reactions?: MetricCount
  providerKey: string
  adapterKey: string
  providerItemId: string
  schemaVersion: string
}

export interface ProviderMetricSnapshotContext {
  organizationId: string
  mentionId?: string | null
  providerRunId?: string | null
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function observedDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error("observedAt must be a valid date")
  return date
}

function canonicalHttpUrl(value: string): string {
  const normalized = canonicalProviderUrl(required(value, "parentUrl"))
  const url = new URL(normalized)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("parentUrl must use http or https")
  }
  return normalized
}

function count(value: MetricCount, field: string): bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === "bigint") {
    if (value < BigInt(0)) throw new Error(`${field} must be a non-negative integer`)
    return value
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`)
    return BigInt(value)
  }
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) throw new Error(`${field} must be a non-negative integer`)
  return BigInt(normalized)
}

export function normalizeSocialMetricSnapshot(input: SocialMetricSnapshotInput) {
  const metrics = {
    views: count(input.views, "views"),
    likes: count(input.likes, "likes"),
    comments: count(input.comments, "comments"),
    shares: count(input.shares, "shares"),
    reactions: count(input.reactions, "reactions"),
  }
  if (Object.values(metrics).every(value => value === null)) {
    throw new Error("at least one metric is required")
  }
  return {
    organizationId: required(input.organizationId, "organizationId"),
    mentionId: input.mentionId?.trim() || null,
    providerRunId: input.providerRunId?.trim() || null,
    platform: required(input.platform, "platform").toLowerCase(),
    externalId: required(input.externalId, "externalId"),
    parentUrl: canonicalHttpUrl(input.parentUrl),
    observedAt: observedDate(input.observedAt),
    ...metrics,
    providerKey: required(input.providerKey, "providerKey"),
    adapterKey: required(input.adapterKey, "adapterKey"),
    providerItemId: required(input.providerItemId, "providerItemId"),
    schemaVersion: required(input.schemaVersion, "schemaVersion"),
  }
}

export async function recordSocialMetricSnapshot(input: SocialMetricSnapshotInput) {
  const snapshot = normalizeSocialMetricSnapshot(input)
  return prisma.socialMetricSnapshot.upsert({
    where: {
      organizationId_platform_externalId_providerKey_adapterKey_observedAt: {
        organizationId: snapshot.organizationId,
        platform: snapshot.platform,
        externalId: snapshot.externalId,
        providerKey: snapshot.providerKey,
        adapterKey: snapshot.adapterKey,
        observedAt: snapshot.observedAt,
      },
    },
    // A repeated delivery of the same provider observation is idempotent.
    // Never rewrite historical values with a later retry payload.
    update: {},
    create: snapshot,
  })
}

export async function recordProviderMetricSnapshot(
  context: ProviderMetricSnapshotContext,
  metric: ProviderMetricRecord,
) {
  if (metric.observedAt !== metric.provenance.observedAt) {
    throw new Error("metric and provenance observedAt must match")
  }
  return recordSocialMetricSnapshot({
    ...context,
    platform: metric.platform,
    externalId: metric.externalId,
    parentUrl: metric.parentUrl,
    observedAt: metric.observedAt,
    views: metric.views,
    likes: metric.likes,
    comments: metric.comments,
    shares: metric.shares,
    reactions: metric.reactions,
    providerKey: metric.provenance.providerKey,
    adapterKey: metric.provenance.adapterKey,
    providerItemId: metric.provenance.providerItemId,
    schemaVersion: metric.provenance.schemaVersion,
  })
}

export async function listSocialMetricHistory(input: {
  organizationId: string
  platform: string
  externalId: string
  limit?: number
}) {
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)))
  return prisma.socialMetricSnapshot.findMany({
    where: {
      organizationId: required(input.organizationId, "organizationId"),
      platform: required(input.platform, "platform").toLowerCase(),
      externalId: required(input.externalId, "externalId"),
    },
    orderBy: { observedAt: "desc" },
    take: limit,
  })
}
