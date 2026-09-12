export type TicketReplyDraft = {
  text: string
  isInternal: boolean
  attachmentIds: string[]
  clientRequestId: string
  updatedAt: string
}

export function ticketDraftStorageKey(organizationId: string, ticketId: string): string {
  return `tickets:draft:${organizationId}:${ticketId}`
}

export function parseTicketReplyDraft(raw: string | null): TicketReplyDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<TicketReplyDraft>
    if (typeof value.text !== "string") return null
    if (typeof value.isInternal !== "boolean" || typeof value.updatedAt !== "string") return null
    const attachmentIds = Array.isArray(value.attachmentIds)
      ? value.attachmentIds.filter((id): id is string => typeof id === "string" && Boolean(id))
      : []
    if (!value.text.trim() && attachmentIds.length === 0) return null
    const clientRequestId = typeof value.clientRequestId === "string" && value.clientRequestId
      ? value.clientRequestId
      : crypto.randomUUID()
    return { text: value.text, isInternal: value.isInternal, attachmentIds, clientRequestId, updatedAt: value.updatedAt }
  } catch {
    return null
  }
}

export function serializeTicketReplyDraft(
  text: string,
  isInternal: boolean,
  attachmentIds: string[] = [],
  clientRequestId = crypto.randomUUID(),
  updatedAt = new Date(),
): string {
  return JSON.stringify({ text, isInternal, attachmentIds, clientRequestId, updatedAt: updatedAt.toISOString() } satisfies TicketReplyDraft)
}
