import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { TARGET_SOURCE_SHA, MIGRATIONS, RELATIONS, INDEXES, GUARD_MD5, LEDGER_GUARD_MD5, parseMigrationEnv, readRootFile, validateSnapshot, assessMetadata, validateReport, inspectRemote, queryMetadata } from "./hrm-migration-metadata-preflight.mjs"

const sql = fs.readFileSync(new URL("./hrm-migration-metadata-preflight.sql", import.meta.url), "utf8")
const helper = fs.readFileSync(new URL("./hrm-migration-metadata-preflight.mjs", import.meta.url), "utf8")
const sha = "a".repeat(40)
const digest = text => createHash("sha256").update(text).digest("hex")
const bindings = { helperSha256: digest(helper), sqlSha256: digest(sql) }
const defaults = () => ({ lockTimeoutMs: 10000, statementTimeoutMs: 840000, readOnlyForced: true })
const snapshot = () => ({
  readOnly: true, repeatableRead: true,
  roleProfile: { noSuperuser: true, bypassRls: true, canLogin: true, sessionIdentityUnchanged: true, expectedIdentity: true },
  ledger: { totalRows: 200, unresolvedRows: 0, known: MIGRATIONS.map(name => ({ name, rows: 0, applied: 0, unresolved: 0, rolledBack: 0, checksumMatch: true })) },
  relations: RELATIONS.map(name => ({ name, present: name !== "workforce_reconciliation_tenant_states", ordinaryTable: name !== "workforce_reconciliation_tenant_states", rls: !["organizations", "workforce_reconciliation_tenant_states"].includes(name), forcedRls: !["organizations", "workforce_reconciliation_tenant_states"].includes(name), ownerAbility: name !== "workforce_reconciliation_tenant_states", bytes: 0, estimatedRows: 0, keyColumnsMatch: name !== "workforce_reconciliation_tenant_states" })),
  indexes: INDEXES.map(name => ({ name, present: false, shapeMatch: false })),
  guard: { present: true, shapeMatch: true, bodyMd5: GUARD_MD5.pending, ownerAbility: true, triggerBound: true },
  ledgerGuards: { appendFunctionMatches: true, appendTriggerBound: true, revisionFunctionMatches: true, revisionTriggerBound: true },
  defaultAcl: { canCreatePublicSchema: true, explicitPrivilegeRows: 0, publicPrivilegeRows: 0, nonOwnerWriteRows: 0, grantableRows: 0 },
  activity: { visibilityComplete: true, otherActiveSessions: 0, otherOpenTransactions: 0, lockWaitSessions: 0 },
})
const encoded = () => JSON.stringify(defaults()) + "\n" + JSON.stringify(snapshot()) + "\n"
const fakeRead = path => path.endsWith(".deploy-sha") ? sha + "\n" : "MIGRATION_DATABASE_URL='postgresql://synthetic:protected@127.0.0.1/fixture'\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"
const sourceFunction = (migration, name) => {
  const text = fs.readFileSync(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8")
  return [...text.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, "g"))].at(-1)
}

test("static env parser never sources shell and rejects ambiguous/session overrides", () => {
  assert.equal(parseMigrationEnv("# comment\nexport MIGRATION_DATABASE_URL='postgresql://synthetic:protected@host/fixture?schema=public&sslmode=verify-full'\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"), "postgresql://synthetic:protected@host/fixture?sslmode=verify-full")
  for (const text of ["MIGRATION_DATABASE_URL='postgresql://synthetic@host/db", "MIGRATION_DATABASE_URL=postgresql://synthetic@host/db\nMIGRATION_DATABASE_URL=postgresql://synthetic@host/db", "MIGRATION_DATABASE_URL=postgresql://synthetic@host/db?options=-c%20default_transaction_read_only=off", "MIGRATION_DATABASE_URL=postgresql://synthetic@host/db?host=other", "MIGRATION_DATABASE_URL=postgresql://synthetic@host/db?schema=private", "MIGRATION_DATABASE_URL=postgresql://synthetic@host/db?sslmode=require&sslmode=disable", "MIGRATION_DATABASE_URL=postgresql://other@host/db", "MIGRATION_DATABASE_URL=postgresql://synthetic@host/db\0"]) assert.throws(() => parseMigrationEnv(text + "\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"), { message: "ENV_INVALID" })
  assert.throws(() => parseMigrationEnv("MIGRATION_DATABASE_URL=postgresql://synthetic@host/db"), { message: "ENV_INVALID" })
  assert.throws(() => parseMigrationEnv("MIGRATION_DATABASE_URL=postgresql://synthetic@host/db\nMIGRATION_EXPECTED_DB_ROLE=synthetic\nMIGRATION_EXPECTED_DB_ROLE=synthetic"), { message: "ENV_INVALID" })
  // Even shell syntax in a literal password is only data passed to libpq.
  assert.match(parseMigrationEnv("MIGRATION_DATABASE_URL='postgresql://synthetic:%24%28false%29@host/fixture'\nMIGRATION_EXPECTED_DB_ROLE=synthetic"), /%24%28false%29/)
})

