/**
 * Single source of truth for SocialMention conversion status values.
 *
 * The convert routes SET these statuses when a mention becomes a lead/ticket/
 * task; `clearDeletedMentionRefs` (mention-refs.ts) REVERTS them when that
 * entity is deleted. Keeping both sides on this one const stops them drifting
 * apart — a status string changed in one place but not the other would
 * silently break the revert (the WHERE would stop matching).
 */

/** SocialMention back-reference column → the status its conversion writes. */
export type MentionRef = "leadId" | "ticketId" | "taskId"

export const CONVERTED_STATUS: Record<MentionRef, string> = {
  leadId: "converted_to_lead",
  ticketId: "converted_to_ticket",
  taskId: "converted_to_task",
}
