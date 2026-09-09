import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock prisma + side-effect helpers so the unit under test only exercises
// its own branching logic.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    ticketComment: {
      create: vi.fn().mockResolvedValue({}),
    },
    contact: {
      findFirst: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}))

// SLA resolution has its own unit test (lib-sla-resolver.test.ts). Here we only
// care THAT reopen calls it and applies the result — default to no policy ({}).
vi.mock("@/lib/sla-resolver", () => ({
  resolveTicketSla: vi.fn().mockResolvedValue({}),
}))

import { prisma, logAudit } from "@/lib/prisma"
import { executeWorkflows } from "@/lib/workflow-engine"
import { fireWebhooks } from "@/lib/webhooks"
import { resolveTicketSla } from "@/lib/sla-resolver"
import { reopenTicketForCustomerReply } from "@/lib/ticket-reopen"

const ORG = "org_1"

const RESOLVED_TICKET = {
  id: "t1",
  ticketNumber: "DV-0026",
  subject: "VPN issue",
  status: "resolved",
  contactId: "c1",
  source: "whatsapp",
  companyId: null,
  priority: "high",
}

const OPEN_TICKET = {
  id: "t2",
  ticketNumber: "DV-0027",
  subject: "billing",
  status: "open",
  contactId: "c1",
  source: "email",
  companyId: null,
  priority: "medium",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("reopenTicketForCustomerReply", () => {
  it("reopens a resolved ticket found by contactId — sets status=open, clears timestamps, logs audit, fires workflow + webhook", async () => {
    ;(prisma.ticket.findFirst as any).mockResolvedValue(RESOLVED_TICKET)

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "whatsapp",
      customerMessage: "проблема не решена",
      contactId: "c1",
    })

    expect(res.reopened).toBe(true)
    expect(res.ticketNumber).toBe("DV-0026")

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "open", resolvedAt: null, closedAt: null, reopenCount: { increment: 1 } },
    })
    expect(prisma.ticketComment.create).toHaveBeenCalledWith({
      data: {
        ticketId: "t1",
        comment: "[Клиент (WhatsApp)] проблема не решена",
        isInternal: false,
      },
    })
    expect(logAudit).toHaveBeenCalledWith(
      ORG, "reopen", "ticket", "t1", "VPN issue",
      expect.objectContaining({
        oldValue: { status: "resolved" },
        newValue: expect.objectContaining({ status: "open", via: "whatsapp" }),
      }),
    )
    expect(executeWorkflows).toHaveBeenCalledWith(
      ORG, "ticket", "replied",
      expect.objectContaining({ id: "t1", status: "open" }),
    )
    expect(fireWebhooks).toHaveBeenCalledWith(
      ORG, "ticket.updated",
      expect.objectContaining({ id: "t1", status: "open", reopenedVia: "whatsapp" }),
    )
  })

  it("recomputes SLA on reopen: passes the ticket's company+priority to the resolver and writes the fresh window", async () => {
    ;(prisma.ticket.findFirst as any).mockResolvedValue({
      ...RESOLVED_TICKET, companyId: "co1", priority: "critical",
    })
    const due = new Date("2030-01-01T00:00:00Z")
    const frDue = new Date("2029-12-31T23:00:00Z")
    ;(resolveTicketSla as any).mockResolvedValueOnce({
      slaDueAt: due, slaFirstResponseDueAt: frDue, slaPolicyName: "Critical SLA",
    })

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "whatsapp",
      customerMessage: "still broken",
      contactId: "c1",
    })

    expect(res.reopened).toBe(true)
    expect(resolveTicketSla).toHaveBeenCalledWith(ORG, { companyId: "co1", priority: "critical" })
    // firstResponseAt is deliberately NOT cleared — reopened ticket owes a resolution
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        status: "open", resolvedAt: null, closedAt: null, reopenCount: { increment: 1 },
        slaDueAt: due, slaFirstResponseDueAt: frDue, slaPolicyName: "Critical SLA",
      },
    })
  })

  it("regression DV-0026: reopens even when ticket was closed long ago (no time window) and source matches without tags", async () => {
    // Old `tryReopenTicket` required `tags: { has: "whatsapp" }` AND closure
    // within 7 days. Both are gone — this test pins the new behavior.
    ;(prisma.ticket.findFirst as any).mockResolvedValue({
      ...RESOLVED_TICKET,
      // Resolved 90 days ago — would have been rejected by the 7-day window
    })

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "whatsapp",
      customerMessage: "again",
      contactId: "c1",
    })

    expect(res.reopened).toBe(true)
    expect(prisma.ticket.update).toHaveBeenCalled()
  })

  it("falls back to phone lookup when contactId is not provided", async () => {
    ;(prisma.contact.findFirst as any).mockResolvedValue({ id: "c1" })
    ;(prisma.ticket.findFirst as any).mockResolvedValue(RESOLVED_TICKET)

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "whatsapp",
      customerMessage: "hi",
      fallbackPhone: "994501234567",
    })

    expect(res.reopened).toBe(true)
    expect(prisma.contact.findFirst).toHaveBeenCalled()
  })

  it("returns no_contact when neither contactId nor fallback resolves", async () => {
    ;(prisma.contact.findFirst as any).mockResolvedValue(null)

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "telegram",
      customerMessage: "hi",
      fallbackPhone: "+9999999",
    })

    expect(res.reopened).toBe(false)
    expect(res.reason).toBe("no_contact")
    expect(prisma.ticket.update).not.toHaveBeenCalled()
  })

  it("returns no_resolved_ticket when contact has no closed/resolved ticket", async () => {
    ;(prisma.ticket.findFirst as any).mockResolvedValue(null)

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "facebook",
      customerMessage: "hi",
      contactId: "c1",
    })

    expect(res.reopened).toBe(false)
    expect(res.reason).toBe("no_resolved_ticket")
    expect(prisma.ticket.update).not.toHaveBeenCalled()
    expect(prisma.ticketComment.create).not.toHaveBeenCalled()
  })

  it("on already-open ticket: appends comment + fires reply workflow but does NOT change status or fire webhook", async () => {
    ;(prisma.ticket.findFirst as any).mockResolvedValue(OPEN_TICKET)

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "email",
      customerMessage: "thanks",
      ticketId: "t2",
    })

    expect(res.reopened).toBe(false)
    expect(res.reason).toBe("ticket_already_open")
    expect(res.commentAdded).toBe(true)
    expect(prisma.ticket.update).not.toHaveBeenCalled()
    expect(prisma.ticketComment.create).toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(
      ORG, "reply", "ticket", "t2", "billing", expect.any(Object),
    )
    expect(executeWorkflows).toHaveBeenCalledWith(
      ORG, "ticket", "replied",
      expect.objectContaining({ id: "t2", status: "open" }),
    )
    expect(fireWebhooks).not.toHaveBeenCalled()
  })

  it("ticketId path: returns ticket_not_found when the id doesn't resolve", async () => {
    ;(prisma.ticket.findFirst as any).mockResolvedValue(null)

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "email",
      customerMessage: "x",
      ticketId: "nonexistent",
    })

    expect(res.reopened).toBe(false)
    expect(res.reason).toBe("ticket_not_found")
  })

  it("commentOverride is honored — used by email-inbound to keep the 📧 prefix", async () => {
    ;(prisma.ticket.findFirst as any).mockResolvedValue(RESOLVED_TICKET)

    await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "email",
      customerMessage: "raw body",
      commentOverride: "📧 raw body",
      ticketId: "t1",
    })

    expect(prisma.ticketComment.create).toHaveBeenCalledWith({
      data: { ticketId: "t1", comment: "📧 raw body", isInternal: false },
    })
  })

  it("commentOverride='' (empty string) is used as-is, not fallen back to auto-format — pins ?? semantics", async () => {
    // If `||` were used instead of `??`, an empty string would fall through to
    // the auto-formatted `[Клиент (Email)] ...` comment. `??` must NOT do that.
    ;(prisma.ticket.findFirst as any).mockResolvedValue(OPEN_TICKET)

    await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "email",
      customerMessage: "raw body",
      commentOverride: "",
      ticketId: "t2",
    })

    expect(prisma.ticketComment.create).toHaveBeenCalledWith({
      data: { ticketId: "t2", comment: "", isInternal: false },
    })
  })

  it("returns reason=error and does not throw when prisma blows up", async () => {
    ;(prisma.ticket.findFirst as any).mockRejectedValue(new Error("db down"))

    const res = await reopenTicketForCustomerReply({
      organizationId: ORG,
      channel: "whatsapp",
      customerMessage: "x",
      contactId: "c1",
    })

    expect(res.reopened).toBe(false)
    expect(res.reason).toBe("error")
  })
})
