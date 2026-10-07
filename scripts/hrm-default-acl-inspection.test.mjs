import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { databaseConnectionEnvironment } from "./hrm-migration-metadata-preflight.mjs"
import { ACL_LIMITS, ACL_CODES, ACL_PRIVILEGES, parseApplicationEnv, validateAclData, validateAclSnapshot, queryAclMetadata, validateAclReport, inspectAclRemote } from "./hrm-default-acl-inspection.mjs"

const source = name => fs.readFileSync(new URL(name, import.meta.url), "utf8")
const sql = source("./hrm-default-acl-inspection.sql")
const helper = source("./hrm-default-acl-inspection.mjs")
const digest = value => createHash("sha256").update(value).digest("hex")
const bindings = { baseHelperSha256: digest(source("./hrm-migration-metadata-preflight.mjs")), helperSha256: digest(helper), sqlSha256: digest(sql) }
const sha = "a".repeat(40)
const marker = "private-fixture-marker-97bb"
const appUrl = "postgresql://acl_runtime:" + marker + "@127.0.0.1:5432/fixture"
const migrationUrl = "postgresql://acl_migration:" + marker + "@127.0.0.1:5432/fixture"
const runtimeProfile = () => ({ present: true, noSuperuser: true, noBypassRls: true, canLogin: true, setPrivilegedCount: 0 })
const migrationProfile = () => ({ ...runtimeProfile(), noBypassRls: false })
const entry = (privilege = "INSERT", recipient = "EXPECTED_RUNTIME", profile = runtimeProfile()) => ({ scope: "PUBLIC_SCHEMA", recipient, privilege, grantable: false, rowCount: 1, recipientProfile: profile })
const data = (entries = [entry("SELECT"), entry("INSERT"), entry("UPDATE"), entry("DELETE"), entry("SELECT", "OTHER", { ...runtimeProfile(), canLogin: false })]) => ({
  explicitPrivilegeRows: entries.reduce((sum, e) => sum + e.rowCount, 0),
  publicPrivilegeRows: entries.filter(e => e.recipient === "PUBLIC").reduce((sum, e) => sum + e.rowCount, 0),
  nonOwnerWriteRows: entries.filter(e => e.recipient !== "OWNER" && e.privilege !== "SELECT").reduce((sum, e) => sum + e.rowCount, 0),
  grantableRows: entries.filter(e => e.grantable).reduce((sum, e) => sum + e.rowCount, 0), entries,
})
const snapshot = (mode = "migration") => ({ mode,
  identity: { expectedIdentity: true, sessionIdentityUnchanged: true, systemIdentifier: "12345678901234567890", databaseOid: "12345", databaseName: "private-fixture-database", primary: true, readOnly: true, repeatableRead: true },
  roleProfile: mode === "runtime" ? runtimeProfile() : migrationProfile(), acl: data(mode === "runtime" ? [] : undefined),
})
const read = path => path.endsWith(".deploy-sha") ? sha : path.endsWith("migration.env") ? "MIGRATION_DATABASE_URL='" + migrationUrl + "'\nMIGRATION_EXPECTED_DB_ROLE=acl_migration\n" : "DATABASE_URL='" + appUrl + "'\n"
const query = (_connection, _sql, _runtimeRole, mode) => JSON.stringify(snapshot(mode))
const inspect = (overrides = {}) => inspectAclRemote(sql, bindings, sha, { uid: 0, read, query, ...overrides })
const assertPrivate = report => assert.doesNotMatch(JSON.stringify(report), /private-fixture|postgresql:\/\/|acl_runtime|acl_migration|databaseOid|systemIdentifier|databaseName|rawEnvironment|roleName/)

