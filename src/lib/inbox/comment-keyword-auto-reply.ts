/**
 * Sends the keyword rule's message for one stored comment (lib/inbox/comment-keyword-rules says why
 * and under which limits). Called by the comment ingest, inside the channel's tenant scope, after
 * the comment row is written. Never throws: whatever goes wrong, the comment itself is already in
 * the inbox and a person can answer it.
 */
import { prisma } from "@/lib/prisma"
import { autoReplyOff } from "@/lib/inbox/conversation-auto-reply"
import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"
import { sanitizeLog } from "@/lib/sanitize"
import {
  COMMENT_KEYWORD_REPEAT_MS,
  loadCommentKeywordRules,
  matchCommentKeywordRule,
} from "@/lib/inbox/comment-keyword-rules"

export type CommentKeywordAutoReplyResult =
  | "no_rule"
  | "auto_reply_off"
  | "already_sent"
  | "sent"
  | "send_failed"
  | "error"

export async function runCommentKeywordAutoReply(params: {
  organizationId: string
  channelConfigId: string
  conversationId: string
  /** The person's Instagram-scoped id — the conversation's externalId. */
  recipientId: string
  inboundMessageId: string
  commentId: string
  /** The post or reel the comment is under (Instagram media id): a rule may be for that post only. */
  postId?: string | null
  text: string
  now?: number
  send?: typeof sendConversationReply
}): Promise<CommentKeywordAutoReplyResult> {
  const { organizationId, channelConfigId, conversationId } = params
  try {
    const rule = matchCommentKeywordRule(await loadCommentKeywordRules(organizationId), params.text, channelConfigId, params.postId ?? null)
    if (!rule) return "no_rule"
    if (await autoReplyOff(organizationId, conversationId)) return "auto_reply_off"
    const since = new Date((params.now ?? Date.now()) - COMMENT_KEYWORD_REPEAT_MS)
    const earlier = await prisma.channelMessage.findFirst({
      where: {
        organizationId,
        conversationId,
        direction: "outbound",
        status: { not: "failed" },
        createdAt: { gte: since },
        metadata: { path: ["commentKeyword", "ruleId"], equals: rule.id },
      },
      select: { id: true },
    })
    if (earlier) return "already_sent"
    const result = await (params.send ?? sendConversationReply)({
      organizationId,
      channel: "instagram",
      to: params.recipientId,
      body: rule.message,
      conversationId,
      channelConfigId,
      instagramComment: {
        commentId: params.commentId,
        inboundMessageId: params.inboundMessageId,
        mode: "direct",
        privateReplyAllowed: true,
      },
      extraMetadata: {
        authorType: "automation",
        commentKeyword: { ruleId: rule.id, keyword: rule.keyword },
      },
    })
    if (!result.success) {
      console.warn(`[ig-comments] keyword message not sent (org=${sanitizeLog(organizationId)}): ${sanitizeLog(result.error)}`)
      return "send_failed"
    }
    return "sent"
  } catch (e) {
    console.error("[ig-comments] keyword auto-reply error:", e instanceof Error ? sanitizeLog(e.message) : "unknown")
    return "error"
  }
}
