import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(),
}))
vi.mock("@/lib/workforce/request-decision", () => ({
  WorkforceRequestDecisionSchema: {
    safeParse: vi.fn((value: unknown) => (
      value && typeof value === "object" && (value as { decision?: unknown }).decision
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ message: "Invalid decision" }] } }
    )),
  },
  decideWorkforceRequest: vi.fn(),
}))
vi.mock("@/lib/workforce/direct-time-correction", () => ({
  WorkforceDirectTimeCorrectionSchema: {
    safeParse: vi.fn((value: unknown) => (
      value && typeof value === "object" && (value as { operationId?: unknown }).operationId
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ message: "Invalid direct correction" }] } }
    )),
  },
  correctWorkforceTimeDirectly: vi.fn(),
}))

import { GET as todayGet } from "@/app/api/v1/workforce/today/route"
import { GET as timesheetGet } from "@/app/api/v1/workforce/timesheet/route"
import { GET as requestsGet } from "@/app/api/v1/workforce/requests/route"
import { POST as decisionPost } from "@/app/api/v1/workforce/requests/[id]/decision/route"
import { POST as directCorrectionPost } from "@/app/api/v1/workforce/workdays/[id]/corrections/route"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { decideWorkforceRequest } from "@/lib/workforce/request-decision"
import { correctWorkforceTimeDirectly } from "@/lib/workforce/direct-time-correction"

const AUTH = {
  orgId: "org-workforce",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.test",
  name: "Workforce Admin",
}

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-28T09:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "UTC" } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforcePolicySnapshot.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceShiftSnapshot.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)
})

afterEach(() => vi.useRealTimers())