test("application env reads one literal canonical URL and never sources other declarations", () => {
  assert.equal(parseApplicationEnv("# synthetic\nexport DATABASE_URL='" + appUrl + "'\nUNRELATED=$(false)\n"), appUrl)
  assert.equal(parseApplicationEnv('DATABASE_URL="' + appUrl + '"'), appUrl)
  const encoded = appUrl.replace(marker, "%24%28false%29")
  assert.equal(parseApplicationEnv("DATABASE_URL='" + encoded + "'"), encoded)
  for (const text of ["", "DATABASE_URL='" + appUrl, "DATABASE_URL=" + appUrl + "\nDATABASE_URL=" + appUrl, "DATABASE_URL=" + appUrl + "\0", "#".repeat(65537), "DATABASE_URL=invalid-" + marker, "DATABASE_URL=" + appUrl + "?options=-c%20default_transaction_read_only=off", "DATABASE_URL=" + appUrl + "?host=other", "DATABASE_URL=" + appUrl + "?unknown_" + marker + "=secret"]) assert.throws(() => parseApplicationEnv(text), { message: "APP_ENV_INVALID" })
})

test("actual two-session proof exports finite evidence without granting ACL approval", () => {
  const calls = [], reads = []
  const report = inspect({ read: (path, limit, mode) => { reads.push({ path, limit, mode }); return read(path) }, query: (connection, statement, runtimeRole, mode) => { calls.push(mode); assert.equal(statement, sql); assert.equal(runtimeRole, "acl_runtime"); assert.equal(connection, mode === "runtime" ? appUrl : migrationUrl); return query(connection, statement, runtimeRole, mode) } })
  assert.deepEqual(calls, ["runtime", "migration"])
  assert.equal(report.status, "READ_COMPLETE")
  assert.equal(report.proof.acl.nonOwnerWriteRows, 3)
  assert.equal(report.proof.sameDeclaredEndpoint, true)
  assert.equal(report.proof.sameDatabaseCatalogIdentity, true)
  assert.equal(report.proof.businessRowsRead, false)
  assert.equal(report.proof.expectedRuntimeSession, true)
  assert.equal(report.proof.expectedMigrationSession, true)
  assert.equal(report.proof.samePhysicalDatabase, undefined)
  assert.deepEqual(reads.filter(item => item.path.endsWith(".env")), [
    { path: "/etc/leaddrive/migration.env", limit: 32768, mode: 0o600 }, { path: "/etc/leaddrive/app.env", limit: 65536, mode: 0o600 },
    { path: "/etc/leaddrive/migration.env", limit: 32768, mode: 0o600 }, { path: "/etc/leaddrive/app.env", limit: 65536, mode: 0o600 },
  ])
  assert.equal(validateAclReport(report, sha), report)
  assertPrivate(report)
  assert.ok(ACL_LIMITS.some(text => text.includes("not ACL approval")))
  assert.ok(ACL_LIMITS.some(text => text.includes("promoted physical clone")))
})

test("root, artifact, env and exact endpoint failures occur before SQL", () => {
  const cases = [
    [{ uid: 1 }, "INPUT_INVALID"],
    [{ read: () => "b".repeat(40) }, "ARTIFACT_MISMATCH"],
    [{ read: path => path.endsWith("app.env") ? "DATABASE_URL='" + migrationUrl + "'" : read(path) }, "IDENTITY_UNPROVED"],
    [{ read: path => path.endsWith("app.env") ? "" : read(path) }, "APP_ENV_INVALID"],
    [{ read: path => path.endsWith("migration.env") ? "" : read(path) }, "MIGRATION_ENV_INVALID"],
    [{ read: path => { if (path.endsWith("app.env")) throw new Error("FILES_UNSAFE"); return read(path) } }, "FILES_UNSAFE"],
    [{ read: path => { if (path.endsWith("app.env")) throw new Error("SOURCE_CHANGED"); return read(path) } }, "SOURCE_CHANGED"],
  ]
  for (const [key, value] of [["hostname", "other.example.invalid"], ["port", "5433"], ["pathname", "/other-fixture"]]) {
    const url = new URL(appUrl); url[key] = value
    cases.push([{ read: path => path.endsWith("app.env") ? "DATABASE_URL='" + url.href + "'" : read(path) }, "IDENTITY_UNPROVED"])
  }
  for (const [overrides, code] of cases) {
    const report = inspect({ ...overrides, query: () => assert.fail("rejected configuration must not query SQL") })
    assert.equal(report.status, "ERROR"); assert.equal(report.code, code)
    assert.equal(report.proof, null); assert.equal(report.productionArtifactSha, null)
    assert.equal(validateAclReport(report, sha), report); assertPrivate(report)
  }
})

