import type { PrismaClient } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFundShadowPostgresFixture, fundShadowDatabase } from "../../scripts/event-platform/fixtures/fund-shadow-postgres"

// Control-flow proof only: these mocks do not establish PostgreSQL/RLS/COMMIT
// or Kafka semantics. The unchanged 14-test real-PG suite and combined gate do.
type MockClient = {
  options: unknown
  $queryRawUnsafe: ReturnType<typeof vi.fn>
  $executeRawUnsafe: ReturnType<typeof vi.fn>
  $disconnect: ReturnType<typeof vi.fn>
}
const mocks = vi.hoisted(() => ({ clients: [] as MockClient[], construct: vi.fn(), spawn: vi.fn() }))
vi.mock("@prisma/client", () => ({ PrismaClient: vi.fn(function(options: unknown) { return mocks.construct(options) }) }))
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }))

const adminUrl = "postgresql://postgres:postgres@127.0.0.1:5432/event_platform_test"
const options = { isolationLevel: "Serializable" as const, maxWait: 5000, timeout: 15000 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.clients.length = 0
  mocks.construct.mockImplementation((configuration: unknown) => {
    const client: MockClient = { options: configuration,
      $queryRawUnsafe: vi.fn(async () => [{ rolname: "event_app" }, { rolname: "event_migrator" }]),
      $executeRawUnsafe: vi.fn(async () => 1), $disconnect: vi.fn(async () => {}),
    }
    mocks.clients.push(client)
    return client
  })
  mocks.spawn.mockReturnValue({ status: 0 })
})
afterEach(() => { vi.unstubAllEnvs() })