describe("independent Workforce read models", () => {
  it("returns only the current tenant's daily work-time facts", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", teamId: "team-1" },
      { id: "agent-2", name: "Murad", role: "AGENT", teamId: "team-1" },
    ] as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany)
      .mockResolvedValueOnce([{
        id: "today-1", agentId: "agent-1", status: "STARTED",
        startedAt: new Date("2026-08-28T08:00:00.000Z"), pausedAt: null, completedAt: null,
      }] as never)
      .mockResolvedValueOnce([{
        id: "previous-2", agentId: "agent-2", workDate: new Date("2026-08-27T00:00:00.000Z"),
        status: "PAUSED", startedAt: new Date("2026-08-27T08:00:00.000Z"), pausedAt: new Date("2026-08-27T12:00:00.000Z"),
      }] as never)

    const response = await todayGet(request("/api/v1/workforce/today"), AUTH as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.summary).toMatchObject({ started: 1, notStarted: 1, previousOpen: 1 })
    expect(body.data.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "agent-1", status: "STARTED" }),
      expect.objectContaining({ id: "agent-2", status: "NOT_STARTED" }),
    ]))
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-workforce" }),
    }))
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-workforce" }),
    }))
  })

  it("does not present legacy timestamps as a Workforce calculation", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", teamId: "team-1" },
    ] as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{
      id: "workday-1", agentId: "agent-1", workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "COMPLETED", startedAt: new Date("2026-08-28T08:00:00.000Z"), pausedAt: null,
      completedAt: new Date("2026-08-28T09:00:00.000Z"), totalPausedSeconds: 600,
    }] as never)

    const response = await timesheetGet(request("/api/v1/workforce/timesheet?start=2026-08-28&end=2026-08-28"), AUTH as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.rows).toEqual([expect.objectContaining({
      id: "workday-1",
      workedSeconds: null,
      calculation: null,
      calculationStatus: "WORKFORCE_TIMESHEET_SNAPSHOT_MISSING",
    })])
    const query = vi.mocked(prisma.mtmAgentWorkday.findMany).mock.calls[0][0] as any
    expect(query.where).toMatchObject({ organizationId: "org-workforce", agentId: { in: ["agent-1"] } })
  })

  it("rehydrates a snapshotted timesheet row from immutable facts without reading live policy data", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", teamId: "team-1" },
    ] as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{
      id: "workday-1", agentId: "agent-1", workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "COMPLETED", startedAt: new Date("2026-08-28T09:00:00.000Z"), pausedAt: null,
      completedAt: new Date("2026-08-28T18:00:00.000Z"), totalPausedSeconds: 60 * 60,
    }] as never)
    vi.mocked(prisma.workforcePolicySnapshot.findMany).mockResolvedValue([{
      id: "policy-snapshot-1", workdayId: "workday-1", agentId: "agent-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"), expectedWorkSeconds: 8 * 60 * 60,
      lateGraceSeconds: 5 * 60, undertimeToleranceSeconds: 5 * 60,
      overtimeThresholdSeconds: 15 * 60, longPauseThresholdSeconds: 60 * 60,
    }] as never)
    vi.mocked(prisma.workforceShiftSnapshot.findMany).mockResolvedValue([{
      id: "shift-snapshot-1", workdayId: "workday-1", agentId: "agent-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"), timezone: "Asia/Baku",
      plannedStartAt: new Date("2026-08-28T09:00:00.000Z"),
      plannedEndAt: new Date("2026-08-28T18:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { id: "event-start", workdayId: "workday-1", type: "START", occurredAt: new Date("2026-08-28T09:00:00.000Z") },
      { id: "event-pause", workdayId: "workday-1", type: "PAUSE", occurredAt: new Date("2026-08-28T12:00:00.000Z") },
      { id: "event-resume", workdayId: "workday-1", type: "RESUME", occurredAt: new Date("2026-08-28T13:00:00.000Z") },
      { id: "event-finish", workdayId: "workday-1", type: "FINISH", occurredAt: new Date("2026-08-28T18:00:00.000Z") },
    ] as never)

    const response = await timesheetGet(request("/api/v1/workforce/timesheet?start=2026-08-28&end=2026-08-28"), AUTH as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.rows).toEqual([expect.objectContaining({
      id: "workday-1",
      workedSeconds: 8 * 60 * 60,
      calculationStatus: "WORKFORCE_TIMESHEET_CALCULATED",
      calculation: expect.objectContaining({
        policySnapshotId: "policy-snapshot-1",
        shiftSnapshotId: "shift-snapshot-1",
        isFinal: true,
      }),
    })])
    expect(body.data.summary).toMatchObject({ calculatedWorkdayCount: 1, unavailableWorkdayCount: 0 })
    expect(prisma.workforcePolicySnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-workforce", workdayId: { in: ["workday-1"] } },
    }))
    expect(prisma.workforceShiftSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-workforce", workdayId: { in: ["workday-1"] } },
    }))
    expect(prisma.workforcePolicy.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceShiftTemplate.findMany).not.toHaveBeenCalled()
  })

  it("does not fall back to mutable worked time when a snapshotted journal is invalid", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", teamId: "team-1" },
    ] as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{
      id: "workday-1", agentId: "agent-1", workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "COMPLETED", startedAt: new Date("2026-08-28T09:00:00.000Z"), pausedAt: null,
      completedAt: new Date("2026-08-28T18:00:00.000Z"), totalPausedSeconds: 0,
    }] as never)
    vi.mocked(prisma.workforcePolicySnapshot.findMany).mockResolvedValue([{
      id: "policy-snapshot-1", workdayId: "workday-1", agentId: "agent-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"), expectedWorkSeconds: 8 * 60 * 60,
      lateGraceSeconds: 5 * 60, undertimeToleranceSeconds: 5 * 60,
      overtimeThresholdSeconds: 15 * 60, longPauseThresholdSeconds: null,
    }] as never)
    vi.mocked(prisma.workforceShiftSnapshot.findMany).mockResolvedValue([{
      id: "shift-snapshot-1", workdayId: "workday-1", agentId: "agent-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"), timezone: "Asia/Baku",
      plannedStartAt: new Date("2026-08-28T09:00:00.000Z"),
      plannedEndAt: new Date("2026-08-28T18:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { id: "event-start", workdayId: "workday-1", type: "START", occurredAt: new Date("2026-08-28T09:00:00.000Z") },
    ] as never)

    const response = await timesheetGet(request("/api/v1/workforce/timesheet?start=2026-08-28&end=2026-08-28"), AUTH as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.rows).toEqual([expect.objectContaining({
      id: "workday-1",
      workedSeconds: null,
      calculation: null,
      calculationStatus: "WORKFORCE_WORKDAY_HISTORY_INVALID",
    })])
    expect(body.data.summary).toMatchObject({ totalWorkedSeconds: 0, unavailableWorkdayCount: 1 })
  })

  it("stores organization-local day keys as canonical PostgreSQL DATE values", async () => {
    vi.setSystemTime(new Date("2026-08-27T21:30:00.000Z"))
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", teamId: "team-1" },
    ] as never)

    const response = await todayGet(request("/api/v1/workforce/today"), AUTH as never)
    const body = await response.json()

    expect(body.data).toMatchObject({ date: "2026-08-28", timezone: "Asia/Baku" })
    const todayQuery = vi.mocked(prisma.mtmAgentWorkday.findMany).mock.calls[0][0] as any
    const previousQuery = vi.mocked(prisma.mtmAgentWorkday.findMany).mock.calls[1][0] as any
    expect(todayQuery.where.workDate).toEqual(new Date("2026-08-28T00:00:00.000Z"))
    expect(previousQuery.where.workDate.lt).toEqual(new Date("2026-08-28T00:00:00.000Z"))
  })

  it("uses canonical DATE boundaries for a positive-offset timesheet", async () => {
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", teamId: "team-1" },
    ] as never)

    const response = await timesheetGet(
      request("/api/v1/workforce/timesheet?start=2026-08-27&end=2026-08-28"),
      AUTH as never,
    )

    expect(response.status).toBe(200)
    const query = vi.mocked(prisma.mtmAgentWorkday.findMany).mock.calls[0][0] as any
    expect(query.where.workDate).toEqual({
      gte: new Date("2026-08-27T00:00:00.000Z"),
      lt: new Date("2026-08-29T00:00:00.000Z"),
    })
  })

  it("keeps the request queue tenant- and actor-scoped", async () => {
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{
      id: "request-1", agentId: "agent-1", type: "LEAVE", status: "PENDING",
      startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-09-02T00:00:00.000Z"),
      reason: "Annual leave", decisionNote: null, submittedAt: new Date("2026-08-28T08:00:00.000Z"),
      agent: { id: "agent-1", name: "Aysel", role: "AGENT" },
    }] as never)

    const response = await requestsGet(request("/api/v1/workforce/requests?status=PENDING"), AUTH as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.requests).toEqual([expect.objectContaining({ id: "request-1", agentId: "agent-1" })])
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-workforce", status: "PENDING" }),
    }))
  })

  it("paginates the request queue without silently truncating it", async () => {
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([
      { id: "request-3" },
      { id: "request-2" },
      { id: "request-1" },
    ] as never)

    const response = await requestsGet(request("/api/v1/workforce/requests?limit=2"), AUTH as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      timezone: "Asia/Baku",
      canDecide: true,
      requests: [{ id: "request-3" }, { id: "request-2" }],
      nextCursor: "request-2",
    })
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    }))
  })

  it("rejects a request cursor outside the actor-scoped queue", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null)

    const response = await requestsGet(
      request("/api/v1/workforce/requests?status=PENDING&cursor=out-of-scope"),
      AUTH as never,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_REQUEST_CURSOR_INVALID" })
    expect(prisma.mtmHrmRequest.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "out-of-scope",
        organizationId: "org-workforce",
        status: "PENDING",
      }),
      select: { id: true },
    })
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/workforce/requests/:id/decision", () => {
  it("calls the shared domain service without requiring Route & Field", async () => {
    vi.mocked(decideWorkforceRequest).mockResolvedValue({
      kind: "success",
      data: { id: "request-1", status: "APPROVED", decisionNote: null, decidedAt: new Date(), updatedAt: new Date() },
      conflicts: [],
      idempotent: true,
    } as never)

    const invokeDecision = decisionPost as unknown as (
      req: NextRequest,
      auth: typeof AUTH,
      ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>
    const response = await invokeDecision(
      request("/api/v1/workforce/requests/request-1/decision", { decision: "APPROVED" }),
      AUTH,
      { params: Promise.resolve({ id: "request-1" }) },
    )

    expect(response.status).toBe(200)
    expect(await response.clone().json()).toMatchObject({ success: true, idempotent: true })
    expect(decideWorkforceRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-workforce",
      requestId: "request-1",
      includeRouteConflicts: false,
    }))
  })

  it("preserves the domain conflict code returned by the decision service", async () => {
    vi.mocked(decideWorkforceRequest).mockResolvedValue({
      kind: "conflict",
      message: "Corrected finish time must be after the corrected start time",
      code: "WORKFORCE_TIME_RANGE_INVALID",
    } as never)

    const invokeDecision = decisionPost as unknown as (
      req: NextRequest,
      auth: typeof AUTH,
      ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>
    const response = await invokeDecision(
      request("/api/v1/workforce/requests/request-1/decision", { decision: "APPROVED" }),
      AUTH,
      { params: Promise.resolve({ id: "request-1" }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_TIME_RANGE_INVALID" })
  })
})

describe("POST /api/v1/workforce/workdays/:id/corrections", () => {
  const correctionInput = {
    operationId: "direct-correction-1",
    expectedUpdatedAt: "2026-08-28T09:00:00.000Z",
    startedAt: "2026-08-28T08:00:00.000Z",
    completedAt: "2026-08-28T17:00:00.000Z",
    reason: "Verified with manager",
  }

  it("uses the Workforce-only manager correction service", async () => {
    vi.mocked(correctWorkforceTimeDirectly).mockResolvedValue({
      kind: "success",
      idempotent: false,
      data: {
        correctionId: "correction-1",
        workday: { id: "workday-1", status: "COMPLETED" },
      },
    } as never)

    const invoke = directCorrectionPost as unknown as (
      req: NextRequest,
      auth: typeof AUTH,
      ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>
    const response = await invoke(
      request("/api/v1/workforce/workdays/workday-1/corrections", correctionInput),
      AUTH,
      { params: Promise.resolve({ id: "workday-1" }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false })
    expect(correctWorkforceTimeDirectly).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-workforce",
      userId: "admin-1",
      workdayId: "workday-1",
      input: correctionInput,
    }))
  })

  it("uses the trusted request IP rather than a caller-controlled forwarded chain in audit metadata", async () => {
    vi.mocked(correctWorkforceTimeDirectly).mockResolvedValue({
      kind: "success",
      idempotent: false,
      data: {
        correctionId: "correction-1",
        workday: { id: "workday-1", status: "COMPLETED" },
      },
    } as never)
    const invoke = directCorrectionPost as unknown as (
      req: NextRequest,
      auth: typeof AUTH,
      ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/workdays/workday-1/corrections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.72, 198.51.100.73",
        "x-real-ip": "203.0.113.72",
        "user-agent": "workforce-correction-test-agent".repeat(40),
      },
      body: JSON.stringify(correctionInput),
    }), AUTH, { params: Promise.resolve({ id: "workday-1" }) })

    expect(response.status).toBe(200)
    expect(correctWorkforceTimeDirectly).toHaveBeenCalledWith(expect.objectContaining({
      audit: {
        ipAddress: "203.0.113.72",
        userAgent: expect.stringMatching(/^workforce-correction-test-agent/),
      },
    }))
    const audit = vi.mocked(correctWorkforceTimeDirectly).mock.calls[0]?.[0]?.audit
    expect(audit?.userAgent).toHaveLength(500)
  })

  it("preserves an optimistic-version correction conflict", async () => {
    vi.mocked(correctWorkforceTimeDirectly).mockResolvedValue({
      kind: "conflict",
      code: "WORKFORCE_TIME_CORRECTION_VERSION_CONFLICT",
      message: "Workday changed since it was opened for correction",
      currentWorkday: { id: "workday-1", status: "COMPLETED" },
    } as never)

    const invoke = directCorrectionPost as unknown as (
      req: NextRequest,
      auth: typeof AUTH,
      ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>
    const response = await invoke(
      request("/api/v1/workforce/workdays/workday-1/corrections", correctionInput),
      AUTH,
      { params: Promise.resolve({ id: "workday-1" }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_TIME_CORRECTION_VERSION_CONFLICT" })
  })
})
