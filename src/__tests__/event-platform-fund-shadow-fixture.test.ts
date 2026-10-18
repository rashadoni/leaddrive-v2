import type { PrismaClient } from "@prisma/client"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import ts from "typescript"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFundShadowPostgresFixture, fundShadowDatabase } from "./fixtures/fund-shadow-postgres"

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

const testFixtureModule = "src/__tests__/fixtures/fund-shadow-postgres"
function fixtureImports(file: string, source: string): string[] {
  // TypeScript's scanner includes static/dynamic imports, re-exports and
  // CommonJS requires; comments containing the path are not importers.
  return ts.preProcessFile(source, true, true).importedFiles.flatMap(({ fileName }) => {
    const specifier = fileName.replace(/\.[cm]?[jt]sx?$/, "")
    const target = specifier.startsWith("@/") ? resolve("src", specifier.slice(2))
      : specifier.startsWith(".") ? resolve(dirname(file), specifier) : resolve(specifier)
    return target === resolve(testFixtureModule) ? [file] : []
  })
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".next", ".git"].includes(entry.name)) return []
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

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
  it("keeps the unscoped test fixture reachable only by its two tests and the admitted combined drill", () => {
    const roots = ["src", "scripts", "apps", "services", "workers", "telegram-bridge", "ops", "deploy", "tests", ".github"]
    const files = [...roots.flatMap(sourceFiles), ...readdirSync(".", { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)).map(entry => resolve(entry.name))]
    const importers = files.flatMap(file => {
      const source = readFileSync(file, "utf8")
      // Only parse source with this module's basename, never dependencies.
      return source.includes("fund-shadow-postgres") ? fixtureImports(file, source) : []
    }).map(file => relative(process.cwd(), file))
    expect([...new Set(importers)].sort()).toEqual([
      "scripts/event-platform/test-broker-postgres.ts",
      "src/__tests__/event-platform-fund-shadow-fixture.test.ts",
      "src/__tests__/event-platform-fund-shadow-postgres.test.ts",
    ])
  })

  it("recognizes alias, relative, re-export, dynamic and CommonJS fixture imports", () => {
    const file = resolve("src/lib/forbidden-fixture-import.ts")
    for (const source of [
      'import { createFundShadowPostgresFixture } from "@/__tests__/fixtures/fund-shadow-postgres"',
      'export * from "../__tests__/fixtures/fund-shadow-postgres"',
      'const fixture = import("../__tests__/fixtures/fund-shadow-postgres.ts")',
      'const fixture = require("../__tests__/fixtures/fund-shadow-postgres")',
    ]) expect(fixtureImports(file, source)).toEqual([file])
    expect(fixtureImports(file, '// import "../__tests__/fixtures/fund-shadow-postgres"')).toEqual([])
  })

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

  it.each(["", "f".repeat(39), "F".repeat(40), "f".repeat(41), "main"])("rejects an invalid fixture release pin before client creation: %s", codeSha => {
    expect(() => createFundShadowPostgresFixture({ adminUrl, environment: "testbroker", codeSha })).toThrow()
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