describe("shared disposable Fund fixture boundary", () => {
  it.each([
    "", "postgresql://postgres:postgres@localhost:5432/event_platform_test",
    "postgresql://postgres:postgres@192.0.2.1:5432/event_platform_test",
    "postgres://postgres:postgres@127.0.0.1:5432/event_platform_test",
    "postgresql://other:postgres@127.0.0.1:5432/event_platform_test",
    "postgresql://postgres:other@127.0.0.1:5432/event_platform_test",
    "postgresql://postgres:postgres@127.0.0.1/event_platform_test",
    "postgresql://postgres:postgres@127.0.0.1:0/event_platform_test",
    "postgresql://postgres:postgres@127.0.0.1:5432/production",
    `${adminUrl}?schema=public`, `${adminUrl}#fragment`,
  ])("rejects a non-contract URL before creating a client: %s", value => {
    vi.stubEnv("DATABASE_URL", adminUrl)
    vi.stubEnv("FUND_SHADOW_TEST_DATABASE_URL", adminUrl)
    expect(() => createFundShadowPostgresFixture({ adminUrl: value, environment: "test" })).toThrow()
    expect(mocks.construct).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it("requires an explicit synthetic environment and cannot substitute production", async () => {
    expect(() => createFundShadowPostgresFixture({ adminUrl, environment: "production" as "test" })).toThrow()
    for (const environment of ["test", "testbroker"] as const) {
      const fixture = createFundShadowPostgresFixture({ adminUrl, environment })
      expect(fixture.topic).toBe(`ld.${environment}.finance.events.v1`)
      expect(() => fixture.scratch).toThrow("not ready")
      expect(() => fixture.sql("SELECT 1")).toThrow("not ready")
      await fixture.close()
    }
    expect(mocks.construct).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it("requires existing bootstrap roles and never creates or drops shared roles", async () => {
    const fixture = createFundShadowPostgresFixture({ adminUrl, environment: "test" })
    const original = mocks.construct.getMockImplementation()!
    mocks.construct.mockImplementation(configuration => {
      const client = original(configuration) as MockClient
      client.$queryRawUnsafe.mockResolvedValue([])
      return client
    })
    await expect(fixture.setup()).rejects.toThrow("migration role bootstrap")
    expect(mocks.clients).toHaveLength(1)
    expect(mocks.clients[0].$executeRawUnsafe).not.toHaveBeenCalled()
    expect(mocks.clients[0].$disconnect).toHaveBeenCalledOnce()
    await fixture.close()
    expect(mocks.clients[0].$disconnect).toHaveBeenCalledOnce()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it("does not DROP a database after an unconfirmed failed CREATE", async () => {
    const failure = new Error("synthetic CREATE refusal")
    const fixture = createFundShadowPostgresFixture({ adminUrl, environment: "test" })
    const original = mocks.construct.getMockImplementation()!
    mocks.construct.mockImplementation(configuration => {
      const client = original(configuration) as MockClient
      client.$executeRawUnsafe.mockRejectedValue(failure)
      return client
    })
    await expect(fixture.setup()).rejects.toBe(failure)
    const calls = mocks.clients[0].$executeRawUnsafe.mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatch(/^CREATE DATABASE "ld_fund_shadow_[0-9]+_[a-f0-9]{12}"$/)
    expect(mocks.clients[0].$disconnect).toHaveBeenCalledOnce()
    await fixture.close()
    expect(mocks.clients[0].$executeRawUnsafe).toHaveBeenCalledTimes(1)
  })

  it("cleans exactly its confirmed database on a later setup failure without logging SQL or config", async () => {
    const fixture = createFundShadowPostgresFixture({ adminUrl, environment: "testbroker" })
    mocks.spawn.mockReturnValue({ status: 1, stderr: "sensitive synthetic SQL/connection details" })
    await expect(fixture.setup()).rejects.toThrow(/^Disposable Fund fixture SQL failed$/)
    expect(mocks.clients).toHaveLength(2)
    const [admin, scratch] = mocks.clients
    const create = admin.$executeRawUnsafe.mock.calls[0][0] as string
    expect(admin.$executeRawUnsafe.mock.calls).toEqual([[create], [create.replace("CREATE DATABASE", "DROP DATABASE")]])
    expect(scratch.$disconnect).toHaveBeenCalledOnce()
    expect(admin.$disconnect).toHaveBeenCalledOnce()
    expect(scratch.$disconnect.mock.invocationCallOrder[0]).toBeLessThan(admin.$executeRawUnsafe.mock.invocationCallOrder[1])
    for (const client of mocks.clients) {
      const url = new URL((client.options as { datasources: { db: { url: string } } }).datasources.db.url)
      expect(url.searchParams.get("connection_limit")).toBe("1")
      expect(url.searchParams.get("connect_timeout")).toBe("5")
      expect(url.searchParams.get("pool_timeout")).toBe("5")
    }
    await fixture.close()
    expect(admin.$executeRawUnsafe).toHaveBeenCalledTimes(2)
  })
})

function transactionHarness(commitFailure?: Error) {
  const events: string[] = []
  const real = {
    $queryRawUnsafe: vi.fn(async () => { events.push("QUERY"); return [{ value: 7 }] }),
    $executeRawUnsafe: vi.fn(async () => { events.push("EXECUTE"); return 1 }),
  }
  const transaction = vi.fn(async (work: (tx: typeof real) => Promise<unknown>, _options: unknown) => {
    events.push("BEGIN")
    try {
      const result = await work(real)
      events.push("CALLBACK_RETURNED")
      if (commitFailure) throw commitFailure
      events.push("COMMIT")
      return result
    } catch (error) { events.push("ROLLBACK"); throw error }
  })
  return { events, real, transaction, client: { $transaction: transaction } as unknown as PrismaClient }
}

describe("Fund fixture transaction instrumentation", () => {
  it("places afterCommit after the real factory resolves and preserves result and SQL timeout options", async () => {
    const h = transactionHarness(), result = { value: "durable" }
    const db = fundShadowDatabase(h.client, {
      afterQuery: async query => { expect(query).toBe("SELECT 7"); h.events.push("AFTER_QUERY") },
      afterExecute: async query => { expect(query).toBe("INSERT synthetic"); h.events.push("AFTER_EXECUTE") },
      beforeCommit: async () => { h.events.push("BEFORE_COMMIT") },
      afterCommit: async () => { h.events.push("AFTER_COMMIT") },
    })
    expect(await db.$transaction(async tx => {
      expect(await tx.$queryRawUnsafe("SELECT 7")).toEqual([{ value: 7 }])
      expect(await tx.$executeRawUnsafe("INSERT synthetic")).toBe(1)
      return result
    }, options)).toBe(result)
    expect(h.events).toEqual(["BEGIN", "QUERY", "AFTER_QUERY", "EXECUTE", "AFTER_EXECUTE", "BEFORE_COMMIT", "CALLBACK_RETURNED", "COMMIT", "AFTER_COMMIT"])
    expect(h.transaction.mock.calls[0][1]).toBe(options)
    expect(options).toEqual({ isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 })
  })

  it.each(["work", "beforeCommit", "commit"])("never calls afterCommit on %s rejection", async phase => {
    const failure = new Error(`synthetic ${phase} rejection`)
    const h = transactionHarness(phase === "commit" ? failure : undefined), afterCommit = vi.fn(async () => {})
    const db = fundShadowDatabase(h.client, { afterCommit,
      beforeCommit: async () => { if (phase === "beforeCommit") throw failure },
    })
    await expect(db.$transaction(async () => { if (phase === "work") throw failure; return 42 }, options)).rejects.toBe(failure)
    expect(afterCommit).not.toHaveBeenCalled()
    expect(h.events).not.toContain("COMMIT")
    expect(h.events.at(-1)).toBe("ROLLBACK")
  })

  it("does not misrepresent an afterCommit failure as a SQL rollback", async () => {
    const h = transactionHarness(), failure = new Error("synthetic post-COMMIT receipt loss")
    const db = fundShadowDatabase(h.client, { afterCommit: async () => { throw failure } })
    await expect(db.$transaction(async () => 42, options)).rejects.toBe(failure)
    expect(h.events).toEqual(["BEGIN", "CALLBACK_RETURNED", "COMMIT"])
  })

  it("can hold acknowledgement after COMMIT without holding the underlying transaction", async () => {
    const h = transactionHarness()
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { entered = resolve })
    const db = fundShadowDatabase(h.client, { afterCommit: async () => { entered(); await held } })
    let returned = false
    const running = db.$transaction(async () => 42, options).then(value => { returned = true; return value })
    try {
      await ready
      expect(h.events).toEqual(["BEGIN", "CALLBACK_RETURNED", "COMMIT"])
      expect(returned).toBe(false)
    } finally { release() }
    expect(await running).toBe(42)
  })

  it("observes only the original execute rejection, not an afterExecute injection", async () => {
    const h = transactionHarness(), failure = new Error("synthetic SQL rejection"), observed = vi.fn()
    h.real.$executeRawUnsafe.mockRejectedValueOnce(failure)
    const db = fundShadowDatabase(h.client, { onExecuteError: observed })
    await expect(db.$transaction(tx => tx.$executeRawUnsafe("INSERT synthetic", "id"), options)).rejects.toBe(failure)
    expect(observed).toHaveBeenCalledExactlyOnceWith({ query: "INSERT synthetic", values: ["id"], error: failure })
    observed.mockClear()
    const after = fundShadowDatabase(h.client, { onExecuteError: observed, afterExecute: async () => { throw failure } })
    await expect(after.$transaction(tx => tx.$executeRawUnsafe("INSERT synthetic", "id"), options)).rejects.toBe(failure)
    expect(observed).not.toHaveBeenCalled()
  })
})
