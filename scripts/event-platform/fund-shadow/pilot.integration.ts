// Fund shadow pilot on a REAL disposable PostgreSQL 16 with the actual event
// platform migrations: provision-role.sql creates the login and build exactly
// as on production, and the shadow consumer runs through the node-postgres
// adapter of the runner. The result must equal the Prisma path the consumer
// is already tested with, and the login must see nothing but its tenant.
//
//   PILOT_PG_ADMIN_URL=postgresql://postgres:postgres@HOST:PORT/event_platform_test \
//   PILOT_PSQL="docker exec -i CONTAINER psql" node pilot.integration.cjs
// with provision-role.sql and retire-builds.sql in PILOT_SQL_DIR (default /tmp).
// (CI: PILOT_PSQL="psql -h 127.0.0.1 -p PORT", PILOT_SQL_DIR=scripts/event-platform/fund-shadow)
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
    const sqlDir = process.env.PILOT_SQL_DIR ?? "/tmp"
    const sql = (file: string, variables: Record<string, string>, input = "") => execFileSync(psql[0], [...psql.slice(1), "-X", "-q", "-At",
      "-U", "postgres", "-d", database, ...Object.entries(variables).flatMap(([k, v]) => ["-v", `${k}=${v}`]), "-f", `${sqlDir}/${file}`],
    { input, encoding: "utf8", timeout: 30_000 })
    const provisionAs = (o: string, r: string, b: string, k: string, p: string) =>
      sql("provision-role.sql", { org: o, role: r, build_id: b, build_key: k, code_sha: codeSha }, `${scramVerifier(p)}\n`)
    const role = "ld_fund_shadow_itest", buildId = randomUUID(), buildKey = "pilot-1"
    const password = randomBytes(24).toString("hex")
    const provision = () => provisionAs(org, role, buildId, buildKey, password)
    const first = provision()
    assert.match(first, new RegExp(`fund_shadow_role=${role} build=${buildId} status=running`))
    assert.doesNotMatch(first, /SCRAM-SHA-256|\$4096:/, "the verifier never reaches the output or the operator's log")
    assert.match(provision(), /status=running/, "a second run with the same values changes nothing and still succeeds")

    const url = new URL(adminUrl); url.pathname = `/${database}`
    const loginAs = (user: string, secret: string) => { const c = new Client({ host: url.hostname, port: Number(url.port), database, user, password: secret }); clients.push(c); return c }
    const login = () => loginAs(role, password)
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

    // A second organization in the same pilot: its own login and build, and
    // the same worker folds both, each through its own login.
    const roleB = "ld_fund_shadow_itest_b", buildB = randomUUID(), passwordB = randomBytes(24).toString("hex")
    assert.match(provisionAs(other.scope.organizationId, roleB, buildB, "pilot-1", passwordB), /status=running/)
    const clientB = loginAs(roleB, passwordB); await clientB.connect()
    const scopeB = { ...other.scope, buildId: buildB, buildKey: "pilot-1", expectedWorkerRole: roleB }
    for (const record of other.records) await consumeFundShadowRecord(pgFundShadowDatabase(clientB), scopeB, record)
    assert.deepEqual((await parity())["pilot-1"], { wrong: 0, stale: 0, funds: 2 })

    // The next pilot (new release): same login, new build pilot-2. The login
    // now reaches only the new build; then the earlier pilot is retired.
    const buildA2 = randomUUID()
    assert.match(provisionAs(org, role, buildA2, "pilot-2", password), /status=running/)
    await client.end(); await probe.end() // the login allows two connections at a time
    const client2 = login(); await client2.connect()
    const scope2 = { ...a.scope, buildId: buildA2, buildKey: "pilot-2", expectedWorkerRole: role }
    for (const record of a.records) await consumeFundShadowRecord(pgFundShadowDatabase(client2), scope2, record)
    await assert.rejects(consumeFundShadowRecord(pgFundShadowDatabase(client2), scope, a.records[0]), "the login no longer reaches pilot-1")
    assert.match(sql("retire-builds.sql", { keep_key: "pilot-2", keep_roles: role }), /fund_shadow_retired builds=2 logins_off=1/)
    assert.match(sql("retire-builds.sql", { keep_key: "pilot-2", keep_roles: role }), /builds=2 logins_off=1/, "retiring twice changes nothing")
    const statuses = (await admin.query(`SELECT "buildKey", status FROM projection_builds WHERE "buildKey" LIKE 'pilot-%' ORDER BY 1, 2`)).rows
    assert.deepEqual(statuses, [{ buildKey: "pilot-1", status: "abandoned" }, { buildKey: "pilot-1", status: "abandoned" }, { buildKey: "pilot-2", status: "running" }])
    const logins = Object.fromEntries((await admin.query(`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1)`,
      [[role, roleB, a.scope.expectedWorkerRole]])).rows.map(r => [r.rolname, r.rolcanlogin]))
    assert.deepEqual(logins, { [role]: true, [roleB]: false, [a.scope.expectedWorkerRole]: true }, "only marked pilot logins are switched off")
    await assert.rejects(loginAs(roleB, passwordB).connect(), "a retired login cannot connect")
    const watched = await parity()
    assert.equal(watched["pilot-1"], undefined, "the watch no longer expects the retired pilot to follow the stream")
    assert.deepEqual(watched["pilot-2"], { wrong: 0, stale: 0, funds: 1 })

    console.log("fund_shadow_pilot_integration=PASS; provision_idempotent=PASS; pg_equals_prisma=PASS; duplicate=PASS; watch_parity_query=PASS; tenant_isolation=PASS; source_untouchable=PASS; timeout_rollback=PASS; two_orgs=PASS; next_pilot_and_retire=PASS")
  } finally {
    await Promise.allSettled(clients.map(c => c.end()))
    await db.close()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
