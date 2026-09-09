import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  MTM_MOBILE_ROUTE_COMMAND_RETENTION_ROWS_PER_TENANT,
  pruneMtmMobileRouteCommandReceipts,
} from "@/lib/mtm/mobile-route-command-retention"

const now = new Date("2026-12-02T00:00:00.000Z")
type OrganizationScanArgs = { where?: { id?: { gt?: string; lte?: string } } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ lastOrganizationId: null }] as never)
  vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-1" }] as never)
  vi.mocked(prisma.mtmMobileSyncRetentionCursor.update).mockResolvedValue({ jobName: "route-commands" } as never)
  vi.mocked(prisma.mtmMobileRouteCommandReceipt.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmMobileRouteCommandReceipt.deleteMany).mockResolvedValue({ count: 0 } as never)
})

describe("MTM mobile route-command bounded retention", () => {
  it("deletes only the selected expired receipt IDs for the scanned tenant", async () => {
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findMany).mockResolvedValue([{ id: "receipt-1" }] as never)
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.deleteMany).mockResolvedValue({ count: 1 } as never)

    await expect(pruneMtmMobileRouteCommandReceipts(now)).resolves.toEqual({
      deletedReceipts: 1,
      tenantsScanned: 1,
      morePending: false,
      cursorBusy: false,
    })
    expect(prisma.mtmMobileRouteCommandReceipt.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: MTM_MOBILE_ROUTE_COMMAND_RETENTION_ROWS_PER_TENANT,
      select: { id: true },
    })
    expect(prisma.mtmMobileRouteCommandReceipt.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        id: { in: ["receipt-1"] },
        expiresAt: { lte: now },
      },
    })
    expect(prisma.mtmSyncOperation.deleteMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.deleteMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
    )
  })

  it("uses the locked cursor as a busy fence without scanning or deleting", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmMobileSyncRetentionCursor.findUnique).mockResolvedValue({ jobName: "route-commands" } as never)

    await expect(pruneMtmMobileRouteCommandReceipts(now)).resolves.toEqual({
      deletedReceipts: 0,
      tenantsScanned: 0,
      morePending: false,
      cursorBusy: true,
    })
    expect(prisma.organization.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.deleteMany).not.toHaveBeenCalled()
  })

  it("caps one noisy tenant and persists only the opaque last-scanned cursor", async () => {
    const capped = Array.from(
      { length: MTM_MOBILE_ROUTE_COMMAND_RETENTION_ROWS_PER_TENANT },
      (_, index) => ({ id: `receipt-${index}` }),
    )
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findMany).mockResolvedValue(capped as never)
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.deleteMany).mockResolvedValue({ count: capped.length } as never)

    await expect(pruneMtmMobileRouteCommandReceipts(now)).resolves.toMatchObject({
      deletedReceipts: capped.length,
      morePending: true,
      tenantsScanned: 1,
    })
    expect(prisma.mtmMobileSyncRetentionCursor.update).toHaveBeenCalledWith({
      where: { jobName: "route-commands" },
      data: { lastOrganizationId: "org-1" },
    })
  })

  it("round-robins at the lexical tenant boundary", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ lastOrganizationId: "org-b" }] as never)
    vi.mocked(prisma.organization.findMany).mockImplementation(async (args: unknown) => {
      const id = (args as OrganizationScanArgs | undefined)?.where?.id
      if (id?.gt === "org-b") return [{ id: "org-c" }]
      if (id?.lte === "org-b") return [{ id: "org-a" }, { id: "org-b" }]
      return []
    })

    await pruneMtmMobileRouteCommandReceipts(now)

    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { gt: "org-b" } },
      take: 11,
    }))
    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { lte: "org-b" } },
    }))
  })
})
