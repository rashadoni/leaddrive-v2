import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PrismaClient, type Prisma } from "@prisma/client"
import { workforceReconciliationCursorStore } from "@/lib/workforce/reconciliation-cursor-store"

const JOB = "workforce-claim-reconciliation-v1"
const testUrl = process.env.WORKFORCE_CURSOR_TEST_DATABASE_URL

describe("dormant Workforce cursor input guards", () => {
  it("rejects invalid bounded observations before database access", async () => {
    const db = { $queryRaw: vi.fn(), $transaction: vi.fn() }
    const store = workforceReconciliationCursorStore(db as unknown as PrismaClient)
    for (const expected of [{ cursor: "", version: 1 }, { cursor: null, version: 0 }, { cursor: null, version: 1.5 }]) {
      await expect(store.commit({ expected, nextCursor: null, ownerToken: "synthetic-owner" })).rejects.toThrow("WORKFORCE_CURSOR_STATE_INVALID")
    }
    await expect(store.commit({ expected: null, nextCursor: "x".repeat(513), ownerToken: "synthetic-owner" })).rejects.toThrow("WORKFORCE_CURSOR_STATE_INVALID")
    await expect(store.commit({ expected: null, nextCursor: null, ownerToken: "" })).rejects.toThrow("WORKFORCE_CURSOR_OWNER_INVALID")
    expect(db.$queryRaw).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("fails closed on version exhaustion without issuing a write", async () => {
    const db = { $queryRaw: vi.fn(), $transaction: vi.fn() }
    const store = workforceReconciliationCursorStore(db as unknown as PrismaClient)
    await expect(store.commit({ expected: { cursor: null, version: 2_147_483_647 }, nextCursor: null, ownerToken: "synthetic-owner" })).resolves.toBe("VERSION_EXHAUSTED")
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

// Explicit opt-in: only a disposable loopback database with this exact name.
// Regular unit-suite success never implies that these PostgreSQL cases ran.
describe.skipIf(!testUrl)("Workforce cursor fences on isolated PostgreSQL", () => {
  let db: PrismaClient
  let other: PrismaClient
  let control: PrismaClient
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const gate = () => {
    let release!: () => void
    const promise = new Promise<void>((resolve) => { release = resolve })
    return { promise, release }
  }

  beforeAll(async () => {
    const parsed = new URL(testUrl!)
    if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/hrm_cursor_fencing_test") {
      throw new Error("WORKFORCE_CURSOR_TEST_DATABASE_NOT_ISOLATED")
    }
    const options = { datasources: { db: { url: testUrl } } }
    db = new PrismaClient(options)
    other = new PrismaClient(options)
    control = new PrismaClient(options)
    await db.$executeRaw`CREATE TABLE IF NOT EXISTS "system_job_leases" (
      "name" TEXT PRIMARY KEY, "ownerToken" TEXT, "leaseUntil" TIMESTAMP(3), "status" TEXT NOT NULL
    )`
    await db.$executeRaw`CREATE TABLE IF NOT EXISTS "system_job_cursors" (
      "name" TEXT PRIMARY KEY, "cursor" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  })
  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE "system_job_cursors", "system_job_leases"`
    await db.$executeRaw`INSERT INTO "system_job_leases" ("name", "ownerToken", "leaseUntil", "status")
      VALUES (${JOB}, 'owner-a', clock_timestamp() + INTERVAL '30 seconds', 'running')`
  })
  afterAll(async () => {
    await Promise.all([db?.$disconnect(), other?.$disconnect(), control?.$disconnect()])
  })

  const waitUntilLeaseExpired = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await control.$queryRaw<Array<{ expired: boolean }>>`
        SELECT "leaseUntil" <= clock_timestamp() AS expired FROM "system_job_leases" WHERE "name" = ${JOB}
      `
      if (row.expired) return
      await delay(20)
    }
    throw new Error("ISOLATED_LEASE_DID_NOT_EXPIRE")
  }

  const waitForLock = async (table: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await control.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::integer AS count FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE ${`%${table}%`}
      `
      if (row.count > 0) return
      await delay(20)
    }
    throw new Error("ISOLATED_CONTENDER_DID_NOT_WAIT_FOR_LOCK")
  }

  it("allows exactly one of two independent first inserts", async () => {
    const stores = [workforceReconciliationCursorStore(db), workforceReconciliationCursorStore(other)]
    expect(await Promise.all(stores.map((s) => s.read()))).toEqual([null, null])
    const outcomes = await Promise.all(stores.map((s, index) => s.commit({ expected: null, nextCursor: `page-${index}`, ownerToken: "owner-a" })))
    expect(outcomes.sort()).toEqual(["COMMITTED", "FENCED_OUT"])
    expect(await stores[0].read()).toMatchObject({ version: 1 })
  })

  it("rejects an ABA replay with the old cursor version", async () => {
    const s = workforceReconciliationCursorStore(db)
    expect(await s.commit({ expected: null, nextCursor: "a", ownerToken: "owner-a" })).toBe("COMMITTED")
    const old = await s.read()
    expect(await s.commit({ expected: old, nextCursor: "b", ownerToken: "owner-a" })).toBe("COMMITTED")
    expect(await s.commit({ expected: await s.read(), nextCursor: "a", ownerToken: "owner-a" })).toBe("COMMITTED")
    expect(await s.commit({ expected: old, nextCursor: "skipped", ownerToken: "owner-a" })).toBe("FENCED_OUT")
    expect(await s.read()).toEqual({ cursor: "a", version: 3 })
  })

  it("rejects a stale owner after takeover while accepting the current owner", async () => {
    const s = workforceReconciliationCursorStore(db)
    await db.$executeRaw`UPDATE "system_job_leases" SET "ownerToken" = 'owner-b' WHERE "name" = ${JOB}`
    expect(await s.commit({ expected: null, nextCursor: "a", ownerToken: "owner-a" })).toBe("FENCED_OUT")
    expect(await s.read()).toBeNull()
    expect(await s.commit({ expected: null, nextCursor: "a", ownerToken: "owner-b" })).toBe("COMMITTED")
  })

  it("distinguishes an existing null cursor from an absent row and rejects duplicate replay", async () => {
    const s = workforceReconciliationCursorStore(db)
    await s.commit({ expected: null, nextCursor: "a", ownerToken: "owner-a" })
    await s.commit({ expected: await s.read(), nextCursor: null, ownerToken: "owner-a" })
    const observed = await s.read()
    expect(observed).toEqual({ cursor: null, version: 2 })
    expect(await s.commit({ expected: null, nextCursor: "bad", ownerToken: "owner-a" })).toBe("FENCED_OUT")
    expect(await s.commit({ expected: observed, nextCursor: "b", ownerToken: "owner-a" })).toBe("COMMITTED")
    expect(await s.commit({ expected: observed, nextCursor: "bad", ownerToken: "owner-a" })).toBe("FENCED_OUT")
    expect(await s.read()).toEqual({ cursor: "b", version: 3 })
  })

  it.each(["expired", "completed", "missing"])("does not write under an %s lease", async (kind) => {
    const s = workforceReconciliationCursorStore(db)
    if (kind === "expired") await db.$executeRaw`UPDATE "system_job_leases" SET "leaseUntil" = clock_timestamp() - INTERVAL '1 second'`
    if (kind === "completed") await db.$executeRaw`UPDATE "system_job_leases" SET "status" = 'completed'`
    if (kind === "missing") await db.$executeRaw`DELETE FROM "system_job_leases"`
    const result = await s.commit({ expected: null, nextCursor: "private-synthetic-page", ownerToken: "owner-a" })
    expect(result).toBe("FENCED_OUT")
    expect(result).not.toMatch(/private|owner|page/)
    expect(await s.read()).toBeNull()
  })

  it("checks wall-clock expiry after waiting for the lease row lock", async () => {
    const held = gate()
    const release = gate()
    const blocker = other.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "system_job_leases" SET "leaseUntil" = clock_timestamp() + INTERVAL '200 milliseconds' WHERE "name" = ${JOB}`
      held.release()
      await release.promise
    })
    await held.promise
    const contender = workforceReconciliationCursorStore(db).commit({ expected: null, nextCursor: "a", ownerToken: "owner-a" })
    try {
      await waitForLock("system_job_leases")
      await delay(350)
    } finally { release.release() }
    await blocker
    expect(await contender).toBe("FENCED_OUT")
    expect(await workforceReconciliationCursorStore(db).read()).toBeNull()
  })

  it("checks expiry after a cursor row lock wait as well", async () => {
    const s = workforceReconciliationCursorStore(db)
    await s.commit({ expected: null, nextCursor: "a", ownerToken: "owner-a" })
    const observed = await s.read()
    const held = gate()
    const release = gate()
    const blocker = other.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "version" FROM "system_job_cursors" WHERE "name" = ${JOB} FOR UPDATE`
      held.release()
      await release.promise
    })
    await held.promise
    await control.$executeRaw`UPDATE "system_job_leases" SET "leaseUntil" = clock_timestamp() + INTERVAL '300 milliseconds' WHERE "name" = ${JOB}`
    const contender = s.commit({ expected: observed, nextCursor: "b", ownerToken: "owner-a" })
    try {
      await waitForLock("system_job_cursors")
      await waitUntilLeaseExpired()
    } finally { release.release() }
    await blocker
    expect(await contender).toBe("FENCED_OUT")
    expect(await s.read()).toEqual(observed)
  })

  it("rolls back a cursor write when its transaction fails before commit", async () => {
    const aborting = {
      $queryRaw: db.$queryRaw.bind(db),
      $transaction: async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async (tx) => {
        await callback(tx)
        throw new Error("SYNTHETIC_ABORT_BEFORE_COMMIT")
      }),
    }
    await expect(workforceReconciliationCursorStore(aborting as unknown as PrismaClient).commit({ expected: null, nextCursor: "a", ownerToken: "owner-a" })).rejects.toThrow("SYNTHETIC_ABORT_BEFORE_COMMIT")
    expect(await workforceReconciliationCursorStore(db).read()).toBeNull()
  })

  it("preserves exhausted and unrelated operational rows", async () => {
    await db.$executeRaw`INSERT INTO "system_job_cursors" ("name", "cursor", "version")
      VALUES (${JOB}, 'last', 2147483647), ('another-job', 'untouched', 12)`
    const s = workforceReconciliationCursorStore(db)
    expect(await s.commit({ expected: await s.read(), nextCursor: null, ownerToken: "owner-a" })).toBe("VERSION_EXHAUSTED")
    expect(await s.read()).toEqual({ cursor: "last", version: 2147483647 })
    const [row] = await db.$queryRaw<Array<{ cursor: string; version: number }>>`
      SELECT "cursor", "version" FROM "system_job_cursors" WHERE "name" = 'another-job'
    `
    expect(row).toEqual({ cursor: "untouched", version: 12 })
  })
})
