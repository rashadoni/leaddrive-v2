// Fund shadow pilot on a REAL disposable PostgreSQL 16 with the actual event
// platform migrations: provision-role.sql creates the login and build exactly
// as on production, and the shadow consumer runs through the node-postgres
// adapter of the runner. The result must equal the Prisma path the consumer
// is already tested with, and the login must see nothing but its tenant.
//
//   PILOT_PG_ADMIN_URL=postgresql://postgres:postgres@HOST:PORT/event_platform_test \
//   PILOT_PSQL="docker exec -i CONTAINER psql" node pilot.integration.cjs
// (CI: PILOT_PSQL="psql -h 127.0.0.1 -p PORT", PILOT_SQL_FILE=<repo path>)
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { Client } from "pg"
import { consumeFundShadowRecord } from "../../../src/lib/event-platform/fund-shadow-consumer"
import { createFundShadowPostgresFixture, fundShadowDatabase } from "../../../src/__tests__/fixtures/fund-shadow-postgres"
import { pgFundShadowDatabase } from "./pg-database"
import { scramVerifier } from "./scram.mjs"

async function main() {
  const adminUrl = process.env.PILOT_PG_ADMIN_URL ?? ""
  const psql = (process.env.PILOT_PSQL ?? "").split(" ").filter(Boolean)
  assert.ok(adminUrl && psql.length, "PILOT_PG_ADMIN_URL and PILOT_PSQL are required")
  const codeSha = "a".repeat(40)
  const db = createFundShadowPostgresFixture({ adminUrl, environment: "testbroker", codeSha })
  const clients: Client[] = []
  try {
    await db.setup()
    const a = await db.fixture()
    const other = await db.fixture()
    const org = a.scope.organizationId
    const database = (await a.client.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db

    // Reference: the consumer through Prisma, the route its tests use.
    for (const record of a.records) await consumeFundShadowRecord(fundShadowDatabase(a.client), a.scope, record)

    // The pilot: the production provisioning SQL, then node-postgres.
    const role = "ld_fund_shadow_itest", buildId = randomUUID(), buildKey = "pilot-itest"
    const password = randomBytes(24).toString("hex")
    const provision = () => execFileSync(psql[0], [...psql.slice(1), "-X", "-q", "-At", "-U", "postgres", "-d", database,
      "-v", `org=${org}`, "-v", `role=${role}`, "-v", `build_id=${buildId}`, "-v", `build_key=${buildKey}`, "-v", `code_sha=${codeSha}`,
      "-f", process.env.PILOT_SQL_FILE ?? "/tmp/provision-role.sql"], { input: `${scramVerifier(password)}\n`, encoding: "utf8", timeout: 30_000 })
    assert.match(provision(), new RegExp(`fund_shadow_role=${role} build=${buildId} status=running`))
    assert.match(provision(), /status=running/, "a second run with the same values changes nothing and still succeeds")

    const url = new URL(adminUrl); url.pathname = `/${database}`
    const login = () => { const c = new Client({ host: url.hostname, port: Number(url.port), database, user: role, password }); clients.push(c); return c }
    const client = login(); await client.connect()
    const scope = { ...a.scope, buildId, buildKey, expectedWorkerRole: role }
    const pilot = pgFundShadowDatabase(client)
    const results = []
    for (const record of a.records) results.push(await consumeFundShadowRecord(pilot, scope, record))
    assert.ok(results.every(r => !r.duplicate))
    // A redelivered record is a duplicate and changes nothing.
    const again = await consumeFundShadowRecord(pilot, scope, a.records[a.records.length - 1])
    assert.equal(again.duplicate, true)

    // Read back as the superuser: each restricted login sees only its own build.
    const admin = new Client({ connectionString: url.toString() }); clients.push(admin)
    await admin.connect()
    const shadows = (await admin.query(`SELECT "buildKey", balance::text, currency, "aggregateVersion"::text AS version
      FROM fund_balance_projections WHERE "organizationId" = $1 AND status = 'shadow' ORDER BY "buildKey"`, [org])).rows as
      Array<{ buildKey: string; balance: string; currency: string; version: string }>
    const source = (await admin.query(`SELECT "currentBalance"::numeric(18,4)::text AS balance FROM funds WHERE "organizationId" = $1`, [org])).rows
    const reference = shadows.find(s => s.buildKey === a.scope.buildKey), ours = shadows.find(s => s.buildKey === buildKey)
    assert.ok(reference); assert.ok(ours)
    assert.deepEqual({ ...ours, buildKey: "" }, { ...reference, buildKey: "" }, "node-postgres and Prisma folds are identical")
    assert.deepEqual(source.map(r => r.balance), [ours.balance], "the shadow folds to the source balance")
    console.log(`pilot_parity balance=${ours.balance} currency=${ours.currency} version=${ours.version}`)

    // The watch's parity query (health-probe.py FUND_SHADOW_SQL) sees agreement,
    // then a corrupted shadow balance as "wrong".
    const paritySql = execFileSync("python3", ["-c", "import runpy,sys; sys.stdout.write(runpy.run_path(sys.argv[1], run_name='probe')['FUND_SHADOW_SQL'])",
      "scripts/event-platform/cluster/health-probe.py"], { encoding: "utf8", timeout: 10_000 })
    const parity = async () => Object.fromEntries((await admin.query({ text: paritySql, rowMode: "array" })).rows
      .map(([key, wrong, stale, funds]) => [key, { wrong: Number(wrong), stale: Number(stale), funds: Number(funds) }]))
    assert.deepEqual((await parity())[buildKey], { wrong: 0, stale: 0, funds: 1 })
    await admin.query(`UPDATE fund_balance_projections SET balance = balance + 1 WHERE "organizationId" = $1 AND "buildKey" = $2`, [org, buildKey])
    assert.deepEqual((await parity())[buildKey], { wrong: 1, stale: 0, funds: 1 })
    await admin.query(`UPDATE fund_balance_projections SET balance = balance - 1 WHERE "organizationId" = $1 AND "buildKey" = $2`, [org, buildKey])

    // The login sees its tenant only and cannot touch the source of truth.
    const probe = login(); await probe.connect()
    await probe.query("BEGIN"); await probe.query("SELECT set_config('app.org_id', $1, true)", [other.scope.organizationId])
    assert.equal((await probe.query("SELECT count(*)::int AS n FROM event_outbox")).rows[0].n, 0, "other tenant's outbox is invisible")
    assert.equal((await probe.query("SELECT count(*)::int AS n FROM funds")).rows[0].n, 0, "other tenant's funds are invisible")
    await probe.query("ROLLBACK")
    for (const statement of [`UPDATE funds SET "currentBalance" = 0`, "DELETE FROM event_outbox", "UPDATE projection_builds SET status = 'promoted'",
      `INSERT INTO fund_balance_projections (id, "organizationId", "fundId", "projectionVersion", "buildKey", status, balance, currency, "aggregateVersion")
       VALUES ('${randomUUID()}', '${org}', 'x', 1, 'x', 'active', 1, 'USD', 1)`]) {
      await probe.query("BEGIN"); await probe.query("SELECT set_config('app.org_id', $1, true)", [org])
      await assert.rejects(probe.query(statement), "restricted login refuses: " + statement.slice(0, 40))
      await probe.query("ROLLBACK")
    }

    // A transaction that outlives its timeout is rolled back; the connection stays usable.
    await assert.rejects(pilot.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT pg_sleep(0.3)`)
      return 1
    }, { isolationLevel: "Serializable", maxWait: 1000, timeout: 100 }))
    assert.equal(await pilot.$transaction(async tx => (await tx.$queryRawUnsafe<Array<{ one: number }>>("SELECT 1 AS one"))[0].one,
      { isolationLevel: "Serializable", maxWait: 1000, timeout: 5000 }), 1)

    console.log("fund_shadow_pilot_integration=PASS; provision_idempotent=PASS; pg_equals_prisma=PASS; duplicate=PASS; watch_parity_query=PASS; tenant_isolation=PASS; source_untouchable=PASS; timeout_rollback=PASS")
  } finally {
    await Promise.allSettled(clients.map(c => c.end()))
    await db.close()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
