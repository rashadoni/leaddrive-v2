import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { count: vi.fn() },
    contact: { count: vi.fn() },
    deal: { groupBy: vi.fn().mockResolvedValue([]), count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    ticket: { count: vi.fn() },
    task: { count: vi.fn(), findMany: vi.fn() },
    activity: { findMany: vi.fn() },
    // orgStageVocabulary resolves which stage spellings mean won/lost before
    // any deal query runs, so both of these must answer.
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

vi.mock("@/lib/constants", () => ({
  PAGE_SIZE: { DEFAULT: 50, DASHBOARD_RECENT: 10, DASHBOARD_TASKS: 10 },
}))

import { GET } from "@/app/api/v1/dashboard/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const mockGetOrgId = getOrgId as ReturnType<typeof vi.fn>
const mockCompanyCount = prisma.company.count as ReturnType<typeof vi.fn>
const mockContactCount = prisma.contact.count as ReturnType<typeof vi.fn>
const mockDealCount = prisma.deal.count as ReturnType<typeof vi.fn>
const mockDealAggregate = prisma.deal.aggregate as ReturnType<typeof vi.fn>
const mockDealFindMany = prisma.deal.findMany as ReturnType<typeof vi.fn>
const mockTicketCount = prisma.ticket.count as ReturnType<typeof vi.fn>
const mockTaskCount = prisma.task.count as ReturnType<typeof vi.fn>
const mockTaskFindMany = prisma.task.findMany as ReturnType<typeof vi.fn>
const mockActivityFindMany = prisma.activity.findMany as ReturnType<typeof vi.fn>

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/dashboard")
}

function setupSuccessMocks(overrides?: {
  companyCount?: number
  contactCounts?: number[]
  dealCount?: number
  pipelineSum?: number | null
  ticketCount?: number
  taskCount?: number
  tasks?: unknown[]
  activities?: unknown[]
  wonDeals?: unknown[]
}) {
  const opts = {
    companyCount: 10,
    contactCounts: [50, 20, 15, 15],
    dealCount: 5,
    pipelineSum: 100000,
    ticketCount: 3,
    taskCount: 2,
    tasks: [],
    activities: [],
    wonDeals: [],
    ...overrides,
  }

  mockGetOrgId.mockResolvedValue("org-1")
  mockCompanyCount.mockResolvedValue(opts.companyCount)

  // contact.count is called 4 times: once in main Promise.all, 3 times for engagement
  let contactCallIndex = 0
  mockContactCount.mockImplementation(() => {
    const val = opts.contactCounts[contactCallIndex] ?? 0
    contactCallIndex++
    return Promise.resolve(val)
  })

  mockDealCount.mockResolvedValue(opts.dealCount)
  mockDealAggregate.mockResolvedValue({ _sum: { valueAmount: opts.pipelineSum } })
  mockTicketCount.mockResolvedValue(opts.ticketCount)
  mockTaskCount.mockResolvedValue(opts.taskCount)
  mockTaskFindMany.mockResolvedValue(opts.tasks)
  mockActivityFindMany.mockResolvedValue(opts.activities)
  mockDealFindMany.mockResolvedValue(opts.wonDeals)
}

