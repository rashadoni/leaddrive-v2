/**
 * «Ответственный» in the inbox's filters (2026-11-16): every conversation one person holds, so a
 * manager who leaves — or goes on holiday — can be handed over with the bulk «assign» that already
 * exists. Until now the list knew «mine», «unassigned» and «others», and «others» is everybody at
 * once: the conversations of the one who left could not be told from anyone else's.
 *
 * Pure pieces the screen reads — no database here, so the page can import them. The server half
 * (who holds conversations, and a person's conversations older than the list's window) is
 * `assignee-conversations.ts`.
 */

/**
 * A conversation with one of these statuses is closed (`SocialConversation.status`: open, resolved,
 * archived). The screen's own split (`convStatusTab`) reads the same two words: everything else is
 * open, a snoozed conversation included — it comes back. By the status, not by `closedAt`: that
 * stamp is set at closing and stays when the conversation is reopened.
 */
export const CLOSED_CONVERSATION_STATUSES = ["resolved", "archived"] as const

/** Somebody conversations are assigned to, as the filter lists them. */
export type InboxAssigneeHolder = {
  id: string
  /** Null for a deleted account and for an id that is no user of the organization at all. */
  name: string | null
  /** Works here and can sign in. */
  active: boolean
  /** The account was deleted (anonymized) — its row carries a placeholder, not a name. */
  removed: boolean
  /**
   * How many open conversations and website chats the person holds that the caller may see — the
   * number «hand over all» (`transferOpenConversations`) moves, counted by the same condition.
   */
  open: number
}

/**
 * Whether a thread belongs in «conversations of this person».
 *
 * A customer's thread is all his channels, and each channel's conversation has its own assignee;
 * the thread shows its primary one's. A thread whose Instagram went to a colleague still holds a
 * WhatsApp conversation of the person asked about, and that conversation is exactly what has to be
 * found — so any conversation of the thread counts, not only the one the row shows.
 */
export function convMatchesAssignee(
  c: { assignedTo?: string | null; threadConversations?: ReadonlyArray<{ assignedTo?: string | null }> | null },
  assigneeId: string | null,
): boolean {
  if (!assigneeId) return true
  if (c.assignedTo === assigneeId) return true
  return (c.threadConversations ?? []).some((conversation) => conversation.assignedTo === assigneeId)
}

export type InboxAssigneeOption = {
  id: string
  name: string | null
  /** "active" — can be given work; "inactive" — switched off; "removed" — deleted or unknown. */
  state: "active" | "inactive" | "removed"
}

/**
 * The filter's list: everyone who can be given a conversation, then the people who cannot any more
 * but still hold some — switched-off accounts by name, deleted ones last. The second group is the
 * reason the filter exists, and the assign list never shows it.
 */
export function inboxAssigneeOptions(
  agents: ReadonlyArray<{ id: string; name: string | null }>,
  holders: ReadonlyArray<Pick<InboxAssigneeHolder, "id" | "name" | "active" | "removed">>,
): InboxAssigneeOption[] {
  const byName = (a: { name: string | null }, b: { name: string | null }) =>
    (a.name ?? "").localeCompare(b.name ?? "")
  const active: InboxAssigneeOption[] = agents.map((agent) => ({ id: agent.id, name: agent.name, state: "active" }))
  const known = new Set(active.map((option) => option.id))
  const former = holders.filter((holder) => !known.has(holder.id))
  const inactive: InboxAssigneeOption[] = former
    .filter((holder) => !holder.removed && holder.name)
    // An active holder the assign list left out (a reviewer is never an assignee) is still a name.
    .map((holder) => ({ id: holder.id, name: holder.name, state: holder.active ? "active" : "inactive" }))
  const removed: InboxAssigneeOption[] = former
    .filter((holder) => holder.removed || !holder.name)
    .map((holder) => ({ id: holder.id, name: null, state: "removed" }))
  return [...active.sort(byName), ...inactive.sort(byName), ...removed.sort((a, b) => a.id.localeCompare(b.id))]
}

/**
 * Who everything a person holds can be handed to at once: anyone who can be given a conversation,
 * except the person herself. Never «nobody» — an open conversation without an owner is what the AI
 * auto-reply takes (lib/user-work-handover).
 */
export function inboxTransferTargets<T extends { id: string }>(agents: ReadonlyArray<T>, fromId: string | null): T[] {
  return fromId ? agents.filter((agent) => agent.id !== fromId) : []
}
