import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    organization: {
      findUnique: vi.fn(),
    },
  }
  return {
    tx,
    transaction: vi.fn(),
    queryRawUnsafe: vi.fn(),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}))

import { getRlsContext, rlsStorage } from "@/lib/rls-context"
import {
  checkSocialMonitoringTenantCollectionFence,
  withSocialMonitoringImportFence,
  withSocialMonitoringTenantCollectionFence,
} from "@/lib/social/monitoring-import-fence"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(async (
    operation: (tx: typeof mocks.tx) => Promise<unknown>,
  ) => rlsStorage.run(
    { orgId: "org-1", inTx: true },
    () => operation(mocks.tx),
  ))
  mocks.tx.$executeRawUnsafe.mockResolvedValue(1)
  mocks.tx.$queryRawUnsafe.mockResolvedValue([{
    settings: {},
    status: "IMPORTING",
    purgedAt: null,
  }])
  mocks.queryRawUnsafe.mockResolvedValue([{
    settings: {},
    status: "IMPORTING",
    purgedAt: null,
  }])
  mocks.tx.organization.findUnique.mockResolvedValue({ settings: {} })
})

describe("social monitoring persistence fences", () => {
  it("runs provider persistence in a fresh tenant RLS scope outside the lock transaction marker", async () => {
    let callbackContext: ReturnType<typeof getRlsContext>

    const result = await withSocialMonitoringImportFence({
      organizationId: "org-1",
      providerRunId: "provider-run-1",
      providerKey: "APIFY",
      expectedStatuses: ["IMPORTING"],
    }, async () => {
      callbackContext = getRlsContext()
      return "persisted"
    })

    expect(result).toEqual({ allowed: true, value: "persisted" })
    expect(callbackContext!).toEqual({ orgId: "org-1" })
    expect(callbackContext!).not.toHaveProperty("inTx")
  })

  it("runs tenant collection callbacks outside the lock transaction marker", async () => {
    let callbackContext: ReturnType<typeof getRlsContext>

    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      async () => {
        callbackContext = getRlsContext()
        return "collected"
      },
    )

    expect(result).toEqual({ allowed: true, value: "collected" })
    expect(callbackContext!).toEqual({ orgId: "org-1" })
    expect(callbackContext!).not.toHaveProperty("inTx")
  })

  it("reuses a provider import fence for nested tenant media scheduling", async () => {
    const result = await withSocialMonitoringImportFence({
      organizationId: "org-1",
      providerRunId: "provider-run-1",
      providerKey: "APIFY",
      expectedStatuses: ["IMPORTING"],
    }, () => withSocialMonitoringTenantCollectionFence(
      "org-1",
      async () => "scheduled",
    ))

    expect(result).toEqual({
      allowed: true,
      value: { allowed: true, value: "scheduled" },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
  })

  it("reuses an active tenant fence when a nested transaction checks the same tenant", async () => {
    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      async () => checkSocialMonitoringTenantCollectionFence(
        mocks.tx,
        "org-1",
      ),
    )

    expect(result).toEqual({
      allowed: true,
      value: { allowed: true, value: true },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(mocks.tx.organization.findUnique).toHaveBeenCalledTimes(1)
  })

  it("fails closed instead of nesting a collection fence for a different tenant", async () => {
    const collect = vi.fn(async () => "should-not-run")
    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      () => withSocialMonitoringTenantCollectionFence("org-2", collect),
    )

    expect(result).toEqual({
      allowed: true,
      value: {
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(mocks.tx.organization.findUnique).toHaveBeenCalledTimes(1)
    expect(collect).not.toHaveBeenCalled()
  })

  it("reuses a tenant collection fence for a nested provider dispatch", async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([{
      settings: {
        socialMonitoringPaidRuns: { emergencyStopped: false },
      },
      status: "QUEUED",
      purgedAt: null,
    }])
    const persist = vi.fn(async () => "dispatched")
    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      () => withSocialMonitoringImportFence({
        organizationId: "org-1",
        providerRunId: "provider-run-1",
        providerKey: "APIFY",
        expectedStatuses: ["QUEUED"],
        blockOnEmergencyStop: true,
      }, persist),
    )

    expect(result).toEqual({
      allowed: true,
      value: { allowed: true, value: "dispatched" },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledOnce()
  })

  it("revalidates and blocks a nested provider dispatch under a held tenant fence", async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([{
      settings: {},
      status: "BLOCKED",
      purgedAt: null,
    }])
    const persist = vi.fn(async () => "should-not-run")

    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      () => withSocialMonitoringImportFence({
        organizationId: "org-1",
        providerRunId: "provider-run-1",
        providerKey: "APIFY",
        expectedStatuses: ["QUEUED"],
      }, persist),
    )

    expect(result).toEqual({
      allowed: true,
      value: {
        allowed: false,
        reason: "social_monitoring_import_run_inactive",
      },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
  })

  it("keeps the emergency stop authoritative in a nested provider dispatch", async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([{
      settings: {
        socialMonitoringPaidRuns: { emergencyStopped: true },
      },
      status: "QUEUED",
      purgedAt: null,
    }])
    const persist = vi.fn(async () => "should-not-run")

    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      () => withSocialMonitoringImportFence({
        organizationId: "org-1",
        providerRunId: "provider-run-1",
        providerKey: "APIFY",
        expectedStatuses: ["QUEUED"],
        blockOnEmergencyStop: true,
      }, persist),
    )

    expect(result).toEqual({
      allowed: true,
      value: {
        allowed: false,
        reason: "social_monitoring_collection_blocked",
      },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
  })

  it("fails closed instead of nesting a fence for a different tenant", async () => {
    const persist = vi.fn(async () => "should-not-run")
    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      () => withSocialMonitoringImportFence({
        organizationId: "org-2",
        providerRunId: "provider-run-2",
        providerKey: "APIFY",
        expectedStatuses: ["IMPORTING"],
      }, persist),
    )

    expect(result).toEqual({
      allowed: true,
      value: {
        allowed: false,
        reason: "social_monitoring_import_run_inactive",
      },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
