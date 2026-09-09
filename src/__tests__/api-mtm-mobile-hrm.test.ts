import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/hrm/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/mtm/mobile/hrm${query}`, {
    headers: { Authorization: "Bearer mobile" },
  })
}

describe("GET /api/v1/mtm/mobile/hrm", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-16T08:00:00.000Z"))
    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: "org-1",
      agentId: "agent-1",
      role: "AGENT",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  })

  afterEach(() => vi.useRealTimers())

  it("validates the schedule range before querying data", async () => {
    const response = await GET(request("?start=2026-01-01&end=2026-06-01"))
    expect(response.status).toBe(400)
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
  })

  it("returns capability disabled before reading HRM records", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: "org-1",
      agentId: "agent-1",
      role: "AGENT",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled()
  })

  it("merges calendar, workday, and pending requests into each day", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{
      id: "workday-1",
      workDate: new Date("2026-07-16T00:00:00.000Z"),
      status: "COMPLETED",
      startedAt: new Date("2026-07-16T05:00:00.000Z"),
      pausedAt: null,
      completedAt: new Date("2026-07-16T14:00:00.000Z"),
      totalPausedSeconds: 1800,
    }] as never)
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{
      id: "request-1",
      clientRequestId: "request-client-1",
      type: "LEAVE",
      status: "PENDING",
      startDate: new Date("2026-07-17T00:00:00.000Z"),
      endDate: new Date("2026-07-17T00:00:00.000Z"),
      correctionWorkdayId: null,
      requestedStartAt: null,
      requestedEndAt: null,
      reason: "Annual leave",
      decisionNote: null,
      submittedAt: new Date("2026-07-16T08:00:00.000Z"),
      decidedAt: null,
      cancelledAt: null,
      updatedAt: new Date("2026-07-16T08:00:00.000Z"),
    }] as never)

    const body = await (await GET(request("?start=2026-07-16&end=2026-07-17"))).json()
    expect(body.data.days).toHaveLength(2)
    expect(body.data.days[0].workday.id).toBe("workday-1")
    expect(body.data.days[1].requests).toEqual([{ id: "request-1", type: "LEAVE", status: "PENDING" }])
    const query = vi.mocked(prisma.mtmWorkCalendarDay.findMany).mock.calls[0][0] as any
    expect(query.where.organizationId).toBe("org-1")
    expect(query.where.OR).toContainEqual({ teamId: "team-1", agentId: null })
  })
})
