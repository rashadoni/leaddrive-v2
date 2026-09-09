import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  MTM_MOBILE_SYNC_V2_RETENTION_CHANGE_ROWS_PER_TENANT,
  pruneMtmMobileSyncV2Retention,
} from "@/lib/mtm/mobile-sync-v2-retention"

const now = new Date("2026-09-11T00:00:00.000Z")
type OrganizationScanArgs = { where?: { id?: { gt?: string; lte?: string } } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ lastOrganizationId: null }] as never)
  vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-1" }] as never)
  vi.mocked(prisma.mtmMobileSyncRetentionCursor.update).mockResolvedValue({ jobName: "changes" } as never)
  vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmMobileSyncChange.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncStream.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshot.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmMobileSyncSnapshot.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotLease.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotLease.deleteMany).mockResolvedValue({ count: 0 } as never)
})

describe("MTM mobile sync v2 bounded retention", () => {
  it("advances a stream floor and deletes only the selected expired IDs in the same bounded transaction", async () => {
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([{
      id: "change-42",
      stream: "routes",
      revision: 42n,
    }] as never)
    vi.mocked(prisma.mtmMobileSyncStream.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmMobileSyncChange.deleteMany).mockResolvedValue({ count: 1 } as never)

    await expect(pruneMtmMobileSyncV2Retention(now)).resolves.toMatchObject({
      deletedChanges: 1,
      retentionFloorsAdvanced: 1,
      deletedSnapshots: 0,
      deletedSnapshotLeases: 0,
      changesTenantsScanned: 1,
    })

    expect(prisma.mtmMobileSyncChange.groupBy).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncStream.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        stream: "routes",
        retentionFloorRevision: { lt: 42n },
      },
      data: { retentionFloorRevision: 42n },
    })
    expect(prisma.mtmMobileSyncChange.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        stream: "routes",
        id: { in: ["change-42"] },
        expiresAt: { lte: now },
      },
    })
    expect(prisma.mtmMobileSyncStream.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.mtmMobileSyncChange.deleteMany.mock.invocationCallOrder[0]!)
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
    )
    expect(prisma.mtmSyncOperation.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.deleteMany).not.toHaveBeenCalled()
  })

  it("uses a locked cursor as a busy fence and performs no scan or delete while it is held", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmMobileSyncRetentionCursor.findUnique).mockResolvedValue({ jobName: "changes" } as never)

    await expect(pruneMtmMobileSyncV2Retention(now)).resolves.toMatchObject({
      changesCursorBusy: true,
      snapshotsCursorBusy: true,
      snapshotLeasesCursorBusy: true,
      changesTenantsScanned: 0,
      deletedChanges: 0,
      deletedSnapshots: 0,
      deletedSnapshotLeases: 0,
    })

    expect(prisma.organization.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncRetentionCursor.update).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncChange.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncSnapshot.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncSnapshotLease.deleteMany).not.toHaveBeenCalled()
  })

  it("round-robins across the lexical tenant boundary and persists only the opaque last scanned tenant", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ lastOrganizationId: "org-b" }] as never)
    vi.mocked(prisma.organization.findMany).mockImplementation(async (args: unknown) => {
      const id = (args as OrganizationScanArgs | undefined)?.where?.id
      if (id?.gt === "org-b") return [{ id: "org-c" }]
      if (id?.lte === "org-b") return [{ id: "org-a" }, { id: "org-b" }]
      return []
    })

    await pruneMtmMobileSyncV2Retention(now)

    expect(prisma.mtmMobileSyncRetentionCursor.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastOrganizationId: "org-b" },
    }))
    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { gt: "org-b" } },
      take: 11,
    }))
    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { lte: "org-b" } },
    }))
  })

  it("reaps snapshot items before an empty parent and never asks the database for a cascade delete", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ lastOrganizationId: null }] as never)
      .mockResolvedValueOnce([{ lastOrganizationId: null }] as never)
      .mockResolvedValueOnce([{ id: "snapshot-1" }] as never)
      .mockResolvedValueOnce([{ lastOrganizationId: null }] as never)
    vi.mocked(prisma.mtmMobileSyncSnapshot.findMany)
      .mockResolvedValueOnce([{ id: "snapshot-1" }] as never)
      .mockResolvedValueOnce([] as never)
    vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([{ id: "item-1" }] as never)
    vi.mocked(prisma.mtmMobileSyncSnapshotItem.deleteMany).mockResolvedValue({ count: 1 } as never)

    await expect(pruneMtmMobileSyncV2Retention(now)).resolves.toMatchObject({
      deletedSnapshotItems: 1,
      deletedSnapshots: 0,
    })

    expect(prisma.mtmMobileSyncSnapshotItem.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        snapshotId: { in: ["snapshot-1"] },
        id: { in: ["item-1"] },
      },
    })
    expect(prisma.mtmMobileSyncSnapshot.deleteMany).not.toHaveBeenCalled()
  })

  it("locks an exact parent set before its empty-child recheck and bounded parent delete", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ lastOrganizationId: null }] as never)
      .mockResolvedValueOnce([{ lastOrganizationId: null }] as never)
      .mockResolvedValueOnce([{ id: "snapshot-1" }] as never)
      .mockResolvedValueOnce([{ lastOrganizationId: null }] as never)
    vi.mocked(prisma.mtmMobileSyncSnapshot.findMany)
      .mockResolvedValueOnce([{ id: "snapshot-1" }] as never)
      .mockResolvedValueOnce([{ id: "snapshot-1" }] as never)
    vi.mocked(prisma.mtmMobileSyncSnapshot.deleteMany).mockResolvedValue({ count: 1 } as never)

    await expect(pruneMtmMobileSyncV2Retention(now)).resolves.toMatchObject({
      deletedSnapshotItems: 0,
      deletedSnapshots: 1,
    })

    const parentLockIndex = prisma.$queryRaw.mock.calls.findIndex(([query]) => {
      const sql = query as { strings: readonly string[] }
      return sql.strings.join(" ").includes('FROM "mtm_mobile_sync_snapshots"')
    })
    expect(parentLockIndex).toBeGreaterThanOrEqual(0)
    const parentLockQuery = prisma.$queryRaw.mock.calls[parentLockIndex]![0] as {
      strings: readonly string[]
      values: unknown[]
    }
    expect(parentLockQuery.strings.join(" ")).toContain("FOR UPDATE")
    expect(parentLockQuery.values).toContain("snapshot-1")
    expect(prisma.$queryRaw.mock.invocationCallOrder[parentLockIndex]!)
      .toBeLessThan(prisma.mtmMobileSyncSnapshotItem.findMany.mock.invocationCallOrder[0]!)
    expect(prisma.$queryRaw.mock.invocationCallOrder[parentLockIndex]!)
      .toBeLessThan(prisma.mtmMobileSyncSnapshot.deleteMany.mock.invocationCallOrder[0]!)
    expect(prisma.mtmMobileSyncSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        id: { in: ["snapshot-1"] },
        expiresAt: { lte: now },
        items: { none: {} },
      },
    })
  })

  it("caps each tenant's change selection and protects a renewed lease with token plus observed expiry", async () => {
    const expiredAt = new Date("2026-09-10T00:00:00.000Z")
    const cappedChanges = Array.from(
      { length: MTM_MOBILE_SYNC_V2_RETENTION_CHANGE_ROWS_PER_TENANT },
      (_, index) => ({ id: `change-${index}`, stream: "routes", revision: BigInt(index + 1) }),
    )
    vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue(cappedChanges as never)
    vi.mocked(prisma.mtmMobileSyncSnapshotLease.findMany).mockResolvedValue([{
      stream: "routes",
      agentId: "agent-1",
      deviceId: "device-1",
      horizonKey: "v1:UTC:2026-09-10",
      leaseToken: "old-token",
      expiresAt: expiredAt,
    }] as never)
    vi.mocked(prisma.mtmMobileSyncSnapshotLease.deleteMany).mockResolvedValue({ count: 1 } as never)

    await expect(pruneMtmMobileSyncV2Retention(now)).resolves.toMatchObject({
      changesMorePending: true,
      deletedSnapshotLeases: 1,
    })

    expect(prisma.mtmMobileSyncChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: MTM_MOBILE_SYNC_V2_RETENTION_CHANGE_ROWS_PER_TENANT,
    }))
    expect(prisma.mtmMobileSyncSnapshotLease.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        OR: [{
          stream: "routes",
          agentId: "agent-1",
          deviceId: "device-1",
          horizonKey: "v1:UTC:2026-09-10",
          leaseToken: "old-token",
          expiresAt: expiredAt,
        }],
      },
    })
  })
})