test("session, primary, read-only, catalog identity and protected role profiles fail closed", () => {
  const cases = []
  for (const mode of ["runtime", "migration"]) for (const field of ["expectedIdentity", "sessionIdentityUnchanged", "primary", "readOnly", "repeatableRead"]) cases.push([mode, s => { s.identity[field] = false }, "IDENTITY_UNPROVED"])
  for (const field of ["systemIdentifier", "databaseOid", "databaseName"]) cases.push(["migration", s => { s.identity[field] = field === "databaseName" ? "other-private-database" : "98765" }, "IDENTITY_UNPROVED"])
  for (const mode of ["runtime", "migration"]) for (const field of ["present", "noSuperuser", "canLogin"]) cases.push([mode, s => { s.roleProfile[field] = false }, "PROFILE_UNPROVED"])
  cases.push(["runtime", s => { s.roleProfile.noBypassRls = false }, "PROFILE_UNPROVED"], ["runtime", s => { s.roleProfile.setPrivilegedCount = 1 }, "PROFILE_UNPROVED"], ["migration", s => { s.roleProfile.noBypassRls = true }, "PROFILE_UNPROVED"])
  for (const [target, mutate, code] of cases) {
    const report = inspect({ query: (_url, _statement, _role, mode) => { const s = snapshot(mode); if (mode === target) mutate(s); return JSON.stringify(s) } })
    assert.equal(report.status, "ERROR"); assert.equal(report.code, code); assertPrivate(report)
  }
})

test("artifact or either private env changing during observation discards all evidence", () => {
  for (const target of [".deploy-sha", "migration.env", "app.env"]) {
    let count = 0
    const report = inspect({ read: path => path.endsWith(target) && ++count > 1 ? target === ".deploy-sha" ? "b".repeat(40) : read(path) + "# changed\n" : read(path) })
    assert.equal(report.status, "ERROR")
    assert.equal(report.code, target === ".deploy-sha" ? "ARTIFACT_MISMATCH" : "SOURCE_CHANGED")
    assert.equal(report.proof, null); assertPrivate(report)
  }
})

test("unsafe and unknown ACL entries remain visible evidence rather than automatic rejection or approval", () => {
  const publicProfile = { present: false, noSuperuser: false, noBypassRls: false, canLogin: false, setPrivilegedCount: 0 }
  const unsafe = [entry("TRUNCATE", "OTHER", { ...runtimeProfile(), noBypassRls: false, setPrivilegedCount: 1 }), { ...entry("SELECT", "PUBLIC", publicProfile), scope: "GLOBAL" }, { ...entry("INSERT", "OTHER"), grantable: true }]
  const report = inspect({ query: (_url, _statement, _role, mode) => JSON.stringify({ ...snapshot(mode), acl: mode === "runtime" ? data([]) : data(unsafe) }) })
  assert.equal(report.status, "READ_COMPLETE")
  assert.equal(report.proof.acl.publicPrivilegeRows, 1)
  assert.equal(report.proof.acl.grantableRows, 1)
  assert.equal(report.proof.acl.nonOwnerWriteRows, 2)
  assert.equal(validateAclReport(report, sha), report)
  assertPrivate(report)
})