test("pending metadata is reviewable while every unresolved prerequisite stays explicit", () => {
  assert.deepEqual(assessMetadata(defaults(), snapshot()), { status: "READY_FOR_REVIEW", reasons: [], migrationStates: ["pending", "pending"] })
  const cases = [
    [s => { s.ledger.unresolvedRows = 1 }, "LEDGER_UNRESOLVED"],
    [s => { s.roleProfile.noSuperuser = false }, "ROLE_PROFILE_UNVERIFIED"],
    [s => { s.roleProfile.bypassRls = false }, "ROLE_PROFILE_UNVERIFIED"],
    [s => { s.roleProfile.sessionIdentityUnchanged = false }, "ROLE_PROFILE_UNVERIFIED"],
    [s => { s.roleProfile.expectedIdentity = false }, "ROLE_PROFILE_UNVERIFIED"],
    [s => { s.ledger.known[0].checksumMatch = false }, "CHECKSUM_MISMATCH"],
    [s => { s.relations[0].present = false }, "RELATION_SHAPE"],
    [s => { s.relations[0].forcedRls = false }, "RLS_UNVERIFIED"],
    [s => { s.relations[0].ownerAbility = false }, "OWNER_ABILITY"],
    [s => { s.indexes[0].present = true }, "INDEX_SHAPE"],
    [s => { s.guard.bodyMd5 = "0".repeat(32) }, "FUNCTION_SHAPE"],
    [s => { s.guard.triggerBound = false }, "FUNCTION_SHAPE"],
    [s => { s.defaultAcl.nonOwnerWriteRows = 1 }, "DEFAULT_ACL_UNREVIEWED"],
    [s => { s.activity.visibilityComplete = false }, "ACTIVITY_VISIBILITY_UNVERIFIED"],
  ]
  for (const [mutate, reason] of cases) { const s = snapshot(); mutate(s); const result = assessMetadata(defaults(), s); assert.equal(result.status, "INCOMPLETE"); assert.ok(result.reasons.includes(reason), reason) }
  assert.ok(assessMetadata({ ...defaults(), lockTimeoutMs: 0 }, snapshot()).reasons.includes("TIMEOUT_DEFAULTS"))
  assert.ok(assessMetadata({ ...defaults(), readOnlyForced: false }, snapshot()).reasons.includes("READ_ONLY_UNVERIFIED"))
})

test("applied/manual new table is incomplete until all table constraints/policy are independently proved", () => {
  const s = snapshot()
  for (const entry of s.ledger.known) Object.assign(entry, { rows: 1, applied: 1 })
  for (const entry of s.indexes) Object.assign(entry, { present: true, shapeMatch: true })
  const relation = s.relations.find(entry => entry.name === "workforce_reconciliation_tenant_states")
  Object.assign(relation, { present: true, ordinaryTable: true, rls: true, forcedRls: true, ownerAbility: true })
  s.guard.bodyMd5 = GUARD_MD5.applied
  assert.deepEqual(assessMetadata(defaults(), s), { status: "INCOMPLETE", reasons: ["APPLIED_TABLE_CONSTRAINTS_NOT_PROVED"], migrationStates: ["applied", "applied"] })
})

test("organizations FK target permits its existing RLS state while every tenant-owned relation requires FORCE RLS", () => {
  const initial = snapshot()
  const organization = initial.relations.find(entry => entry.name === "organizations")
  assert.equal(organization.rls, false)
  assert.equal(organization.forcedRls, false)
  assert.equal(assessMetadata(defaults(), initial).status, "READY_FOR_REVIEW")
  for (const name of RELATIONS.filter(name => !["organizations", "workforce_reconciliation_tenant_states"].includes(name))) {
    const changed = snapshot()
    changed.relations.find(entry => entry.name === name).forcedRls = false
    assert.ok(assessMetadata(defaults(), changed).reasons.includes("RLS_UNVERIFIED"), name)
  }
})

