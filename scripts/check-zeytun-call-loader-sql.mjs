/**
 * Bounded, opt-in SQL check. Uses only an in-memory PGlite database and synthetic
 * rows. Never reads DATABASE_URL, application secrets or a production database.
 * Install pinned tooling separately; see docs/zeytun-1c-voice-pilot.md.
 * This checks the real loader query, not Prisma transport or all migrations.
 */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, readFile, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { isAbsolute, join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const tooling = process.env.ZEYTUN_SQL_TOOLING_DIR
assert(tooling && isAbsolute(tooling), "ZEYTUN_SQL_TOOLING_DIR must name isolated tooling")
// PGlite parses timestamp-without-time-zone using the process timezone. Pin the
// synthetic fixture to UTC; real Prisma timestamp semantics remain a live gate.
assert.equal(process.env.TZ, "UTC", "Run this fixture with TZ=UTC")
const requireTool = createRequire(join(tooling, "package.json"))
const ts = requireTool("typescript")
const { PGlite } = requireTool("@electric-sql/pglite")
const pglitePackage = JSON.parse(await readFile(join(tooling, "node_modules/@electric-sql/pglite/package.json"), "utf8"))
assert.equal(pglitePackage.version, "0.5.11")
const root = fileURLToPath(new URL("../", import.meta.url))
const compiled = await mkdtemp(join(tmpdir(), "zeytun-sql-check-"))
const started = performance.now()
let pg
let passed = 0

try {
  // Compile only these three source files, with dependencies supplied by the
  // isolated tooling. transpileModule is not claimed as a TypeScript check.
  await writeFile(join(compiled, "package.json"), '{"type":"commonjs"}\n')
  await symlink(join(tooling, "node_modules"), join(compiled, "node_modules"), "dir")
  for (const relative of ["rls-context", "voice-agent/pharmacy/zeytun-call-context", "voice-agent/pharmacy/zeytun-call-loader"]) {
    const source = await readFile(join(root, "src/lib", `${relative}.ts`), "utf8")
    const result = ts.transpileModule(source, {
      fileName: `${relative}.ts`, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true, esModuleInterop: true },
    })
    assert.equal(result.diagnostics?.length ?? 0, 0, `Transpile failed: ${relative}`)
    const output = join(compiled, `${relative}.js`)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, result.outputText)
  }
  const requireCompiled = createRequire(join(compiled, "package.json"))
  const { createZeytunCallLoader } = requireCompiled("./voice-agent/pharmacy/zeytun-call-loader.js")
  pg = await PGlite.create()
  // Relevant column types mirror schema.prisma. Deliberately omit foreign keys
  // and providerCallId uniqueness to exercise corrupt/legacy relations and the
  // loader's defensive duplicate check. This is not the full application schema.
  await pg.exec(`
    CREATE ROLE zeytun_sql_reader NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE organizations (id text PRIMARY KEY, "isActive" boolean NOT NULL);
    CREATE TABLE channel_configs (id text PRIMARY KEY, "organizationId" text NOT NULL,
      "channelType" text NOT NULL, "isActive" boolean NOT NULL, settings jsonb);
    CREATE TABLE companies (id text PRIMARY KEY, "organizationId" text NOT NULL, status text NOT NULL);
    CREATE TABLE contacts (id text PRIMARY KEY, "organizationId" text NOT NULL,
      "companyId" text, "isActive" boolean NOT NULL, "fullName" text);
    CREATE TABLE leads (id text PRIMARY KEY, "organizationId" text NOT NULL, status text NOT NULL);
    CREATE TABLE call_logs (id text PRIMARY KEY, "organizationId" text NOT NULL,
      "providerCallId" text, "channelConfigId" text, provider text NOT NULL,
      "callMode" text NOT NULL, direction text NOT NULL, status text NOT NULL,
      "wasAnswered" boolean NOT NULL, "fromNumber" text NOT NULL, "toNumber" text NOT NULL,
      "targetPhoneE164" text, "contactId" text, "companyId" text, "leadId" text,
      "endedAt" timestamp(3), "startedAt" timestamp(3) NOT NULL, transcription text);
    GRANT USAGE ON SCHEMA public TO zeytun_sql_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO zeytun_sql_reader;
  `)
  // Same policy convention as scripts/rls/generate-rls-policies.mjs. Organization
  // itself is not a tenant-owned table; the real query joins its exact ID.
  for (const table of ["channel_configs", "companies", "contacts", "leads", "call_logs"]) {
    await pg.exec(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON "${table}"
        USING ("organizationId" = current_setting('app.org_id', true)
          OR current_setting('app.rls_bypass', true) = 'on')
        WITH CHECK ("organizationId" = current_setting('app.org_id', true)
          OR current_setting('app.rls_bypass', true) = 'on');`)
  }
  const now = Date.parse("2026-10-22T12:00:00.000Z")
  const config = { organizationId: "sql-tenant-a", channelConfigId: "sql-line-a" }
  const callId = "cccccccc-1111-4222-8333-444444444444"
  const lookup = { ...config, provider: "asterisk", providerCallId: callId }
  const marker = "SQL_FIXTURE_PRIVATE_FIELD_NOT_FOR_PROJECTION"
  const observations = []
  const rawReadResults = []
  let transactionCount = 0
  const database = {
    $transaction: async (read, options) => {
      assert.deepEqual(options, { isolationLevel: "ReadCommitted", maxWait: 500, timeout: 2500 })
      transactionCount++
      return pg.transaction(async tx => {
        await tx.exec("SET LOCAL ROLE zeytun_sql_reader")
        return read({ $queryRaw: async (strings, ...values) => {
          const sql = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "")
          const result = await tx.query(sql, values)
          if (sql.includes("WITH candidates")) rawReadResults.push({ rows: result.rows,
            startedAtType: Object.prototype.toString.call(result.rows[0]?.startedAt) })
          observations.push((await tx.query(`SELECT current_user AS role,
            current_setting('app.org_id') AS org, current_setting('app.rls_bypass') AS bypass,
            current_setting('statement_timeout') AS timeout, current_setting('lock_timeout') AS lock_timeout`)).rows[0])
          return result.rows
        } })
      })
    },
  }
  const load = createZeytunCallLoader(config, database, () => now)
  async function reset() {
    await pg.exec("TRUNCATE call_logs, contacts, companies, leads, channel_configs, organizations")
    observations.length = 0
    rawReadResults.length = 0
    transactionCount = 0
    for (const suffix of ["a", "b"]) {
      const org = `sql-tenant-${suffix}`
      await pg.query('INSERT INTO organizations VALUES ($1, true)', [org])
      await pg.query('INSERT INTO channel_configs VALUES ($1, $2, $3, true, $4)',
        [`sql-line-${suffix}`, org, "voip", { provider: "asterisk", voiceAgentEnabled: true, password: marker }])
      await pg.query('INSERT INTO companies VALUES ($1, $2, $3)', [`sql-company-${suffix}`, org, "active"])
      await pg.query('INSERT INTO contacts VALUES ($1, $2, $3, true, $4)',
        [`sql-contact-${suffix}`, org, `sql-company-${suffix}`, marker])
      await pg.query('INSERT INTO leads VALUES ($1, $2, $3)', [`sql-lead-${suffix}`, org, "qualified"])
      await pg.query(`INSERT INTO call_logs VALUES (
        $1, $2, $3, $4, 'asterisk', 'ai', 'inbound', 'in-progress', true,
        '+994500000001', '+994500000002', '+994500000001', $5, $6, NULL, NULL, $7, $8)`,
        [`sql-call-${suffix}`, org, callId, `sql-line-${suffix}`, `sql-contact-${suffix}`, `sql-company-${suffix}`, new Date(now), marker])
    }
    // Simulate a connection previously used for an administrative read. The
    // loader must replace these settings only for its own transaction.
    await pg.query("SELECT set_config('app.org_id', 'outer-sentinel', false), set_config('app.rls_bypass', 'on', false)")
  }
  async function outerRestored() {
    const row = (await pg.query("SELECT current_setting('app.org_id') AS org, current_setting('app.rls_bypass') AS bypass")).rows[0]
    assert.deepEqual(row, { org: "outer-sentinel", bypass: "on" })
  }
  async function test(name, body) {
    await reset()
    await body()
    await outerRestored()
    passed++
    console.log(`PASS ${name}`)
  }

  await test("RLS is enforced for a non-superuser without BYPASSRLS", async () => {
    await pg.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE zeytun_sql_reader")
      const role = (await tx.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0]
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false })
      await tx.query("SELECT set_config('app.org_id', '', true), set_config('app.rls_bypass', 'off', true)")
      assert.deepEqual((await tx.query('SELECT id FROM call_logs')).rows, [])
      await tx.query("SELECT set_config('app.org_id', 'sql-tenant-b', true)")
      assert.deepEqual((await tx.query('SELECT id FROM call_logs')).rows, [{ id: "sql-call-b" }])
    })
  })
  await test("real SQL returns the exact tenant despite another tenant sharing the provider UUID", async () => {
    const row = await load(lookup)
    assert.notEqual(row, null, JSON.stringify(rawReadResults))
    assert.equal(row?.call.id, "sql-call-a")
    assert.equal(row?.call.startedAt, new Date(now).toISOString())
    assert.equal(row?.subject.id, "sql-contact-a")
    assert.equal(row?.company.id, "sql-company-a")
    assert.equal(JSON.stringify(row).includes(marker), false)
    assert.deepEqual(observations, Array.from({ length: 2 }, () => ({
      role: "zeytun_sql_reader", org: config.organizationId, bypass: "off", timeout: "1500ms", lock_timeout: "500ms",
    })))
  })
  await test("wrong tenant and line lookup stop before the DB", async () => {
    assert.equal(await load({ ...lookup, organizationId: "sql-tenant-b" }), null)
    assert.equal(await load({ ...lookup, channelConfigId: "sql-line-b" }), null)
    assert.equal(transactionCount, 0)
  })
  await test("duplicate provider UUID is rejected before different-line or status filtering", async () => {
    await pg.query(`INSERT INTO call_logs SELECT 'sql-duplicate', "organizationId", "providerCallId", 'other-line',
      provider, "callMode", direction, 'completed', "wasAnswered", "fromNumber", "toNumber", "targetPhoneE164",
      "contactId", "companyId", "leadId", "endedAt", "startedAt", transcription FROM call_logs WHERE id = 'sql-call-a'`)
    assert.equal(await load(lookup), null)
  })
  const rejectedChanges = [
    ["inactive organization", "UPDATE organizations SET \"isActive\" = false WHERE id = 'sql-tenant-a'"],
    ["inactive line", "UPDATE channel_configs SET \"isActive\" = false WHERE id = 'sql-line-a'"],
    ["string true is not an enabled AI flag", `UPDATE channel_configs SET settings = '{"provider":"asterisk","voiceAgentEnabled":"true"}' WHERE id = 'sql-line-a'`],
    ["cross-tenant contact", "UPDATE contacts SET \"organizationId\" = 'sql-tenant-b' WHERE id = 'sql-contact-a'"],
    ["cross-tenant company", "UPDATE companies SET \"organizationId\" = 'sql-tenant-b' WHERE id = 'sql-company-a'"],
    ["inactive contact", "UPDATE contacts SET \"isActive\" = false WHERE id = 'sql-contact-a'"],
    ["incorrect external phone", "UPDATE call_logs SET \"targetPhoneE164\" = '+994500000003' WHERE id = 'sql-call-a'"],
    ["unanswered initiated call", "UPDATE call_logs SET status = 'initiated', \"wasAnswered\" = false WHERE id = 'sql-call-a'"],
    ["ended call", "UPDATE call_logs SET \"endedAt\" = \"startedAt\" WHERE id = 'sql-call-a'"],
    ["expired call", "UPDATE call_logs SET \"startedAt\" = \"startedAt\" - interval '2 hours' WHERE id = 'sql-call-a'"],
    ["future call", "UPDATE call_logs SET \"startedAt\" = \"startedAt\" + interval '1 second' WHERE id = 'sql-call-a'"],
    ["both contact and lead", "UPDATE call_logs SET \"leadId\" = 'sql-lead-a' WHERE id = 'sql-call-a'"],
  ]
  for (const [name, sql] of rejectedChanges) {
    await test(`rejects ${name}`, async () => {
      await pg.exec(sql)
      assert.equal(await load(lookup), null)
    })
  }
  await test("answered lead-only outbound call; next read detects lead revocation", async () => {
    await pg.exec(`UPDATE call_logs SET direction = 'outbound', "contactId" = NULL, "companyId" = NULL,
      "leadId" = 'sql-lead-a', "fromNumber" = '+994500000002', "toNumber" = '+994500000001' WHERE id = 'sql-call-a'`)
    assert.equal((await load(lookup))?.subject.kind, "lead")
    await pg.exec("UPDATE leads SET status = 'rejected' WHERE id = 'sql-lead-a'")
    assert.equal(await load(lookup), null)
  })
  await test("a subsequent search re-reads call closure", async () => {
    assert.equal((await load(lookup))?.call.id, "sql-call-a")
    await pg.exec("UPDATE call_logs SET status = 'completed', \"endedAt\" = \"startedAt\" WHERE id = 'sql-call-a'")
    assert.equal(await load(lookup), null)
    assert.equal(transactionCount, 2)
  })
  await test("tenant text is bound as data, never executable SQL", async () => {
    const scope = { ...config, organizationId: "tenant'; DROP TABLE call_logs; --" }
    const unsafeLooking = createZeytunCallLoader(scope, database, () => now)
    assert.equal(await unsafeLooking({ ...lookup, ...scope }), null)
    assert.equal((await pg.query('SELECT count(*)::int AS count FROM call_logs')).rows[0].count, 2)
  })
  await test("permission error is masked, does not retry, and rolls back local settings", async () => {
    await pg.exec("REVOKE SELECT ON call_logs FROM zeytun_sql_reader")
    try {
      await assert.rejects(load(lookup), /^Error: call_context_unavailable$/)
      assert.equal(transactionCount, 1)
    } finally {
      await pg.exec("GRANT SELECT ON call_logs TO zeytun_sql_reader")
    }
  })
  const version = (await pg.query("SELECT current_setting('server_version') AS version")).rows[0].version
  console.log(JSON.stringify({ passed, engine: `PGlite 0.5.11 / PostgreSQL ${version}`,
    elapsedMs: Math.round(performance.now() - started), maxRssKiB: process.resourceUsage().maxRSS,
    limitations: "Synthetic schema; no Prisma adapter, production migrations, connection-pool concurrency or timeout timing check" }))
} finally {
  try { if (pg) await pg.close() } finally { await rm(compiled, { recursive: true, force: true }) }
}