test("strict ACL projection rejects raw identities, malformed totals, unknown enums and duplicate groups", () => {
  for (const mutate of [d => { d.roleName = marker }, d => { d.entries[0].roleName = marker }, d => { d.entries[0].recipientProfile.roleName = marker }, d => { d.entries[0].recipient = marker }, d => { d.entries[0].scope = "private" }, d => { d.entries[0].privilege = "ALL" }, d => { d.entries[0].rowCount = 0 }, d => { d.entries[0].rowCount = "1" }, d => { d.entries[0].recipientProfile.present = "true" }, d => { d.entries[0].recipientProfile.setPrivilegedCount = -1 }, d => { d.explicitPrivilegeRows += 1 }, d => { d.publicPrivilegeRows = 1 }, d => { d.nonOwnerWriteRows = 0 }, d => { d.grantableRows = 1 }, d => { d.explicitPrivilegeRows = 101 }, d => { d.entries = {} }]) {
    const d = data(); mutate(d); assert.throws(() => validateAclData(d), { message: "OUTPUT_INVALID" })
  }
  const duplicate = entry()
  const reordered = { ...duplicate, recipientProfile: Object.fromEntries(Object.entries(duplicate.recipientProfile).reverse()) }
  assert.throws(() => validateAclData(data([duplicate, reordered])), { message: "OUTPUT_INVALID" })
  const wrongPublic = entry("SELECT", "PUBLIC")
  assert.throws(() => validateAclData(data([wrongPublic])), { message: "OUTPUT_INVALID" })
  assert.equal(validateAclData(data()).explicitPrivilegeRows, 5)
})

test("internal snapshots reject unknown fields and runtime ACL output; private identifiers never enter report", () => {
  for (const mutate of [s => { s.rawEnvironment = marker }, s => { s.identity.roleName = marker }, s => { s.roleProfile.roleName = marker }, s => { s.identity.systemIdentifier = marker }, s => { s.identity.databaseOid = marker }, s => { s.identity.databaseName = "x".repeat(64) }, s => { s.mode = "owner" }]) {
    const s = snapshot(); mutate(s); assert.throws(() => validateAclSnapshot(s, "migration"), { message: "OUTPUT_INVALID" })
  }
  const runtime = snapshot("runtime"); runtime.acl = data()
  assert.throws(() => validateAclSnapshot(runtime, "runtime"), { message: "OUTPUT_INVALID" })
  for (const raw of ["not-json-" + marker, JSON.stringify(snapshot()) + "\n" + marker, "x".repeat(65537)]) {
    const report = inspect({ query: () => raw }); assert.equal(report.status, "ERROR"); assertPrivate(report)
  }
  const report = inspect({ query: () => { throw new Error("secret-" + marker) } })
  assert.equal(report.code, "INSPECTION_FAILED"); assertPrivate(report)
})

test("report refuses readiness claims, missing proofs, protected profile contradictions and private additions", () => {
  const initial = inspect()
  for (const mutate of [r => { r.status = "READY" }, r => { r.status = "READY_FOR_REVIEW" }, r => { r.version = 2 }, r => { r.rawEnvironment = marker }, r => { r.bindings.roleName = marker }, r => { r.proof.roleName = marker }, r => { r.proof.sameDeclaredEndpoint = false }, r => { r.proof.sameDatabaseCatalogIdentity = false }, r => { r.proof.businessRowsRead = true }, r => { r.proof.runtimeProfile.setPrivilegedCount = 1 }, r => { r.proof.acl.entries[0].recipientProfile.noSuperuser = false }, r => { r.limits = [] }, r => { r.productionArtifactSha = "b".repeat(40) }]) {
    const changed = structuredClone(initial); mutate(changed); assert.throws(() => validateAclReport(changed, sha), { message: "OUTPUT_INVALID" })
  }
  const reordered = structuredClone(initial)
  reordered.proof.acl.entries[0].recipientProfile = Object.fromEntries(Object.entries(reordered.proof.runtimeProfile).reverse())
  assert.equal(validateAclReport(reordered, sha), reordered)
  const failed = inspect({ uid: 1 })
  for (const code of ACL_CODES) assert.equal(validateAclReport({ ...failed, code }, sha).code, code)
  assert.throws(() => validateAclReport({ ...failed, code: marker }, sha), { message: "OUTPUT_INVALID" })
  assert.throws(() => validateAclReport({ ...failed, proof: initial.proof }, sha), { message: "OUTPUT_INVALID" })
})

