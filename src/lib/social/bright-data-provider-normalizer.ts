import { normalizeBrightDataFacebookComment } from "@/lib/social/bright-data-facebook-comment-normalizer"
import {
  normalizeBrightDataFacebookDiscoveryCandidate,
  normalizeBrightDataFacebookPost,
} from "@/lib/social/bright-data-facebook-post-normalizer"
import { normalizeBrightDataInstagramComment } from "@/lib/social/bright-data-instagram-comment-normalizer"
import {
  normalizeBrightDataInstagramDiscoveryCandidate,
  normalizeBrightDataInstagramPost,
} from "@/lib/social/bright-data-instagram-post-normalizer"
import {
  evaluateBrightDataSchemaDrift,
  type BrightDataSchemaDriftOptions,
  type BrightDataSchemaDriftReport,
} from "@/lib/social/bright-data-schema-drift"
import { normalizeBrightDataTikTokCommentThread } from "@/lib/social/bright-data-tiktok-comment-normalizer"
import {
  normalizeBrightDataTikTokDiscoveryCandidate,
  normalizeBrightDataTikTokPost,
} from "@/lib/social/bright-data-tiktok-post-normalizer"
import {
  assertValidProviderBatch,
  canonicalProviderUrl,
  PROVIDER_CONTRACT_VERSION,
  type ProviderBatch,
  type ProviderCapability,
  type ProviderRecord,
} from "@/lib/social/provider-capability-contract"

export const BRIGHT_DATA_PROVIDER_KEY = "bright-data"

export const BRIGHT_DATA_SUPPORTED_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
] as const

export type BrightDataSupportedPlatform = (typeof BRIGHT_DATA_SUPPORTED_PLATFORMS)[number]

export interface BrightDataProviderNormalizationInput extends BrightDataSchemaDriftOptions {
  platform: BrightDataSupportedPlatform
  capability: ProviderCapability
  rows: readonly unknown[]
  observedAt: string
  query?: string | null
  /** Canonical or raw parent-post URL -> enriched platform post ID. */
  parentPostExternalIds?: Readonly<Record<string, string>>
}

export interface BrightDataProviderNormalizationResult {
  batch: ProviderBatch
  drift: BrightDataSchemaDriftReport<ProviderRecord[]>
}

type PostNormalization = ReturnType<typeof normalizeBrightDataInstagramPost>

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function validObservedAt(value: string): string {
  const date = new Date(value)
  if (!value.trim() || !Number.isFinite(date.getTime())) {
    throw new Error("Bright Data observedAt must be an ISO date")
  }
  return date.toISOString()
}

function urlPathToken(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url.trim())
    const segments = parsed.pathname.split("/").filter(Boolean)
    const token = segments.length > 0 ? segments[segments.length - 1].trim().toLowerCase() : ""
    return token || null
  } catch {
    return null
  }
}

interface ParentIdentityIndex {
  byCanonicalUrl: Map<string, string>
  // Post-identity token = the last path segment of the tracked post URL
  // (pfbid…, numeric id, reel id). Ambiguous tokens are dropped so a comment
  // can never attach to the wrong tracked post.
  byPathToken: Map<string, string>
}

function normalizeParentMap(input: Readonly<Record<string, string>> | undefined): ParentIdentityIndex {
  const byCanonicalUrl = new Map<string, string>()
  const byPathToken = new Map<string, string>()
  const ambiguousTokens = new Set<string>()
  for (const [url, externalId] of Object.entries(input ?? {})) {
    const id = nonEmptyString(externalId)
    if (!id) continue
    const canonical = canonicalProviderUrl(url)
    byCanonicalUrl.set(canonical, id)
    const token = urlPathToken(canonical)
    if (!token) continue
    if (byPathToken.has(token) && byPathToken.get(token) !== id) {
      ambiguousTokens.add(token)
      continue
    }
    byPathToken.set(token, id)
  }
  for (const token of ambiguousTokens) byPathToken.delete(token)
  return { byCanonicalUrl, byPathToken }
}

function parentPostUrl(row: unknown): string | null {
  const value = object(row)
  // Bright Data may resolve a tracked Facebook reel/post to a generic
  // facebook.com/video.php URL. The echoed input URL is the exact target we
  // supplied and is therefore the strongest safe lineage key.
  const input = object(value.input)
  return nonEmptyString(input.url) ?? nonEmptyString(value.post_url) ?? nonEmptyString(value.url)
}

