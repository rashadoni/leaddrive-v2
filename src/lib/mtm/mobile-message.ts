export type MobileMessageCreateInput = {
  threadId: string | null
  recipientAgentId: string | null
  clientMessageId: string
  body: string | null
  attachmentClientDocumentId: string | null
  sentAt: Date
}

export type MobileMessageReceiptInput = {
  messageId: string
  type: "READ" | "ACKNOWLEDGED"
  clientReceiptId: string
  occurredAt: Date
}

const RECEIPT_TYPES = new Set<MobileMessageReceiptInput["type"]>(["READ", "ACKNOWLEDGED"])
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

function validId(value: unknown, minimum = 1): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= 128
}

function eventDate(value: unknown, now: Date): Date | null {
  const parsed = typeof value === "string" || typeof value === "number"
    ? new Date(value)
    : new Date(Number.NaN)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) return null
  return parsed
}

export function directMessageThreadKey(firstAgentId: string, secondAgentId: string): string {
  return [firstAgentId, secondAgentId].sort().join(":")
}

export function parseMobileMessageCreate(
  data: unknown,
  now = new Date(),
): { input: MobileMessageCreateInput | null; error: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { input: null, error: "Message data must be an object" }
  }
  const value = data as Record<string, unknown>
  const threadId = validId(value.threadId) ? value.threadId.trim() : null
  const recipientAgentId = validId(value.recipientAgentId) ? value.recipientAgentId.trim() : null
  if (!threadId && !recipientAgentId) {
    return { input: null, error: "threadId or recipientAgentId is required" }
  }
  if (threadId && recipientAgentId) {
    return { input: null, error: "Provide threadId or recipientAgentId, not both" }
  }
  if (!validId(value.clientMessageId, 8)) {
    return { input: null, error: "clientMessageId must be 8..128 characters" }
  }
  const body = typeof value.body === "string" ? value.body.trim() : ""
  if (body.length > 4000) {
    return { input: null, error: "Message body must be 4000 characters or fewer" }
  }
  const attachmentClientDocumentId = validId(value.attachmentClientDocumentId, 8)
    ? value.attachmentClientDocumentId.trim()
    : null
  if (!body && !attachmentClientDocumentId) {
    return { input: null, error: "Message body or attachment is required" }
  }
  const sentAt = eventDate(value.sentAt, now)
  if (!sentAt) {
    return { input: null, error: "Valid sentAt is required and cannot be in the future" }
  }

  return {
    input: {
      threadId,
      recipientAgentId,
      clientMessageId: value.clientMessageId.trim(),
      body: body || null,
      attachmentClientDocumentId,
      sentAt,
    },
    error: null,
  }
}

export function parseMobileMessageReceipt(
  data: unknown,
  now = new Date(),
): { input: MobileMessageReceiptInput | null; error: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { input: null, error: "Message receipt data must be an object" }
  }
  const value = data as Record<string, unknown>
  if (!validId(value.messageId)) {
    return { input: null, error: "messageId is required" }
  }
  if (typeof value.type !== "string" || !RECEIPT_TYPES.has(value.type as MobileMessageReceiptInput["type"])) {
    return { input: null, error: "Receipt type must be READ or ACKNOWLEDGED" }
  }
  if (!validId(value.clientReceiptId, 8)) {
    return { input: null, error: "clientReceiptId must be 8..128 characters" }
  }
  const occurredAt = eventDate(value.occurredAt, now)
  if (!occurredAt) {
    return { input: null, error: "Valid occurredAt is required and cannot be in the future" }
  }

  return {
    input: {
      messageId: value.messageId.trim(),
      type: value.type as MobileMessageReceiptInput["type"],
      clientReceiptId: value.clientReceiptId.trim(),
      occurredAt,
    },
    error: null,
  }
}
