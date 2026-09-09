import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mockState = vi.hoisted(() => ({
  runWithRlsBypass: vi.fn((fn: () => Promise<Response>) => fn()),
  requireCronAuth: vi.fn(),
  reapStaleMonitoringSourceLeases: vi.fn(),
  repairLegacyFacebookScenarioSources: vi.fn(),
  runDueMonitoringSources: vi.fn(),
  runSocialCoverageSloChecks: vi.fn(),
  recordSocialMonitoringScheduleTick: vi.fn(),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mockState.runWithRlsBypass,
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: mockState.requireCronAuth,
}))

vi.mock("@/lib/social/monitoring-collector", () => ({
  reapStaleMonitoringSourceLeases: mockState.reapStaleMonitoringSourceLeases,
  runDueMonitoringSources: mockState.runDueMonitoringSources,
}))

vi.mock("@/lib/social/coverage-slo", () => ({
  runSocialCoverageSloChecks: mockState.runSocialCoverageSloChecks,
}))

vi.mock("@/lib/social/monitoring-scenarios", () => ({
  repairLegacyFacebookScenarioSources: mockState.repairLegacyFacebookScenarioSources,
}))

// Пульс планировщика (#665): по его отметкам интерфейс отличает работающее
// расписание от снятой на сервере строки планировщика.
vi.mock("@/lib/social/monitoring-schedule-status", () => ({
  recordSocialMonitoringScheduleTick: mockState.recordSocialMonitoringScheduleTick,
}))

import { POST } from "@/app/api/cron/social-monitoring-sources/route"

function request(path = "/api/cron/social-monitoring-sources?limit=7&organizationId=org-1") {
  return new NextRequest(`http://localhost${path}`, { method: "POST" })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.requireCronAuth.mockReturnValue(null)
  mockState.recordSocialMonitoringScheduleTick.mockResolvedValue(undefined)
  mockState.reapStaleMonitoringSourceLeases.mockResolvedValue({ scanned: 1, reaped: 1, runsFailed: 1, hasMore: false })
  mockState.repairLegacyFacebookScenarioSources.mockResolvedValue({
    scanned: 1,
    organizations: 1,
    scenarios: 1,
    failedOrganizations: 0,
    hasMore: false,
  })
  mockState.runDueMonitoringSources.mockResolvedValue({
    selected: 1,
    foundTotal: 0,
    newTotal: 0,
    results: [],
  })
  mockState.runSocialCoverageSloChecks.mockResolvedValue({ evaluated: 0, created: 0, candidates: [] })
})

describe("POST /api/cron/social-monitoring-sources", () => {
  it("requires cron auth and runs due monitoring sources inside RLS bypass", async () => {
    const res = await POST(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockState.runWithRlsBypass).toHaveBeenCalledTimes(1)
    expect(mockState.requireCronAuth).toHaveBeenCalledWith(expect.any(NextRequest))
    expect(mockState.reapStaleMonitoringSourceLeases).toHaveBeenCalledWith({ organizationId: "org-1", limit: 100 })
    expect(mockState.repairLegacyFacebookScenarioSources).toHaveBeenCalledWith({ organizationId: "org-1", limit: 28 })
    expect(mockState.runDueMonitoringSources).toHaveBeenCalledWith({ organizationId: "org-1", limit: 7 })
    expect(mockState.runSocialCoverageSloChecks).toHaveBeenCalledWith({ organizationId: "org-1" })
    expect(json.data).toMatchObject({ selected: 1 })
    expect(json.data.reaper).toMatchObject({ reaped: 1, runsFailed: 1 })
    expect(json.data.scenarioSourceRepair).toMatchObject({ scanned: 1, scenarios: 1 })
    expect(json.data.manualRunJobs).toBeUndefined()
    expect(json.data.slo).toMatchObject({ evaluated: 0, created: 0 })
  })

  it("returns the cron auth failure without running collectors", async () => {
    mockState.requireCronAuth.mockReturnValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))

    const res = await POST(request())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
    expect(mockState.reapStaleMonitoringSourceLeases).not.toHaveBeenCalled()
    expect(mockState.repairLegacyFacebookScenarioSources).not.toHaveBeenCalled()
    expect(mockState.runDueMonitoringSources).not.toHaveBeenCalled()
    expect(mockState.runSocialCoverageSloChecks).not.toHaveBeenCalled()
  })

  it("keeps running due sources when the bounded legacy repair fails", async () => {
    mockState.repairLegacyFacebookScenarioSources.mockRejectedValueOnce(new Error("repair failed"))

    const res = await POST(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockState.runDueMonitoringSources).toHaveBeenCalledWith({ organizationId: "org-1", limit: 7 })
    expect(mockState.runSocialCoverageSloChecks).toHaveBeenCalledWith({ organizationId: "org-1" })
    expect(json.data.scenarioSourceRepair).toMatchObject({
      scenarios: 0,
      failedOrganizations: 1,
    })
  })
  // Пульс планировщика (#665). Он пишется ДО обхода и намеренно не лиза:
  // сериализовать сбор ради наблюдаемости нельзя — это задержало бы reaper и
  // оставляло бы running-строку, на которую смотрит карантин деплоя.
  it("records the scheduler heartbeat before sweeping and never blocks the sweep", async () => {
    const order: string[] = []
    mockState.recordSocialMonitoringScheduleTick.mockImplementation(async () => {
      order.push("heartbeat")
    })
    mockState.reapStaleMonitoringSourceLeases.mockImplementation(async () => {
      order.push("reaper")
      return { scanned: 0, reaped: 0, runsFailed: 0, hasMore: false }
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(order).toEqual(["heartbeat", "reaper"])
    expect(mockState.runDueMonitoringSources).toHaveBeenCalledOnce()
  })

  it("still sweeps when the heartbeat write fails", async () => {
    mockState.recordSocialMonitoringScheduleTick.mockRejectedValue(new Error("heartbeat down"))

    const response = await POST(request())

    // Пульс — наблюдаемость. Он не имеет права останавливать сбор.
    expect(response.status).toBe(200)
    expect(mockState.runDueMonitoringSources).toHaveBeenCalledOnce()
  })
})
