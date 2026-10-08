import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { FIELDS, MIGRATION, assessSchemaContract, parseSchemaContract, sourceBindings } from "./workforce-reconciliation-schema-contract.mjs"

const sql = fs.readFileSync(new URL("./workforce-reconciliation-schema-contract.sql", import.meta.url), "utf8")
const migration = fs.readFileSync(new URL("../" + MIGRATION, import.meta.url), "utf8")
const valid = () => Object.fromEntries(FIELDS.map(key => [key, true]))
test("finite validation retains each separate failed prerequisite and empty-match boundary", () => {
  assert.equal(assessSchemaContract(valid()).status, "MATCHED_CATALOG_CONTRACT_ONLY")
  for (const key of FIELDS) {
    const result = assessSchemaContract({ ...valid(), [key]: false })
    assert.equal(result.status, "INCOMPLETE")
    assert.deepEqual(result.failed, [key])
  }
  assert.deepEqual(assessSchemaContract(Object.fromEntries(FIELDS.map(key => [key, false]))).failed, FIELDS)
})
test("unknown/private fields, coercible dimensions, nulls and over-bound input refuse", () => {
  for (const value of [null, [], {}, { ...valid(), privateValue: "PRIVATE_SCHEMA_CANARY" }, { ...valid(), defaults: null }, { ...valid(), policy: 1 }, { ...valid(), checks: "true" }])
    assert.throws(() => assessSchemaContract(value), { message: "C12_SCHEMA_OUTPUT_INVALID" })
  for (const value of ["PRIVATE_SCHEMA_CANARY", "{}", " ".repeat(4097), JSON.stringify({ ...valid(), extra: "PRIVATE_SCHEMA_CANARY" })])
    assert.throws(() => parseSchemaContract(value), { message: "C12_SCHEMA_OUTPUT_INVALID" })
  const coercible = Object.assign(Object.create({ toJSON: () => "PRIVATE_SCHEMA_CANARY" }), valid())
  assert.throws(() => assessSchemaContract(coercible), { message: "C12_SCHEMA_OUTPUT_INVALID" })
  const accessor = valid()
  Object.defineProperty(accessor, "checks", { enumerable: true, get() { assert.fail("private accessor must never execute") } })
  assert.throws(() => assessSchemaContract(accessor), { message: "C12_SCHEMA_OUTPUT_INVALID" })
})
test("CLI withholds rejected raw input and refuses incomplete proof", () => {
  const run = input => spawnSync(process.execPath, [new URL("./workforce-reconciliation-schema-contract.mjs", import.meta.url).pathname], { input, encoding: "utf8", timeout: 5000 })
  const rejected = run(JSON.stringify({ ...valid(), privateValue: "PRIVATE_SCHEMA_CANARY" }))
  assert.equal(rejected.status, 1)
  assert.deepEqual(JSON.parse(rejected.stdout), { status: "ERROR", code: "C12_SCHEMA_OUTPUT_INVALID" })
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /PRIVATE_SCHEMA_CANARY/)
  const incomplete = run(JSON.stringify({ ...valid(), foreignKey: false }))
  assert.equal(incomplete.status, 1)
  assert.deepEqual(JSON.parse(incomplete.stdout).failed, ["foreignKey"])
  const matched = run(JSON.stringify(valid()))
  assert.equal(matched.status, 0)
  assert.equal(JSON.parse(matched.stdout).productionObserved, false)
  assert.equal(JSON.parse(matched.stdout).historicalReplay, false)
})
test("contract source is bound to the complete unmodified migration", () => {
  assert.equal(sourceBindings().length, 5)
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/)
  assert.match(sql, /SET LOCAL statement_timeout = '10s'/)
  assert.match(sql, /ROLLBACK;/)
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|GRANT|CREATE|ALTER|DROP|COPY|TRUNCATE)\b(?![^\n]*')/i)
})

