import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}))

vi.mock("@/lib/auto-assign", () => ({
  autoAssignTicket: vi.fn().mockResolvedValue({ assigned: true }),
}))

import { createNotification } from "@/lib/notifications"
import { evaluateEntitlementMilestones } from "@/lib/entitlement-process/milestone-automation"

const NOW = new Date("2026-07-04T12:00:00.000Z")

function makeMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: "tm-1",
    organizationId: "org-1",
    ticketId: "tk-1",
    type: "resolution",
    status: "in_progress",
    dueAt: new Date("2026-07-04T13:00:00.000Z"),
    missedAt: null,
    escalationLevel: 0,
    lastEscalatedAt: null,
    metadata: {},
    ticket: {
      id: "tk-1",
      organizationId: "org-1",
      ticketNumber: "DV-1",
      subject: "Broken SLA",
      priority: "medium",
      status: "open",
      assignedTo: "agent-1",
      category: "general",
    },
    definition: {
      id: "def-1",
      name: "Resolution",
      isRequired: true,
      entitlement: {
        id: "ent-1",
        supportLevel: "standard",
        company: { name: "Acme" },
        slaPolicy: { name: "Critical SLA" },
      },
    },
    ...overrides,
  }
}

function makeDb(milestones: unknown[]) {
  return {
    entitlementTicketMilestone: {
      findMany: vi.fn().mockResolvedValue(milestones),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    entitlementAuditEvent: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
    ticketComment: {
      create: vi.fn().mockResolvedValue({ id: "comment-1" }),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: "manager-1" }, { id: "admin-1" }]),
    },
    ticket: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("evaluateEntitlementMilestones", () => {
  it("marks upcoming milestones as at-risk once and notifies the assignee", async () => {
    const db = makeDb([makeMilestone()])

    const result = await evaluateEntitlementMilestones(db as never, { now: NOW })

    expect(result.atRisk).toBe(1)
    expect(result.notified).toBe(1)
    expect(result.internalNotes).toBe(1)
    expect(db.entitlementTicketMilestone.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ escalationLevel: { lt: 1 } }),
      data: expect.objectContaining({
        escalationLevel: 1,
        metadata: expect.objectContaining({ riskState: "at_risk" }),
      }),
    }))
    expect(db.entitlementAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "milestone_escalated",
        payload: expect.objectContaining({ trigger: "at_risk" }),
      }),
    }))
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: "agent-1",
      kind: "ticket.entitlement_at_risk",
    }))
  })

  it("does not duplicate at-risk side effects when CAS loses", async () => {
    const db = makeDb([makeMilestone()])
    db.entitlementTicketMilestone.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await evaluateEntitlementMilestones(db as never, { now: NOW })

    expect(result.atRisk).toBe(0)
    expect(result.skipped).toBe(1)
    expect(createNotification).not.toHaveBeenCalled()
    expect(db.entitlementAuditEvent.create).not.toHaveBeenCalled()
    expect(db.ticketComment.create).not.toHaveBeenCalled()
  })

  it("marks overdue in-progress milestones as missed and notifies managers for premium terms", async () => {
    const db = makeDb([
      makeMilestone({
        dueAt: new Date("2026-07-04T11:55:00.000Z"),
        definition: {
          id: "def-1",
          name: "Resolution",
          isRequired: true,
          entitlement: {
            id: "ent-1",
            supportLevel: "premium",
            company: { name: "Acme" },
            slaPolicy: { name: "Critical SLA" },
          },
        },
      }),
    ])

    const result = await evaluateEntitlementMilestones(db as never, { now: NOW })

    expect(result.missed).toBe(1)
    expect(result.notified).toBe(3)
    expect(result.escalated).toBe(0)
    expect(db.entitlementTicketMilestone.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "missed",
        metadata: expect.objectContaining({ riskState: "missed" }),
      }),
    }))
    expect(db.entitlementAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "milestone_missed" }),
    }))
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: { in: ["admin", "manager"] } }),
    }))
  })

  it("applies delayed missed escalation actions idempotently by escalation level", async () => {
    const db = makeDb([
      makeMilestone({
        status: "missed",
        dueAt: new Date("2026-07-04T09:00:00.000Z"),
        missedAt: new Date("2026-07-04T09:00:00.000Z"),
        escalationLevel: 1,
        ticket: {
          id: "tk-1",
          organizationId: "org-1",
          ticketNumber: "DV-1",
          subject: "Broken SLA",
          priority: "medium",
          status: "open",
          assignedTo: null,
          category: "general",
        },
      }),
    ])

    const result = await evaluateEntitlementMilestones(db as never, { now: NOW })

    expect(result.escalated).toBe(1)
    expect(result.notified).toBe(2)
    expect(result.priorityRaised).toBe(1)
    expect(result.internalNotes).toBe(1)
    expect(db.entitlementTicketMilestone.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "missed", escalationLevel: 1 }),
      data: expect.objectContaining({ escalationLevel: 2 }),
    }))
    expect(db.ticket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { priority: "high" },
    }))
    expect(db.entitlementAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "milestone_escalated",
        payload: expect.objectContaining({ level: 2 }),
      }),
    }))
  })
})
