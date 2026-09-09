import {
  canonicalProviderUrl,
  type ProviderCommentRecord,
  type ProviderProvenance,
} from "@/lib/social/provider-capability-contract"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

export const BRIGHT_DATA_TIKTOK_COMMENT_SCHEMA_VERSION = "tiktok-comment-2026-07-18"

const PROVIDER_KEY = "bright-data"
const ADAPTER_KEY = "BRIGHT_DATA_TIKTOK_COMMENTS"

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
    schemaVersion: BRIGHT_DATA_TIKTOK_COMMENT_SCHEMA_VERSION,
  }
}

export function normalizeBrightDataTikTokComment(
  value: unknown,
  observedAtInput: string,
  expectedPostExternalIdInput: string,
): ProviderCommentRecord {
  const row = object(value)
  const observedAt = isoDate(observedAtInput)
  if (!observedAt) throw new Error("Bright Data TikTok comment observedAt must be an ISO date")
  const expectedPostExternalId = nonEmptyString(expectedPostExternalIdInput)
  if (!expectedPostExternalId) throw new Error("Bright Data TikTok parent post ID is required")
  const postExternalId = nonEmptyString(row.post_id)
  if (!postExternalId) throw new Error("Bright Data TikTok comment post ID is required")
  if (postExternalId !== expectedPostExternalId) {
    throw new Error("Bright Data TikTok comment parent post ID mismatch")
  }

  const externalId = nonEmptyString(row.comment_id)
  if (!externalId) throw new Error("Bright Data TikTok comment ID is required")
  const text = nonEmptyString(row.comment_text)
  if (!text) throw new Error("Bright Data TikTok comment text is required")
  const parentPostUrl = httpUrl(row.post_url) ?? httpUrl(row.url)
  if (!parentPostUrl) throw new Error("Bright Data TikTok parent post URL is required")
  const commentUrl = httpUrl(row.comment_url)
  const handle = nonEmptyString(row.commenter_user_name)
  const profileUrl = httpUrl(row.commenter_url)
  const parentExternalId = nonEmptyString(row.parent_comment_id)
    ?? nonEmptyString(row.reply_to_comment_id)
    ?? nonEmptyString(row.parent_id)
  const isReply = Boolean(parentExternalId)

  return {
    recordType: "COMMENT",
    platform: "tiktok",
    externalId,
    contentKind: isReply ? "REPLY" : "COMMENT",
    text,
    url: commentUrl,
    canonicalUrl: commentUrl ? canonicalProviderUrl(commentUrl) : canonicalProviderUrl(parentPostUrl),
    postExternalId,
    parentExternalId,
    threadExternalId: postExternalId,
    replyToExternalId: parentExternalId,
    parentPostUrl,
    depth: isReply ? 1 : 0,
    publishedAt: isoDate(row.date_created) ?? isoDate(row.timestamp),
    likes: finiteNonNegative(row.num_likes),
    replies: finiteNonNegative(row.num_replies),
    author: handle || nonEmptyString(row.commenter_id) || profileUrl
      ? {
          externalId: nonEmptyString(row.commenter_id),
          name: handle,
          handle,
          profileUrl,
        }
      : null,
    provenance: provenance(externalId, observedAt),
  }
}

/**
 * Bright Data embeds TikTok replies under their top-level comment. Preserve
 * that container identity as the canonical parent instead of expecting a
 * provider-level parent_comment_id that is not present in the live schema.
 */
export function normalizeBrightDataTikTokCommentThread(
  value: unknown,
  observedAtInput: string,
  expectedPostExternalIdInput: string,
): ProviderCommentRecord[] {
  const comment = normalizeBrightDataTikTokComment(value, observedAtInput, expectedPostExternalIdInput)
  const row = object(value)
  if (row.replies === undefined || row.replies === null) return [comment]
  if (!Array.isArray(row.replies)) throw new Error("Bright Data TikTok comment replies must be an array")

  const replies = row.replies.map((value): ProviderCommentRecord => {
    const reply = object(value)
    const externalId = nonEmptyString(reply.reply_id)
    if (!externalId) throw new Error("Bright Data TikTok reply ID is required")
    const text = nonEmptyString(reply.text)
    if (!text) throw new Error("Bright Data TikTok reply text is required")
    return {
      recordType: "COMMENT", platform: "tiktok", externalId, contentKind: "REPLY", text,
      url: null, canonicalUrl: comment.canonicalUrl, postExternalId: comment.postExternalId,
      parentExternalId: comment.externalId, threadExternalId: comment.threadExternalId,
      replyToExternalId: comment.externalId, parentPostUrl: comment.parentPostUrl, depth: 1,
      publishedAt: isoDate(reply.reply_date), likes: finiteNonNegative(reply.amount_of_likes),
      replies: 0, author: null, provenance: provenance(externalId, comment.provenance.observedAt),
    }
  })
  return [comment, ...replies]
}
