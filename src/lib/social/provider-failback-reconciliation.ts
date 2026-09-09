import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { ROUTE_ADAPTERS } from "@/lib/social/source-route-plan"

type FailbackObservation = {
  providerKey: string | null
  canonicalUrl: string | null
  url: string | null
  idempotencyKey: string
  acceptedMentionId: string | null
}

export type FailbackReconciliationResult = {
  reconciled: boolean
  evidenceAvailable: boolean
  fallbackIdentityCount: number
  primaryIdentityCount: number
  retainedFallbackCount: number
  matchedByPrimaryCount: number
  unresolvedGapCount: number
  identityConflictCount: number
  unresolvedIdentityHashes: string[]
  conflictingIdentityHashes: string[]
}

function providerKeyForAdapter(adapter: string): string {
  if (adapter === ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT) return "bright-data"
  if (adapter === ROUTE_ADAPTERS.APIFY_ASYNC) return "APIFY"
  return adapter
}

function canonicalIdentity(observation: FailbackObservation): string {
  return observation.canonicalUrl?.trim()
    || observation.url?.trim()
    || `idempotency:${observation.idempotencyKey}`
}

function identityHash(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16)
}

export function evaluateFailbackReconciliation(
  observations: FailbackObservation[],
  primaryProviderKey: string,
  fallbackProviderKeys: string[],
): FailbackReconciliationResult {
  const fallbackKeySet = new Set(fallbackProviderKeys)
  const primary = observations.filter(observation => observation.providerKey === primaryProviderKey)
  const fallback = observations.filter(observation => observation.providerKey && fallbackKeySet.has(observation.providerKey))
  const primaryIdentities = new Set(primary.map(canonicalIdentity))
  const fallbackByIdentity = new Map<string, FailbackObservation[]>()
  for (const observation of fallback) {
    const identity = canonicalIdentity(observation)
    const entries = fallbackByIdentity.get(identity) ?? []
    entries.push(observation)
    fallbackByIdentity.set(identity, entries)
  }

  const mentionIdsByIdentity = new Map<string, Set<string>>()
  for (const observation of observations) {
    if (!observation.acceptedMentionId) continue
    const identity = canonicalIdentity(observation)
    const ids = mentionIdsByIdentity.get(identity) ?? new Set<string>()
    ids.add(observation.acceptedMentionId)
    mentionIdsByIdentity.set(identity, ids)
  }

  const unresolved: string[] = []
  let retainedFallbackCount = 0
  let matchedByPrimaryCount = 0
  for (const [identity, entries] of fallbackByIdentity) {
    if (entries.some(entry => entry.acceptedMentionId)) retainedFallbackCount += 1
    if (primaryIdentities.has(identity)) matchedByPrimaryCount += 1
    if (!entries.some(entry => entry.acceptedMentionId) && !primaryIdentities.has(identity)) unresolved.push(identityHash(identity))
  }
  const conflicts = Array.from(mentionIdsByIdentity.entries())
    .filter(([, mentionIds]) => mentionIds.size > 1)
    .map(([identity]) => identityHash(identity))
    .sort()
  const evidenceAvailable = fallbackByIdentity.size > 0

  return {
    reconciled: evidenceAvailable && unresolved.length === 0 && conflicts.length === 0,
    evidenceAvailable,
    fallbackIdentityCount: fallbackByIdentity.size,
    primaryIdentityCount: primaryIdentities.size,
    retainedFallbackCount,
    matchedByPrimaryCount,
    unresolvedGapCount: unresolved.length,
    identityConflictCount: conflicts.length,
    unresolvedIdentityHashes: unresolved.sort(),
    conflictingIdentityHashes: conflicts,
  }
}

function overlapMinutes(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 60
  const configured = Number((value as Record<string, unknown>).failbackOverlapMinutes)
  return Number.isFinite(configured) ? Math.max(15, Math.min(1_440, Math.trunc(configured))) : 60
}

export async function auditProviderFailback(input: {
  organizationId: string
  routePlanId: string
  primaryAdapter: string
  fallbackAdapters: string[]
  rateLimit: unknown
  now?: Date
}): Promise<FailbackReconciliationResult> {
  const now = input.now ?? new Date()
  const primaryProviderKey = providerKeyForAdapter(input.primaryAdapter)
  const fallbackProviderKeys = input.fallbackAdapters
    .filter(adapter => adapter !== ROUTE_ADAPTERS.MANUAL_TASK)
    .map(providerKeyForAdapter)
  if (fallbackProviderKeys.length === 0) {
    return evaluateFailbackReconciliation([], primaryProviderKey, fallbackProviderKeys)
  }
  const observations = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId: input.organizationId,
      routePlanId: input.routePlanId,
      providerKey: { in: [primaryProviderKey, ...fallbackProviderKeys] },
      createdAt: { gte: new Date(now.getTime() - overlapMinutes(input.rateLimit) * 60_000) },
      purgedAt: null,
    },
    select: {
      providerKey: true,
      canonicalUrl: true,
      url: true,
      idempotencyKey: true,
      acceptedMentionId: true,
    },
  })
  return evaluateFailbackReconciliation(observations, primaryProviderKey, fallbackProviderKeys)
}
