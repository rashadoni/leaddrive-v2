import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  taskFindMany: vi.fn(),
  leadFindMany: vi.fn(),
  userFindMany: vi.fn(),
  callLogFindMany: vi.fn(),
  channelMessageFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: mocks.taskFindMany },
    lead: { findMany: mocks.leadFindMany },
    user: { findMany: mocks.userFindMany },
    callLog: { findMany: mocks.callLogFindMany },
    channelMessage: { findMany: mocks.channelMessageFindMany },
  },
}))

import { buildLateCallbackReport } from "@/lib/commitments/late-callbacks"

const ORG = "org-1"
const made = new Date("2026-08-16T09:00:00.000Z")
const promisedFor = new Date("2026-08-16T15:00:00.000Z")

function commitment(over: Partial<{ id: string; assignedTo: string | null; relatedId: string }> = {}) {
  return {
    id: over.id ?? "task-1",
    dueDate: promisedFor,
    assignedTo: over.assignedTo === undefined ? "seller-1" : over.assignedTo,
    relatedType: "lead",
    relatedId: over.relatedId ?? "lead-1",
    createdAt: made,
    customFields: { commitmentCallId: "call-1" },
  }
}

describe("late callback report", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leadFindMany.mockResolvedValue([
      { id: "lead-1", contactName: "Aysel", phone: "+994500000001" },
      { id: "lead-2", contactName: "Kamran", phone: null },
    ])
    mocks.userFindMany.mockResolvedValue([
      { id: "seller-1", name: "Ahmed", email: "a@x.az" },
      { id: "seller-2", name: null, email: "k@x.az" },
    ])
    mocks.callLogFindMany.mockResolvedValue([])
    mocks.channelMessageFindMany.mockResolvedValue([])
  })

  const window = { organizationId: ORG, from: new Date("2026-08-16T00:00:00.000Z"), to: new Date("2026-08-16T23:59:59.000Z") }

  it("counts a callback before the promised time as kept", async () => {
    mocks.taskFindMany.mockResolvedValue([commitment()])
    mocks.callLogFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T14:30:00.000Z"), startedAt: new Date("2026-08-16T14:30:00.000Z") },
    ])

    const report = await buildLateCallbackReport(window)

    expect(report.totals).toEqual({ promises: 1, onTime: 1, late: 0, missed: 0 })
    expect(report.rows[0].status).toBe("on_time")
    expect(report.rows[0].sellerName).toBe("Ahmed")
    expect(report.rows[0].leadName).toBe("Aysel")
  })

  it("measures lateness from the time the customer was given", async () => {
    mocks.taskFindMany.mockResolvedValue([commitment()])
    mocks.callLogFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T17:45:00.000Z"), startedAt: new Date("2026-08-16T17:45:00.000Z") },
    ])

    const report = await buildLateCallbackReport(window)

    expect(report.rows[0].status).toBe("late")
    expect(report.rows[0].lateByMinutes).toBe(165)
    expect(report.sellers[0].worstLateMinutes).toBe(165)
  })

  it("honours the tolerance before calling a promise late", async () => {
    mocks.taskFindMany.mockResolvedValue([commitment()])
    mocks.callLogFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T15:20:00.000Z"), startedAt: new Date("2026-08-16T15:20:00.000Z") },
    ])

    const report = await buildLateCallbackReport({ ...window, toleranceMinutes: 30 })

    expect(report.rows[0].status).toBe("on_time")
  })

  it("ignores contact that happened before the promise was made", async () => {
    // The seller spoke to this customer in the morning; that cannot be the
    // callback they promised at 15:00.
    mocks.taskFindMany.mockResolvedValue([commitment()])
    mocks.callLogFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T08:00:00.000Z"), startedAt: new Date("2026-08-16T08:00:00.000Z") },
    ])

    const report = await buildLateCallbackReport(window)

    expect(report.rows[0].status).toBe("missed")
    expect(report.rows[0].contactedAt).toBeNull()
  })

  it("accepts an outbound message as contact, not only a call", async () => {
    mocks.taskFindMany.mockResolvedValue([commitment()])
    mocks.channelMessageFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T14:00:00.000Z") },
    ])

    const report = await buildLateCallbackReport(window)

    expect(report.rows[0].status).toBe("on_time")
  })

  it("groups by seller and puts the worst offenders first", async () => {
    mocks.taskFindMany.mockResolvedValue([
      commitment({ id: "task-1", assignedTo: "seller-1", relatedId: "lead-1" }),
      commitment({ id: "task-2", assignedTo: "seller-2", relatedId: "lead-2" }),
      commitment({ id: "task-3", assignedTo: "seller-2", relatedId: "lead-2" }),
    ])
    mocks.callLogFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T14:00:00.000Z"), startedAt: new Date("2026-08-16T14:00:00.000Z") },
    ])

    const report = await buildLateCallbackReport(window)

    expect(report.totals).toEqual({ promises: 3, onTime: 1, late: 0, missed: 2 })
    expect(report.sellers[0].sellerId).toBe("seller-2")
    expect(report.sellers[0].missed).toBe(2)
    // Falls back to the login when the seller has no display name.
    expect(report.sellers[0].sellerName).toBe("k@x.az")
  })

  it("does not judge a seller on a task nobody ticked", async () => {
    // Completion is irrelevant by design: nothing in the product closes these
    // tasks automatically, so reading completedAt would accuse everyone.
    mocks.taskFindMany.mockResolvedValue([commitment()])
    mocks.callLogFindMany.mockResolvedValue([
      { leadId: "lead-1", createdAt: new Date("2026-08-16T14:00:00.000Z"), startedAt: null },
    ])

    const report = await buildLateCallbackReport(window)

    expect(report.rows[0].status).toBe("on_time")
  })
})
