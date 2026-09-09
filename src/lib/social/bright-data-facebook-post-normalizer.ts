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

export const BRIGHT_DATA_FACEBOOK_POST_SCHEMA_VERSION = "facebook-post-2026-07-13"
export const BRIGHT_DATA_FACEBOOK_DISCOVERY_SCHEMA_VERSION = "facebook-discovery-2026-07-13"

const PROVIDER_KEY = "bright-data"
const ADAPTER_KEY = "BRIGHT_DATA_FACEBOOK_POSTS"
const DISCOVERY_ADAPTER_KEY = "BRIGHT_DATA_FACEBOOK_DISCOVERY"

export interface BrightDataFacebookPostNormalization {
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

function durationSeconds(value: unknown): number | null {
  const duration = finiteNumber(value)
  if (duration === null || duration < 0) return null
  // The verified Facebook attachment schema returns milliseconds (e.g. 125767).
  return duration > 1_000 ? duration / 1_000 : duration
}

function mediaKind(value: unknown): ProviderMediaKind {
  const type = nonEmptyString(value)?.toLowerCase() ?? ""
  if (type.includes("video") || type.includes("reel")) return "VIDEO"
  if (type.includes("audio")) return "AUDIO"
  return "IMAGE"
}

function contentKind(
  row: Record<string, unknown>,
  attachments: Array<Record<string, unknown>>,
): ProviderContentRecord["contentKind"] {
  const declaredTypes = [
    nonEmptyString(row.post_type),
    ...attachments.flatMap(item => [
      nonEmptyString(item.type),
      nonEmptyString(item.source_type),
    ]),
  ].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase())
  const url = [
    nonEmptyString(row.url),
    nonEmptyString(row.post_url),
  ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase()
  const evidence = `${declaredTypes.join(" ")} ${url}`

  if (/(video|reel|watch)/.test(evidence)) return "VIDEO"
  if (/(audio|podcast)/.test(evidence)) return "AUDIO"
  if (/(image|photo|picture|carousel|album)/.test(evidence) || nonEmptyString(row.post_image)) return "IMAGE"
  return "POST"
}

function provenance(providerItemId: string, observedAt: string): ProviderProvenance {
  return {
    providerKey: PROVIDER_KEY,
    adapterKey: ADAPTER_KEY,
    providerItemId,
    observedAt,
    schemaVersion: BRIGHT_DATA_FACEBOOK_POST_SCHEMA_VERSION,
  }
}

export function normalizeBrightDataFacebookDiscoveryCandidate(
  value: unknown,
  observedAtInput: string,
  queryInput: string,
): ProviderCandidateRecord {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data Facebook discovery observedAt must be an ISO date")
  const query = nonEmptyString(queryInput)
  if (!query) throw new Error("Bright Data Facebook discovery query is required")
  const url = httpUrl(row.url)
  if (!url) throw new Error("Bright Data Facebook discovery URL is required")
  const postId = nonEmptyString(row.post_id) ?? nonEmptyString(row.shortcode)
  if (!postId) throw new Error("Bright Data Facebook discovery post ID is required")

  return {
    recordType: "CANDIDATE",
    platform: "facebook",
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
      schemaVersion: BRIGHT_DATA_FACEBOOK_DISCOVERY_SCHEMA_VERSION,
    },
  }
}

export function normalizeBrightDataFacebookPost(
  value: unknown,
  observedAtInput: string,
): BrightDataFacebookPostNormalization {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data Facebook observedAt must be an ISO date")
  const url = httpUrl(row.url)
  if (!url) throw new Error("Bright Data Facebook post URL is required")
  const postId = nonEmptyString(row.post_id) ?? nonEmptyString(row.shortcode)
  if (!postId) throw new Error("Bright Data Facebook post ID is required")
  const text = nonEmptyString(row.content) ?? nonEmptyString(row.video_title)
  if (!text) throw new Error("Bright Data Facebook post text is required")

  const canonicalUrl = canonicalProviderUrl(url)
  const handle = nonEmptyString(row.profile_handle) ?? nonEmptyString(row.user_handle)
  const attachments = Array.isArray(row.attachments) ? row.attachments.map(object) : []

  const content: ProviderContentRecord = {
    recordType: "CONTENT",
    platform: "facebook",
    externalId: postId,
    contentKind: contentKind(row, attachments),
    url,
    canonicalUrl,
    text,
    publishedAt: isoDate(row.date_posted) ?? isoDate(row.timestamp),
    author: handle || nonEmptyString(row.user_username_raw) || httpUrl(row.page_logo)
      ? {
          externalId: nonEmptyString(row.profile_id),
          name: nonEmptyString(row.user_username_raw),
          handle,
          avatarUrl: httpUrl(row.page_logo) ?? httpUrl(row.avatar_image_url),
        }
      : null,
    provenance: provenance(postId, observedAt),
  }

  const media: ProviderMediaRecord[] = []
  const seenUrls = new Set<string>()
  const addMedia = (input: {
    providerId?: unknown
    kind: ProviderMediaKind
    url: unknown
    thumbnailUrl?: unknown
    duration?: unknown
    mimeType?: unknown
  }) => {
    const mediaUrl = httpUrl(input.url)
    if (!mediaUrl || seenUrls.has(mediaUrl)) return
    seenUrls.add(mediaUrl)
    const providerId = nonEmptyString(input.providerId)
      ?? `${postId}:${input.kind.toLowerCase()}:${media.length + 1}`
    media.push({
      recordType: "MEDIA",
      platform: "facebook",
      externalId: providerId,
      parentExternalId: postId,
      parentUrl: canonicalUrl,
      mediaKind: input.kind,
      url: mediaUrl,
      thumbnailUrl: httpUrl(input.thumbnailUrl),
      mimeType: nonEmptyString(input.mimeType),
      durationSeconds: durationSeconds(input.duration),
      provenance: provenance(providerId, observedAt),
    })
  }

  for (const item of attachments) {
    const kind = mediaKind(item.type)
    const mediaUrl = kind === "VIDEO"
      ? item.video_url ?? item.attachment_url ?? item.url
      : item.attachment_url ?? item.url
    addMedia({
      providerId: item.id,
      kind,
      url: mediaUrl,
      thumbnailUrl: item.thumbnail_url,
      duration: item.video_length,
      mimeType: item.source_type,
    })
  }
  addMedia({ kind: "THUMBNAIL", url: row.post_image })

  const metric: ProviderMetricRecord = {
    recordType: "METRIC",
    platform: "facebook",
    externalId: postId,
    parentUrl: canonicalUrl,
    observedAt,
    views: firstNumber(row, ["video_view_count", "play_count"]),
    likes: finiteNumber(row.likes),
    comments: finiteNumber(row.num_comments),
    shares: finiteNumber(row.num_shares),
    provenance: provenance(postId, observedAt),
  }

  return { content, media, metric }
}
