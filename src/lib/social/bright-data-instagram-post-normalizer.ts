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

export const BRIGHT_DATA_INSTAGRAM_POST_SCHEMA_VERSION = "instagram-post-2026-07-13"
export const BRIGHT_DATA_INSTAGRAM_REEL_SCHEMA_VERSION = "instagram-reel-2026-07-13"
export const BRIGHT_DATA_INSTAGRAM_DISCOVERY_SCHEMA_VERSION = "instagram-discovery-2026-07-13"

const PROVIDER_KEY = "bright-data"
const ADAPTER_KEY = "BRIGHT_DATA_INSTAGRAM_POSTS"
const DISCOVERY_ADAPTER_KEY = "BRIGHT_DATA_INSTAGRAM_DISCOVERY"

export interface BrightDataInstagramPostNormalization {
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

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(row[key])
    if (value !== null) return value
  }
  return null
}

function provenance(providerItemId: string, observedAt: string, schemaVersion: string): ProviderProvenance {
  return {
    providerKey: PROVIDER_KEY,
    adapterKey: ADAPTER_KEY,
    providerItemId,
    observedAt,
    schemaVersion,
  }
}

function mediaKind(value: unknown): ProviderMediaKind {
  const type = nonEmptyString(value)?.toLowerCase() ?? ""
  if (type.includes("video") || type.includes("reel")) return "VIDEO"
  if (type.includes("audio")) return "AUDIO"
  return "IMAGE"
}

function durationSeconds(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const duration = finiteNumber(item)
      if (duration !== null) return duration
    }
    return null
  }
  return finiteNumber(value)
}

export function normalizeBrightDataInstagramDiscoveryCandidate(
  value: unknown,
  observedAtInput: string,
  queryInput: string,
): ProviderCandidateRecord {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data Instagram discovery observedAt must be an ISO date")
  const query = nonEmptyString(queryInput)
  if (!query) throw new Error("Bright Data Instagram discovery query is required")
  const url = httpUrl(row.url)
  if (!url) throw new Error("Bright Data Instagram discovery URL is required")
  const postId = nonEmptyString(row.post_id)
    ?? nonEmptyString(row.content_id)
    ?? nonEmptyString(row.shortcode)
  if (!postId) throw new Error("Bright Data Instagram discovery post ID is required")

  return {
    recordType: "CANDIDATE",
    platform: "instagram",
    url,
    canonicalUrl: canonicalProviderUrl(url),
    externalId: postId,
    query,
    publishedAt: isoDate(row.date_posted) ?? isoDate(row.timestamp),
    provenance: {
      providerKey: PROVIDER_KEY,
      adapterKey: DISCOVERY_ADAPTER_KEY,
      providerItemId: postId,
      observedAt,
      schemaVersion: BRIGHT_DATA_INSTAGRAM_DISCOVERY_SCHEMA_VERSION,
    },
  }
}

export function normalizeBrightDataInstagramPost(
  value: unknown,
  observedAtInput: string,
): BrightDataInstagramPostNormalization {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data Instagram observedAt must be an ISO date")

  const url = httpUrl(row.url)
  if (!url) throw new Error("Bright Data Instagram post URL is required")
  const postId = nonEmptyString(row.post_id)
    ?? nonEmptyString(row.content_id)
    ?? nonEmptyString(row.shortcode)
  if (!postId) throw new Error("Bright Data Instagram post ID is required")
  const text = nonEmptyString(row.description) ?? nonEmptyString(row.alt_text)
  if (!text) throw new Error("Bright Data Instagram post text is required")

  const canonicalUrl = canonicalProviderUrl(url)
  const handle = nonEmptyString(row.user_posted)
  const postType = [row.content_type, row.product_type]
    .map(nonEmptyString)
    .filter((item): item is string => Boolean(item))
    .join(" ")
    .toLowerCase()
  const hasVideo = postType.includes("video")
    || postType.includes("reel")
    || postType.includes("clip")
    || Boolean(httpUrl(row.video_url))
  const schemaVersion = hasVideo
    ? BRIGHT_DATA_INSTAGRAM_REEL_SCHEMA_VERSION
    : BRIGHT_DATA_INSTAGRAM_POST_SCHEMA_VERSION

  const content: ProviderContentRecord = {
    recordType: "CONTENT",
    platform: "instagram",
    externalId: postId,
    contentKind: hasVideo ? "VIDEO" : "POST",
    url,
    canonicalUrl,
    text,
    publishedAt: isoDate(row.date_posted) ?? isoDate(row.timestamp),
    author: handle || httpUrl(row.profile_image_link) || httpUrl(row.profile_url)
      ? {
          externalId: nonEmptyString(row.user_posted_id),
          name: handle,
          handle,
          avatarUrl: httpUrl(row.profile_image_link),
        }
      : null,
    provenance: provenance(postId, observedAt, schemaVersion),
  }

  const media: ProviderMediaRecord[] = []
  const seenUrls = new Set<string>()
  const addMedia = (input: {
    providerId?: unknown
    kind: ProviderMediaKind
    url: unknown
    thumbnailUrl?: unknown
    duration?: unknown
  }) => {
    const mediaUrl = httpUrl(input.url)
    if (!mediaUrl || seenUrls.has(mediaUrl)) return
    seenUrls.add(mediaUrl)
    const providerId = nonEmptyString(input.providerId)
      ?? `${postId}:${input.kind.toLowerCase()}:${media.length + 1}`
    media.push({
      recordType: "MEDIA",
      platform: "instagram",
      externalId: providerId,
      parentExternalId: postId,
      parentUrl: canonicalUrl,
      mediaKind: input.kind,
      url: mediaUrl,
      thumbnailUrl: httpUrl(input.thumbnailUrl),
      durationSeconds: durationSeconds(input.duration),
      provenance: provenance(providerId, observedAt, schemaVersion),
    })
  }

  if (Array.isArray(row.post_content)) {
    for (const itemValue of row.post_content) {
      const item = object(itemValue)
      addMedia({
        providerId: item.id,
        kind: mediaKind(item.type),
        url: item.url,
        thumbnailUrl: row.thumbnail,
        duration: item.duration ?? row.videos_duration,
      })
    }
  }
  if (Array.isArray(row.images)) {
    for (const itemValue of row.images) {
      const item = object(itemValue)
      addMedia({ providerId: item.id, kind: "IMAGE", url: item.url })
    }
  }
  if (Array.isArray(row.photos)) {
    for (const photo of row.photos) addMedia({ kind: "IMAGE", url: photo })
  }
  addMedia({
    providerId: `${postId}:video`,
    kind: "VIDEO",
    url: row.video_url,
    thumbnailUrl: row.thumbnail,
    duration: row.length ?? row.videos_duration,
  })
  addMedia({ kind: "THUMBNAIL", url: row.thumbnail })
  addMedia({ kind: "AUDIO", url: row.audio_url })
  content.contentKind = media.some(item => item.mediaKind === "VIDEO")
    ? "VIDEO"
      : media.some(item => item.mediaKind === "AUDIO")
      ? "AUDIO"
      : media.length > 0
        ? "IMAGE"
        : content.contentKind

  const metric: ProviderMetricRecord = {
    recordType: "METRIC",
    platform: "instagram",
    externalId: postId,
    parentUrl: canonicalUrl,
    observedAt,
    views: firstNumber(row, ["views", "video_view_count", "video_play_count"]),
    likes: finiteNumber(row.likes),
    comments: finiteNumber(row.num_comments),
    shares: finiteNumber(row.shares),
    provenance: provenance(postId, observedAt, schemaVersion),
  }

  return { content, media, metric }
}