test("both query modes retain fixed clean libpq startup and bounds without credentials in argv", () => {
  for (const [connection, mode, expectedUser] of [[appUrl + "?connect_timeout=0", "runtime", "acl_runtime"], [migrationUrl + "?connect_timeout=-10", "migration", "acl_migration"]]) {
    let call
    assert.equal(queryAclMetadata(connection, sql, "acl_runtime", mode, (binary, args, options) => { call = { binary, args, options }; return "bounded" }), "bounded")
    assert.equal(call.binary, "psql")
    assert.doesNotMatch(call.args.join(" "), /postgresql:\/\/|private-fixture|acl_runtime|acl_migration/)
    assert.equal(call.options.input, sql)
    assert.equal(call.options.env.PGUSER, expectedUser)
    assert.equal(call.options.env.PGHOST, "127.0.0.1")
    assert.equal(call.options.env.PGCONNECT_TIMEOUT, "10")
    assert.equal(call.options.env.PGPASSFILE, "/dev/null")
    assert.equal(call.options.env.PGOPTIONS, "-c default_transaction_read_only=on -c application_name=hrm_default_acl_inspection -c hrm.acl_expected_role=" + expectedUser + " -c hrm.acl_runtime_role=acl_runtime -c hrm.acl_mode=" + mode)
    assert.equal(call.options.env.HOME, undefined); assert.equal(call.options.env.PGSERVICE, undefined)
    assert.equal(call.options.timeout, 30000); assert.equal(call.options.maxBuffer, 65536)
    assert.ok(call.args.includes("VERBOSITY=sqlstate"))
  }
  assert.throws(() => queryAclMetadata(appUrl, sql, "acl_runtime", "runtime", () => { throw new Error(appUrl) }), { message: "QUERY_FAILED" })
  assert.throws(() => queryAclMetadata(appUrl, sql, "injected -c option", "runtime", () => assert.fail("invalid role must not invoke psql")), { message: "QUERY_FAILED" })
})

test("fixed SQL is bounded catalog-only read evidence and original strict metadata source remains exact", () => {
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
  assert.match(sql, /SET LOCAL lock_timeout = '2s';/)
  assert.match(sql, /SET LOCAL statement_timeout = '10s';/)
  assert.match(sql, /ROLLBACK;/)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY)\s+(?:INTO|FROM|TABLE|INDEX|ROLE|USER|FUNCTION|POLICY)\b/i)
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+public\./i)
  assert.match(sql, /scope COLLATE "C",recipient COLLATE "C",privilege_type COLLATE "C"/)
  assert.equal(digest(source("./hrm-migration-metadata-preflight.mjs")), "46b417da7bbe763960b8ede8fa0e9dbd98543d090d54f73979289504bfe35771")
  assert.equal(digest(source("./hrm-migration-metadata-preflight.sql")), "b174e32eb68a0dbcca98e8557fe8c716ed8277111e79ba822bce43f4e7023b6a")
  assert.equal(digest(source("./hrm-migration-metadata-preflight.test.mjs")), "39c947982f5e7dc2ca1e96307ac5314518bfe748ec58a3cf217f8f09194c0eef")
  assert.equal(digest(source("../.github/workflows/hrm-migration-metadata-preflight.yml")), "f90937ecda3b81e7dd017819cfaec1afdefc5fee58167fdfc2289ce012a1dcf1")
})