test("isolated PostgreSQL16 catalog and drift acceptance", { skip: !process.env.C12_SCHEMA_TEST_DATABASE_URL }, async context => {
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.CI, "true")
  const url = new URL(process.env.C12_SCHEMA_TEST_DATABASE_URL)
  assert.equal(url.protocol, "postgresql:")
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.username, "postgres")
  assert.equal(url.pathname, "/hrm_c12_schema_contract_test")
  assert.equal(url.search, "")
  assert.equal(url.hash, "")
  assert.match(process.env.C12_EXPECTED_HEAD_SHA, /^[0-9a-f]{40}$/)
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), process.env.C12_EXPECTED_HEAD_SHA)
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C", PGHOST: "127.0.0.1", PGPORT: url.port || "5432",
    PGDATABASE: "hrm_c12_schema_contract_test", PGUSER: "postgres", PGPASSWORD: decodeURIComponent(url.password),
    PGPASSFILE: "/dev/null", PGCONNECT_TIMEOUT: "5" }
  const execute = text => {
    try { return execFileSync("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8", env, timeout: 20000, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }).trim() }
    catch { throw new Error("C12_ISOLATED_QUERY_FAILED") }
  }
  const reader = "wf_c12_schema_catalog_reader"
  const target = "workforce_reconciliation_tenant_states"
  const roots = ["mtm_agent_workdays", "mtm_agent_workday_events", "workforce_site_transitions", "workforce_attendance_evidence",
    "workforce_evidence_assessments", "workforce_exception_cases", "workforce_timesheet_approvals", "mtm_audit_logs"]
  const indexes = [...migration.matchAll(/CREATE INDEX "(wf_recon_[a-z_]+)"/g)].map(match => match[1])
  assert.equal(indexes.length, 9)
  assert.equal(execute("SELECT current_database()='hrm_c12_schema_contract_test' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);"), "t")
  assert.equal(execute("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','p','f');"), "0")
  execute(`CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
    GRANT USAGE ON SCHEMA public TO ${reader}; CREATE TABLE organizations(id text PRIMARY KEY);
    INSERT INTO organizations VALUES ('PRIVATE_SCHEMA_CANARY_A'),('PRIVATE_SCHEMA_CANARY_B');
    ${roots.map(name => `CREATE TABLE ${name} ("organizationId" text NOT NULL,id text NOT NULL${name === "workforce_timesheet_approvals" ? ',"agentId" text NOT NULL,"periodStart" date NOT NULL,"periodEnd" date NOT NULL' : ""});`).join("\n")}`)
  const beforeBindings = sourceBindings()
  const facts = () => roots.concat("organizations").map(name => execute(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY ${name === "organizations" ? "id" : '"organizationId",id'}),'')) FROM ${name} t;`))
  const originalFacts = facts()
  const reset = () => execute(`DROP TABLE IF EXISTS ${target} CASCADE; ${indexes.map(name => `DROP INDEX IF EXISTS "${name}";`).join("\n")} ${migration}`)
  const observe = () => parseSchemaContract(execute(`SET ROLE ${reader}; ${sql}`))
  const receipt = { fixture: "SELECTED_SYNTHETIC_DEPENDENCY_DDL_PLUS_COMPLETE_UNMODIFIED_C12_MIGRATION",
    sourceSha: process.env.C12_EXPECTED_HEAD_SHA, sourceBindings: beforeBindings, productionObserved: false, historicalReplay: false,
    status: "RUNNING", cases: [], limitations: ["No actual production catalog observation or old metadata-gate replacement", "No complete current/history schema, actual grants, density, timeout benchmark, scheduler, collectors or restore acceptance"] }
  async function check(name, fn) {
    await context.test(name, async () => { await fn(); assert.deepEqual(facts(), originalFacts); receipt.cases.push({ name, status: "PASS", businessFactsUnchanged: true }) })
  }
  try {
    reset()
    await check("exact migration matches as nonsuperuser with no business-table SELECT", () => {
      assert.equal(execute(`SET ROLE ${reader}; SELECT NOT rolsuper AND NOT rolbypassrls AND NOT has_table_privilege(current_user,'organizations','SELECT') AND NOT has_table_privilege(current_user,'${target}','SELECT') FROM pg_roles WHERE rolname=current_user;`), "t")
      const result = observe()
      assert.equal(result.status, "MATCHED_CATALOG_CONTRACT_ONLY")
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SCHEMA_CANARY|organizationId|tenant_isolation|SELECT/)
    })
    await check("actual defaults and five CHECK ranges reject bad values", () => {
      assert.equal(execute(`BEGIN; INSERT INTO ${target}("organizationId") VALUES ('PRIVATE_SCHEMA_CANARY_A');
        SELECT "consecutiveFailures"=0 AND "lastOutcome"='NEVER' AND "examinedCount"=0 AND "mismatchCount"=0 AND "durationMs"=0
          AND "dueAt" IS NOT NULL AND "updatedAt" IS NOT NULL AND "attemptToken" IS NULL AND "lastAttemptAt" IS NULL AND "lastCompletedAt" IS NULL FROM ${target}; ROLLBACK;`), "t")
      for (const [column, values] of [["consecutiveFailures", [-1,1001]], ["examinedCount", [-1,100001]], ["mismatchCount", [-1,1000001]], ["durationMs", [-1,3600001]], ["lastOutcome", ["'PRIVATE_SCHEMA_CANARY_INVALID'"]]]) {
        for (const value of values) assert.equal(execute(`BEGIN; DO $$ BEGIN
          BEGIN INSERT INTO ${target}("organizationId","${column}") VALUES ('PRIVATE_SCHEMA_CANARY_A',${value});
            RAISE EXCEPTION 'EXPECTED_CHECK_REJECTION'; EXCEPTION WHEN check_violation THEN NULL; END;
          END $$; SELECT count(*)=0 FROM ${target}; ROLLBACK;`), "t")
      }
    })
    await check("actual foreign key rejects orphan and cascades only within rolled-back fixture", () => {
      assert.equal(execute(`BEGIN; DO $$ BEGIN BEGIN INSERT INTO ${target}("organizationId") VALUES ('PRIVATE_SCHEMA_CANARY_ORPHAN');
        RAISE EXCEPTION 'EXPECTED_FK_REJECTION'; EXCEPTION WHEN foreign_key_violation THEN NULL; END; END $$;
        INSERT INTO ${target}("organizationId") VALUES ('PRIVATE_SCHEMA_CANARY_A'),('PRIVATE_SCHEMA_CANARY_B');
        DELETE FROM organizations WHERE id='PRIVATE_SCHEMA_CANARY_A'; SELECT count(*)=1 FROM ${target}; ROLLBACK;`), "t")
    })
    await check("actual forced RLS separates tenants and rejects foreign writes", () => {
      execute(`CREATE ROLE wf_c12_schema_tenant_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
        GRANT USAGE ON SCHEMA public TO wf_c12_schema_tenant_reader; GRANT SELECT,INSERT ON ${target} TO wf_c12_schema_tenant_reader;`)
      assert.equal(execute(`BEGIN; INSERT INTO ${target}("organizationId") VALUES ('PRIVATE_SCHEMA_CANARY_B');
        SET LOCAL ROLE wf_c12_schema_tenant_reader; SET LOCAL app.org_id='PRIVATE_SCHEMA_CANARY_A'; SET LOCAL app.rls_bypass='off';
        SELECT count(*)=0 FROM ${target}; INSERT INTO ${target}("organizationId") VALUES ('PRIVATE_SCHEMA_CANARY_A');
        SELECT count(*)=1 FROM ${target};
        DO $$ BEGIN BEGIN INSERT INTO ${target}("organizationId") VALUES ('PRIVATE_SCHEMA_CANARY_B');
          RAISE EXCEPTION 'EXPECTED_RLS_REJECTION'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$; ROLLBACK;`), "t\nt")
    })
    const mutations = [
      ["nullable tenant key", `ALTER TABLE ${target} DROP CONSTRAINT workforce_reconciliation_tenant_states_pkey; ALTER TABLE ${target} ALTER COLUMN "organizationId" DROP NOT NULL`, "columnShape"],
      ["wrong timestamp precision", `ALTER TABLE ${target} ALTER COLUMN "dueAt" TYPE timestamp(6)`, "columnShape"],
      ["wrong UUID type", `ALTER TABLE ${target} ALTER COLUMN "attemptToken" TYPE text USING "attemptToken"::text`, "columnShape"],
      ["extra private column", `ALTER TABLE ${target} ADD COLUMN private_fixture text`, "columnShape"],
      ["missing default", `ALTER TABLE ${target} ALTER COLUMN "dueAt" DROP DEFAULT`, "defaults"],
      ["changed default", `ALTER TABLE ${target} ALTER COLUMN "consecutiveFailures" SET DEFAULT 1`, "defaults"],
      ["unexpected nullable default", `ALTER TABLE ${target} ALTER COLUMN "attemptToken" SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid`, "defaults"],
      ["missing primary key", `ALTER TABLE ${target} DROP CONSTRAINT workforce_reconciliation_tenant_states_pkey`, "primaryKey"],
      ["deferrable primary key", `ALTER TABLE ${target} DROP CONSTRAINT workforce_reconciliation_tenant_states_pkey; ALTER TABLE ${target} ADD PRIMARY KEY ("organizationId") DEFERRABLE`, "primaryKey"],
      ["missing foreign key", `ALTER TABLE ${target} DROP CONSTRAINT "workforce_reconciliation_tenant_states_organizationId_fkey"`, "foreignKey"],
      ["wrong foreign delete action", `ALTER TABLE ${target} DROP CONSTRAINT "workforce_reconciliation_tenant_states_organizationId_fkey"; ALTER TABLE ${target} ADD FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE RESTRICT`, "foreignKey"],
      ["unvalidated foreign key", `ALTER TABLE ${target} DROP CONSTRAINT "workforce_reconciliation_tenant_states_organizationId_fkey"; ALTER TABLE ${target} ADD FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE NOT VALID`, "foreignKey"],
      ["disabled foreign key triggers", `ALTER TABLE ${target} DISABLE TRIGGER ALL`, "foreignKey"],
      ["missing range check", `ALTER TABLE ${target} DROP CONSTRAINT "workforce_reconciliation_tenant_states_durationMs_check"`, "checks"],
      ["weakened range check", `ALTER TABLE ${target} DROP CONSTRAINT "workforce_reconciliation_tenant_states_durationMs_check"; ALTER TABLE ${target} ADD CHECK ("durationMs" BETWEEN 0 AND 3600001)`, "checks"],
      ["unvalidated check", `ALTER TABLE ${target} DROP CONSTRAINT "workforce_reconciliation_tenant_states_durationMs_check"; ALTER TABLE ${target} ADD CHECK ("durationMs" BETWEEN 0 AND 3600000) NOT VALID`, "checks"],
      ["extra check", `ALTER TABLE ${target} ADD CHECK ("durationMs" < 2)`, "checks"],
      ["RLS disabled", `ALTER TABLE ${target} DISABLE ROW LEVEL SECURITY`, "rls"],
      ["forced RLS removed", `ALTER TABLE ${target} NO FORCE ROW LEVEL SECURITY`, "rls"],
      ["policy missing", `DROP POLICY tenant_isolation ON ${target}`, "policy"],
      ["policy read broadened", `ALTER POLICY tenant_isolation ON ${target} USING (true)`, "policy"],
      ["policy write broadened", `ALTER POLICY tenant_isolation ON ${target} WITH CHECK (true)`, "policy"],
      ["additional restrictive policy", `CREATE POLICY hidden_fixture ON ${target} AS RESTRICTIVE USING (false)`, "policy"],
      ["custom operator policy dependency", `CREATE FUNCTION public.c12_fixture_equal(text,text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
        CREATE OPERATOR public.= (LEFTARG=text,RIGHTARG=text,FUNCTION=public.c12_fixture_equal);
        ALTER POLICY tenant_isolation ON ${target} USING ("organizationId" OPERATOR(public.=) current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on')`, "policy"],
      ["missing due index", `DROP INDEX wf_reconciliation_due_attempt_org_idx`, "indexes"],
      ["descending due index", `DROP INDEX wf_reconciliation_due_attempt_org_idx; CREATE INDEX wf_reconciliation_due_attempt_org_idx ON ${target} ("dueAt" DESC,"lastAttemptAt","organizationId")`, "indexes"],
      ["partial due index", `DROP INDEX wf_reconciliation_due_attempt_org_idx; CREATE INDEX wf_reconciliation_due_attempt_org_idx ON ${target} ("dueAt","lastAttemptAt","organizationId") WHERE "durationMs"=0`, "indexes"],
      ["extra index", `CREATE INDEX private_extra_index ON ${target} ("attemptToken")`, "indexes"],
      ["additional user trigger", `CREATE FUNCTION public.c12_fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER c12_fixture_trigger BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION public.c12_fixture_trigger()`, "noUserTriggers"],
    ]
    for (const [name, change, field] of mutations) await check(name, () => {
      reset(); execute(change)
      const result = observe()
      assert.equal(result.status, "INCOMPLETE")
      assert.ok(result.failed.includes(field), `expected finite field ${field}`)
    })
    await check("missing table gives finite refusal", () => { reset(); execute(`DROP TABLE ${target}`); assert.equal(observe().status, "INCOMPLETE") })
    await check("all checks restored without changing original business facts", () => { reset(); assert.equal(observe().status, "MATCHED_CATALOG_CONTRACT_ONLY"); assert.deepEqual(sourceBindings(), beforeBindings) })
    receipt.status = context.signal.aborted || receipt.cases.length !== mutations.length + 6 ? "FAIL" : "PASS_ISOLATED_SCHEMA_CONTRACT_ONLY"
    assert.equal(receipt.status, "PASS_ISOLATED_SCHEMA_CONTRACT_ONLY")
  } finally {
    if (receipt.status === "RUNNING") receipt.status = "FAIL"
    if (process.env.C12_SCHEMA_RECEIPT) fs.writeFileSync(process.env.C12_SCHEMA_RECEIPT, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  }
})
