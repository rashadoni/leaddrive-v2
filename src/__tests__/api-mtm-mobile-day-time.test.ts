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

import { GET } from "@/app/api/v1/mtm/mobile/day-time/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

/** The agent's own «ring of the day» on «Bu gün» (owner, 2026-11-02). */
const request = () => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/day-time", { headers: { Authorization: "Bearer valid-token" } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-02T08:00:00.000Z"))
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: "org-1", agentId: "agent-1", role: "AGENT", tenantCapabilities: { routeField: true, workforceHrm: false } } as never)
})
afterEach(() => vi.useRealTimers())

describe("GET /mobile/day-time", () => {
  it("says where his day of today went", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "workday-1", startedAt: new Date("2026-11-02T05:00:00.000Z"), completedAt: null } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { workdayId: "workday-1", type: "PAUSE", occurredAt: new Date("2026-11-02T07:00:00.000Z"), appliedAt: null },
      { workdayId: "workday-1", type: "RESUME", occurredAt: new Date("2026-11-02T07:20:00.000Z"), appliedAt: null },
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      { agentId: "agent-1", checkInAt: new Date("2026-11-02T05:30:00.000Z"), checkOutAt: new Date("2026-11-02T06:15:00.000Z") },
    ] as never)

    const body = await (await GET(request())).json()

    expect(body.data.dayTime).toEqual({ startedAt: "2026-11-02T05:00:00.000Z", totalMinutes: 180, visitMinutes: 45, breakMinutes: 20, travelMinutes: 115 })
    // His own day only.
    const where = (vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.calls[0][0] as any).where
    expect(where).toMatchObject({ organizationId: "org-1", agentId: "agent-1" })
  })

  it("has nothing before the day is started", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
    const body = await (await GET(request())).json()
    expect(body.data.dayTime).toBeNull()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
  })
})
