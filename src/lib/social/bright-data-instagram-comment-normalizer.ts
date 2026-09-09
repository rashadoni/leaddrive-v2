import {
  canonicalProviderUrl,
  type ProviderCommentRecord,
  type ProviderProvenance,
} from "@/lib/social/provider-capability-contract"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

export const BRIGHT_DATA_INSTAGRAM_COMMENT_SCHEMA_VERSION = "instagram-comment-2026-07-13"

const PROVIDER_KEY = "bright-data"
const ADAPTER_KEY = "BRIGHT_DATA_INSTAGRAM_COMMENTS"

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

function provenance(providerItemId: string, observedAt: string): ProviderProvenance {
  return {
    providerKey: PROVIDER_KEY,
    adapterKey: ADAPTER_KEY,
    providerItemId,
    observedAt,
    schemaVersion: BRIGHT_DATA_INSTAGRAM_COMMENT_SCHEMA_VERSION,
  }
}

/**
 * Bright Data's comment row does not include Instagram's post ID. The caller
 * must supply the external ID from the already-enriched parent post so comment
 * linkage cannot silently fork onto a shortcode-only identity.
 */
export function normalizeBrightDataInstagramComment(
  value: unknown,
  observedAtInput: string,
  postExternalIdInput: string,
): ProviderCommentRecord {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data Instagram comment observedAt must be an ISO date")
  const postExternalId = nonEmptyString(postExternalIdInput)
  if (!postExternalId) throw new Error("Bright Data Instagram parent post ID is required")

  const externalId = nonEmptyString(row.comment_id)
  if (!externalId) throw new Error("Bright Data Instagram comment ID is required")
  const text = nonEmptyString(row.comment)
  if (!text) throw new Error("Bright Data Instagram comment text is required")
  const parentPostUrl = httpUrl(row.post_url) ?? httpUrl(row.url)
  if (!parentPostUrl) throw new Error("Bright Data Instagram parent post URL is required")
  const handle = nonEmptyString(row.comment_user)
  const profileUrl = httpUrl(row.comment_user_url)

  return {
    recordType: "COMMENT",
    platform: "instagram",
    externalId,
    contentKind: "COMMENT",
    text,
    url: null,
    canonicalUrl: canonicalProviderUrl(parentPostUrl),
    postExternalId,
    parentExternalId: null,
    threadExternalId: postExternalId,
    replyToExternalId: null,
    parentPostUrl,
    depth: 0,
    publishedAt: isoDate(row.comment_date) ?? isoDate(row.timestamp),
    likes: finiteNonNegative(row.likes_number),
    replies: finiteNonNegative(row.replies_number),
    author: handle || profileUrl
      ? {
          name: handle,
          handle,
          profileUrl,
        }
      : null,
    provenance: provenance(externalId, observedAt),
  }
}
