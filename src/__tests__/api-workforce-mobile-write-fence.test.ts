import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAdminAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/mobile-write-fence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/mobile-write-fence")>(
    "@/lib/workforce/mobile-write-fence",
  )
  return {
    ...actual,
    getWorkforceMobileWriteFenceConfiguration: vi.fn(),
    setWorkforceMobileWriteFence: vi.fn(),
    upsertWorkforceMobileWriteCohort: vi.fn(),
    disableWorkforceMobileWriteCohort: vi.fn(),
  }
})

import { GET, PUT as putFence } from "@/app/api/v1/workforce/configuration/mobile-write-fence/route"
import { DELETE, PUT as putCohort } from "@/app/api/v1/workforce/configuration/mobile-write-fence/cohorts/route"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  disableWorkforceMobileWriteCohort,
  getWorkforceMobileWriteFenceConfiguration,
  setWorkforceMobileWriteFence,
  upsertWorkforceMobileWriteCohort,
  WorkforceMobileWriteFenceError,
} from "@/lib/workforce/mobile-write-fence"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin" }
type Handler = (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.17",
      "user-agent": "workforce-fence-test",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  // Keep the route-construction calls intact: they prove all four exported
  // controls use the session-only administrator wrapper. Reset only services
  // whose return values are deliberately changed per test.
  vi.mocked(getWorkforceMobileWriteFenceConfiguration).mockReset()
  vi.mocked(setWorkforceMobileWriteFence).mockReset()
  vi.mocked(upsertWorkforceMobileWriteCohort).mockReset()
  vi.mocked(disableWorkforceMobileWriteCohort).mockReset()
  vi.mocked(getWorkforceMobileWriteFenceConfiguration).mockResolvedValue({
    fence: { mode: "LEGACY_ALLOWED", updatedByUserId: null, createdAt: null, updatedAt: null },
    cohorts: [],
    cohortLimit: 200,
  } as never)
  vi.mocked(setWorkforceMobileWriteFence).mockResolvedValue({
    mode: "FROZEN",
    updatedAt: new Date("2026-08-29T12:00:00.000Z"),
  } as never)
  vi.mocked(upsertWorkforceMobileWriteCohort).mockResolvedValue({
    id: "cohort-1",
    agentId: "agent-1",
    deviceId: "device-1",
    enabled: true,
    expiresAt: null,
    updatedAt: new Date("2026-08-29T12:00:00.000Z"),
  } as never)
  vi.mocked(disableWorkforceMobileWriteCohort).mockResolvedValue({
    id: "cohort-1",
    agentId: "agent-1",
    deviceId: "device-1",
    enabled: false,
    expiresAt: null,
    updatedAt: new Date("2026-08-29T12:00:00.000Z"),
  } as never)
})

describe("Workforce mobile write fence configuration API", () => {
  it("uses the session-only Workforce administrator boundary for every control-plane operation", () => {
    expect(withWorkforceSessionAdminAuth).toHaveBeenCalledTimes(4)
  })

  it("returns the server-owned tenant posture and cohorts", async () => {
    const response = await (GET as unknown as Handler)(request("GET", "/api/v1/workforce/configuration/mobile-write-fence"), AUTH)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { fence: { mode: "LEGACY_ALLOWED" }, cohorts: [] },
    })
    expect(getWorkforceMobileWriteFenceConfiguration).toHaveBeenCalledWith(AUTH.orgId)
  })

  it("validates and audits an explicit release-posture change", async () => {
    const response = await (putFence as unknown as Handler)(request(
      "PUT",
      "/api/v1/workforce/configuration/mobile-write-fence",
      { mode: "FROZEN" },
    ), AUTH)

    expect(response.status).toBe(200)
    expect(setWorkforceMobileWriteFence).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      actorUserId: AUTH.userId,
      update: { mode: "FROZEN" },
      audit: expect.objectContaining({
        actorUserId: AUTH.userId,
        ipAddress: "203.0.113.17",
        userAgent: "workforce-fence-test",
      }),
    }))
  })

  it("does not pass an unchecked mode or cohort body to the service", async () => {
    const invalidFence = await (putFence as unknown as Handler)(request(
      "PUT",
      "/api/v1/workforce/configuration/mobile-write-fence",
      { mode: "UNSAFE" },
    ), AUTH)
    const invalidCohort = await (putCohort as unknown as Handler)(request(
      "PUT",
      "/api/v1/workforce/configuration/mobile-write-fence/cohorts",
      { agentId: "agent-1", deviceId: "device-1", unexpected: true },
    ), AUTH)

    expect(invalidFence.status).toBe(400)
    expect(invalidCohort.status).toBe(400)
    expect(setWorkforceMobileWriteFence).not.toHaveBeenCalled()
    expect(upsertWorkforceMobileWriteCohort).not.toHaveBeenCalled()
  })

  it("enables or disables a cohort through audited, non-delete controls", async () => {
    const upsertResponse = await (putCohort as unknown as Handler)(request(
      "PUT",
      "/api/v1/workforce/configuration/mobile-write-fence/cohorts",
      { agentId: "agent-1", deviceId: "device-1", expiresAt: null },
    ), AUTH)
    const disableResponse = await (DELETE as unknown as Handler)(request(
      "DELETE",
      "/api/v1/workforce/configuration/mobile-write-fence/cohorts",
      { agentId: "agent-1", deviceId: "device-1" },
    ), AUTH)

    expect(upsertResponse.status).toBe(200)
    expect(disableResponse.status).toBe(200)
    expect(upsertWorkforceMobileWriteCohort).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      actorUserId: AUTH.userId,
      cohort: { agentId: "agent-1", deviceId: "device-1", expiresAt: null },
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
    expect(disableWorkforceMobileWriteCohort).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      actorUserId: AUTH.userId,
      cohort: { agentId: "agent-1", deviceId: "device-1" },
    }))
  })

  it("returns cohort safety failures without hiding their actionable status", async () => {
    vi.mocked(setWorkforceMobileWriteFence).mockRejectedValue(new WorkforceMobileWriteFenceError(
      "At least one active cohort is required",
      "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED",
    ))
    vi.mocked(disableWorkforceMobileWriteCohort).mockRejectedValue(new WorkforceMobileWriteFenceError(
      "Cohort not found",
      "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_NOT_FOUND",
    ))

    const fenceResponse = await (putFence as unknown as Handler)(request(
      "PUT",
      "/api/v1/workforce/configuration/mobile-write-fence",
      { mode: "COHORT_ONLY" },
    ), AUTH)
    const cohortResponse = await (DELETE as unknown as Handler)(request(
      "DELETE",
      "/api/v1/workforce/configuration/mobile-write-fence/cohorts",
      { agentId: "agent-1", deviceId: "device-1" },
    ), AUTH)

    expect(fenceResponse.status).toBe(409)
    await expect(fenceResponse.json()).resolves.toMatchObject({ code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED" })
    expect(cohortResponse.status).toBe(404)
    await expect(cohortResponse.json()).resolves.toMatchObject({ code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_NOT_FOUND" })
  })
})
