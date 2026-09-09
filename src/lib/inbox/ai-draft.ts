/**
 * A2 — pending AI reply drafts on a conversation.
 *
 * Storage: SocialConversation.metadata.aiDraft (ONE pending draft per conversation, newest wins —
 * an operator reviews the reply to the LATEST inbound; a stale draft to an older message is noise).
 * Deliberately NOT a ChannelMessage row: the inbox thread renders every ChannelMessage as
 * sent/received, so a draft row would read as a delivered reply. Conversation metadata is already
 * returned by the conversation GET, so the review UI slice can render it with no API change.
 *
 * Lifecycle: created by the AI reply gate (draft decision) → operator sends (possibly edited) or
 * discards via /api/v1/inbox/conversations/[id]/ai-draft → metadata.aiDraft cleared.
 */
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import type { AiQualityMetadata } from "@/lib/ai/response-scorer"
import type { AiDraftReason } from "@/lib/inbox/ai-reply-gate"

export type ConversationAiDraft = {
  text: string
  reason: AiDraftReason
  quality?: AiQualityMetadata
  /** Channel the reply was generated for (platform / channelType). */
  channel: string
  /** Send target captured at generation time (externalId / phone / chat id). */
  to: string
  /** AiChatSession id — the assistant turn is persisted there only after a confirmed send. */
  sessionId?: string
  /** A5 — the reply's AiInteractionLog id (debug view lookup on the sent message). */
  logId?: string
  createdAt: string
  /** The customer message the draft answers (preview for the review UI). */
  inboundPreview?: string
}

/** Read the pending draft off a conversation metadata blob (null when none). */
export function readConversationAiDraft(metadata: unknown): ConversationAiDraft | null {
  const m = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>
  const d = m.aiDraft
  if (!d || typeof d !== "object") return null
  const draft = d as Record<string, unknown>
  if (typeof draft.text !== "string" || !draft.text.trim()) return null
  return draft as unknown as ConversationAiDraft
}

/**
 * Persist the pending draft (metadata-merge, org-scoped) + notify the assignee — or the inbox
 * team when unassigned — that a reply is waiting for review. Best-effort; never throws.
 */
export async function saveConversationAiDraft(opts: {
  organizationId: string
  conversationId: string
  draft: ConversationAiDraft
}): Promise<boolean> {
  const { organizationId, conversationId, draft } = opts
  try {
    const conv = await prisma.socialConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { metadata: true, assignedTo: true, platform: true },
    })
    if (!conv) return false
    const current = (conv.metadata && typeof conv.metadata === "object" ? conv.metadata : {}) as Record<string, unknown>
    await prisma.socialConversation.updateMany({
      where: { id: conversationId, organizationId },
      data: { metadata: { ...current, aiDraft: { ...draft } } },
    })

    // Notify the reviewer(s) — an invisible draft is a dead draft.
    try {
      const recipients: string[] = conv.assignedTo
        ? [conv.assignedTo]
        : (
            await prisma.user.findMany({
              where: { organizationId, role: { in: ["admin", "manager", "support"] }, isActive: true },
              select: { id: true },
            })
          ).map((u: { id: string }) => u.id)
      await Promise.all(
        recipients.map((userId) =>
          createNotification({
            organizationId,
            userId,
            type: "info",
            title: "AI подготовил черновик ответа",
            message: `Черновик AI-ответа (${draft.channel}) ждёт проверки — откройте диалог, чтобы отправить или изменить`,
            entityType: "inbox_message",
            entityId: conversationId,
            kind: "inbox.message",
            push: true,
          }).catch(() => {}),
        ),
      )
    } catch {
      /* notification failure must not undo the saved draft */
    }
    return true
  } catch (e) {
    console.error("[ai-draft] save failed:", e instanceof Error ? e.message : e)
    return false
  }
}

/** Clear the pending draft (after operator send/discard). Merge-safe, org-scoped. */
export async function clearConversationAiDraft(opts: {
  organizationId: string
  conversationId: string
  /** Clear only the draft the caller actually read, never a newer replacement. */
  expectedCreatedAt?: string
  /** When supplied, require ownership of the operation lease. */
  claimToken?: string
}): Promise<boolean> {
  try {
    const conv = await prisma.socialConversation.findFirst({
      where: { id: opts.conversationId, organizationId: opts.organizationId },
      select: { metadata: true },
    })
    if (!conv) return false
    const current = {
      ...((conv.metadata && typeof conv.metadata === "object" ? conv.metadata : {}) as Record<string, unknown>),
    }
    const currentDraft = readConversationAiDraft(current)
    if (!currentDraft) return true
    if (opts.expectedCreatedAt && currentDraft.createdAt !== opts.expectedCreatedAt) return false
    delete current.aiDraft
    const cleared = await prisma.socialConversation.updateMany({
      where: {
        id: opts.conversationId,
        organizationId: opts.organizationId,
        ...(opts.claimToken ? { aiReplyClaimToken: opts.claimToken } : {}),
      },
      data: { metadata: current },
    })
    return cleared.count === 1
  } catch (e) {
    console.error("[ai-draft] clear failed:", e instanceof Error ? e.message : e)
    return false
  }
}
