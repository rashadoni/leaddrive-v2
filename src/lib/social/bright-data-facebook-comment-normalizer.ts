import {
  canonicalProviderUrl,
  type ProviderCommentRecord,
  type ProviderProvenance,
} from "@/lib/social/provider-capability-contract"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

export const BRIGHT_DATA_FACEBOOK_COMMENT_SCHEMA_VERSION = "facebook-comment-2026-07-13"

const PROVIDER_KEY = "bright-data"
const ADAPTER_KEY = "BRIGHT_DATA_FACEBOOK_COMMENTS"

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
    schemaVersion: BRIGHT_DATA_FACEBOOK_COMMENT_SCHEMA_VERSION,
  }
}

export function normalizeBrightDataFacebookComment(
  value: unknown,
  observedAtInput: string,
  expectedPostExternalIdInput: string,
): ProviderCommentRecord {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data Facebook comment observedAt must be an ISO date")
  const expectedPostExternalId = nonEmptyString(expectedPostExternalIdInput)
  if (!expectedPostExternalId) throw new Error("Bright Data Facebook expected post ID is required")

  const externalId = nonEmptyString(row.comment_id)
  if (!externalId) throw new Error("Bright Data Facebook comment ID is required")
  const text = nonEmptyString(row.comment_text)
  if (!text) throw new Error("Bright Data Facebook comment text is required")
  // The parent identity is resolved by the shared layer from the row's own
  // post URL / post id against the tracked-post index, so it is authoritative.
  // The provider may echo the same post under a different id representation
  // (pfbid vs numeric) — key the record by the RESOLVED tracked identity so it
  // links to the enriched parent mention; a row whose parent is genuinely
  // untracked never reaches this point (the shared layer throws first).
  if (!nonEmptyString(row.post_id) && !nonEmptyString(row.post_url) && !nonEmptyString(row.url)) {
    throw new Error("Bright Data Facebook parent post ID is required")
  }
  const postExternalId = expectedPostExternalId
  const input = object(row.input)
  const parentPostUrl = httpUrl(input.url) ?? httpUrl(row.post_url) ?? httpUrl(row.url)
  if (!parentPostUrl) throw new Error("Bright Data Facebook parent post URL is required")

  const parentExternalId = nonEmptyString(row.parent_comment_id)
  const isReply = row.reply === true || Boolean(parentExternalId)
  if (isReply && !parentExternalId) {
    throw new Error("Bright Data Facebook reply parent comment ID is required")
  }
  const commentUrl = httpUrl(row.comment_link)
  const profileUrl = httpUrl(row.commentator_profile_url)

  return {
    recordType: "COMMENT",
    platform: "facebook",
    externalId,
    contentKind: isReply ? "REPLY" : "COMMENT",
    text,
    url: commentUrl,
    canonicalUrl: commentUrl ? canonicalProviderUrl(commentUrl) : null,
    postExternalId,
    parentExternalId,
    threadExternalId: postExternalId,
    replyToExternalId: parentExternalId,
    parentPostUrl,
    depth: isReply ? 1 : 0,
    publishedAt: isoDate(row.date_created) ?? isoDate(row.timestamp),
    likes: finiteNonNegative(row.num_likes),
    replies: finiteNonNegative(row.num_replies),
    author: nonEmptyString(row.user_id) || nonEmptyString(row.user_name) || profileUrl
      ? {
          externalId: nonEmptyString(row.user_id),
          name: nonEmptyString(row.user_name),
          profileUrl,
        }
      : null,
    provenance: provenance(externalId, observedAt),
  }
}
