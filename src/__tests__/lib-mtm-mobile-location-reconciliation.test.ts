import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_TTL_MS,
  MtmLatestLocationReconciliationCursorError,
  issueMtmLatestLocationReconciliationCursor,
  readMtmLatestLocationReconciliationCursor,
  reconcileMtmLatestLocations,
} from "@/lib/mtm/mobile-location-reconciliation"

const NOW = new Date("2026-08-29T10:00:00.000Z")
const RAW_RECORDED_AT = new Date("2026-08-28T09:00:00.000Z")

function rawLocation(id: string) {
  return {
    id,
    payloadSha256: null,
    latitude: 40.4093,
    longitude: 49.8671,
    accuracy: 8,
    speed: 2,
    heading: 90,
    altitude: 10,
    battery: 80,
    isMoving: true,
    recordedAt: RAW_RECORDED_AT,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgentLatestLocation.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("MTM latest-location reconciliation cursor", () => {
  it("seals a tenant-bound continuation and rejects expiry or tampering", () => {
    const nowMs = NOW.getTime()
    const cursor = issueMtmLatestLocationReconciliationCursor({
      organizationId: "org-1",
      afterAgentId: "agent-1",
      nowMs,
    })

    expect(cursor).toMatch(/^v1:/)
    expect(readMtmLatestLocationReconciliationCursor(cursor, nowMs)).toEqual({
      v: 1,
      organizationId: "org-1",
      afterAgentId: "agent-1",
      exp: nowMs + MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_TTL_MS,
    })
    expect(() => readMtmLatestLocationReconciliationCursor(cursor, nowMs + MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_TTL_MS))
      .toThrow(new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_EXPIRED"))
    expect(() => readMtmLatestLocationReconciliationCursor(`${cursor}x`, nowMs))
      .toThrow(new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID"))
  })
})

describe("reconcileMtmLatestLocations", () => {
  it("repairs a bounded, tenant-scoped page without writing raw GPS or v1 sync state", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1" },
      { id: "agent-2" },
      { id: "agent-3" },
    ] as never)
    vi.mocked(prisma.mtmAgentLocation.findFirst)
      .mockResolvedValueOnce(rawLocation("raw-1") as never)
      .mockResolvedValueOnce(rawLocation("raw-2") as never)

    await expect(reconcileMtmLatestLocations({
      organizationId: "org-1",
      afterAgentId: "agent-0",
      now: NOW,
      maxAgents: 2,
    })).resolves.toEqual({
      processedAgents: 2,
      reconciledLocations: 2,
      missingRawLocations: 0,
      morePending: true,
      nextAfterAgentId: "agent-2",
      retryableFailure: false,
    })

    const cutoff = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1_000)
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        status: "ACTIVE",
        id: { gt: "agent-0" },
        locations: {
          some: {
            organizationId: "org-1",
            recordedAt: { gte: cutoff },
            latitude: { gte: -90, lte: 90 },
            longitude: { gte: -180, lte: 180 },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true },
    })
    expect(prisma.mtmAgentLocation.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        agentId: "agent-1",
        recordedAt: { gte: cutoff },
        latitude: { gte: -90, lte: 90 },
        longitude: { gte: -180, lte: 180 },
      },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: expect.any(Object),
    })
    expect(prisma.mtmAgentLatestLocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        agentId: "agent-1",
        recordedAt: { lte: RAW_RECORDED_AT },
      },
      data: expect.objectContaining({
        sourceLocationId: "raw-1",
        recordedAt: RAW_RECORDED_AT,
        receivedAt: RAW_RECORDED_AT,
      }),
    }))
    expect(prisma.mtmAgentLocation.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.deleteMany).not.toHaveBeenCalled()
  })

  it("keeps the continuation before a failed agent so a retry cannot skip its projection", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1" },
      { id: "agent-2" },
    ] as never)
    vi.mocked(prisma.mtmAgentLocation.findFirst)
      .mockResolvedValueOnce(rawLocation("raw-1") as never)
      .mockResolvedValueOnce(rawLocation("raw-2") as never)
    vi.mocked(prisma.mtmAgentLatestLocation.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockRejectedValueOnce(new Error("projection unavailable"))

    await expect(reconcileMtmLatestLocations({
      organizationId: "org-1",
      now: NOW,
      maxAgents: 2,
    })).resolves.toEqual({
      processedAgents: 1,
      reconciledLocations: 1,
      missingRawLocations: 0,
      morePending: true,
      nextAfterAgentId: "agent-1",
      retryableFailure: true,
    })
    expect(prisma.mtmAgentLocation.findFirst).toHaveBeenCalledTimes(2)
    expect(prisma.mtmSyncOperation.updateMany).not.toHaveBeenCalled()
  })
})
