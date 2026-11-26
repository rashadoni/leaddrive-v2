/**
 * Answering a stored TikTok comment — by a person from «Комментарии», and by nobody else.
 *
 * There is one way to answer: under the video. TikTok's direct messages are the Business Messaging
 * permission, which the platform stopped issuing, so the private reply that Instagram and Facebook
 * offer has no equivalent here; a keyword rule, whose whole job is to write privately, does not run
 * on TikTok comments at all.
 *
 * Must run inside the organization's tenant scope. Never throws on a TikTok failure: the caller gets
 * the platform's own words.
 */
import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { replyToVideoComment } from "@/lib/social/tiktok-comment-api"

export type StoredTikTokReply = {
  id: string
  text: string
  at: string
  /** Who answered from the CRM; null when the answer was typed in the TikTok app. */
  authorName: string | null
  fromApp: boolean
}

export function storedTikTokReplies(value: unknown): StoredTikTokReply[] {
  if (!Array.isArray(value)) return []
  const out: StoredTikTokReply[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== "string" || typeof r.text !== "string" || typeof r.at !== "string") continue
    out.push({
      id: r.id,
      text: r.text,
      at: r.at,
      authorName: typeof r.authorName === "string" ? r.authorName : null,
      fromApp: r.fromApp === true,
    })
  }
  return out
}

/**
 * Adds an answer under the row's lock, once per TikTok id. The poller sees our own reply again on
 * its next pass — as the account's own reply under the comment — and must not double it.
 */
export async function appendTikTokReply(organizationId: string, rowId: string, reply: StoredTikTokReply): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "tiktok_video_comments" WHERE "id" = ${rowId} AND "organizationId" = ${organizationId} FOR UPDATE`
    const row = await tx.tikTokVideoComment.findFirst({ where: { id: rowId, organizationId }, select: { replies: true } })
    if (!row) return
    const replies = storedTikTokReplies(row.replies)
    if (replies.some((r) => r.id === reply.id)) return
    await tx.tikTokVideoComment.update({
      where: { id: rowId },
      data: { replies: [...replies, reply] as unknown as Prisma.InputJsonValue },
    })
  })
}

export type TikTokCommentReplyResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 502; error: string }

/**
 * Sends a person's answer under the video and records it. The account is read from the comment's own
 * row, so an answer always goes out as the account that owns the video — never as another connected
 * account of the same organization.
 */
export async function sendTikTokCommentReply(params: {
  organizationId: string
  rowId: string
  text: string
  authorName: string | null
}): Promise<TikTokCommentReplyResult> {
  const row = await prisma.tikTokVideoComment.findFirst({
    where: { id: params.rowId, organizationId: params.organizationId },
    select: {
      commentId: true, videoId: true, businessId: true, removedAt: true,
      socialAccount: { select: { id: true, accessToken: true, tokenExpiresAt: true, isActive: true } },
    },
  })
  if (!row) return { ok: false, status: 404, error: "Comment not found" }
  if (row.removedAt) return { ok: false, status: 409, error: "Comment is gone from TikTok" }
  if (!row.socialAccount || !row.socialAccount.isActive) {
    return { ok: false, status: 409, error: "TikTok account is not connected" }
  }

  const sent = await replyToVideoComment({
    account: row.socialAccount,
    businessId: row.businessId,
    videoId: row.videoId,
    commentId: row.commentId,
    text: params.text,
  })
  if (!sent.ok) {
    // TikTok's own refusal, kept verbatim: «not eligible», a deleted comment and a dead token are
    // different problems, and a generic «could not send» hides which one it is.
    return { ok: false, status: 502, error: sent.message }
  }

  await appendTikTokReply(params.organizationId, params.rowId, {
    // Without an id from TikTok the answer still has to show; the next poll recognises it by its id
    // when TikTok does give one, and otherwise by the account's own reply text.
    id: sent.data.commentId ?? `local:${randomUUID()}`,
    text: params.text,
    at: new Date().toISOString(),
    authorName: params.authorName,
    fromApp: false,
  })
  return { ok: true }
}
