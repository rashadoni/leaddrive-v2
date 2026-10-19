import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
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
import { runAsScheduledWork } from "@/lib/scheduled-work"
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
  mocks.tx.$executeRaw.mockResolvedValue(1)
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

  it("takes the caller's locks on its own transaction once the fence lets it in, in one order", async () => {
    const order: string[] = []
    mocks.tx.$executeRawUnsafe.mockImplementation(async (_sql: string, key: string) => { order.push(key) })
    mocks.tx.$executeRaw.mockImplementation(async (_sql: TemplateStringsArray, key: string) => { order.push(key) })

    const result = await withSocialMonitoringTenantCollectionFence(
      "org-1",
      async () => {
        order.push("collect")
        return "collected"
      },
      { lockKeys: ["lead:b", "lead:a", "lead:b"] },
    )

    expect(result).toEqual({ allowed: true, value: "collected" })
    expect(order).toEqual(["social-monitoring-clean-slate:org-1", "lead:a", "lead:b", "collect"])
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it("takes none of the caller's locks when the clean-slate reset has closed the fence", async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({
      settings: { socialMonitoringCleanSlate: { collectionBlocked: true } },
    })
    const collect = vi.fn(async () => "should-not-run")

    const result = await withSocialMonitoringTenantCollectionFence("org-1", collect, { lockKeys: ["lead:a"] })

    expect(result).toEqual({ allowed: false, reason: "social_monitoring_collection_blocked" })
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
    expect(collect).not.toHaveBeenCalled()
  })

  it("refuses the caller's locks inside a fence already held, which has no transaction to take them on", async () => {
    const collect = vi.fn(async () => "should-not-run")

    await expect(withSocialMonitoringTenantCollectionFence(
      "org-1",
      () => withSocialMonitoringTenantCollectionFence("org-1", collect, { lockKeys: ["lead:a"] }),
    )).rejects.toThrow(/lockKeys need a fence of their own/)

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
    expect(collect).not.toHaveBeenCalled()
  })
})

describe("who may open a fence transaction, and when", () => {
  /** Fence transactions open right now, by organization, in the order they opened. */
  let open: string[]
  let opened: string[]

  beforeEach(() => {
    open = []
    opened = []
    mocks.transaction.mockImplementation(async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => {
      const organizationId = getRlsContext()?.orgId ?? "?"
      open.push(organizationId)
      opened.push(organizationId)
      try {
        return await rlsStorage.run({ orgId: organizationId, inTx: true }, () => operation(mocks.tx))
      } finally {
        open.splice(open.indexOf(organizationId), 1)
      }
    })
  })

  /** A fence of `organizationId` whose callback runs until `release()`. */
  function fenceUntilReleased(organizationId: string, kind: "collection" | "import" = "collection") {
    let release!: () => void
    const released = new Promise<void>((resolve) => { release = resolve })
    const callback = async () => { await released; return organizationId }
    // The tenant scope the callers give the fence; the mock above reads it.
    const result = rlsStorage.run({ orgId: organizationId }, () => kind === "collection"
      ? withSocialMonitoringTenantCollectionFence(organizationId, callback)
      : withSocialMonitoringImportFence({
          organizationId,
          providerRunId: "provider-run-1",
          providerKey: "APIFY",
          expectedStatuses: ["IMPORTING"],
        }, callback))
    return { result, release }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it("lets one organization's openers into Postgres one at a time, whichever fence they open", async () => {
    const first = fenceUntilReleased("org-1")
    const second = fenceUntilReleased("org-1", "import")
    const third = fenceUntilReleased("org-1")
    await settle()
    expect(opened).toEqual(["org-1"])

    first.release()
    await settle()
    expect(opened).toEqual(["org-1", "org-1"])
    expect(open).toEqual(["org-1"])

    second.release()
    third.release()
    expect(await Promise.all([first.result, second.result, third.result])).toEqual([
      { allowed: true, value: "org-1" },
      { allowed: true, value: "org-1" },
      { allowed: true, value: "org-1" },
    ])
    expect(opened).toHaveLength(3)
  })

  it("keeps at most two fence transactions open at once, whatever the organizations", async () => {
    const fences = ["org-1", "org-2", "org-3"].map((organizationId) => fenceUntilReleased(organizationId))
    await settle()
    expect(open).toEqual(["org-1", "org-2"])

    fences[0].release()
    await settle()
    expect(open).toEqual(["org-2", "org-3"])

    fences[1].release()
    fences[2].release()
    await Promise.all(fences.map((fence) => fence.result))
    expect(open).toEqual([])
  })

  it("never lets scheduled work hold both slots, so another organization's webhook still gets one", async () => {
    const cronFirst = await runAsScheduledWork(async () => fenceUntilReleased("org-1"))
    const cronSecond = await runAsScheduledWork(async () => fenceUntilReleased("org-2"))
    await settle()
    expect(open).toEqual(["org-1"])

    const webhook = fenceUntilReleased("org-3")
    await settle()
    expect(open).toEqual(["org-1", "org-3"])
    webhook.release()
    expect(await webhook.result).toEqual({ allowed: true, value: "org-3" })

    cronFirst.release()
    await settle()
    expect(open).toEqual(["org-2"])
    cronSecond.release()
    await Promise.all([cronFirst.result, cronSecond.result])
  })

  it("holds up no one of its own organization while scheduled work waits for its slot", async () => {
    const cronFirst = await runAsScheduledWork(async () => fenceUntilReleased("org-1"))
    const cronSecond = await runAsScheduledWork(async () => fenceUntilReleased("org-2"))
    const webhookOfSecond = fenceUntilReleased("org-2")
    await settle()
    expect(open).toEqual(["org-1", "org-2"])
    webhookOfSecond.release()
    expect(await webhookOfSecond.result).toEqual({ allowed: true, value: "org-2" })

    cronFirst.release()
    cronSecond.release()
    await Promise.all([cronFirst.result, cronSecond.result])
    expect(opened).toEqual(["org-1", "org-2", "org-2"])
  })

  it("passes the turn on when a fence transaction fails, and the opener gets the failure", async () => {
    mocks.transaction.mockImplementationOnce(async () => {
      throw new Error("Timed out fetching a new connection from the connection pool")
    })
    const failed = fenceUntilReleased("org-1")
    const next = fenceUntilReleased("org-1")
    next.release()

    await expect(failed.result).rejects.toThrow(/Timed out fetching/)
    expect(await next.result).toEqual({ allowed: true, value: "org-1" })
  })

  it("gives the organization's turn up once the transaction's time is over, even if its callback never ends", async () => {
    vi.useFakeTimers()
    try {
      const stuck = fenceUntilReleased("org-1")
      const next = fenceUntilReleased("org-1")
      next.release()
      await vi.advanceTimersByTimeAsync(30 * 60_000)
      expect(opened).toEqual(["org-1"])

      // Prisma has rolled the stuck transaction back by now (maxWait + timeout),
      // and Postgres has released its lock.
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await next.result).toEqual({ allowed: true, value: "org-1" })
      expect(opened).toEqual(["org-1", "org-1"])
      stuck.release()
      await stuck.result
    } finally {
      vi.useRealTimers()
    }
  })
})