test("stdin bundle binds unchanged base and supplemental bytes, while non-root emits only a safe error", () => {
  const bundle = execFileSync(process.execPath, ["scripts/hrm-default-acl-inspection.mjs", "--emit-remote"], { encoding: "utf8", maxBuffer: 200000 })
  const safe = bundle.replace(",process.env.EXPECTED_MAIN_SHA);", ",process.env.EXPECTED_MAIN_SHA,{uid:1});")
  assert.notEqual(safe, bundle)
  try { execFileSync(process.execPath, ["--input-type=module", "-"], { input: safe, encoding: "utf8", env: { EXPECTED_MAIN_SHA: sha }, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }); assert.fail("non-root must fail") }
  catch (error) { assert.equal(error.status, 1); assert.equal(error.stderr, ""); const report = JSON.parse(error.stdout); assert.equal(validateAclReport(report, sha).code, "INPUT_INVALID"); assert.deepEqual(report.bindings, bindings); assertPrivate(report) }
})

test("runner validation preserves original safe errors and withholds forged private receipts", () => {
  const run = report => execFileSync(process.execPath, ["scripts/hrm-default-acl-inspection.mjs", "--validate-output", sha], { input: JSON.stringify(report), encoding: "utf8", maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] })
  const failed = inspect({ uid: 1 })
  assert.deepEqual(JSON.parse(run(failed)), failed)
  const complete = inspect(); assert.deepEqual(JSON.parse(run(complete)), complete)
  for (const changed of [{ ...failed, roleName: marker }, { ...failed, bindings: { ...bindings, baseHelperSha256: "b".repeat(64) } }, { ...complete, status: "READY" }]) {
    try { run(changed); assert.fail("invalid private/source receipt must fail") }
    catch (error) { assert.equal(error.status, 1); assert.equal(error.stdout, ""); assert.equal(error.stderr, "HRM supplemental ACL output invalid; raw data withheld\n") }
  }
})