describe("GET /api/v1/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when getOrgId returns null", async () => {
    mockGetOrgId.mockResolvedValue(null)

    const res = await GET(makeRequest())
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns all stats with correct structure", async () => {
    setupSuccessMocks()

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty("stats")
    expect(body.data).toHaveProperty("revenueByMonth")
    expect(body.data).toHaveProperty("recentActivities")
    expect(body.data).toHaveProperty("myTasks")
    expect(body.data).toHaveProperty("engagementHot")
    expect(body.data).toHaveProperty("engagementWarm")
    expect(body.data).toHaveProperty("engagementCold")

    expect(body.data.stats).toEqual({
      companies: 10,
      contacts: 50,
      activeDeals: 5,
      pipelineValue: 100000,
      openTickets: 3,
      overdueTasks: 2,
    })
  })

  it("all queries include organizationId", async () => {
    setupSuccessMocks()

    await GET(makeRequest())

    // company.count
    expect(mockCompanyCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // contact.count (called 4 times — all should have organizationId)
    expect(mockContactCount).toHaveBeenCalledTimes(4)
    for (const call of mockContactCount.mock.calls) {
      expect(call[0].where.organizationId).toBe("org-1")
    }

    // deal.count
    expect(mockDealCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // deal.aggregate
    expect(mockDealAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // ticket.count
    expect(mockTicketCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // task.count
    expect(mockTaskCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // activity.findMany
    expect(mockActivityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // task.findMany
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )

    // deal.findMany (revenueByMonth)
    expect(mockDealFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) })
    )
  })

  it("computes pipeline value from aggregate _sum", async () => {
    setupSuccessMocks({ pipelineSum: 250000 })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.data.stats.pipelineValue).toBe(250000)
  })

  it("returns pipelineValue 0 when aggregate _sum is null", async () => {
    setupSuccessMocks({ pipelineSum: null })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.data.stats.pipelineValue).toBe(0)
  })

  it("returns all zeros for empty results", async () => {
    setupSuccessMocks({
      companyCount: 0,
      contactCounts: [0, 0, 0, 0],
      dealCount: 0,
      pipelineSum: null,
      ticketCount: 0,
      taskCount: 0,
      tasks: [],
      activities: [],
      wonDeals: [],
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.data.stats).toEqual({
      companies: 0,
      contacts: 0,
      activeDeals: 0,
      pipelineValue: 0,
      openTickets: 0,
      overdueTasks: 0,
    })
    expect(body.data.revenueByMonth).toEqual({})
    expect(body.data.recentActivities).toEqual([])
    expect(body.data.myTasks).toEqual([])
    expect(body.data.engagementHot).toBe(0)
    expect(body.data.engagementWarm).toBe(0)
    expect(body.data.engagementCold).toBe(0)
  })

  it("groups revenue by month from won deals", async () => {
    // `stage` is required: the same deal.findMany mock also answers the
    // distinct-stage query that resolves the won/lost vocabulary, and
    // Deal.stage is NOT NULL in the schema, so a row without it is not a shape
    // production can produce.
    const wonDeals = [
      { stage: "WON", valueAmount: 5000, createdAt: new Date("2026-01-15T10:00:00Z") },
      { stage: "WON", valueAmount: 3000, createdAt: new Date("2026-01-20T10:00:00Z") },
      { stage: "WON", valueAmount: 8000, createdAt: new Date("2026-03-05T10:00:00Z") },
    ]

    setupSuccessMocks({ wonDeals })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.data.revenueByMonth["2026-01"]).toBe(8000)
    expect(body.data.revenueByMonth["2026-03"]).toBe(8000)
    expect(Object.keys(body.data.revenueByMonth)).toHaveLength(2)
  })

  it("returns engagement breakdown (hot/warm/cold)", async () => {
    // contactCounts: [main count, hot >=50, warm 20-49, cold <20]
    setupSuccessMocks({ contactCounts: [100, 30, 45, 25] })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.data.engagementHot).toBe(30)
    expect(body.data.engagementWarm).toBe(45)
    expect(body.data.engagementCold).toBe(25)
  })

  it("queries engagement with correct score thresholds", async () => {
    setupSuccessMocks()

    await GET(makeRequest())

    // The 3 engagement calls are the 2nd, 3rd, and 4th calls to contact.count
    const engagementCalls = mockContactCount.mock.calls.slice(1)

    // hot: engagementScore >= 50
    expect(engagementCalls[0][0].where.engagementScore).toEqual({ gte: 50 })
    // warm: engagementScore >= 20 and < 50
    expect(engagementCalls[1][0].where.engagementScore).toEqual({ gte: 20, lt: 50 })
    // cold: engagementScore < 20
    expect(engagementCalls[2][0].where.engagementScore).toEqual({ lt: 20 })
  })

  it("returns recent activities and tasks from Prisma", async () => {
    const activities = [
      { id: "a1", type: "call", contact: { fullName: "John" }, company: { name: "Acme" } },
    ]
    const tasks = [
      { id: "t1", title: "Follow up", status: "pending", dueDate: "2026-04-15" },
    ]

    setupSuccessMocks({ activities, tasks })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.data.recentActivities).toEqual(activities)
    expect(body.data.myTasks).toEqual(tasks)
  })

  it("returns 500 on unexpected error", async () => {
    mockGetOrgId.mockResolvedValue("org-1")
    mockCompanyCount.mockRejectedValue(new Error("DB connection failed"))

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.error).toBe("Internal server error")

    consoleSpy.mockRestore()
  })
})
