export type PortalReplyDraft = {
  text: string
  attachmentIds: string[]
  clientRequestId: string
  updatedAt: string
}

export type PortalNewTicketDraft = {
  subject: string
  description: string
  category: string
  clientRequestId: string
  updatedAt: string
}

const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function portalReplyDraftKey(ticketId: string): string {
  return `portal:ticket-reply:${ticketId}`
}

export const PORTAL_NEW_TICKET_DRAFT_KEY = "portal:new-ticket"

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
}

function fresh(updatedAt: unknown, now: Date): updatedAt is string {
  if (typeof updatedAt !== "string") return false
  const timestamp = new Date(updatedAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= now.getTime() + 60_000 && now.getTime() - timestamp <= MAX_DRAFT_AGE_MS
}

export function parsePortalReplyDraft(raw: string | null, now = new Date()): PortalReplyDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PortalReplyDraft>
    if (typeof value.text !== "string" || !validRequestId(value.clientRequestId) || !fresh(value.updatedAt, now)) return null
    const attachmentIds = Array.isArray(value.attachmentIds)
      ? [...new Set(value.attachmentIds.filter((id): id is string => typeof id === "string" && Boolean(id)))].slice(0, 10)
      : []
    if (!value.text.trim() && attachmentIds.length === 0) return null
    return { text: value.text, attachmentIds, clientRequestId: value.clientRequestId, updatedAt: value.updatedAt }
  } catch {
    return null
  }
}

export function serializePortalReplyDraft(
  text: string,
  attachmentIds: string[],
  clientRequestId: string,
  updatedAt = new Date(),
): string {
  return JSON.stringify({ text, attachmentIds, clientRequestId, updatedAt: updatedAt.toISOString() } satisfies PortalReplyDraft)
}

export function parsePortalNewTicketDraft(raw: string | null, now = new Date()): PortalNewTicketDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PortalNewTicketDraft>
    if (
      typeof value.subject !== "string"
      || typeof value.description !== "string"
      || typeof value.category !== "string"
      || !validRequestId(value.clientRequestId)
      || !fresh(value.updatedAt, now)
    ) return null
    if (!value.subject.trim() && !value.description.trim()) return null
    return {
      subject: value.subject,
      description: value.description,
      category: value.category,
      clientRequestId: value.clientRequestId,
      updatedAt: value.updatedAt,
    }
  } catch {
    return null
  }
}

export function serializePortalNewTicketDraft(
  draft: Omit<PortalNewTicketDraft, "updatedAt">,
  updatedAt = new Date(),
): string {
  return JSON.stringify({ ...draft, updatedAt: updatedAt.toISOString() } satisfies PortalNewTicketDraft)
}
