import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Owns a fresh local container; accepts no connection URL or existing database.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = process.argv[2]
assert.ok(output && resolve(output) === output, "ABSOLUTE_PRIVATE_OUTPUT_REQUIRED")
assert.notEqual(process.env.NODE_ENV, "production")
const image = "pgvector/pgvector:pg16"
const database = "hrm_c12_reader_profile_acceptance"
const job = "workforce-claim-reconciliation-v1"
const role = "wf_c12_profile_reader"
const tables = [
  "mtm_agent_workdays", "mtm_agent_workday_events", "workforce_site_transitions",
  "workforce_attendance_evidence", "workforce_evidence_assessments", "workforce_exception_cases",
  "workforce_timesheet_approvals", "mtm_audit_logs", "mtm_agents", "workforce_employee_team_memberships",
  "workforce_shift_templates", "workforce_shift_segments", "workforce_shift_assignments",
  "workforce_shift_default_assignments", "workforce_shift_team_default_assignments",
  "workforce_workday_schedule_snapshots", "workforce_shift_snapshots", "workforce_policy_snapshots",
]
const migrationPath = "prisma/migrations/20261005193000_workforce_reconciliation_operations/migration.sql"
const sourcePaths = ["prisma/schema.prisma", migrationPath, "scripts/_rls.mjs",
  "src/lib/workforce/reconciliation-reader-profile.ts", "src/lib/workforce/reconciliation-operations.ts",
  "src/lib/workforce/reconciliation-sweep.ts", "src/lib/workforce/reconciliation-dense.ts",
  "src/lib/workforce/reconciliation-source-page.ts", "src/lib/workforce/reconciliation-snapshot.ts",
  "src/lib/workforce/reconciliation-approval-group.ts", "src/lib/workforce/reconciliation-export-audit.ts",
  "src/lib/workforce/reconciliation-schedule-subject.ts", "src/lib/workforce/reconciliation.ts",
  "src/lib/workforce/reconciliation-cursor-store.ts", "scripts/workforce-reconciliation-reader-profile-evidence.mjs"]
const hash = bytes => createHash("sha256").update(bytes).digest("hex")
const receipt = { status: "RUNNING", fixture: "FULL_CURRENT_PRISMA_SCHEMA_PLUS_EXACT_C12_MIGRATION_AND_SYNTHETIC_RLS",
  historicalReplay: false, productionAccess: false, stage: "source-binding", cases: [], cleanup: [], sourceBindings: [] }
