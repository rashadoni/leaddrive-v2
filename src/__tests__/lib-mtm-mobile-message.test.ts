import { describe, expect, it } from "vitest"
import {
  directMessageThreadKey,
  parseMobileMessageCreate,
  parseMobileMessageReceipt,
} from "@/lib/mtm/mobile-message"

describe("mobile message contract", () => {
  const now = new Date("2026-07-16T10:00:00.000Z")

  it("builds one stable direct key regardless of sender order", () => {
    expect(directMessageThreadKey("agent-z", "agent-a")).toBe("agent-a:agent-z")
    expect(directMessageThreadKey("agent-a", "agent-z")).toBe("agent-a:agent-z")
  })

  it("accepts text or attachment messages and trims text", () => {
    expect(parseMobileMessageCreate({
      recipientAgentId: "manager-1",
      clientMessageId: "message-client-1",
      body: "  Hello  ",
      sentAt: now.toISOString(),
    }, now).input).toMatchObject({ body: "Hello", recipientAgentId: "manager-1" })

    expect(parseMobileMessageCreate({
      threadId: "thread-1",
      clientMessageId: "message-client-2",
      attachmentClientDocumentId: "document-client-1",
      sentAt: now.toISOString(),
    }, now).error).toBeNull()
  })

  it("rejects ambiguous destinations, empty content, and future timestamps", () => {
    const base = { clientMessageId: "message-client-1", body: "Hello", sentAt: now.toISOString() }
    expect(parseMobileMessageCreate({ ...base, threadId: "t", recipientAgentId: "a" }, now).error).toMatch(/not both/)
    expect(parseMobileMessageCreate({ ...base, threadId: "t", body: "   " }, now).error).toMatch(/body or attachment/)
    expect(parseMobileMessageCreate({ ...base, threadId: "t", sentAt: "2026-07-16T10:06:00.000Z" }, now).error).toMatch(/future/)
  })

  it("parses durable read and acknowledgement receipts", () => {
    expect(parseMobileMessageReceipt({
      messageId: "message-1",
      type: "ACKNOWLEDGED",
      clientReceiptId: "receipt-client-1",
      occurredAt: now.toISOString(),
    }, now).input).toMatchObject({ type: "ACKNOWLEDGED", messageId: "message-1" })
    expect(parseMobileMessageReceipt({
      messageId: "message-1",
      type: "DELIVERED",
      clientReceiptId: "receipt-client-1",
      occurredAt: now.toISOString(),
    }, now).error).toMatch(/READ or ACKNOWLEDGED/)
  })
})