// Only GitHub-hosted disposable PostgreSQL can create these synthetic roles and
// ACLs. The production helper has no fixture mode or security exception.
test("hosted PostgreSQL proves real runtime/default-ACL catalog projection and read-only enforcement", { skip: !process.env.HRM_DEFAULT_ACL_TEST_DATABASE_URL }, context => {
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true")
  const url = new URL(process.env.HRM_DEFAULT_ACL_TEST_DATABASE_URL)
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/hrm_preflight_test"); assert.equal(url.username, "postgres")
  const adminEnv = databaseConnectionEnvironment(url.href)
  const sqlStates = new Set(["08001", "08006", "25006", "28000", "28P01", "42501", "42601", "42704", "42P01", "2BP01", "55P03", "57014", "XX000"])
  const execute = statement => {
    try { return execFileSync("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], { input: statement, encoding: "utf8", env: adminEnv, timeout: 20000, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }) }
    catch (error) {
      const state = String(error?.stderr ?? "").match(/ERROR:\s+([0-9A-Z]{5})(?:\s|$)/)?.[1]
      const failure = new Error("HOSTED_ACL_PSQL_FAILED sqlState=" + (sqlStates.has(state) ? state : "UNAVAILABLE"))
      failure.fixtureSqlState = sqlStates.has(state) ? state : "UNAVAILABLE"
      throw failure
    }
  }
  const failureDetail = error => "kind=" + (error?.fixtureSqlState ? "PSQL" : error?.code === "ERR_ASSERTION" ? "ASSERTION" : "OTHER") + " sqlState=" + (sqlStates.has(error?.fixtureSqlState) ? error.fixtureSqlState : "UNAVAILABLE")
  assert.equal(execute("SELECT current_database()='hrm_preflight_test' AND (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user);").trim(), "t")
  assert.equal(execute("SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';").trim(), "0")
  const runtime = new URL(url.href); runtime.username = "hrm_acl_runtime"; runtime.password = "isolated-acl-runtime"
  const migration = new URL(url.href); migration.username = "hrm_acl_migration"; migration.password = "isolated-acl-migration"
  const privateRead = path => path.endsWith(".deploy-sha") ? sha : path.endsWith("migration.env") ? "MIGRATION_DATABASE_URL='" + migration.href + "'\nMIGRATION_EXPECTED_DB_ROLE=hrm_acl_migration\n" : "DATABASE_URL='" + runtime.href + "'\n"
  const observe = () => {
    const report = inspectAclRemote(sql, bindings, sha, { uid: 0, read: privateRead })
    assert.equal(report.status, "READ_COMPLETE", "HOSTED_ACL_INSPECTION status=" + report.status + " code=" + report.code)
    assert.equal(report.proof.expectedRuntimeSession, true); assert.equal(report.proof.sameDeclaredEndpoint, true); assert.equal(report.proof.sameDatabaseCatalogIdentity, true)
    assert.equal(validateAclReport(report, sha), report)
    assert.doesNotMatch(JSON.stringify(report), /hrm_acl_|isolated-acl|postgresql:\/\/|systemIdentifier|databaseOid|databaseName/)
    return report
  }
  execute("BEGIN; CREATE ROLE hrm_acl_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'isolated-acl-runtime'; CREATE ROLE hrm_acl_migration LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'isolated-acl-migration'; CREATE ROLE hrm_acl_other NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE hrm_acl_privileged NOLOGIN NOSUPERUSER BYPASSRLS; GRANT USAGE,CREATE ON SCHEMA public TO hrm_acl_migration; GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO hrm_acl_runtime,hrm_acl_migration; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_acl_migration IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO hrm_acl_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_acl_migration IN SCHEMA public GRANT SELECT ON TABLES TO hrm_acl_other; COMMIT;")
  let stage = "FIXTURE_IDENTITY", bodyError = null, cleanupError = null, migrationFixtureOid
  try {
    migrationFixtureOid = execute("SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname='hrm_acl_migration';").trim()
    assert.ok(/^[1-9][0-9]{0,9}$/.test(migrationFixtureOid), "HOSTED_ACL_FIXTURE_IDENTITY_UNPROVED")
    stage = "INITIAL_CATALOG"
    let report = observe()
    assert.equal(report.proof.acl.explicitPrivilegeRows, 5); assert.equal(report.proof.acl.nonOwnerWriteRows, 3); assert.equal(report.proof.acl.publicPrivilegeRows, 0)
    assert.deepEqual(report.proof.acl.entries.filter(e => e.recipient === "EXPECTED_RUNTIME").map(e => e.privilege).sort(), ["DELETE", "INSERT", "SELECT", "UPDATE"])
    assert.equal(report.proof.acl.entries.find(e => e.recipient === "OTHER").privilege, "SELECT")
    assert.equal(report.proof.acl.entries.find(e => e.recipient === "OTHER").recipientProfile.canLogin, false)
    context.diagnostic("HOSTED_ACL_MILESTONE initialCatalog=PASS")
    stage = "UNSAFE_CATALOG"
    execute("ALTER DEFAULT PRIVILEGES FOR ROLE hrm_acl_migration GRANT SELECT ON TABLES TO PUBLIC; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_acl_migration IN SCHEMA public GRANT TRUNCATE,TRIGGER,REFERENCES ON TABLES TO hrm_acl_other; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_acl_migration IN SCHEMA public GRANT INSERT ON TABLES TO hrm_acl_other WITH GRANT OPTION;")
    report = observe()
    assert.equal(report.proof.acl.publicPrivilegeRows, 1); assert.equal(report.proof.acl.nonOwnerWriteRows, 7); assert.equal(report.proof.acl.grantableRows, 1)
    assert.ok(report.proof.acl.entries.some(e => e.scope === "GLOBAL" && e.recipient === "OWNER"))
    assert.ok(report.proof.acl.entries.some(e => e.recipient === "PUBLIC" && e.recipientProfile.present === false))
    assert.deepEqual(report.proof.acl.entries.filter(e => e.recipient === "OTHER" && ["TRUNCATE", "TRIGGER", "REFERENCES"].includes(e.privilege)).map(e => e.privilege).sort(), ["REFERENCES", "TRIGGER", "TRUNCATE"])
    context.diagnostic("HOSTED_ACL_MILESTONE unsafeCatalog=PASS")
    stage = "RUNTIME_SET_GUARD"
    execute("GRANT hrm_acl_privileged TO hrm_acl_runtime;")
    const denied = inspectAclRemote(sql, bindings, sha, { uid: 0, read: privateRead })
    assert.equal(denied.status, "ERROR"); assert.equal(denied.code, "PROFILE_UNPROVED"); assert.equal(denied.proof, null)
    execute("REVOKE hrm_acl_privileged FROM hrm_acl_runtime;")
    context.diagnostic("HOSTED_ACL_MILESTONE runtimeSetGuard=PASS")
    stage = "READ_ONLY_GUARD"
    assert.equal(queryAclMetadata(migration.href, "SELECT current_setting('transaction_read_only');", "hrm_acl_runtime", "migration").trim(), "on")
    assert.throws(() => queryAclMetadata(migration.href, "CREATE TABLE hrm_acl_forbidden(id integer);", "hrm_acl_runtime", "migration"), { message: "QUERY_FAILED" })
    assert.equal(execute("SELECT to_regclass('public.hrm_acl_forbidden') IS NULL;").trim(), "t")
    context.diagnostic("HOSTED_ACL_BODY=PASS")
  } catch (error) {
    bodyError = error
    context.diagnostic("HOSTED_ACL_BODY=FAIL stage=" + stage + " " + failureDetail(error))
  } finally {
    // Each command uses a new psql session/catalog snapshot. A multirole DROP
    // OWNED can revisit a default ACL tuple removed by a previous role's pass.
    const roles = [["RUNTIME", "hrm_acl_runtime"], ["MIGRATION", "hrm_acl_migration"], ["OTHER", "hrm_acl_other"], ["PRIVILEGED", "hrm_acl_privileged"]]
    for (const command of ["DROP OWNED BY", "DROP ROLE"]) for (const [slot, role] of roles) {
      const action = command === "DROP OWNED BY" ? "DROP_OWNED" : "DROP_ROLE"
      try {
        execute(command + " " + role + ";")
        context.diagnostic("HOSTED_ACL_CLEANUP action=" + action + " slot=" + slot + " status=PASS")
      } catch (error) {
        cleanupError ??= error
        context.diagnostic("HOSTED_ACL_CLEANUP action=" + action + " slot=" + slot + " status=FAIL " + failureDetail(error))
      }
    }
    try {
      assert.ok(/^[1-9][0-9]{0,9}$/.test(migrationFixtureOid), "HOSTED_ACL_CLEANUP_IDENTITY_UNPROVED")
      assert.equal(execute("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('hrm_acl_runtime','hrm_acl_migration','hrm_acl_other','hrm_acl_privileged')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole=" + migrationFixtureOid + ");").trim(), "t")
      context.diagnostic("HOSTED_ACL_CLEANUP residue=PASS")
    } catch (error) {
      cleanupError ??= error
      context.diagnostic("HOSTED_ACL_CLEANUP residue=FAIL " + failureDetail(error))
    }
    if (!cleanupError) context.diagnostic("HOSTED_ACL_CLEANUP=PASS")
  }
  // Preserve the primary body failure even if cleanup also failed. A cleanup
  // failure still fails the test when all unchanged body assertions succeeded.
  if (bodyError) throw bodyError
  if (cleanupError) throw cleanupError
})
