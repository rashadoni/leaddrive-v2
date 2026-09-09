import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  withJobLease: vi.fn(),
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => Promise<unknown>) => callback(),
}))
vi.mock("@/lib/mtm/mobile-sync-v2-retention", () => ({
  pruneMtmMobileSyncV2Retention: vi.fn(),
}))
vi.mock("@/lib/mtm/mobile-route-command-retention", () => ({
  pruneMtmMobileRouteCommandReceipts: vi.fn(),
}))
vi.mock("@/lib/cron/job-lease", () => ({ withJobLease: mocks.withJobLease }))

import { POST } from "@/app/api/cron/mtm-cleanup/route"
import { prisma } from "@/lib/prisma"
import { pruneMtmMobileSyncV2Retention } from "@/lib/mtm/mobile-sync-v2-retention"
import { pruneMtmMobileRouteCommandReceipts } from "@/lib/mtm/mobile-route-command-retention"
import { withJobLease } from "@/lib/cron/job-lease"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAgentLatestLocation.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAlert.deleteMany).mockResolvedValue({ count: 0 } as never)
  mocks.withJobLease.mockImplementation(async (
    _options: unknown,
    work: () => Promise<unknown>,
  ) => ({ status: "completed", value: await work() }))
  vi.mocked(pruneMtmMobileSyncV2Retention).mockResolvedValue({
    retentionFloorsAdvanced: 0,
    deletedChanges: 0,
    deletedSnapshots: 0,
    deletedSnapshotItems: 0,
    deletedSnapshotLeases: 0,
    changesTenantsScanned: 0,
    snapshotsTenantsScanned: 0,
    snapshotLeasesTenantsScanned: 0,
    changesCursorBusy: false,
    snapshotsCursorBusy: false,
    snapshotLeasesCursorBusy: false,
    changesMorePending: false,
    snapshotsMorePending: false,
    snapshotLeasesMorePending: false,
  })
  vi.mocked(pruneMtmMobileRouteCommandReceipts).mockResolvedValue({
    deletedReceipts: 0,
    tenantsScanned: 0,
    morePending: false,
    cursorBusy: false,
  })
})

describe("POST /api/cron/mtm-cleanup", () => {
  it("prunes rebuildable v2/GPS and receipt state without touching v1 idempotency or outbox rows", async () => {
    const response = await POST(new NextRequest("http://localhost:3000/api/cron/mtm-cleanup", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret" },
    }))

    expect(response.status).toBe(200)
    expect(pruneMtmMobileSyncV2Retention).toHaveBeenCalledTimes(1)
    expect(pruneMtmMobileRouteCommandReceipts).toHaveBeenCalledTimes(1)
    expect(withJobLease).toHaveBeenCalledWith(
      { name: "mtm-cleanup", ttlMs: 60_000 },
      expect.any(Function),
    )
    expect(prisma.mtmSyncOperation.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.deleteMany).not.toHaveBeenCalled()
  })

  it("bounds resolved-alert retention independently from GPS and v1 sync state", async () => {
    const staleAlerts = Array.from({ length: 5_000 }, (_, index) => ({ id: `alert-${index}` }))
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue(staleAlerts as never)
    vi.mocked(prisma.mtmAlert.deleteMany).mockResolvedValue({ count: staleAlerts.length } as never)

    const response = await POST(new NextRequest("http://localhost:3000/api/cron/mtm-cleanup", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret" },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        deletedResolvedAlerts: 5_000,
        alertsRetentionMorePending: true,
      },
    })
    expect(prisma.mtmAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 5_000,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }))
    expect(prisma.mtmAlert.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: staleAlerts.map((row) => row.id) } },
    })
    expect(prisma.mtmSyncOperation.deleteMany).not.toHaveBeenCalled()
  })

  it("treats an overlapping cleanup lease as a successful no-op", async () => {
    mocks.withJobLease.mockResolvedValueOnce({ status: "skipped", reason: "already_running" })

    const response = await POST(new NextRequest("http://localhost:3000/api/cron/mtm-cleanup", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret" },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { skipped: "already_running" } })
    expect(pruneMtmMobileSyncV2Retention).not.toHaveBeenCalled()
    expect(pruneMtmMobileRouteCommandReceipts).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.findMany).not.toHaveBeenCalled()
  })

  it("still runs route-command retention when the independent v2 cache domain fails", async () => {
    vi.mocked(pruneMtmMobileSyncV2Retention).mockRejectedValueOnce(new Error("v2 unavailable"))

    const response = await POST(new NextRequest("http://localhost:3000/api/cron/mtm-cleanup", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret" },
    }))

    expect(response.status).toBe(500)
    expect(pruneMtmMobileRouteCommandReceipts).toHaveBeenCalledTimes(1)
  })
})
