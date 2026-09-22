import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { dayKeyWeekday, demoPulsePosition, planDemoPulseDay } from "@/lib/mtm/demo-pulse-plan"
import { demoPulseAgents, demoPulseRouteExternalId, pulseDemoAgent } from "@/lib/mtm/demo-pulse"
import { localDateKeyToUtc } from "@/lib/mtm/mobile-week"

/**
 * Owner decision 2026-09-22: the LeadDrive Inc. demo organization is shown to
 * prospects and its field data ended on 9 August. The pulse gives demo agents
 * an ordinary day, every day.
 */
const TZ = "Asia/Baku"
const CUSTOMERS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]
// Tuesday 22 September 2026.
const DAY = "2026-09-22"
const MIDNIGHT = localDateKeyToUtc(DAY, TZ)

function plan(agentId = "agent-1", dayKey = DAY) {
  return planDemoPulseDay({ agentId, dayKey, localMidnight: localDateKeyToUtc(dayKey, TZ), customerIds: CUSTOMERS })
}

describe("the demo field day", () => {
  it("is the same plan on every tick", () => {
    expect(plan()).toEqual(plan())
    expect(plan("agent-2")).not.toEqual(plan())
  })

  it("is a working day: five stops in order, between nine and evening, with a published route before", () => {
    const day = plan()!
    const localHour = (at: Date) => (at.getTime() - MIDNIGHT.getTime()) / 3_600_000
    expect(day.stops).toHaveLength(5)
    expect(new Set(day.stops.map((stop) => stop.customerId)).size).toBe(5)
    expect(localHour(day.routePublishAt)).toBe(7)
    expect(localHour(day.shiftStartAt)).toBeGreaterThanOrEqual(9)
    expect(localHour(day.shiftStartAt)).toBeLessThan(9.5)
    let previous = day.shiftStartAt.getTime()
    for (const stop of day.stops) {
      expect(stop.checkInAt.getTime()).toBeGreaterThan(previous)
      expect(stop.checkOutAt.getTime() - stop.checkInAt.getTime()).toBe(stop.durationMinutes * 60_000)
      expect(stop.durationMinutes).toBeGreaterThanOrEqual(15)
      expect(stop.durationMinutes).toBeLessThanOrEqual(40)
      previous = stop.checkOutAt.getTime()
    }
    expect(day.shiftEndAt.getTime()).toBeGreaterThan(previous)
    expect(localHour(day.shiftEndAt)).toBeLessThan(19)
  })

  it("rests on Sunday and without customers", () => {
    expect(dayKeyWeekday("2026-09-27")).toBe(0)
    expect(plan("agent-1", "2026-09-27")).toBeNull()
    expect(planDemoPulseDay({ agentId: "a", dayKey: DAY, localMidnight: MIDNIGHT, customerIds: [] })).toBeNull()
  })

  it("puts the agent at the customer during a visit and on the road between them", () => {
    const day = plan()!
    const positions = new Map(CUSTOMERS.map((id, index) => [id, { latitude: 40 + index / 100, longitude: 49 + index / 100 }]))
    const [first, second] = day.stops
    const atFirst = demoPulsePosition(day, positions, new Date(first.checkInAt.getTime() + 60_000))!
    expect(atFirst).toEqual({ ...positions.get(first.customerId)!, isMoving: false })
    const between = demoPulsePosition(day, positions, new Date((first.checkOutAt.getTime() + second.checkInAt.getTime()) / 2))!
    expect(between.isMoving).toBe(true)
    const from = positions.get(first.customerId)!
    const to = positions.get(second.customerId)!
    expect(between.latitude).toBeCloseTo((from.latitude + to.latitude) / 2, 6)
    expect(demoPulsePosition(day, positions, new Date(day.shiftStartAt.getTime() - 1))).toBeNull()
    expect(demoPulsePosition(day, positions, day.shiftEndAt)).toBeNull()
  })
})

