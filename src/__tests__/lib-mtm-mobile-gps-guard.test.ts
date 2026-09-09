import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { readMtmMobileGpsBatchPilot } from "@/lib/mtm/mobile-gps-guard"

const AUTH = { orgId: "org-1", agentId: "agent-1" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)
})

describe("MTM mobile GPS batch cohort", () => {
  it("requires an exact enrolled device rather than trusting an APK header as an opt-in", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-28T14:00:00.000Z"),
    } as never)

    const pilot = await readMtmMobileGpsBatchPilot({
      auth: AUTH,
      deviceId: "device-1",
      now: new Date("2026-08-28T15:00:00.000Z"),
    })

    expect(pilot).toEqual({
      enrolled: true,
      deviceId: "device-1",
      cohortEpoch: "2026-08-28T14:00:00.000Z",
    })
    expect(prisma.mtmMobileSyncCohort.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: AUTH.orgId,
        agentId: AUTH.agentId,
        deviceId: "device-1",
        stream: "gps",
        enabled: true,
      }),
    }))
  })

  it("keeps the v2 endpoint off for a missing, invalid, or un-enrolled device", async () => {
    await expect(readMtmMobileGpsBatchPilot({ auth: AUTH, deviceId: null })).resolves.toMatchObject({ enrolled: false })
    await expect(readMtmMobileGpsBatchPilot({ auth: AUTH, deviceId: "invalid device" })).resolves.toMatchObject({ enrolled: false })
    await expect(readMtmMobileGpsBatchPilot({ auth: AUTH, deviceId: "other-device" })).resolves.toMatchObject({
      enrolled: false,
      deviceId: "other-device",
    })
  })

  it("does not enable batch GPS while the additive cohort table is unavailable", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockRejectedValue({ code: "P2021" } as never)

    await expect(readMtmMobileGpsBatchPilot({ auth: AUTH, deviceId: "device-1" })).resolves.toEqual({
      enrolled: false,
      deviceId: "device-1",
      cohortEpoch: null,
    })
  })
})
