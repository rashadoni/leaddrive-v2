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
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/workday${query}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: ORG,
    agentId: AGENT,
    role: "AGENT",
    tenantCapabilities: { routeField: true, workforceHrm: true },
  } as any)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
})

afterEach(() => vi.useRealTimers())

describe("GET /api/v1/mtm/mobile/workday", () => {
  it("requires mobile authentication", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    expect((await GET(request())).status).toBe(401)
  })

  it("lets a manager read their own workday through the explicit worktime permission", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: ORG,
      agentId: AGENT,
      role: "MANAGER",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    } as any)
    expect((await GET(request())).status).toBe(200)
  })

  it("rejects an unknown role before querying workdays", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: ORG,
      agentId: AGENT,
      role: "OWNER",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    } as any)
    expect((await GET(request())).status).toBe(403)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
  })

  it("returns a capability-disabled response before reading workforce data", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: ORG,
      agentId: AGENT,
      role: "AGENT",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as any)

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
      },
    })
    const firstQuery = vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.calls[0][0] as any
    expect(firstQuery.where).toEqual({
      organizationId: ORG,
      agentId: AGENT,
      workDate: new Date("2026-07-15T00:00:00.000Z"),
    })
  })
})
