import { describe, expect, it } from "vitest"

import {
  DEFAULT_TICKET_CATEGORIES,
  inferTicketCategoryScope,
  normalizeAiTicketCategory,
  normalizeLegacyTicketCategory,
  normalizeTicketCategorySlug,
} from "@/lib/ticketing/categories"
import {
  buildTicketCategoryTree,
  buildTicketRequesterSnapshot,
  ticketCategoryScopeAllows,
} from "@/lib/ticketing/category-service"
import {
  createTicketClosureToken,
  hashTicketClosureToken,
  inferClosureRequestTarget,
  ticketClosureDueAt,
} from "@/lib/ticketing/closure-requests"

describe("ticketing category helpers", () => {
  it("normalizes free-form category names into stable slugs", () => {
    expect(normalizeTicketCategorySlug(" Feature Request ")).toBe("feature_request")
    expect(normalizeTicketCategorySlug("Billing / Payments")).toBe("billing_payments")
    expect(normalizeTicketCategorySlug("")).toBe("general")
    expect(normalizeTicketCategorySlug(null)).toBe("general")
  })

  it("keeps legacy API writers inside the existing category contract", () => {
    expect(normalizeLegacyTicketCategory("technical")).toBe("technical")
    expect(normalizeLegacyTicketCategory("Complaint")).toBe("complaint")
    expect(normalizeLegacyTicketCategory("custom")).toBe("general")
  })

  it("keeps AI categorization away from complaint until the UI uses dynamic categories", () => {
    expect(normalizeAiTicketCategory("billing")).toBe("billing")
    expect(normalizeAiTicketCategory("complaint")).toBe("general")
  })

  it("seeds the default category set used by the migration", () => {
    expect(DEFAULT_TICKET_CATEGORIES.map((c) => c.slug)).toEqual([
      "general",
      "technical",
      "billing",
      "feature_request",
      "complaint",
    ])
    expect(inferTicketCategoryScope("complaint")).toBe("complaint")
    expect(inferTicketCategoryScope("billing")).toBe("ticket")
  })

  it("builds a stable category tree while keeping orphaned children visible as roots", () => {
    const tree = buildTicketCategoryTree([
      { id: "billing", parentId: null, name: "Billing" },
      { id: "refunds", parentId: "billing", name: "Refunds" },
      { id: "orphan", parentId: "inactive-parent", name: "Orphan" },
    ])

    expect(tree.map((c) => c.id)).toEqual(["billing", "orphan"])
    expect(tree[0].children.map((c) => c.id)).toEqual(["refunds"])
    expect(tree[1].children).toEqual([])
  })

  it("matches category scopes for ticket and complaint forms", () => {
    expect(ticketCategoryScopeAllows("both", "ticket")).toBe(true)
    expect(ticketCategoryScopeAllows("ticket", "ticket")).toBe(true)
    expect(ticketCategoryScopeAllows("complaint", "ticket")).toBe(false)
    expect(ticketCategoryScopeAllows("complaint")).toBe(true)
  })

  it("builds requester snapshots from the best available display value", () => {
    expect(buildTicketRequesterSnapshot({ email: "client@example.com" })).toEqual({
      requesterName: "client@example.com",
      requesterEmail: "client@example.com",
      requesterPhone: null,
      requesterExternalId: null,
      requesterMeta: undefined,
    })
  })

  it("creates hash-only closure confirmation tokens", () => {
    const first = createTicketClosureToken()
    const second = createTicketClosureToken()

    expect(first.token).not.toBe(first.tokenHash)
    expect(first.token).not.toBe(second.token)
    expect(hashTicketClosureToken(first.token)).toBe(first.tokenHash)
  })

  it("sets closure confirmation deadline to seven days", () => {
    const start = new Date("2026-07-03T00:00:00.000Z")
    expect(ticketClosureDueAt(start).toISOString()).toBe("2026-07-10T00:00:00.000Z")
  })

  it("targets WhatsApp closure requests from requester phone or source metadata", () => {
    expect(inferClosureRequestTarget({
      id: "t1",
      organizationId: "org",
      ticketNumber: "TK-1",
      subject: "Resolved issue",
      status: "resolved",
      source: "whatsapp",
      sourceMeta: { phone: "994501111111" },
      requesterEmail: null,
      requesterPhone: null,
      requesterExternalId: null,
      contactId: null,
    })).toEqual({ channel: "whatsapp", recipient: "994501111111" })
  })
})