test("decision guard catalog booleans fail closed individually and bind exact committed function bodies", () => {
  for (const field of Object.keys(snapshot().ledgerGuards)) {
    const changed = snapshot()
    changed.ledgerGuards[field] = false
    assert.ok(assessMetadata(defaults(), changed).reasons.includes("LEDGER_GUARDS_UNVERIFIED"), field)
    changed.ledgerGuards[field] = "protected"
    assert.throws(() => validateSnapshot(defaults(), changed), { message: "OUTPUT_INVALID" })
  }
  for (const [kind, migration, name] of [
    ["append", "20260927014100_workforce_exception_case_revisions_backfill", "workforce_reject_exception_decision_mutation"],
    ["revision", "20260927014000_workforce_exception_case_revisions", "workforce_assign_exception_decision_revision"],
  ]) {
    const declaration = sourceFunction(migration, name)
    assert.ok(declaration)
    assert.equal(createHash("md5").update(declaration[1]).digest("hex"), LEDGER_GUARD_MD5[kind])
    assert.ok(sql.includes(LEDGER_GUARD_MD5[kind]))
  }
  assert.match(sql, /t\.tgtype=27 AND t\.tgqual IS NULL/)
  assert.match(sql, /t\.tgtype=7 AND t\.tgqual IS NULL/)
})

test("strict finite projection rejects secret fields, malformed counts and unknown names", () => {
  for (const mutate of [s => { s.secret = "protected" }, s => { s.relations[0].roleName = "protected" }, s => { s.guard.bodyMd5 = "raw SQL" }, s => { s.indexes[0].name = "unknown" }, s => { s.ledger.known[0].rows = 1 }, s => { s.relations[0].bytes = Infinity }]) {
    const s = snapshot(); mutate(s); assert.throws(() => validateSnapshot(defaults(), s), { message: "OUTPUT_INVALID" })
  }
})

test("remote inspection checks artifact before/after, canonical protected env, read-only outputs", () => {
  const reads = []
  const report = inspectRemote(sql, bindings, sha, { uid: 0, read: (path, limit, mode) => { reads.push({ path, limit, mode }); return fakeRead(path) }, query: (url, source) => { assert.equal(source, sql); assert.equal(new URL(url).hostname, "127.0.0.1"); return encoded() } })
  assert.equal(report.status, "READY_FOR_REVIEW")
  assert.equal(report.targetSourceSha, TARGET_SOURCE_SHA)
  assert.equal(reads.length, 3)
  assert.deepEqual(reads[1], { path: "/etc/leaddrive/migration.env", limit: 32768, mode: 0o600 })
  assert.equal(validateReport(report, sha), report)
  for (const [deps, code] of [
    [{ uid: 1 }, "INPUT_INVALID"],
    [{ uid: 0, read: () => "b".repeat(40), query: () => { assert.fail("query must not run after artifact mismatch") } }, "ARTIFACT_MISMATCH"],
    [{ uid: 0, read: fakeRead, query: () => { throw new Error("protected credentials") } }, "INSPECTION_FAILED"],
    [{ uid: 0, read: fakeRead, query: () => encoded() + "protected\n" }, "OUTPUT_INVALID"],
  ]) { const failed = inspectRemote(sql, bindings, sha, deps); assert.equal(failed.status, "ERROR"); assert.equal(failed.code, code); assert.doesNotMatch(JSON.stringify(failed), /protected credentials/) }
  let calls = 0
  assert.equal(inspectRemote(sql, bindings, sha, { uid: 0, read: path => path.endsWith(".deploy-sha") ? (++calls === 1 ? sha : "b".repeat(40)) : fakeRead(path), query: encoded }).code, "ARTIFACT_MISMATCH")
})

test("psql receives connection only in a clean child environment, bounded read-only options, no raw error", () => {
  let observed
  const connection = "postgresql://synthetic:protected@host/fixture"
  assert.equal(queryMetadata(connection, sql, (binary, args, options) => { observed = { binary, args, options }; return "bounded" }), "bounded")
  assert.equal(observed.binary, "psql")
  assert.equal(observed.args.join(" ").includes(connection), false)
  assert.equal(observed.options.input, sql)
  assert.equal(observed.options.env.PGDATABASE, connection)
  assert.equal(observed.options.env.PGOPTIONS, "-c default_transaction_read_only=on -c application_name=hrm_migration_metadata_preflight -c hrm.preflight_expected_role=synthetic")
  assert.equal(observed.options.env.HOME, undefined)
  assert.equal(observed.options.timeout, 30000)
  assert.equal(observed.options.maxBuffer, 65536)
  assert.ok(observed.args.includes("VERBOSITY=sqlstate"))
  assert.throws(() => queryMetadata(connection, sql, () => { throw new Error(connection) }), { message: "QUERY_FAILED" })
})

