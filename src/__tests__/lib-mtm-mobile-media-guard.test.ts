import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  readMtmMobileMediaUploadPolicy,
  releaseMtmMobileMediaUpload,
  requireMtmMobileMediaAccess,
  reserveMtmMobileMediaUpload,
} from "@/lib/mtm/mobile-media-guard"
import { _resetPublicAbuseGuardForTests } from "@/lib/public-abuse-guard"

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetPublicAbuseGuardForTests()
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)
})

afterEach(() => {
  _resetPublicAbuseGuardForTests()
  vi.unstubAllEnvs()
})

describe("MTM mobile media guard", () => {
  it("fails closed when the Field tenant capability is disabled", async () => {
    const forbidden = await requireMtmMobileMediaAccess({
      ...AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    })

    expect(forbidden?.status).toBe(403)
    expect(await forbidden?.json()).toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "route-field",
    })
  })

  it("rejects a non-Field mobile role before looking up tenant entitlements", async () => {
    const forbidden = await requireMtmMobileMediaAccess({ ...AUTH, role: "MANAGER" })

    expect(forbidden?.status).toBe(403)
    expect(await forbidden?.json()).toMatchObject({
      code: "MTM_MOBILE_CAPABILITY_REQUIRED",
      capability: "FIELD_EXECUTE",
    })
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
  })

  it("returns bounded Retry-After when the per-device upload budget is exhausted", async () => {
    for (let index = 0; index < 20; index += 1) {
      const reservation = await reserveMtmMobileMediaUpload({ auth: AUTH, deviceId: "device-1" })
      expect(reservation.allowed).toBe(true)
      if (reservation.allowed) await releaseMtmMobileMediaUpload(reservation.reservation)
    }

    const limited = await reserveMtmMobileMediaUpload({ auth: AUTH, deviceId: "device-1" })

    expect(limited.allowed).toBe(false)
    if (!limited.allowed) {
      expect(limited.response.status).toBe(429)
      expect(limited.response.headers.get("Retry-After")).toMatch(/^[1-9]\d?$/)
      expect(await limited.response.json()).toMatchObject({ code: "MTM_MOBILE_MEDIA_RATE_LIMITED" })
    }
  })

  it("fails media protection closed with a retryable 503 when Redis is unavailable in production", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const unavailable = await reserveMtmMobileMediaUpload({ auth: AUTH, deviceId: "device-1" })

    expect(unavailable.allowed).toBe(false)
    if (!unavailable.allowed) {
      expect(unavailable.response.status).toBe(503)
      expect(unavailable.response.headers.get("Retry-After")).toBe("1")
      expect(await unavailable.response.json()).toMatchObject({ code: "MTM_MOBILE_MEDIA_GUARD_UNAVAILABLE" })
    }
  })

  it("uses an exact server cohort, never a client contract header, to select isolation", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-28T13:00:00.000Z"),
    } as never)

    const policy = await readMtmMobileMediaUploadPolicy({
      auth: AUTH,
      deviceId: "device-1",
      now: new Date("2026-08-28T14:00:00.000Z"),
    })

    expect(policy).toEqual({
      contractVersion: 2,
      deviceId: "device-1",
      isolated: true,
      requiresDeviceCohort: false,
      cohortEpoch: "2026-08-28T13:00:00.000Z",
    })
    expect(prisma.mtmMobileSyncCohort.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: AUTH.orgId,
        agentId: AUTH.agentId,
        deviceId: "device-1",
        stream: "media",
        enabled: true,
      }),
    }))
  })

  it("fails closed instead of returning an enrolled agent to legacy when the device header is missing", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-28T13:00:00.000Z"),
    } as never)

    const policy = await readMtmMobileMediaUploadPolicy({
      auth: AUTH,
      deviceId: null,
      now: new Date("2026-08-28T14:00:00.000Z"),
    })

    expect(policy).toEqual({
      contractVersion: 2,
      deviceId: null,
      isolated: false,
      requiresDeviceCohort: true,
      cohortEpoch: "2026-08-28T13:00:00.000Z",
    })
    const lookup = vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mock.calls[0][0] as any
    expect(lookup.where.deviceId).toBeUndefined()
  })

  it("fails closed when a different device header is presented after enrollment", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ updatedAt: new Date("2026-08-28T13:00:00.000Z") } as never)

    const policy = await readMtmMobileMediaUploadPolicy({
      auth: AUTH,
      deviceId: "other-device",
      now: new Date("2026-08-28T14:00:00.000Z"),
    })

    expect(policy).toMatchObject({
      contractVersion: 2,
      deviceId: "other-device",
      isolated: false,
      requiresDeviceCohort: true,
    })
  })
})
