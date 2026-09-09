import {
  canonicalProviderUrl,
  type ProviderCandidateRecord,
  type ProviderContentRecord,
  type ProviderMediaKind,
  type ProviderMediaRecord,
  type ProviderMetricRecord,
  type ProviderProvenance,
} from "@/lib/social/provider-capability-contract"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

export const BRIGHT_DATA_TIKTOK_DISCOVERY_SCHEMA_VERSION = "tiktok-discovery-2026-07-13"
export const BRIGHT_DATA_TIKTOK_POST_SCHEMA_VERSION = "tiktok-post-2026-07-13"

const PROVIDER_KEY = "bright-data"
const DISCOVERY_ADAPTER_KEY = "BRIGHT_DATA_TIKTOK_DISCOVERY"
const POST_ADAPTER_KEY = "BRIGHT_DATA_TIKTOK_POSTS"

export interface BrightDataTikTokPostNormalization {
  content: ProviderContentRecord
  media: ProviderMediaRecord[]
  metric: ProviderMetricRecord
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function httpUrl(value: unknown): string | null {
  const candidate = nonEmptyString(value)
  return candidate && isValidPublicMediaUrl(candidate) ? candidate : null
}

function isoDate(value: unknown): string | null {
  const candidate = nonEmptyString(value)
  if (!candidate) return null
  const date = new Date(candidate)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function finiteNonNegative(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(number) && number >= 0 ? number : null
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = finiteNonNegative(row[key])
    if (value !== null) return value
  }
  return null
}

function provenance(input: {
  providerItemId: string
  observedAt: string
  adapterKey: string
  schemaVersion: string
}): ProviderProvenance {
  return {
    providerKey: PROVIDER_KEY,
    adapterKey: input.adapterKey,
    providerItemId: input.providerItemId,
    observedAt: input.observedAt,
    schemaVersion: input.schemaVersion,
  }
}

export function normalizeBrightDataTikTokDiscoveryCandidate(
  value: unknown,
  observedAtInput: string,
  queryInput: string,
): ProviderCandidateRecord {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data TikTok discovery observedAt must be an ISO date")
  const query = nonEmptyString(queryInput)
  if (!query) throw new Error("Bright Data TikTok discovery query is required")
  const url = httpUrl(row.url)
  if (!url) throw new Error("Bright Data TikTok discovery URL is required")
  const postId = nonEmptyString(row.post_id) ?? nonEmptyString(row.shortcode)
  if (!postId) throw new Error("Bright Data TikTok discovery post ID is required")

  return {
    recordType: "CANDIDATE",
    platform: "tiktok",
    url,
    canonicalUrl: canonicalProviderUrl(url),
    externalId: postId,
    query,
    publishedAt: isoDate(row.create_time) ?? isoDate(row.timestamp),
    provenance: provenance({
      providerItemId: postId,
      observedAt,
      adapterKey: DISCOVERY_ADAPTER_KEY,
      schemaVersion: BRIGHT_DATA_TIKTOK_DISCOVERY_SCHEMA_VERSION,
    }),
  }
}

export function normalizeBrightDataTikTokPost(
  value: unknown,
  observedAtInput: string,
): BrightDataTikTokPostNormalization {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data TikTok observedAt must be an ISO date")
  const url = httpUrl(row.url)
  if (!url) throw new Error("Bright Data TikTok post URL is required")
  const postId = nonEmptyString(row.post_id) ?? nonEmptyString(row.shortcode)
  if (!postId) throw new Error("Bright Data TikTok post ID is required")
  const text = nonEmptyString(row.description)
  if (!text) throw new Error("Bright Data TikTok post text is required")

  const canonicalUrl = canonicalProviderUrl(url)
  const handle = nonEmptyString(row.profile_username)
  const postProvenance = (providerItemId: string) => provenance({
    providerItemId,
    observedAt,
    adapterKey: POST_ADAPTER_KEY,
    schemaVersion: BRIGHT_DATA_TIKTOK_POST_SCHEMA_VERSION,
  })

  const content: ProviderContentRecord = {
    recordType: "CONTENT",
    platform: "tiktok",
    externalId: postId,
    contentKind: "VIDEO",
    url,
    canonicalUrl,
    text,
    publishedAt: isoDate(row.create_time) ?? isoDate(row.timestamp),
    author: handle || httpUrl(row.profile_avatar)
      ? {
          externalId: nonEmptyString(row.profile_id) ?? nonEmptyString(row.account_id),
          name: handle,
          handle,
          avatarUrl: httpUrl(row.profile_avatar),
        }
      : null,
    provenance: postProvenance(postId),
  }

  const media: ProviderMediaRecord[] = []
  const seenUrls = new Set<string>()
  const addMedia = (input: {
    providerId?: unknown
    kind: ProviderMediaKind
    url: unknown
    thumbnailUrl?: unknown
    duration?: unknown
    width?: unknown
    height?: unknown
  }) => {
    const mediaUrl = httpUrl(input.url)
    if (!mediaUrl || seenUrls.has(mediaUrl)) return
    seenUrls.add(mediaUrl)
    const providerId = nonEmptyString(input.providerId)
      ?? `${postId}:${input.kind.toLowerCase()}:${media.length + 1}`
    media.push({
      recordType: "MEDIA",
      platform: "tiktok",
      externalId: providerId,
      parentExternalId: postId,
      parentUrl: canonicalUrl,
      mediaKind: input.kind,
      url: mediaUrl,
      thumbnailUrl: httpUrl(input.thumbnailUrl),
      durationSeconds: finiteNonNegative(input.duration),
      width: finiteNonNegative(input.width),
      height: finiteNonNegative(input.height),
      provenance: postProvenance(providerId),
    })
  }

  addMedia({
    providerId: `${postId}:video`,
    kind: "VIDEO",
    url: row.video_url,
    thumbnailUrl: row.preview_image,
    duration: row.video_duration,
    width: row.width,
  })
  addMedia({ providerId: `${postId}:cover`, kind: "THUMBNAIL", url: row.preview_image })
  const music = object(row.music)
  addMedia({ providerId: music.id, kind: "AUDIO", url: music.playurl })
  if (Array.isArray(row.carousel_images)) {
    for (const imageValue of row.carousel_images) {
      const image = object(imageValue)
      addMedia({ providerId: image.id, kind: "IMAGE", url: image.url ?? imageValue })
    }
  }

  const metric: ProviderMetricRecord = {
    recordType: "METRIC",
    platform: "tiktok",
    externalId: postId,
    parentUrl: canonicalUrl,
    observedAt,
    views: finiteNonNegative(row.play_count),
    likes: finiteNonNegative(row.digg_count),
    comments: finiteNonNegative(row.comment_count),
    shares: firstNumber(row, ["share_count", "num_share_count"]),
    provenance: postProvenance(postId),
  }

  return { content, media, metric }
}