describe("who the pulse drives", () => {
  beforeEach(() => vi.clearAllMocks())

  it("only active AGENTs that have not signed in to the app for 30 days — never a real phone", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "demo-1", name: "Günel" }, { id: "phone", name: "Anar" }] as never)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([{ agentId: "phone" }] as never)
    const now = new Date("2026-09-22T08:00:00.000Z")

    expect(await demoPulseAgents("org-demo", now)).toEqual([{ id: "demo-1", name: "Günel" }])
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-demo", status: "ACTIVE", role: "AGENT" },
    }))
    expect(prisma.mtmAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: { in: ["MOBILE_LOGIN", "login"] }, createdAt: { gte: new Date("2026-08-23T08:00:00.000Z") } }),
    }))
  })

  it("runs only in organizations flagged by hand, and the flag is not a tenant capability", () => {
    const job = readFileSync("src/lib/mtm/demo-pulse.ts", "utf8")
    expect(job).toContain("where: { features: { array_contains: [MTM_DEMO_PULSE_FEATURE] } }")
    const capabilities = readFileSync("src/app/api/v1/settings/capabilities/route.ts", "utf8")
    expect(capabilities).not.toContain("mtm-demo-pulse")
  })
})

describe("one tick of a demo agent", () => {
  const agent = { id: "demo-1", name: "Günel" }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue(CUSTOMERS.map((customerId) => ({ customerId })) as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue(CUSTOMERS.map((id, index) => ({ id, name: `Aptek ${index}`, latitude: 40.4 + index / 100, longitude: 49.8 })) as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue({ id: "route-1", status: "PLANNED", startedAt: null } as never)
  })

  it("does nothing before the route is published", async () => {
    const result = await pulseDemoAgent({ organizationId: "org-demo", agent, timezone: TZ, now: new Date(MIDNIGHT.getTime() + 6 * 3_600_000) })
    expect(result.routeCreated).toBe(false)
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("publishes the day's route once, keyed by agent and day, before the shift", async () => {
    const result = await pulseDemoAgent({ organizationId: "org-demo", agent, timezone: TZ, now: new Date(MIDNIGHT.getTime() + 8 * 3_600_000) })
    expect(result).toMatchObject({ routeCreated: true, workday: "none", checkIns: 0 })
    const created = vi.mocked(prisma.mtmRoute.create).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(created.data).toMatchObject({
      organizationId: "org-demo",
      agentId: "demo-1",
      externalId: demoPulseRouteExternalId("demo-1", DAY),
      date: new Date(`${DAY}T00:00:00.000Z`),
      status: "PLANNED",
      totalPoints: 5,
    })
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ id: "route-1", status: "PLANNED", startedAt: null } as never)
    vi.mocked(prisma.mtmRoute.create).mockClear()
    await pulseDemoAgent({ organizationId: "org-demo", agent, timezone: TZ, now: new Date(MIDNIGHT.getTime() + 8.5 * 3_600_000) })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("steps aside when the agent has a shift the pulse did not open", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "real-shift", status: "STARTED", startedAt: MIDNIGHT } as never)
    const result = await pulseDemoAgent({ organizationId: "org-demo", agent, timezone: TZ, now: new Date(MIDNIGHT.getTime() + 11 * 3_600_000) })
    expect(result.workday).toBe("skipped")
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })
})

describe("the schedule", () => {
  it("runs every ten minutes through the managed cron block, and the endpoint answers the deploy smoke", () => {
    const install = readFileSync("scripts/install-resilience-crons.sh", "utf8")
    expect(install).toContain(`printf '%s\\n' "*/10 * * * * $TRIGGER /api/cron/mtm-demo-pulse >> $LOG 2>&1"`)
    expect(install).toContain("/cron-trigger\\.sh \\/api\\/cron\\/mtm-demo-pulse/ { next }")
    const route = readFileSync("src/app/api/cron/mtm-demo-pulse/route.ts", "utf8")
    expect(route.indexOf("requireCronAuth(req)")).toBeLessThan(route.indexOf("runMtmDemoPulseJob()"))
    expect(route).toContain('searchParams.get("smoke") === "1"')
  })
})
