import { prisma } from "@/lib/prisma"
import { planSocialCommentCheckpoint } from "@/lib/social/comment-checkpoint"
import { canonicalProviderUrl } from "@/lib/social/provider-capability-contract"

const DISPATCH_LEASE_MS = 6 * 3_600_000
const FAILURE_BACKOFF_MS = 24 * 3_600_000

export type SocialCommentCheckpointRow = {
  id: string
  canonicalParentUrl: string
  parentExternalId: string | null
  discoveredAt: Date
  lastActivityAt: Date
  lastAttemptAt: Date | null
  lastSuccessfulAt: Date | null
  status: string
  consecutiveNoChange: number
  lastSeenCommentCount: number
  lastSeenCommentExternalId: string | null
}

export interface SocialCommentCheckpointStore {
  upsert(input: Record<string, unknown>): Promise<unknown>
  findDue(input: { organizationId: string; sourceId: string; platform: string; now: Date; limit: number; includeInactive?: boolean }): Promise<Array<{ id: string; canonicalParentUrl: string; parentExternalId: string | null }>>
  findByUrls(input: { organizationId: string; sourceId: string; urls: string[] }): Promise<SocialCommentCheckpointRow[]>
  updateMany(input: Record<string, unknown>): Promise<unknown>
  update(input: Record<string, unknown>): Promise<unknown>
}

const defaultStore: SocialCommentCheckpointStore = {
  upsert: input => prisma.socialCommentCheckpoint.upsert(input as never),
  findDue: input => prisma.socialCommentCheckpoint.findMany({
    where: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      platform: input.platform,
      status: input.includeInactive ? { in: ["ACTIVE", "INACTIVE"] } : "ACTIVE",
      ...(input.includeInactive ? {} : { nextDueAt: { lte: input.now } }),
    },
    orderBy: [{ nextDueAt: "asc" }, { discoveredAt: "desc" }, { id: "asc" }],
    take: Math.min(Math.max(input.limit, 1), 50),
    select: { id: true, canonicalParentUrl: true, parentExternalId: true },
  }),
  findByUrls: input => prisma.socialCommentCheckpoint.findMany({
    where: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      canonicalParentUrl: { in: input.urls },
    },
    select: {
      id: true,
      canonicalParentUrl: true,
      parentExternalId: true,
      discoveredAt: true,
      lastActivityAt: true,
      lastAttemptAt: true,
      lastSuccessfulAt: true,
      status: true,
      consecutiveNoChange: true,
      lastSeenCommentCount: true,
      lastSeenCommentExternalId: true,
    },
  }),
  updateMany: input => prisma.socialCommentCheckpoint.updateMany(input as never),
  update: input => prisma.socialCommentCheckpoint.update(input as never),
}

function canonicalUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map(url => canonicalProviderUrl(url)).filter(Boolean)))
}

export async function registerAndSelectDueCommentCheckpoints(input: {
  organizationId: string
  sourceId: string
  platform: string
  candidateUrls: string[]
  now: Date
  limit: number
  includeInactive?: boolean
}, store: SocialCommentCheckpointStore = defaultStore): Promise<Array<{ canonicalUrl: string; parentExternalId: string | null }>> {
  // Register a bounded surplus before selecting the 50 due parents. Paired
  // Instagram discovery can contribute up to one full posts half and one full
  // reels half; registering only the first due-run limit would permanently
  // hide the second member on later retries.
  const registrationLimit = Math.min(
    100,
    Math.max(50, Math.max(1, Math.trunc(input.limit)) * 2),
  )
  const urls = canonicalUrls(input.candidateUrls).slice(0, registrationLimit)
  await Promise.all(urls.map(canonicalParentUrl => store.upsert({
    where: {
      organizationId_sourceId_canonicalParentUrl: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        canonicalParentUrl,
      },
    },
    create: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      platform: input.platform,
      canonicalParentUrl,
      discoveredAt: input.now,
      lastActivityAt: input.now,
      nextDueAt: input.now,
      status: "ACTIVE",
    },
    update: {},
  })))
  const due = await store.findDue({
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    platform: input.platform,
    now: input.now,
    limit: Math.min(Math.max(input.limit, 1), 50),
    includeInactive: input.includeInactive === true,
  })
  return due.map(row => ({ canonicalUrl: row.canonicalParentUrl, parentExternalId: row.parentExternalId }))
}

