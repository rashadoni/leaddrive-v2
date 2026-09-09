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
vi.mock("@/lib/public-abuse-guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/public-abuse-guard")>("@/lib/public-abuse-guard")
  return { ...actual, consumePublicRateLimit: vi.fn() }
})

import { POST } from "@/app/api/v2/mtm/mobile/location/batch/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { mtmMobileLocationPayloadSha256 } from "@/lib/mtm/mobile-location-idempotency"
import { _resetPublicAbuseGuardForTests, consumePublicRateLimit } from "@/lib/public-abuse-guard"

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  role: "AGENT",
  email: "agent@example.test",
  name: "Agent",
  tenantCapabilities: { routeField: true, workforceHrm: false },
}
const WORKDAY = {
  id: "workday-1",
  status: "STARTED",
  startedAt: new Date("2026-08-28T08:00:00.000Z"),
  completedAt: null,
}
const RECORDED_AT = "2026-08-28T09:00:00.000Z"

function request(body: unknown, deviceId = "device-1") {
  return new NextRequest("http://localhost/api/v2/mtm/mobile/location/batch", {
    method: "POST",
    headers: {
      Authorization: "Bearer mobile",
      "content-type": "application/json",
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
    },
    body: JSON.stringify(body),
  })
}

function point(clientLocationId: string, latitude = 40.4) {
  return { clientLocationId, latitude, longitude: 49.8, accuracy: 8, speed: 2, recordedAt: RECORDED_AT }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-28T10:00:00.000Z"))
  _resetPublicAbuseGuardForTests()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: AUTH.orgId,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true, "route-field": true },
  } as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(WORKDAY as never)
  vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmAgentLocation.create)
    .mockResolvedValueOnce({ id: "location-1" } as never)
    .mockResolvedValueOnce({ id: "location-2" } as never)
  vi.mocked(prisma.mtmAgentLatestLocation.updateMany)
    .mockResolvedValueOnce({ count: 0 } as never)
    .mockResolvedValueOnce({ count: 1 } as never)
  vi.mocked(prisma.mtmAgentLatestLocation.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
    updatedAt: new Date("2026-08-28T10:00:00.000Z"),
  } as never)
  vi.mocked(consumePublicRateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
})

afterEach(() => {
  _resetPublicAbuseGuardForTests()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("POST /api/v2/mtm/mobile/location/batch", () => {
  it("stores an ordered, bounded batch and advances the latest-location projection in the same transaction", async () => {
    const response = await POST(request({ points: [point("location-client-2", 40.5), point("location-client-1", 40.4)] }))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { appliedClientLocationIds: ["location-client-2", "location-client-1"], replayedClientLocationIds: [] },
    })
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmAgentLatestLocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: AUTH.orgId, agentId: AUTH.agentId, sourceLocationId: "location-1" }),
    }))
    expect(prisma.mtmRoute.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
  })

  it("replays only the same client location payload without creating another raw point", async () => {
    const digest = mtmMobileLocationPayloadSha256({
      workdayId: WORKDAY.id,
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 8,
      speed: 2,
      heading: null,
      altitude: null,
      battery: null,
      recordedAt: new Date(RECORDED_AT),
    })
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([
      { clientLocationId: "location-client-1", payloadSha256: digest },
    ] as never)

    const response = await POST(request({ points: [point("location-client-1")] }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { appliedClientLocationIds: [], replayedClientLocationIds: ["location-client-1"] },
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns a visible conflict when one durable ID is reused for different coordinates", async () => {
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([
      { clientLocationId: "location-client-1", payloadSha256: "different-payload" },
    ] as never)

    const response = await POST(request({ points: [point("location-client-1")] }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_LOCATION_ID_CONFLICT",
      clientLocationId: "location-client-1",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("identifies only the point outside the supplied workday without returning its coordinates", async () => {
    const response = await POST(request({
      points: [
        point("location-inside"),
        { ...point("location-outside"), recordedAt: "2026-08-28T07:59:59.000Z" },
      ],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "a point is outside the supplied workday",
      code: "MTM_LOCATION_OUTSIDE_WORKDAY",
      clientLocationId: "location-outside",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("identifies the point rejected when the workday closes during the write transaction", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst)
      .mockResolvedValueOnce(WORKDAY as never)
      .mockResolvedValueOnce({
        ...WORKDAY,
        status: "COMPLETED",
        completedAt: new Date("2026-08-28T08:30:00.000Z"),
      } as never)

    const response = await POST(request({ points: [point("location-after-close")] }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_LOCATION_OUTSIDE_WORKDAY",
      clientLocationId: "location-after-close",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("rejects data older than the approved seven-day offline horizon before it writes", async () => {
    const response = await POST(request({ points: [{ ...point("location-old"), recordedAt: "2026-08-20T09:00:00.000Z" }] }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "recordedAt must be valid, no more than 7 days old, and not in the future",
      code: "MTM_LOCATION_OFFLINE_HORIZON_EXCEEDED",
      clientLocationId: "location-old",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("identifies a point with invalid coordinates without echoing its raw data", async () => {
    const response = await POST(request({ points: [{ ...point("location-bad-coordinates"), latitude: 91 }] }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "latitude/longitude are out of range",
      code: "MTM_LOCATION_COORDINATES_INVALID",
      clientLocationId: "location-bad-coordinates",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("identifies a point with invalid metrics without echoing its raw data", async () => {
    const response = await POST(request({ points: [{ ...point("location-bad-metric"), speed: 501 }] }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "invalid location telemetry",
      code: "MTM_LOCATION_METRICS_INVALID",
      clientLocationId: "location-bad-metric",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("does not echo a missing or invalid client location ID", async () => {
    const response = await POST(request({ points: [{ ...point("location-ignored"), clientLocationId: "" }] }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "each point needs clientLocationId (1..100 characters)",
      code: "MTM_LOCATION_CLIENT_ID_INVALID",
    })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("keeps the server-side Field tenant capability mandatory", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)

    const response = await POST(request({ points: [point("location-client-1")] }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED", capabilityId: "route-field" })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("requires an exact server-side GPS cohort before it parses or writes a batch", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)

    const response = await POST(request({ points: [point("location-client-1")] }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MOBILE_GPS_BATCH_COHORT_DISABLED" })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("requires a valid device selector for the cohort-bound v2 endpoint", async () => {
    const response = await POST(request({ points: [point("location-client-1")] }, ""))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_GPS_BATCH_DEVICE_REQUIRED" })
    expect(prisma.mtmMobileSyncCohort.findFirst).not.toHaveBeenCalled()
  })

  it("returns a bounded Retry-After when the separate device GPS guard is busy", async () => {
    vi.mocked(consumePublicRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, unavailable: false })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, unavailable: false })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 12, unavailable: false })

    const response = await POST(request({ points: [point("location-client-1")] }))

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("12")
    expect(await response.json()).toMatchObject({ code: "MTM_LOCATION_BATCH_RATE_LIMITED" })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })
})
