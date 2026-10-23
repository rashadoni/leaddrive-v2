/** Full Prisma schema in a fresh local CI schema. No customer database URL,
 * production credential or destructive fixture reset is accepted here.
 * This proves schema/transaction behavior; it is not native-phone evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { PrismaClient, type Prisma } from "@prisma/client"
import { RF, RF_AGENTS, RF_CUSTOMERS, prepareRouteFieldFixture, readRouteFieldFixture } from "../../scripts/mtm-route-field-fixture"

const target = process.env.RF_FIXTURE_TEST_DATABASE_URL
if (process.env.RF_FIXTURE_DB_GATE === "required" && !target) throw new Error("RF_FIXTURE_DB_GATE_MISSING")
if (target) {
  const url = new URL(target)
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/postgres"
    || url.username !== "postgres" || url.password !== "fixture-only") throw new Error("RF_FIXTURE_TEST_DB_REFUSED")
}
const schema = "rf_native_fixture_" + randomBytes(8).toString("hex")
const hash = "$2b$12$" + "x".repeat(53)
let db: PrismaClient
let schemaCreated = false

describe.skipIf(!target)("Route & Field fixture on real PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(target!)
    url.searchParams.set("schema", schema)
    db = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: url.toString() } } })
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    schemaCreated = true
    // The full CRM schema contains Unsupported("vector(512)"). Keep the
    // extension in this owned schema so Prisma's isolated search_path finds
    // the type; never move or reuse an extension from another schema.
    await db.$executeRawUnsafe(`CREATE EXTENSION vector WITH SCHEMA "${schema}"`)
    const pushed = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"],
      { env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() }, encoding: "utf8", timeout: 120000 })
    if (pushed.status !== 0) throw new Error("RF_FIXTURE_TEST_SCHEMA_FAILED")
  }, 150000)

  afterAll(async () => {
    if (!db) return
    // Only the random schema created by this test can be removed.
    if (!/^rf_native_fixture_[a-f0-9]{16}$/.test(schema)) throw new Error("RF_FIXTURE_TEST_CLEANUP_REFUSED")
    try {
      if (schemaCreated) {
        // One DROP SCHEMA takes locks for every CRM table/index/constraint
        // together and exceeds a stock PostgreSQL lock table. Each DROP TABLE
        // commits separately, releasing those locks before the next table.
        const tables = await db.$queryRaw<Array<{ tablename: string }>>`
          SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = ${schema}`
        for (const { tablename } of tables) {
          await db.$executeRawUnsafe(`DROP TABLE "${schema}"."${tablename.replace(/"/g, '""')}" CASCADE`)
        }
        await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
      }
    } finally { await db.$disconnect() }
  })

  it("creates isolated team/customer scope and preserves legitimate fixture changes on repeat", async () => {
    expect(await prepareRouteFieldFixture(db, hash)).toBe(true)
    const state = await readRouteFieldFixture(db)
    expect(state.users).toHaveLength(1)
    expect(state.agents.map(agent => agent.id).sort()).toEqual(RF_AGENTS.map(agent => agent.id).sort())
    expect(state.customers).toBe(3)
    expect(await db.mtmVisit.count({ where: { organizationId: RF.id } })).toBe(0)
    expect(await db.mtmAgentWorkdayEvent.count({ where: { organizationId: RF.id } })).toBe(0)
    expect(await db.mtmRoute.count({ where: { organizationId: RF.id } })).toBe(0)
    expect(await db.mtmCustomerAgentAssignment.findMany({ where: { organizationId: RF.id },
      select: { customerId: true, agentId: true } })).toEqual(expect.arrayContaining([
        { customerId: RF_CUSTOMERS[0].id, agentId: RF_AGENTS[1].id },
        { customerId: RF_CUSTOMERS[2].id, agentId: RF_AGENTS[2].id },
      ]))
    await db.mtmTask.update({ where: { id: "rf-task-v1" }, data: { status: "IN_PROGRESS" } })
    expect(await prepareRouteFieldFixture(db, "$2b$12$" + "y".repeat(53))).toBe(false)
    expect((await db.mtmTask.findUniqueOrThrow({ where: { id: "rf-task-v1" } })).status).toBe("IN_PROGRESS")
    expect((await db.mtmAgent.findUniqueOrThrow({ where: { id: RF_AGENTS[1].id } })).passwordHash).toBe(hash)
  })

  it("refuses a changed ownership marker without repairing or deleting any data", async () => {
    await db.organization.update({ where: { id: RF.id }, data: { settings: { routeFieldAcceptanceOwner: "wrong" } } })
    await expect(prepareRouteFieldFixture(db, hash)).rejects.toThrow("RF_FIXTURE_NOT_OWNED")
    expect(await db.mtmCustomer.count({ where: { organizationId: RF.id } })).toBe(3)
    expect((await db.organization.findUniqueOrThrow({ where: { id: RF.id } })).settings).toEqual({ routeFieldAcceptanceOwner: "wrong" })
  })
})
