"use client"

/**
 * The open customer's feed on the inbox screen (owner, 2026-11-15, «Bütün kanallar bir lentdə»):
 *  - his whole history, read when he is opened (GET /api/v1/inbox/thread), merged with what the list
 *    already holds — the list is only the organization's newest messages;
 *  - every stored conversation of his, which assign/close/the trash act on together;
 *  - where a reply goes: one of his conversations, by default the one he wrote in last.
 */

import { useEffect, useMemo, useState } from "react"
import type { InboxCallLog, InboxConversation, InboxMessage } from "@/lib/inbox-channels"
import { normalizeInboxConversations } from "@/lib/inbox-channels"
import {
  defaultReplyTarget,
  replyTargetsOf,
  summarizeThreadConversations,
  threadConversationIds,
  type ReplyTarget,
} from "@/lib/inbox/thread-conversations"

type History = { key: string; messages: InboxMessage[]; callLogs: InboxCallLog[] }

function historyQuery(convo: InboxConversation | null): string | null {
  if (!convo || convo.webChatSessionId) return null
  if (convo.contactId) return `contactId=${encodeURIComponent(convo.contactId)}`
  if (convo.socialConversationId) return `conversationId=${encodeURIComponent(convo.socialConversationId)}`
  return null
}

export function useCustomerThread(
  convo: InboxConversation | null,
  headers: Record<string, string>,
  /** Changes when the list is re-read, so a new message on any channel re-reads the history. */
  refreshKey?: unknown,
) {
  const query = historyQuery(convo)
  const [history, setHistory] = useState<History | null>(null)

  useEffect(() => {
    // No query (web chat): `current` below reads nothing, whatever an earlier customer left here.
    if (!query) return
    let cancelled = false
    fetch(`/api/v1/inbox/thread?${query}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.success) return
        // The history comes in the list's message shape; the list's normalizer guards it the same way.
        const [normalized] = normalizeInboxConversations([{ contactName: "", messages: body.data?.messages ?? [] }])
        setHistory({
          key: query,
          messages: normalized?.messages ?? [],
          callLogs: Array.isArray(body.data?.callLogs) ? body.data.callLogs : [],
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [query, headers, refreshKey])

  const current = history && history.key === query ? history : null

  /** The list's messages and the history together, each once, newest first like the list. */
  const messages = useMemo(() => {
    const own = convo?.messages ?? []
    if (!current) return own
    const byId = new Map<string, InboxMessage>()
    for (const message of current.messages) byId.set(message.id, message)
    for (const message of own) byId.set(message.id, message)
    return [...byId.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [convo?.messages, current])

  const callLogs = useMemo(() => current?.callLogs ?? [], [current])

  /**
   * His conversations, one per channel: the server's list, plus any the history found (an Instagram
   * conversation of his whose messages were older than the list). State fields come from the server.
   */
  const conversations = useMemo(() => {
    const listed = convo?.threadConversations ?? []
    const seen = new Set(listed.map((c) => c.key))
    const extra = summarizeThreadConversations(messages).filter((c) => !seen.has(c.key))
    return [...listed, ...extra]
  }, [convo?.threadConversations, messages])

  const conversationIds = useMemo(
    () => (convo ? threadConversationIds({ socialConversationId: convo.socialConversationId, threadConversations: conversations }) : []),
    [convo, conversations],
  )

  const replyTargets = useMemo<ReplyTarget[]>(
    () => (convo ? replyTargetsOf({ ...convo, threadConversations: convo.threadConversations ? conversations : undefined }) : []),
    [convo, conversations],
  )

  // A newly opened customer answers where he wrote last; the manager's own pick holds while he stays —
  // so the pick remembers whose it was, and another customer's pick is simply not his.
  const threadIdentity = convo ? (convo.webChatSessionId || convo.threadKey || convo.socialConversationId || convo.contactId || "") : ""
  const [pick, setPick] = useState<{ thread: string; key: string } | null>(null)
  const pickedKey = pick && pick.thread === threadIdentity ? pick.key : null
  const replyTarget = replyTargets.find((t) => t.key === pickedKey)
    ?? defaultReplyTarget(replyTargets, convo?.lastChannel)
  const setReplyTargetKey = (key: string) => setPick({ thread: threadIdentity, key })

  return { messages, callLogs, conversations, conversationIds, replyTargets, replyTarget, setReplyTargetKey }
}
