/**
 * The product's inbound WhatsApp ticket path with the guided demo's mark
 * (src/lib/inbox/whatsapp-inbound-ticket.ts, `demo`): the demo's own ticket
 * is found by the id its thread keeps — never by the phone — reopened through
 * the product's reopen when it was resolved, and created marked «demo», inside
 * the same per-phone lock as every other message. Without the mark nothing
 * changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findTicket: vi.fn(),
  createComment: vi.fn(),
  createTicket: vi.fn(),
  updateTicket: vi.fn(),
  reopen: vi.fn(),
  lock: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    // The per-phone lock: its transaction holds only the advisory lock.
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ $executeRaw: mocks.lock }),
    ticket: { findFirst: mocks.findTicket, updateMany: mocks.updateTicket },
    ticketComment: { create: mocks.createComment },
  },
}))
vi.mock("@/lib/ticket-factory", () => ({ createTicketWithAssignment: mocks.createTicket }))
vi.mock("@/lib/ticket-reopen", () => ({ reopenTicketForCustomerReply: mocks.reopen }))
vi.mock("@/lib/ticketing/customer-locale", () => ({ loadOrganizationLocale: async () => "az" }))

import { DEMO_WHATSAPP_TICKET_TAGS, ensureInboundWhatsAppTicket } from "@/lib/inbox/whatsapp-inbound-ticket"

const BASE = {
  organizationId: "org-sales",
  waPhone: "994501234567",
  senderName: "Nigar",
  messageText: "Kassa çeki çap etmir",
  contactId: null,
  leadId: "lead-1",
  companyId: null,
  channelMessageId: "cm-1",
  waMessageId: "wamid.1",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findTicket.mockResolvedValue(null)
  mocks.createComment.mockResolvedValue({})
  mocks.createTicket.mockResolvedValue({ id: "ticket-new", ticketNumber: "WA-0031" })
  mocks.reopen.mockResolvedValue({ reopened: true, ticketId: "ticket-1", ticketNumber: "WA-0030" })
  mocks.updateTicket.mockResolvedValue({ count: 1 })
  mocks.lock.mockResolvedValue(0)
})

describe("the demo's ticket", () => {
  it("opens with the product's prefix and path, marked as the demo's — not appended to the phone's other open ticket", async () => {
    const result = await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: null } })
    expect(result).toMatchObject({ ticketId: "ticket-new", ticketNumber: "WA-0031", created: true, reopened: false })
    // The same per-phone lock as the product's own messages.
    expect(mocks.lock).toHaveBeenCalledTimes(1)
    // No lookup by the phone: an older ticket of that phone is not the demo's.
    expect(mocks.findTicket).not.toHaveBeenCalled()
    const created = mocks.createTicket.mock.calls[0][0]
    expect(created).toMatchObject({ ticketNumberPrefix: "WA", source: "whatsapp", initialStatus: "open" })
    expect(created.tags).toEqual(expect.arrayContaining(["whatsapp", ...DEMO_WHATSAPP_TICKET_TAGS]))
    expect(created.sourceMeta).toMatchObject({ phone: "994501234567", demoGrantId: "grant-1", reasons: ["inbound_message", "demo_whatsapp"] })
  })

  it("files a later message on the ticket the thread holds", async () => {
    mocks.findTicket.mockResolvedValue({ id: "ticket-1", ticketNumber: "WA-0030", status: "in_progress" })
    const result = await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: "ticket-1" } })
    expect(mocks.findTicket.mock.calls[0][0].where).toEqual({ id: "ticket-1", organizationId: "org-sales" })
    expect(mocks.createComment.mock.calls[0][0].data).toEqual({ ticketId: "ticket-1", comment: "[Клиент (WhatsApp)] Kassa çeki çap etmir", isInternal: false })
    expect(result).toMatchObject({ ticketId: "ticket-1", created: false, commentAdded: true })
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it("moves its waiting ticket back to open when the customer answers", async () => {
    mocks.findTicket.mockResolvedValue({ id: "ticket-1", ticketNumber: "WA-0030", subject: "Kassa", status: "waiting" })
    await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: "ticket-1" } })
    expect(mocks.updateTicket.mock.calls[0][0]).toEqual({ where: { id: "ticket-1", organizationId: "org-sales", status: "waiting" }, data: { status: "open" } })
  })

  it("reopens its resolved ticket through the product's reopen, which also cancels its closure link", async () => {
    mocks.findTicket.mockResolvedValue({ id: "ticket-1", ticketNumber: "WA-0030", status: "resolved" })
    const result = await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: "ticket-1" } })
    expect(mocks.reopen.mock.calls[0][0]).toMatchObject({ organizationId: "org-sales", channel: "whatsapp", ticketId: "ticket-1" })
    expect(result).toMatchObject({ ticketId: "ticket-1", reopened: true })
    // The reopen wrote the customer's comment itself.
    expect(mocks.createComment).not.toHaveBeenCalled()
  })

  it("reports a held ticket that was deleted, and opens none itself — the demo lets one message open the next", async () => {
    mocks.findTicket.mockResolvedValue(null)
    const result = await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: "ticket-gone" } })
    expect(result).toEqual({ ticketId: null, ticketNumber: null, created: false, commentAdded: false, reopened: false, missing: true })
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it("does not write the message twice when another message reopened the ticket a moment ago", async () => {
    mocks.findTicket.mockResolvedValue({ id: "ticket-1", ticketNumber: "WA-0030", status: "resolved" })
    mocks.reopen.mockResolvedValue({ reopened: false, reason: "ticket_already_open", commentAdded: true })
    const result = await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: "ticket-1" } })
    expect(result).toMatchObject({ ticketId: "ticket-1", commentAdded: true })
    expect(result.reopened).toBe(false)
    expect(mocks.createComment).not.toHaveBeenCalled()
  })

  it("still names the demo's ticket when a step after creating it failed", async () => {
    mocks.createComment.mockRejectedValue(new Error("connection reset"))
    const result = await ensureInboundWhatsAppTicket({ ...BASE, demo: { grantId: "grant-1", ticketId: null } })
    expect(result).toMatchObject({ ticketId: "ticket-new", ticketNumber: "WA-0031", created: true })
    // The ordinary path keeps its old answer.
    expect(await ensureInboundWhatsAppTicket(BASE)).toMatchObject({ ticketId: null, created: false })
  })
})

describe("any other WhatsApp message", () => {
  it("is filed exactly as before: on the phone's open ticket, unmarked", async () => {
    mocks.findTicket.mockResolvedValue({ id: "ticket-9", ticketNumber: "WA-0009" })
    const result = await ensureInboundWhatsAppTicket(BASE)
    expect(mocks.findTicket.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-sales",
      tags: { has: "whatsapp" },
      sourceMeta: { path: ["phone"], equals: "994501234567" },
    })
    expect(result).toMatchObject({ ticketId: "ticket-9", created: false })
    mocks.findTicket.mockResolvedValue(null)
    await ensureInboundWhatsAppTicket(BASE)
    expect(mocks.createTicket.mock.calls[0][0].tags).toEqual(["whatsapp", "inbound_whatsapp", "auto_created"])
    expect(mocks.createTicket.mock.calls[0][0].sourceMeta).not.toHaveProperty("demoGrantId")
    expect(mocks.reopen).not.toHaveBeenCalled()
  })
})