test("only whitelisted SQLSTATE survives query failures; messages and unknown codes are withheld", () => {
  for (const [state, expected] of [["42501", "42501"], ["42P01", "42P01"], ["57014", "57014"], ["25006", "25006"], ["99999", null]]) {
    const query = () => queryMetadata("postgresql://synthetic:protected@host/fixture", sql, () => { const error = new Error("protected credentials"); error.stderr = `psql:<stdin>:23: ERROR:  ${state}\nprotected raw details\n`; throw error })
    const report = inspectRemote(sql, bindings, sha, { uid: 0, read: fakeRead, query })
    assert.equal(report.status, "ERROR")
    assert.equal(report.code, "QUERY_FAILED")
    assert.equal(report.sqlState, expected)
    assert.doesNotMatch(JSON.stringify(report), /protected credentials|protected raw details/)
  }
  const report = inspectRemote(sql, bindings, sha, { uid: 1 })
  assert.throws(() => validateReport({ ...report, sqlState: "42501" }, sha), { message: "OUTPUT_INVALID" })
})

test("root file read refuses symlink, weak ownership/mode and race changes", () => {
  const directory = { uid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false }
  const file = { uid: 0, mode: 0o100600, size: 3, dev: 1, ino: 1, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false }
  const io = overrides => ({ lstatSync: path => path === "/etc/leaddrive/migration.env" ? file : directory, fstatSync: () => file, openSync: () => 1, readFileSync: () => Buffer.from("abc"), closeSync: () => {}, ...overrides })
  assert.equal(readRootFile("/etc/leaddrive/migration.env", 100, 0o600, io()), "abc")
  for (const bad of [{ ...file, uid: 1000 }, { ...file, mode: 0o100644 }, { ...file, isSymbolicLink: () => true }]) assert.throws(() => readRootFile("/etc/leaddrive/migration.env", 100, 0o600, io({ lstatSync: path => path.endsWith(".env") ? bad : directory })), { message: "FILES_UNSAFE" })
  assert.throws(() => readRootFile("/etc/leaddrive/migration.env", 100, 0o600, io({ fstatSync: () => ({ ...file, ino: 2 }) })), { message: "SOURCE_CHANGED" })
})

test("fixed SQL observes defaults before bounded read-only snapshot and exports no HR rows or identities", () => {
  assert.ok(sql.indexOf("'lockTimeoutMs'") < sql.indexOf("BEGIN TRANSACTION"))
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
  assert.match(sql, /SET LOCAL lock_timeout='2s';/)
  assert.match(sql, /SET LOCAL statement_timeout='10s';/)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY)\s+(?:INTO|FROM|TABLE|INDEX|ROLE|USER|FUNCTION|POLICY)\b/i)
  assert.doesNotMatch(sql, /FROM\s+public\.(?!_prisma_migrations\b)/i)
  assert.equal((sql.match(/'wf_recon[^']*'/g) ?? []).length, 10)
  for (const name of MIGRATIONS) assert.ok(sql.includes(name))
})

test("stdin remote bundle leaves CLI inactive, emits only a validated static error outside root", () => {
  const bundle = execFileSync(process.execPath, ["scripts/hrm-migration-metadata-preflight.mjs", "--emit-remote"], { encoding: "utf8", maxBuffer: 200000 })
  const safeBundle = bundle.replace("process.env.EXPECTED_MAIN_SHA);", "process.env.EXPECTED_MAIN_SHA, {uid:1});")
  let result
  try { execFileSync(process.execPath, ["--input-type=module", "-"], { input: safeBundle, encoding: "utf8", env: { EXPECTED_MAIN_SHA: sha }, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }); assert.fail("non-root remote bundle must fail") }
  catch (error) { assert.equal(error.status, 1); assert.equal(error.stderr, ""); result = error.stdout }
  assert.equal(validateReport(JSON.parse(result), sha).code, "INPUT_INVALID")
})

