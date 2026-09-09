import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { count: vi.fn() },
    lead: { findFirst: vi.fn() },
    ticket: { count: vi.fn() },
  },
}))

import { checkGoal } from "@/lib/journey-goals"
import { prisma } from "@/lib/prisma"

describe("journey-goals — checkGoal", () => {
  const enrollment = {
    id: "enr-1",
    contactId: "contact-1",
    leadId: "lead-1",
    enrolledAt: new Date("2026-01-01"),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns false when no goalType", async () => {
    const result = await checkGoal(enrollment, { goalType: null, goalConditions: null }, "org-1")
    expect(result).toBe(false)
  })

  it("returns false when no goalConditions", async () => {
    const result = await checkGoal(enrollment, { goalType: "deal_created", goalConditions: null }, "org-1")
    expect(result).toBe(false)
  })

  // deal_created goal type
  it("deal_created: returns true when deals exist after enrollment", async () => {
    vi.mocked(prisma.deal.count).mockResolvedValue(2)

    const result = await checkGoal(enrollment, {
      goalType: "deal_created",
      goalConditions: {},
    }, "org-1")

    expect(result).toBe(true)
    expect(prisma.deal.count).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        contactId: "contact-1",
        createdAt: { gte: enrollment.enrolledAt },
      },
    })
  })

  it("deal_created: returns false when no deals exist", async () => {
    vi.mocked(prisma.deal.count).mockResolvedValue(0)

    const result = await checkGoal(enrollment, {
      goalType: "deal_created",
      goalConditions: {},
    }, "org-1")
    expect(result).toBe(false)
  })

  it("deal_created: returns false when no contactId", async () => {
    const noContact = { ...enrollment, contactId: null }
    const result = await checkGoal(noContact, {
      goalType: "deal_created",
      goalConditions: {},
    }, "org-1")
    expect(result).toBe(false)
    expect(prisma.deal.count).not.toHaveBeenCalled()
  })

  // status_change goal type
  it("status_change: returns true when lead status matches", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "lead-1",
      status: "qualified",
    } as any)

    const result = await checkGoal(enrollment, {
      goalType: "status_change",
      goalConditions: { value: "qualified" },
    }, "org-1")
    expect(result).toBe(true)
  })

  it("status_change: returns false when lead status differs", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "lead-1",
      status: "new",
    } as any)

    const result = await checkGoal(enrollment, {
      goalType: "status_change",
      goalConditions: { value: "qualified" },
    }, "org-1")
    expect(result).toBe(false)
  })

  it("status_change: returns false when no leadId", async () => {
    const noLead = { ...enrollment, leadId: null }
    const result = await checkGoal(noLead, {
      goalType: "status_change",
      goalConditions: { value: "qualified" },
    }, "org-1")
    expect(result).toBe(false)
  })

  // ticket_resolved goal type
  it("ticket_resolved: returns true when resolved tickets exist", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(1)

    const result = await checkGoal(enrollment, {
      goalType: "ticket_resolved",
      goalConditions: {},
    }, "org-1")

    expect(result).toBe(true)
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        contactId: "contact-1",
        status: "resolved",
        updatedAt: { gte: enrollment.enrolledAt },
      },
    })
  })

  it("ticket_resolved: returns false when no resolved tickets", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(0)

    const result = await checkGoal(enrollment, {
      goalType: "ticket_resolved",
      goalConditions: {},
    }, "org-1")
    expect(result).toBe(false)
  })

  // Unknown goal type
  it("unknown goal type returns false", async () => {
    const result = await checkGoal(enrollment, {
      goalType: "unknown_type",
      goalConditions: {},
    }, "org-1")
    expect(result).toBe(false)
  })
})