function expectedParentExternalId(row: unknown, parentIds: ParentIdentityIndex): string {
  const url = parentPostUrl(row)
  const byUrl = url ? parentIds.byCanonicalUrl.get(canonicalProviderUrl(url)) : null
  if (byUrl) return byUrl
  // Exact URL mapping breaks when the provider echoes the post URL in another
  // form — resolved id instead of pfbid, extra query params (?comment_id=…),
  // m./www. host variants — which used to reject the ENTIRE comment batch
  // ("parent identity mapping is required" for every row). Fall back to
  // identity matching; a comment still cannot attach to a post we don't track.
  const postId = nonEmptyString(object(row).post_id)
  if (postId) {
    for (const externalId of parentIds.byCanonicalUrl.values()) {
      if (externalId === postId) return externalId
    }
  }
  const token = urlPathToken(url)
  const byToken = token ? parentIds.byPathToken.get(token) : null
  if (byToken) return byToken
  throw new Error("Bright Data parent identity mapping is required")
}

function normalizeDiscovery(
  platform: BrightDataSupportedPlatform,
  row: unknown,
  observedAt: string,
  query: string | null,
): ProviderRecord[] {
  if (!query) throw new Error("Bright Data discovery query is required")
  switch (platform) {
    case "instagram":
      return [normalizeBrightDataInstagramDiscoveryCandidate(row, observedAt, query)]
    case "facebook":
      return [normalizeBrightDataFacebookDiscoveryCandidate(row, observedAt, query)]
    case "tiktok":
      return [normalizeBrightDataTikTokDiscoveryCandidate(row, observedAt, query)]
  }
}

function normalizePost(
  platform: BrightDataSupportedPlatform,
  row: unknown,
  observedAt: string,
): PostNormalization {
  switch (platform) {
    case "instagram":
      return normalizeBrightDataInstagramPost(row, observedAt)
    case "facebook":
      return normalizeBrightDataFacebookPost(row, observedAt)
    case "tiktok":
      return normalizeBrightDataTikTokPost(row, observedAt)
  }
}

function normalizeComment(
  platform: BrightDataSupportedPlatform,
  row: unknown,
  observedAt: string,
  parentIds: ParentIdentityIndex,
): ProviderRecord[] {
  const parentExternalId = expectedParentExternalId(row, parentIds)
  switch (platform) {
    case "instagram":
      return [normalizeBrightDataInstagramComment(row, observedAt, parentExternalId)]
    case "facebook":
      return [normalizeBrightDataFacebookComment(row, observedAt, parentExternalId)]
    case "tiktok":
      return normalizeBrightDataTikTokCommentThread(row, observedAt, parentExternalId)
  }
}

function recordsForCapability(input: {
  platform: BrightDataSupportedPlatform
  capability: ProviderCapability
  row: unknown
  observedAt: string
  query: string | null
  parentIds: ParentIdentityIndex
}): ProviderRecord[] {
  if (input.capability === "DISCOVER_URLS") {
    return normalizeDiscovery(input.platform, input.row, input.observedAt, input.query)
  }
  if (input.capability === "READ_COMMENTS") {
    return normalizeComment(input.platform, input.row, input.observedAt, input.parentIds)
  }

  const post = normalizePost(input.platform, input.row, input.observedAt)
  switch (input.capability) {
    case "ENRICH_CONTENT":
      return [post.content]
    case "READ_MEDIA":
      if (post.media.length === 0) throw new Error("Bright Data media URL is required")
      return post.media
    case "UPDATE_METRICS": {
      const metricValues = [
        post.metric.views,
        post.metric.likes,
        post.metric.comments,
        post.metric.shares,
        post.metric.reactions,
      ]
      if (metricValues.every(value => value === null || value === undefined)) {
        throw new Error("Bright Data metric value is required")
      }
      return [post.metric]
    }
    default: {
      const exhaustive: never = input.capability
      throw new Error(`Unsupported Bright Data capability: ${exhaustive}`)
    }
  }
}

/**
 * Converts already-downloaded Bright Data rows into the provider capability
 * contract. This function is pure: it performs no provider I/O or persistence.
 */
export function normalizeBrightDataProviderBatch(
  input: BrightDataProviderNormalizationInput,
): BrightDataProviderNormalizationResult {
  const observedAt = validObservedAt(input.observedAt)
  const query = nonEmptyString(input.query)
  const parentIds = normalizeParentMap(input.parentPostExternalIds)
  const drift = evaluateBrightDataSchemaDrift<ProviderRecord[]>(
    input.rows,
    row => recordsForCapability({
      platform: input.platform,
      capability: input.capability,
      row,
      observedAt,
      query,
      parentIds,
    }),
    { degradedRatio: input.degradedRatio },
  )
  const batch: ProviderBatch = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerKey: BRIGHT_DATA_PROVIDER_KEY,
    capability: input.capability,
    records: drift.normalized.flat(),
    warnings: drift.warnings,
  }
  assertValidProviderBatch(batch)
  return { batch, drift }
}
