import { describe, expect, it } from "vitest"
import {
  parsePortalNewTicketDraft,
  parsePortalReplyDraft,
  portalReplyDraftKey,
  serializePortalNewTicketDraft,
  serializePortalReplyDraft,
} from "@/lib/ticketing/portal-ticket-draft"

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000"
const NOW = new Date("2026-09-05T12:00:00.000Z")

describe("portal ticket drafts", () => {
  it("round-trips a new-ticket draft and keeps its retry identity", () => {
    const encoded = serializePortalNewTicketDraft({
      subject: "Login issue",
      description: "Cannot sign in",
      category: "technical",
      clientRequestId: REQUEST_ID,
    }, NOW)

    expect(parsePortalNewTicketDraft(encoded, NOW)).toEqual({
      subject: "Login issue",
      description: "Cannot sign in",
      category: "technical",
      clientRequestId: REQUEST_ID,
      updatedAt: NOW.toISOString(),
    })
  })

  it("deduplicates and caps recoverable reply attachments", () => {
    const ids = Array.from({ length: 14 }, (_, index) => "file-" + index)
    const encoded = serializePortalReplyDraft("More detail", [ids[0], ...ids, ids[0]], REQUEST_ID, NOW)
    const draft = parsePortalReplyDraft(encoded, NOW)

    expect(draft?.attachmentIds).toHaveLength(10)
    expect(new Set(draft?.attachmentIds).size).toBe(10)
    expect(draft?.clientRequestId).toBe(REQUEST_ID)
  })

  it("rejects expired, future, malformed and empty drafts", () => {
    const stale = serializePortalReplyDraft("stale", [], REQUEST_ID, new Date("2026-08-20T00:00:00.000Z"))
    const future = serializePortalReplyDraft("future", [], REQUEST_ID, new Date("2026-09-06T00:00:00.000Z"))

    expect(parsePortalReplyDraft(stale, NOW)).toBeNull()
    expect(parsePortalReplyDraft(future, NOW)).toBeNull()
    expect(parsePortalReplyDraft("{", NOW)).toBeNull()
    expect(parsePortalReplyDraft(JSON.stringify({
      text: "",
      attachmentIds: [],
      clientRequestId: REQUEST_ID,
      updatedAt: NOW.toISOString(),
    }), NOW)).toBeNull()
  })

  it("rejects a non-UUID retry identity and scopes reply keys by ticket", () => {
    expect(parsePortalReplyDraft(JSON.stringify({
      text: "hello",
      attachmentIds: [],
      clientRequestId: "predictable",
      updatedAt: NOW.toISOString(),
    }), NOW)).toBeNull()
    expect(portalReplyDraftKey("ticket-a")).not.toBe(portalReplyDraftKey("ticket-b"))
  })
})
