import { describe, expect, it } from "vitest"

import { parseTicketReplyDraft, serializeTicketReplyDraft, ticketDraftStorageKey } from "@/lib/ticketing/ticket-draft"

describe("ticket reply drafts", () => {
  it("scopes drafts to both tenant and ticket", () => {
    expect(ticketDraftStorageKey("org-1", "ticket-1")).toBe("tickets:draft:org-1:ticket-1")
    expect(ticketDraftStorageKey("org-2", "ticket-1")).not.toBe(ticketDraftStorageKey("org-1", "ticket-1"))
  })

  it("round-trips public and internal drafts", () => {
    const updatedAt = new Date("2026-09-04T10:00:00.000Z")
    expect(parseTicketReplyDraft(serializeTicketReplyDraft("Customer reply", false, ["file-1"], "request-1", updatedAt))).toEqual({
      text: "Customer reply",
      isInternal: false,
      attachmentIds: ["file-1"],
      clientRequestId: "request-1",
      updatedAt: updatedAt.toISOString(),
    })
    expect(parseTicketReplyDraft(serializeTicketReplyDraft("Private note", true, [], "request-2", updatedAt))?.isInternal).toBe(true)
  })

  it("upgrades legacy text-only drafts without losing their content", () => {
    const draft = parseTicketReplyDraft(JSON.stringify({ text: "Legacy", isInternal: false, updatedAt: "2026-09-04T10:00:00.000Z" }))
    expect(draft).toMatchObject({ text: "Legacy", attachmentIds: [] })
    expect(draft?.clientRequestId).toBeTruthy()
  })

  it.each([null, "", "not json", "{}", JSON.stringify({ text: "   ", isInternal: false, updatedAt: "now" })])(
    "fails closed for unusable stored data: %s",
    (raw) => expect(parseTicketReplyDraft(raw)).toBeNull(),
  )
})