test("runner validator retains valid original failures but never prints rejected private fields", () => {
  const report = inspectRemote(sql, bindings, sha, { uid: 1 })
  const run = input => execFileSync(process.execPath, ["scripts/hrm-migration-metadata-preflight.mjs", "--validate-output", sha], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] })
  assert.deepEqual(JSON.parse(run(report)), report)
  for (const invalid of [{ ...report, rawEnvironment: "protected marker" }, { ...report, bindings: { ...bindings, sqlSha256: "b".repeat(64) } }]) {
    try { run(invalid); assert.fail("invalid output must fail") }
    catch (error) { assert.equal(error.status, 1); assert.equal(error.stdout, ""); assert.equal(error.stderr, "HRM metadata output invalid; raw data withheld\n") }
  }
})

// Only this hosted-only test writes a disposable SQL fixture. The production
// helper has no test mode, privilege bypass or mutation path.
test("hosted PostgreSQL executes the real fixed catalog query and rejects writes", { skip: !process.env.HRM_PREFLIGHT_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.HRM_PREFLIGHT_TEST_DATABASE_URL)
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.CI, "true")
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.pathname, "/hrm_preflight_test")
  assert.equal(url.username, "postgres")
  const env = { PATH: process.env.PATH, LC_ALL: "C", PGDATABASE: url.href, PGCONNECT_TIMEOUT: "5" }
  const execute = text => execFileSync("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8", env, timeout: 20000, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] })
  assert.equal(execute("SELECT current_database()='hrm_preflight_test' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);\n").trim(), "t")
  assert.equal(execute("SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';\n").trim(), "0")
  const oldMigration = fs.readFileSync(new URL("../prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql", import.meta.url), "utf8")
  const guard = /CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(oldMigration)
  assert.ok(guard)
  assert.equal(createHash("md5").update(guard[1]).digest("hex"), GUARD_MD5.pending)
  const extra = {
    workforce_exception_decisions: ',"caseId" text NOT NULL,"caseRevision" integer NOT NULL',
    mtm_agents: ',"teamId" text',
    workforce_shift_templates: ',"teamId" text,"status" "WorkforceDefinitionStatus" NOT NULL',
    workforce_shift_assignments: ',"agentId" text NOT NULL,"templateId" text NOT NULL,"assignedByUserId" text NOT NULL,"effectiveFrom" date NOT NULL,"effectiveTo" date',
    workforce_shift_snapshots: ',"assignmentId" text,"workDate" date NOT NULL',
    workforce_timesheet_approvals: ',"agentId" text NOT NULL,"periodStart" date NOT NULL,"periodEnd" date NOT NULL',
  }
  const tables = RELATIONS.filter(name => name !== "workforce_reconciliation_tenant_states").map(name => name === "organizations"
    ? 'CREATE TABLE organizations ("id" text PRIMARY KEY);'
    : `CREATE TABLE "${name}" ("organizationId" text NOT NULL,"id" text NOT NULL${extra[name] ?? ""}); ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${name}" FORCE ROW LEVEL SECURITY;`).join("\n")
  const append = sourceFunction("20260927014100_workforce_exception_case_revisions_backfill", "workforce_reject_exception_decision_mutation")
  const revision = sourceFunction("20260927014000_workforce_exception_case_revisions", "workforce_assign_exception_decision_revision")
  execute(`BEGIN; CREATE ROLE hrm_preflight_migration LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'isolated-preflight-migration'; GRANT USAGE,CREATE ON SCHEMA public TO hrm_preflight_migration; SET ROLE hrm_preflight_migration; CREATE TABLE _prisma_migrations(id text NOT NULL,migration_name text NOT NULL,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz); CREATE TYPE "WorkforceDefinitionStatus" AS ENUM ('ACTIVE','DRAFT','RETIRED'); ${tables}\n${guard[0]}\n${append[0]}\n${revision[0]}\nCREATE TRIGGER workforce_shift_assignments_guard BEFORE INSERT OR UPDATE ON workforce_shift_assignments FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_assignment(); CREATE TRIGGER workforce_exception_decisions_append_only BEFORE UPDATE OR DELETE ON workforce_exception_decisions FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_decision_mutation(); CREATE TRIGGER workforce_exception_decisions_assign_case_revision BEFORE INSERT ON workforce_exception_decisions FOR EACH ROW EXECUTE FUNCTION workforce_assign_exception_decision_revision(); COMMIT; RESET ROLE; ALTER ROLE hrm_preflight_migration SET lock_timeout='10s'; ALTER ROLE hrm_preflight_migration SET statement_timeout='14min';`)
  const migrationUrl = new URL(url.href)
  migrationUrl.username = "hrm_preflight_migration"
  migrationUrl.password = "isolated-preflight-migration"
  try {
    const query = () => { const lines = queryMetadata(migrationUrl.href, sql).trim().split("\n"); assert.equal(lines.length, 2); return lines.map(JSON.parse) }
    let [d, s] = query()
    assert.deepEqual(assessMetadata(d, s), { status: "READY_FOR_REVIEW", reasons: [], migrationStates: ["pending", "pending"] })
    for (const [trigger, field] of [["workforce_exception_decisions_append_only", "appendTriggerBound"], ["workforce_exception_decisions_assign_case_revision", "revisionTriggerBound"]]) {
      execute(`ALTER TABLE workforce_exception_decisions DISABLE TRIGGER ${trigger};`)
      ;[d, s] = query()
      assert.equal(s.ledgerGuards[field], false)
      assert.ok(assessMetadata(d, s).reasons.includes("LEDGER_GUARDS_UNVERIFIED"))
      execute(`ALTER TABLE workforce_exception_decisions ENABLE TRIGGER ${trigger};`)
    }
    execute("ALTER FUNCTION workforce_assign_exception_decision_revision() SECURITY DEFINER;")
    ;[d, s] = query()
    assert.equal(s.ledgerGuards.revisionFunctionMatches, false)
    execute("ALTER FUNCTION workforce_assign_exception_decision_revision() SECURITY INVOKER; CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END; $$;")
    ;[d, s] = query()
    assert.equal(s.ledgerGuards.appendFunctionMatches, false)
    execute(append[0] + ' ALTER TABLE workforce_exception_decisions ALTER COLUMN "caseRevision" DROP NOT NULL;')
    ;[d, s] = query()
    assert.equal(s.relations.find(entry => entry.name === "workforce_exception_decisions").keyColumnsMatch, false)
    assert.ok(assessMetadata(d, s).reasons.includes("RELATION_SHAPE"))
    execute('ALTER TABLE workforce_exception_decisions ALTER COLUMN "caseRevision" SET NOT NULL;')
    execute("CREATE INDEX wf_recon_workdays_c_idx ON mtm_agent_workdays (\"organizationId\",\"id\");")
    ;[d, s] = query()
    assert.ok(assessMetadata(d, s).reasons.includes("INDEX_SHAPE"))
    assert.ok(assessMetadata(d, s).reasons.includes("INDEX_LEDGER_MISMATCH"))
    execute("DROP INDEX wf_recon_workdays_c_idx; CREATE INDEX wf_recon_workdays_c_idx ON mtm_agent_workdays (\"organizationId\",\"id\" COLLATE \"C\");")
    ;[d, s] = query()
    assert.equal(s.indexes.find(entry => entry.name === "wf_recon_workdays_c_idx").shapeMatch, true)
    execute("DROP INDEX wf_recon_workdays_c_idx; INSERT INTO _prisma_migrations VALUES ('fixture-unresolved','synthetic-only','wrong-checksum',NULL,NULL);")
    ;[d, s] = query()
    assert.ok(assessMetadata(d, s).reasons.includes("LEDGER_UNRESOLVED"))
    execute("DELETE FROM _prisma_migrations; INSERT INTO _prisma_migrations VALUES ('known-wrong','20261005193000_workforce_reconciliation_operations','wrong-checksum',now(),NULL);")
    ;[d, s] = query()
    assert.equal(s.ledger.known[0].checksumMatch, false)
    assert.ok(assessMetadata(d, s).reasons.includes("CHECKSUM_MISMATCH"))
    execute("DELETE FROM _prisma_migrations; ALTER ROLE hrm_preflight_migration SET lock_timeout='1s';")
    ;[d, s] = query()
    assert.equal(d.lockTimeoutMs, 1000)
    assert.ok(assessMetadata(d, s).reasons.includes("TIMEOUT_DEFAULTS"))
    assert.throws(() => queryMetadata(migrationUrl.href, "INSERT INTO _prisma_migrations VALUES ('write','synthetic','no',NULL,NULL);"), { message: "QUERY_FAILED" })
    assert.equal(execute("SELECT count(*) FROM _prisma_migrations;").trim(), "0")
  } finally {
    execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP ROLE hrm_preflight_migration;")
  }
})
