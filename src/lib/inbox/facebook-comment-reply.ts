/**
 * Answering a stored Facebook Page comment, by a person from «Комментарии» or by a keyword rule.
 *
 * Public goes under the post. Private is the comment's one private reply: the slot is claimed in the
 * database BEFORE Meta is asked, so two presses (or a person and a rule) cannot both spend it, and a
 * refusal gives it back. Meta's answer names the person's PSID, which is what finally ties the comment
 * to a Messenger conversation; the reply is written there as an ordinary outbound row, so the thread
 * shows it and the `message_echoes` webhook recognises it as ours.
 *
 * Must run inside the organization's tenant scope. Never throws on a Meta failure.
 */
import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { upsertSocialConversation } from "@/lib/facebook"
import { sendMetaCommentPrivateReply } from "@/lib/social/meta-dm-attachment"
import { FACEBOOK_PRIVATE_REPLY_DAYS, replyToFacebookComment } from "@/lib/social/facebook-comments"

export type StoredFacebookReply = {
  id: string
  text: string
  mode: "public" | "private"
  at: string
  authorName: string | null
  keyword: string | null
  ruleId: string | null
  fromApp: boolean
}

export function storedFacebookReplies(value: unknown): StoredFacebookReply[] {
  if (!Array.isArray(value)) return []
  const out: StoredFacebookReply[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== "string" || typeof r.text !== "string" || typeof r.at !== "string") continue
    out.push({
      id: r.id,
      text: r.text,
      mode: r.mode === "private" ? "private" : "public",
      at: r.at,
      authorName: typeof r.authorName === "string" ? r.authorName : null,
      keyword: typeof r.keyword === "string" ? r.keyword : null,
      ruleId: typeof r.ruleId === "string" ? r.ruleId : null,
      fromApp: r.fromApp === true,
    })
  }
  return out
}

export function facebookPrivateReplyAvailable(row: { commentedAt: Date; privateReplyAt: Date | null; fromAvailable?: boolean }, now = Date.now()): boolean {
  return !row.privateReplyAt && now - row.commentedAt.getTime() < FACEBOOK_PRIVATE_REPLY_DAYS * 24 * 60 * 60 * 1000
}

/** Adds an answer under the row's lock, once per Meta id: the webhook echoes our own public replies. */
export async function appendFacebookReply(organizationId: string, rowId: string, reply: StoredFacebookReply, extra: { conversationId?: string } = {}): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "facebook_page_comments" WHERE "id" = ${rowId} AND "organizationId" = ${organizationId} FOR UPDATE`
    const row = await tx.facebookPageComment.findFirst({ where: { id: rowId, organizationId }, select: { replies: true } })
    if (!row) return
    const replies = storedFacebookReplies(row.replies)
    if (replies.some((r) => r.id === reply.id)) return
    await tx.facebookPageComment.update({
      where: { id: rowId },
      data: { replies: [...replies, reply] as unknown as Prisma.InputJsonValue, ...extra },
    })
  })
}

export type FacebookCommentReplyResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string }

export async function sendFacebookCommentReply(params: {
  organizationId: string
  rowId: string
  mode: "public" | "private"
  text: string
  authorName: string | null
  authorUserId?: string | null
  rule?: { id: string; keyword: string } | null
  now?: number
}): Promise<FacebookCommentReplyResult> {
  const { organizationId, rowId, mode, authorName, rule } = params
  const text = params.text.trim()
  const now = params.now ?? Date.now()
  if (!text) return { ok: false, status: 400, error: "Message text required" }
  const row = await prisma.facebookPageComment.findFirst({
    where: { id: rowId, organizationId, removedAt: null },
    select: { id: true, commentId: true, channelConfigId: true, commentedAt: true, privateReplyAt: true, fromName: true },
  })
  if (!row?.channelConfigId) return { ok: false, status: 404, error: "Comment not found" }
  const channel = await prisma.channelConfig.findFirst({
    where: { id: row.channelConfigId, organizationId, channelType: "facebook", isActive: true },
    select: { id: true, apiKey: true },
  })
  if (!channel?.apiKey) return { ok: false, status: 409, error: "facebook_not_connected" }

  if (mode === "public") {
    const sent = await replyToFacebookComment({ commentId: row.commentId, text, token: channel.apiKey })
    if (!sent.ok) return { ok: false, status: 502, error: sent.error ?? "send error" }
    await appendFacebookReply(organizationId, row.id, {
      id: sent.replyId ?? randomUUID(), text, mode, at: new Date(now).toISOString(),
      authorName, keyword: rule?.keyword ?? null, ruleId: rule?.id ?? null, fromApp: false,
    })
    return { ok: true }
  }

  if (!facebookPrivateReplyAvailable(row, now)) return { ok: false, status: 409, error: "private_reply_used" }
  const at = new Date(now)
  const claimed = await prisma.facebookPageComment.updateMany({
    where: { id: row.id, organizationId, privateReplyAt: null },
    data: { privateReplyAt: at },
  })
  if (claimed.count !== 1) return { ok: false, status: 409, error: "private_reply_used" }
  const sent = await sendMetaCommentPrivateReply({ igLogin: false, commentId: row.commentId, token: channel.apiKey, text })
  if (!sent.ok) {
    await prisma.facebookPageComment.updateMany({ where: { id: row.id, organizationId, privateReplyAt: at }, data: { privateReplyAt: null } })
    return { ok: false, status: 502, error: sent.error ?? "send error" }
  }

  let conversationId: string | undefined
  if (sent.recipientId) {
    // The comment is answered whatever happens here; a thread that failed to appear is only a thread.
    try {
      const conv = await upsertSocialConversation(organizationId, "facebook", sent.recipientId, row.fromName || sent.recipientId, text, channel.id)
      conversationId = conv.id
      await prisma.channelMessage.create({
        data: {
          organizationId,
          channelConfigId: channel.id,
          channelType: "facebook",
          direction: "outbound",
          from: "page",
          to: sent.recipientId,
          body: text,
          status: "sent",
          conversationId: conv.id,
          ...(sent.messageId ? { externalId: sent.messageId } : {}),
          metadata: {
            sentVia: "leaddrive_inbox",
            authorType: rule ? "automation" : "operator",
            ...(params.authorUserId ? { authorUserId: params.authorUserId } : {}),
            ...(authorName ? { authorName } : {}),
            ...(sent.messageId ? { metaMessageIds: [sent.messageId] } : {}),
            fbCommentReply: { commentId: row.commentId, mode: "private" },
          },
        },
      })
    } catch (e) {
      console.error("[fb-comments] private reply row failed:", e instanceof Error ? e.message : "unknown")
    }
  }
  await appendFacebookReply(organizationId, row.id, {
    id: sent.messageId ?? randomUUID(), text, mode, at: at.toISOString(),
    authorName, keyword: rule?.keyword ?? null, ruleId: rule?.id ?? null, fromApp: false,
  }, conversationId ? { conversationId } : {})
  return { ok: true }
}
