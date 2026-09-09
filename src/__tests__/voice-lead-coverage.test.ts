import { beforeEach, describe, expect, it, vi } from "vitest"

const leadFindMany = vi.hoisted(() => vi.fn())
const callGroupBy = vi.hoisted(() => vi.fn())
const userFindMany = vi.hoisted(() => vi.fn())
const taskCount = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findMany: leadFindMany },
    callLog: { groupBy: callGroupBy },
    user: { findMany: userFindMany },
    task: { count: taskCount },
  },
}))

import { buildLeadCoverageSummary, COVERAGE_GRACE_HOURS } from "@/lib/ai/voice/lead-coverage"

const NOW = new Date("2026-08-14T09:00:00.000Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000)

describe("lead coverage the assistant reads out", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callGroupBy.mockResolvedValue([])
    userFindMany.mockResolvedValue([
      { id: "u1", name: "Tural", email: null },
      { id: "u2", name: "Sevinc", email: null },
    ])
    taskCount.mockResolvedValue(0)
  })

  it("does not call a lead 'not contacted' before anyone could have called it", async () => {
    leadFindMany.mockResolvedValue([
      { id: "l1", assignedTo: "u1", customerStage: null, createdAt: hoursAgo(1) },
      { id: "l2", assignedTo: "u1", customerStage: null, createdAt: hoursAgo(COVERAGE_GRACE_HOURS + 2) },
    ])

    const summary = await buildLeadCoverageSummary("org-1", NOW)

    // A lead created an hour ago is not a lead somebody failed to call, and
    // putting a salesperson on a list for it is how the list stops being read.
    expect(summary.tooNewToJudge).toBe(1)
    expect(summary.notContacted).toBe(1)
    expect(summary.sellers[0]).toMatchObject({ name: "Tural", notContacted: 1, assigned: 2 })
  })

  it("counts a logged call and a recorded call outcome, and says so", async () => {
    leadFindMany.mockResolvedValue([
      { id: "l1", assignedTo: "u1", customerStage: null, createdAt: hoursAgo(48) },
      { id: "l2", assignedTo: "u2", customerStage: "unable_to_contact", createdAt: hoursAgo(48) },
      { id: "l3", assignedTo: "u2", customerStage: null, createdAt: hoursAgo(48) },
    ])
    callGroupBy.mockResolvedValue([{ leadId: "l1", _count: { _all: 2 } }])

    const summary = await buildLeadCoverageSummary("org-1", NOW)

    expect(summary.contacted).toBe(2)
    expect(summary.notContacted).toBe(1)
    // A number that names people has to carry its own definition, or it will be
    // repeated as "we contacted two thirds of the leads" — including the chats
    // it never counted.
    expect(summary.contactedMeans).toContain("chats and emails do not count")
    expect(summary.graceHours).toBe(COVERAGE_GRACE_HOURS)
  })

  it("puts the person with the most untouched work first", async () => {
    leadFindMany.mockResolvedValue([
      { id: "a1", assignedTo: "u1", customerStage: null, createdAt: hoursAgo(72) },
      { id: "b1", assignedTo: "u2", customerStage: null, createdAt: hoursAgo(72) },
      { id: "b2", assignedTo: "u2", customerStage: null, createdAt: hoursAgo(96) },
      { id: "b3", assignedTo: "u2", customerStage: null, createdAt: hoursAgo(120) },
    ])

    const summary = await buildLeadCoverageSummary("org-1", NOW)

    expect(summary.sellers.map((s) => s.name)).toEqual(["Sevinc", "Tural"])
    expect(summary.sellers[0].oldestUntouchedDays).toBe(5)
  })

  it("counts leads nobody owns instead of hiding them in a person's column", async () => {
    leadFindMany.mockResolvedValue([
      { id: "l1", assignedTo: null, customerStage: null, createdAt: hoursAgo(72) },
      { id: "l2", assignedTo: "u1", customerStage: null, createdAt: hoursAgo(72) },
    ])

    const summary = await buildLeadCoverageSummary("org-1", NOW)

    expect(summary.unassigned).toBe(1)
    expect(summary.sellers.find((s) => s.userId === null)?.notContacted).toBe(1)
  })
})
