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

import { GET } from "@/app/api/v1/mtm/mobile/workday/route"
import { resolveMobileAuth, type MobileAuthResult } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/workday${query}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

function mobileAuth(role: string, workforceHrm = true): MobileAuthResult {
  return {
    orgId: ORG,
    agentId: AGENT,
    userId: "user-1",
    email: "employee@example.com",
    name: "Employee",
    role,
    tenantCapabilities: { routeField: true, workforceHrm },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth("AGENT"))
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
})

afterEach(() => vi.useRealTimers())

describe("GET /api/v1/mtm/mobile/workday", () => {
  it("requires mobile authentication", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
  })

  it("lets a manager read their own workday through the explicit worktime permission", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth("MANAGER"))
    expect((await GET(request())).status).toBe(200)
  })

  it("rejects an unknown role before querying workdays", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth("OWNER"))
    expect((await GET(request())).status).toBe(403)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
  })

  it("returns a capability-disabled response before reading workforce data", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth("AGENT", false))

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
  })

  it("validates the local date before querying workdays", async () => {
    const response = await GET(request("?date=2026-02-29"))
    expect(response.status).toBe(400)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
  })

  it("returns a running shift with live worked time and tenant scope", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-15T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 600,
      startLatitude: 40.4,
      startLongitude: 49.8,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-15T05:00:00.000Z"),
      updatedAt: new Date("2026-07-15T05:00:00.000Z"),
      events: [],
      workforceShiftSnapshot: {
        timezone: "Asia/Baku",
        plannedStartAt: new Date("2026-07-15T05:00:00.000Z"),
        plannedEndAt: new Date("2026-07-15T14:00:00.000Z"),
      },
      workforceWorkdayScheduleSnapshot: {
        segments: [{
          id: "segment-1",
          mode: "SITE",
          siteId: "site-1",
          startTime: "09:00",
          endTime: "18:00",
          proofPolicyReference: "high-assurance",
        }],
        sites: [{
          id: "site-1",
          name: "Baku HQ",
          addressLabel: "Private office address",
          geofenceRevision: { centerLatitude: 40.4, centerLongitude: 49.8, radiusMeters: 100 },
        }],
      },
    } as never)

    const response = await GET(request("?date=2026-07-15"))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toMatchObject({
      date: "2026-07-15",
      today: "2026-07-15",
      timezone: "Asia/Baku",
      gpsIntervalSeconds: 30,
      availableActions: ["PAUSE", "FINISH"],
      workday: {
        id: "workday-1",
        status: "STARTED",
        workedSeconds: 10_200,
        availableActions: ["PAUSE", "FINISH"],
        schedule: {
          plannedStartAt: "2026-07-15T05:00:00.000Z",
          plannedEndAt: "2026-07-15T14:00:00.000Z",
          segment: {
            state: "CURRENT",
            mode: "SITE",
            startTime: "09:00",
            endTime: "18:00",
            siteName: "Baku HQ",
          },
        },
      },
    })
    expect(json.data.workday).not.toHaveProperty("startLatitude")
    expect(json.data.workday).not.toHaveProperty("startLongitude")
    expect(json.data.workday).not.toHaveProperty("events")
    expect(json.data.workday.schedule).not.toHaveProperty("proofPolicyReference")
    expect(json.data.workday.schedule.segment).not.toHaveProperty("siteId")
    expect(json.data.workday.schedule.segment).not.toHaveProperty("addressLabel")
    expect(json.data.workday.schedule.segment).not.toHaveProperty("geofenceRevision")
    const firstQuery = vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.calls[0]?.[0] as unknown as {
      where: { organizationId: string; agentId: string; workDate: Date }
      select: Record<string, unknown>
    }
    expect(firstQuery.where).toEqual({
      organizationId: ORG,
      agentId: AGENT,
      workDate: new Date("2026-07-15T00:00:00.000Z"),
    })
    expect(firstQuery.select).not.toHaveProperty("startLatitude")
    expect(firstQuery.select).not.toHaveProperty("startLongitude")
    expect(firstQuery.select).not.toHaveProperty("events")
    expect(firstQuery.select.workforceShiftSnapshot).toEqual({
      select: { timezone: true, plannedStartAt: true, plannedEndAt: true },
    })
    expect(firstQuery.select.workforceWorkdayScheduleSnapshot).toEqual({
      select: { segments: true, sites: true },
    })
  })

  it("returns no segment context when a snapshot has no current or future segment", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "COMPLETED",
      startedAt: new Date("2026-07-15T05:00:00.000Z"),
      pausedAt: null,
      completedAt: new Date("2026-07-15T06:00:00.000Z"),
      totalPausedSeconds: 0,
      workforceShiftSnapshot: {
        timezone: "Asia/Baku",
        plannedStartAt: new Date("2026-07-15T05:00:00.000Z"),
        plannedEndAt: new Date("2026-07-15T14:00:00.000Z"),
      },
      workforceWorkdayScheduleSnapshot: {
        segments: [{ mode: "REMOTE", siteId: null, startTime: "06:00", endTime: "07:00" }],
        sites: [],
      },
    } as never)

    const response = await GET(request("?date=2026-07-15"))

    await expect(response.json()).resolves.toMatchObject({
      data: { workday: { schedule: { segment: null } } },
    })
  })
})