export async function markCommentCheckpointsDispatched(input: {
  organizationId: string
  sourceId: string
  urls: string[]
  providerRunId: string
  now: Date
  includeInactive?: boolean
}, store: SocialCommentCheckpointStore = defaultStore): Promise<void> {
  const urls = canonicalUrls(input.urls)
  if (urls.length === 0) return
  await store.updateMany({
    where: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      status: input.includeInactive ? { in: ["ACTIVE", "INACTIVE"] } : "ACTIVE",
      canonicalParentUrl: { in: urls },
    },
    data: {
      lastAttemptAt: input.now,
      nextDueAt: new Date(input.now.getTime() + DISPATCH_LEASE_MS),
      lastProviderRunId: input.providerRunId,
      lastError: null,
    },
  })
}

export async function recordCommentCheckpointBatch(input: {
  organizationId: string
  sourceId: string
  urls: string[]
  providerRunId: string
  observedCommentCounts?: Map<string, number>
  latestCommentExternalIds?: Map<string, string>
  activityUrls?: Set<string>
  coverageClass: string
  error?: string | null
  successful: boolean
  now: Date
}, store: SocialCommentCheckpointStore = defaultStore): Promise<void> {
  const urls = canonicalUrls(input.urls)
  if (urls.length === 0) return
  const counts = new Map(Array.from(input.observedCommentCounts ?? []).map(([url, count]) => [canonicalProviderUrl(url), count]))
  const latestIds = new Map(Array.from(input.latestCommentExternalIds ?? []).map(([url, id]) => [canonicalProviderUrl(url), id]))
  const activityUrls = new Set(Array.from(input.activityUrls ?? []).map(canonicalProviderUrl))
  const rows = await store.findByUrls({ organizationId: input.organizationId, sourceId: input.sourceId, urls })
  await Promise.all(rows.map(row => {
    const observedCommentCount = Math.max(0, Math.trunc(counts.get(row.canonicalParentUrl) ?? 0))
    const latestCommentExternalId = latestIds.get(row.canonicalParentUrl) ?? null
    const activityDetected = activityUrls.has(row.canonicalParentUrl)
      || observedCommentCount > row.lastSeenCommentCount
      || Boolean(latestCommentExternalId && latestCommentExternalId !== row.lastSeenCommentExternalId)
    const lastActivityAt = activityDetected ? input.now : row.lastActivityAt
    const consecutiveNoChange = activityDetected ? 0 : row.consecutiveNoChange + 1
    const plan = input.successful
      ? planSocialCommentCheckpoint({
          state: {
            discoveredAt: row.discoveredAt,
            lastActivityAt,
            lastSuccessfulAt: input.now,
            consecutiveNoChange,
            status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
          },
          now: input.now,
        })
      : null
    return store.update({
      where: { organizationId_id: { organizationId: input.organizationId, id: row.id } },
      data: {
        lastAttemptAt: input.now,
        ...(input.successful ? { lastSuccessfulAt: input.now } : {}),
        lastActivityAt,
        nextDueAt: plan?.nextDueAt ?? new Date(input.now.getTime() + FAILURE_BACKOFF_MS),
        status: plan?.status ?? "ACTIVE",
        consecutiveNoChange,
        lastSeenCommentCount: Math.max(row.lastSeenCommentCount, observedCommentCount),
        lastSeenCommentExternalId: latestCommentExternalId ?? row.lastSeenCommentExternalId,
        coverageClass: input.coverageClass,
        lastProviderRunId: input.providerRunId,
        lastError: input.error ?? null,
      },
    })
  }))
}