let container, db, other, fixturePath
const originalTestDatabaseUrl = process.env.EVENT_PLATFORM_TEST_DATABASE_URL
const command = (file, args, options = {}) => {
  const result = spawnSync(file, args, { cwd: root, encoding: "utf8", timeout: 120000,
    maxBuffer: 2 * 1024 * 1024, ...options })
  if (result.status !== 0) {
    receipt.commandFailure = { stage: receipt.stage, exitCode: result.status,
      code: result.error?.code ?? result.stderr?.match(/\bP\d{4}\b/)?.[0] ?? null }
    throw new Error("FIXTURE_COMMAND_FAILED")
  }
  return result.stdout
}
const sql = text => command("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], { input: text })
async function bind() {
  return Promise.all(sourcePaths.map(async path => { const bytes = await readFile(resolve(root, path)); return { path, bytes: bytes.length, sha256: hash(bytes) } }))
}
try {
  receipt.sourceBindings = await bind()
  receipt.stage = "owned-container-start"
  fixturePath = await mkdtemp(resolve(tmpdir(), "hrm-c12-profile-"))
  const password = randomBytes(24).toString("hex")
  const envFile = resolve(fixturePath, "postgres.env")
  await writeFile(envFile, `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=${database}\nPOSTGRES_USER=postgres\n`, { mode: 0o600, flag: "wx" })
  // Require the locally available image; do not fetch an unreviewed substitute.
  receipt.imageId = command("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { timeout: 10000 }).trim()
  assert.match(receipt.imageId, /^sha256:[a-f0-9]{64}$/)
  container = command("docker", ["run", "--detach", "--memory", "2g", "--cpus", "2", "--publish", "127.0.0.1::5432",
    "--env-file", envFile, receipt.imageId]).trim()
  assert.match(container, /^[a-f0-9]{64}$/)
  const binding = command("docker", ["port", container, "5432/tcp"]).trim()
  assert.match(binding, /^127\.0\.0\.1:\d+$/)
  const url = `postgresql://postgres:${password}@${binding}/${database}`
  let ready = false
  for (let i = 0; i < 60; i++) {
    ready = spawnSync("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", database], { stdio: "ignore", timeout: 5000 }).status === 0
    if (ready) break
    await new Promise(done => setTimeout(done, 250))
  }
  assert.ok(ready, "FIXTURE_NOT_READY")
  receipt.stage = "full-current-schema"
  sql("CREATE EXTENSION vector;")
  command(resolve(root, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: url, NODE_OPTIONS: "--max-old-space-size=4096" }, timeout: 120000 })
  const migration = await readFile(resolve(root, migrationPath), "utf8")
  const indexes = [...migration.matchAll(/CREATE INDEX "(wf_recon_[a-z_]+)"/g)].map(match => match[1])
  assert.equal(indexes.length, 9)
  receipt.stage = "exact-c12-migration"
  // The fresh generated schema has the table and locale indexes, but omits SQL
  // CHECK/RLS/collation semantics. Replace only these empty fixture objects and
  // apply the complete, byte-bound migration; never mark history as applied.
  sql(`DROP TABLE workforce_reconciliation_tenant_states;\n${indexes.map(name => `DROP INDEX "${name}";`).join("\n")}\n${migration}`)
  // The shared RLS-test factory fences both clients to this just-created target;
  // it deliberately installs no bypass/tenant setting before the negative cases.
  process.env.EVENT_PLATFORM_TEST_DATABASE_URL = url
  db = makeRlsTestPrisma(url)
  other = makeRlsTestPrisma(url)
  receipt.stage = "synthetic-reader-and-facts"
  await db.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`)
  await db.$executeRawUnsafe(`GRANT SELECT ON organizations,workforce_reconciliation_tenant_states,${tables.join(",")} TO ${role}`)
  for (const table of tables) {
    await db.$executeRawUnsafe(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`)
    await db.$executeRawUnsafe(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`)
    await db.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON public."${table}" USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on')`)
  }
  const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } })
  const { runWorkforceReconciliationTick: tick } = await jiti.import(resolve(root, "src/lib/workforce/reconciliation-operations.ts"))
  const { assertWorkforceReconciliationReaderProfile: profile } = await jiti.import(resolve(root, "src/lib/workforce/reconciliation-reader-profile.ts"))
  const tenant = await db.organization.create({ data: { name: "Synthetic C12 A", slug: "synthetic-c12-a", plan: "enterprise", features: ["workforce-hrm"], modules: { "workforce-hrm": true } } })
  const foreign = await db.organization.create({ data: { name: "Synthetic C12 B", slug: "synthetic-c12-b", isActive: false } })
  for (const organization of [tenant, foreign]) {
    const agent = await db.mtmAgent.create({ data: { organizationId: organization.id, name: "Synthetic employee" } })
    await db.mtmAgentWorkday.create({ data: { organizationId: organization.id, agentId: agent.id,
      workDate: new Date("2026-10-01T00:00:00Z"), startedAt: new Date("2026-10-01T08:00:00Z") } })
  }
  await db.systemJobLease.create({ data: { name: job, ownerToken: "synthetic-owner", status: "running", leaseUntil: new Date(Date.now() + 600000) } })
  const facts = async () => Promise.all(tables.map(async table => {
    const rows = await db.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) AS hash FROM public."${table}" t`)
    return { table, ...rows[0] }
  }))
  const originalFacts = await facts()
  const reader = (organizationId, extra) => ({ $transaction: (fn, options) => db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`)
    await tx.$queryRaw`SELECT set_config('app.org_id',${organizationId},true),set_config('app.rls_bypass','off',true)`
    await extra?.(tx)
    return fn(tx)
  }, options) })
  const run = async extra => {
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`
    return tick({ control: db, ownerToken: "synthetic-owner", readerForOrganization: async organizationId => reader(organizationId, extra) })
  }
  const checkpoint = () => db.systemJobCursor.findUnique({ where: { name: job } })
  const pass = async (name, fn) => {
    receipt.stage = name
    await fn(); assert.deepEqual(await facts(), originalFacts)
    receipt.cases.push({ name, status: "PASS", businessFactsUnchanged: true })
  }
  const refusal = async extra => {
    const before = await checkpoint(), result = await run(extra)
    assert.equal(result.status, "INCOMPLETE"); assert.equal(result.examined, 0)
    assert.deepEqual(await checkpoint(), before)
    assert.doesNotMatch(JSON.stringify(result), /Synthetic|PRIVATE|organizationId|tenant_isolation|SELECT /)
  }
  const mutation = async (name, setup, check, restore) => pass(name, async () => {
    await setup(); try { await check() } finally { await restore() }
  })
  await pass("supported-current-policy-sees-one-tenant-root-and-excludes-foreign-root", async () => {
    const result = await run(); assert.equal(result.status, "MATCHED"); assert.equal(result.examined, 1)
  })
  for (const table of tables) await mutation(`hidden-roots-or-dependencies-refused:${table}`,
    () => db.$executeRawUnsafe(`CREATE POLICY hidden_fixture ON public."${table}" AS RESTRICTIVE FOR SELECT TO ${role} USING (false)`),
    () => refusal(), () => db.$executeRawUnsafe(`DROP POLICY hidden_fixture ON public."${table}"`))
  await mutation("narrowed-permissive-policy-refused",
    () => db.$executeRaw`ALTER POLICY tenant_isolation ON mtm_agent_workdays USING (false)`, () => refusal(),
    () => db.$executeRaw`ALTER POLICY tenant_isolation ON mtm_agent_workdays USING ("organizationId"=current_setting('app.org_id',true))`)
  await pass("supported-tenant-only-policy", async () => { assert.equal((await run()).status, "MATCHED") })
  await mutation("public-column-write-grant-refused",
    () => db.$executeRaw`GRANT UPDATE ("startedAt") ON mtm_agent_workdays TO PUBLIC`, () => refusal(),
    () => db.$executeRaw`REVOKE UPDATE ("startedAt") ON mtm_agent_workdays FROM PUBLIC`)
  await mutation("table-write-grant-refused",
    () => db.$executeRawUnsafe(`GRANT DELETE ON mtm_agent_workdays TO ${role}`), () => refusal(),
    () => db.$executeRawUnsafe(`REVOKE DELETE ON mtm_agent_workdays FROM ${role}`))
  await db.$executeRaw`CREATE ROLE wf_c12_profile_parent NOLOGIN NOSUPERUSER NOBYPASSRLS`
  await mutation("inherited-column-write-grant-refused", async () => {
    await db.$executeRawUnsafe(`ALTER ROLE ${role} INHERIT`)
    await db.$executeRawUnsafe(`GRANT wf_c12_profile_parent TO ${role}`)
    await db.$executeRaw`GRANT UPDATE ("startedAt") ON mtm_agent_workdays TO wf_c12_profile_parent`
  }, () => refusal(), async () => {
    await db.$executeRaw`REVOKE UPDATE ("startedAt") ON mtm_agent_workdays FROM wf_c12_profile_parent`
    await db.$executeRawUnsafe(`REVOKE wf_c12_profile_parent FROM ${role}`)
    await db.$executeRawUnsafe(`ALTER ROLE ${role} NOINHERIT`)
  })
  await mutation("inherited-restrictive-select-policy-refused", async () => {
    await db.$executeRawUnsafe(`ALTER ROLE ${role} INHERIT`)
    await db.$executeRawUnsafe(`GRANT wf_c12_profile_parent TO ${role}`)
    await db.$executeRaw`CREATE POLICY inherited_hidden_fixture ON mtm_agent_workdays AS RESTRICTIVE FOR SELECT TO wf_c12_profile_parent USING (false)`
  }, () => refusal(), async () => {
    await db.$executeRaw`DROP POLICY inherited_hidden_fixture ON mtm_agent_workdays`
    await db.$executeRawUnsafe(`REVOKE wf_c12_profile_parent FROM ${role}`)
    await db.$executeRawUnsafe(`ALTER ROLE ${role} NOINHERIT`)
  })
  await mutation("non-applicable-select-policy-does-not-narrow-reader", async () => {
    await db.$executeRaw`CREATE POLICY other_role_fixture ON mtm_agent_workdays AS RESTRICTIVE FOR SELECT TO wf_c12_profile_parent USING (false)`
  }, async () => assert.equal((await run()).status, "MATCHED"),
  () => db.$executeRaw`DROP POLICY other_role_fixture ON mtm_agent_workdays`)
  await mutation("missing-select-refused",
    () => db.$executeRawUnsafe(`REVOKE SELECT ON mtm_agent_workdays FROM ${role}`), () => refusal(),
    () => db.$executeRawUnsafe(`GRANT SELECT ON mtm_agent_workdays TO ${role}`))
  await mutation("disabled-force-rls-refused", () => db.$executeRaw`ALTER TABLE mtm_agent_workdays NO FORCE ROW LEVEL SECURITY`,
    () => refusal(), () => db.$executeRaw`ALTER TABLE mtm_agent_workdays FORCE ROW LEVEL SECURITY`)
  await pass("temporary-shadow-relation-refused", () => refusal(tx => tx.$executeRaw`CREATE TEMP TABLE mtm_agent_workdays (id text) ON COMMIT DROP`))
  await mutation("view-replacement-refused", async () => {
    await db.$executeRaw`ALTER TABLE mtm_agent_workdays RENAME TO profile_hidden_workdays`
    await db.$executeRaw`CREATE VIEW mtm_agent_workdays AS SELECT * FROM profile_hidden_workdays`
    await db.$executeRawUnsafe(`GRANT SELECT ON mtm_agent_workdays TO ${role}`)
  }, () => refusal(), async () => {
    await db.$executeRaw`DROP VIEW mtm_agent_workdays`
    await db.$executeRaw`ALTER TABLE profile_hidden_workdays RENAME TO mtm_agent_workdays`
  })
  await mutation("missing-table-refused", () => db.$executeRaw`ALTER TABLE mtm_agent_workdays RENAME TO profile_hidden_workdays`,
    () => refusal(), () => db.$executeRaw`ALTER TABLE profile_hidden_workdays RENAME TO mtm_agent_workdays`)
  await mutation("unrelated-insert-policy-does-not-narrow-select",
    () => db.$executeRaw`CREATE POLICY insert_fixture ON mtm_agent_workdays FOR INSERT WITH CHECK (false)`,
    async () => assert.equal((await run()).status, "MATCHED"), () => db.$executeRaw`DROP POLICY insert_fixture ON mtm_agent_workdays`)
  await mutation("custom-equality-operator-policy-refused-despite-canonical-display", async () => {
    await db.$executeRaw`CREATE SCHEMA wf_c12_operator`
    await db.$executeRaw`CREATE FUNCTION wf_c12_operator.equal_text(text,text) RETURNS boolean LANGUAGE SQL IMMUTABLE AS 'SELECT pg_catalog.texteq($1,$2)'`
    await db.$executeRaw`CREATE OPERATOR wf_c12_operator.= (FUNCTION=wf_c12_operator.equal_text,LEFTARG=text,RIGHTARG=text)`
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA wf_c12_operator TO ${role}`)
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL search_path=wf_c12_operator,pg_catalog,public`
      await tx.$executeRaw`ALTER POLICY tenant_isolation ON public.mtm_agent_workdays USING ("organizationId"=current_setting('app.org_id',true))`
      const rows = await tx.$queryRaw`SELECT pg_catalog.pg_get_expr(polqual,polrelid) AS expression FROM pg_catalog.pg_policy WHERE polrelid='public.mtm_agent_workdays'::regclass`
      assert.equal(rows[0].expression, '("organizationId" = current_setting(\'app.org_id\'::text, true))')
      receipt.customOperatorCanonicalDisplayConfirmed = true
    })
  }, () => refusal(tx => tx.$executeRaw`SET LOCAL search_path=wf_c12_operator,pg_catalog,public`), async () => {
    await db.$executeRaw`ALTER POLICY tenant_isolation ON mtm_agent_workdays USING ("organizationId" OPERATOR(pg_catalog.=) pg_catalog.current_setting('app.org_id',true))`
    await db.$executeRaw`DROP SCHEMA wf_c12_operator CASCADE`
  })
  await mutation("nondefault-tenant-column-collation-refused", async () => {
    await db.$executeRaw`DROP POLICY tenant_isolation ON workforce_shift_segments`
    await db.$executeRaw`ALTER TABLE workforce_shift_segments ALTER COLUMN "organizationId" TYPE text COLLATE "C"`
    await db.$executeRaw`CREATE POLICY tenant_isolation ON workforce_shift_segments USING ("organizationId"=current_setting('app.org_id',true))`
  }, () => refusal(), async () => {
    await db.$executeRaw`DROP POLICY tenant_isolation ON workforce_shift_segments`
    await db.$executeRaw`ALTER TABLE workforce_shift_segments ALTER COLUMN "organizationId" TYPE text COLLATE "default"`
    await db.$executeRaw`CREATE POLICY tenant_isolation ON workforce_shift_segments USING ("organizationId"=current_setting('app.org_id',true))`
  })
  await pass("checked-policy-ddl-cannot-change-before-snapshot-finishes", async () => {
    await reader(tenant.id).$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await profile(tx, tenant.id)
      let blocked = false
      try {
        await other.$transaction(async change => {
          await change.$executeRaw`SET LOCAL lock_timeout='100ms'`
          await change.$executeRaw`ALTER POLICY tenant_isolation ON mtm_agent_workdays USING (false)`
        })
      } catch (error) { blocked = error?.code === "P2010" && error?.meta?.code === "55P03" }
      assert.equal(blocked, true)
    }, { isolationLevel: "RepeatableRead", timeout: 5000 })
  })
  receipt.catalog = {
    server: await db.$queryRaw`SELECT current_setting('server_version_num') AS version, current_setting('server_encoding') AS encoding`,
    relations: await db.$queryRawUnsafe(`SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force,
      (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS user_triggers,
      (SELECT md5(string_agg(a.attname||':'||a.atttypid::text||':'||a.attnotnull::text,',' ORDER BY a.attnum)) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_shape_hash
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${tables.map(t => `'${t}'`).join(",")}) ORDER BY c.relname`),
    indexes: await db.$queryRawUnsafe(`SELECT c.relname AS name,pg_get_indexdef(c.oid) AS definition,i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname IN (${indexes.map(i => `'${i}'`).join(",")}) ORDER BY c.relname`),
    operationalChecks: await db.$queryRaw`SELECT conname AS name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.workforce_reconciliation_tenant_states'::regclass ORDER BY conname`,
    historicalTriggersApplied: false,
    policyProvenance: "Synthetic explicit supported tenant policy; not production policy/ACL acceptance",
  }
  assert.equal(receipt.catalog.indexes.length, 9)
  assert.ok(receipt.catalog.indexes.every(index => index.valid && index.definition.includes('COLLATE "C"')))
  receipt.facts = originalFacts
  assert.deepEqual(await bind(), receipt.sourceBindings)
  receipt.status = "PASS_SUPPORTED_READER_PROFILE_ACCEPTANCE_ONLY"
  receipt.limitations = ["Two tenants with one workday/agent each; other source tables empty. Existing dense/closure suites remain separate coverage.",
    "Full current generated schema plus exact C12 operational migration; no historical migration replay or complete trigger restoration.",
    "Supported exact SELECT profile only; non-owner and whole-table SELECT are conservative admission rules, not a universal role policy.",
    "Administrative role attributes/membership must remain stable; relation locks cover relation/policy DDL, not role changes.",
    "Control-client visibility, collector/retention/alerts, representative density and production staging remain separate."]
} catch (error) {
  receipt.status = "FAIL"
  receipt.failure = { name: error?.name ?? "Error", code: typeof error?.code === "string" ? error.code : null,
    sqlState: /^[A-Z0-9]{5}$/.test(error?.meta?.code ?? "") ? error.meta.code : null }
  process.exitCode = 1
} finally {
  for (const client of [db, other]) if (client) {
    try { await client.$disconnect(); receipt.cleanup.push({ action: "disconnect", status: "PASS" }) }
    catch { receipt.cleanup.push({ action: "disconnect", status: "FAIL" }); process.exitCode = 1 }
  }
  if (container) {
    const result = spawnSync("docker", ["rm", "--force", "--volumes", container], { stdio: "ignore", timeout: 30000 })
    receipt.cleanup.push({ action: "remove-owned-disposable-container-and-volumes", status: result.status === 0 ? "PASS" : "FAIL" })
    if (result.status !== 0) process.exitCode = 1
  }
  if (fixturePath) await rm(fixturePath, { recursive: true, force: true })
  if (originalTestDatabaseUrl === undefined) delete process.env.EVENT_PLATFORM_TEST_DATABASE_URL
  else process.env.EVENT_PLATFORM_TEST_DATABASE_URL = originalTestDatabaseUrl
  if (process.exitCode) receipt.status = "FAIL"
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" })
  console.log(JSON.stringify({ status: receipt.status, cases: receipt.cases.length, cleanup: receipt.cleanup }))
}
