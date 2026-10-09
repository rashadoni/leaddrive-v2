import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { TARGET_SOURCE_SHA, MIGRATIONS, RELATIONS, INDEXES, GUARD_MD5, LEDGER_GUARD_MD5, ENV_DETAILS, databaseConnectionEnvironment, parseMigrationEnv, readRootFile, validateSnapshot, assessMetadata, validateReport, inspectRemote, queryMetadata } from "./hrm-migration-metadata-preflight.mjs"

const sql = fs.readFileSync(new URL("./hrm-migration-metadata-preflight.sql", import.meta.url), "utf8")
const historicalSql = fs.readFileSync(new URL("./ci/fixtures/hrm-metadata-preflight/assignment-trigger-before.sql", import.meta.url), "utf8")
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

test("libpq receives explicit host/port/decoded identity and documented TLS fields without URI fallback", () => {
  const env = databaseConnectionEnvironment("postgresql://synthetic:p%40ss%20word@db.example.invalid:6432/fixture%2Ddb?schema=public&connection_limit=1&sslmode=verify-full&sslrootcert=%2Fetc%2Ftrusted-ca.crt&sslcert=%2Fetc%2Fclient.crt&sslkey=%2Fetc%2Fclient.key")
  assert.deepEqual(env, { PATH: "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C", PGHOST: "db.example.invalid", PGPORT: "6432", PGDATABASE: "fixture-db", PGUSER: "synthetic", PGPASSWORD: "p@ss word", PGPASSFILE: "/dev/null", PGCONNECT_TIMEOUT: "10", PGSSLMODE: "verify-full", PGSSLROOTCERT: "/etc/trusted-ca.crt", PGSSLCERT: "/etc/client.crt", PGSSLKEY: "/etc/client.key" })
  assert.equal(Object.values(env).some(value => value.includes("postgresql://")), false)
  assert.equal(env.PGSERVICE, undefined)
  assert.equal(env.HOME, undefined)
  assert.equal(databaseConnectionEnvironment("postgresql://synthetic:protected@[::1]/fixture").PGHOST, "::1")
  assert.equal(databaseConnectionEnvironment("postgresql://synthetic:protected@127.0.0.1/fixture").PGPORT, "5432")
  for (const suffix of ["?sslpassword=secret", "?sslmode=invalid", "?sslkey=engine:unsafe", "?sslrootcert=relative.crt", "?sslmode=require&sslmode=disable", "?options=-c%20default_transaction_read_only=off", "?host=other", "?sslcert=%00"]) assert.throws(() => databaseConnectionEnvironment("postgresql://synthetic:protected@host/fixture" + suffix), { message: "ENV_INVALID" })
})

test("env rejection details stop before SQL and never reflect connection values or unknown parameter names", () => {
  const privateMarker = "private-fixture-marker-31f1"
  const base = "postgresql://synthetic:" + privateMarker + "@host/fixture"
  const env = (connection = base, role = "synthetic") => "MIGRATION_DATABASE_URL='" + connection + "'\nMIGRATION_EXPECTED_DB_ROLE='" + role + "'\n"
  const cases = [
    ["CONTENT_INVALID", env() + "\0"],
    ["CONTENT_INVALID", "#".repeat(32769)],
    ["URL_DECLARATION_MISSING", "MIGRATION_EXPECTED_DB_ROLE=synthetic\n"],
    ["URL_DECLARATION_DUPLICATED", env() + "MIGRATION_DATABASE_URL=" + base + "\n"],
    ["ROLE_DECLARATION_MISSING", "MIGRATION_DATABASE_URL=" + base + "\n"],
    ["ROLE_DECLARATION_DUPLICATED", env() + "MIGRATION_EXPECTED_DB_ROLE=synthetic\n"],
    ["URL_QUOTES_INVALID", "MIGRATION_DATABASE_URL='" + base + "\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"],
    ["ROLE_QUOTES_INVALID", "MIGRATION_DATABASE_URL=" + base + "\nMIGRATION_EXPECTED_DB_ROLE='synthetic\n"],
    ["ROLE_PROFILE_INVALID", env(base, "invalid role " + privateMarker)],
    ["URL_SYNTAX_INVALID", env("invalid-connection-" + privateMarker)],
    ["URL_SCHEME_UNSUPPORTED", env(base.replace("postgresql:", "https:"))],
    ["URL_HOST_REQUIRED", env("postgresql:///fixture")],
    ["URL_DATABASE_REQUIRED", env(base.replace("/fixture", ""))],
    ["URL_FRAGMENT_UNSUPPORTED", env(base + "#" + privateMarker)],
    ["URL_CONTROL_INVALID", env(base.replace(privateMarker, "raw space"))],
    ["USERNAME_ENCODING_INVALID", env(base.replace("synthetic:", "%:"))],
    ["DATABASE_ENCODING_INVALID", env(base.replace("/fixture", "/%"))],
    ["PASSWORD_ENCODING_INVALID", env(base.replace(privateMarker, "%"))],
    ["TCP_HOST_INVALID", env(base.replace("@host/", "@host_name/"))],
    ["TCP_PORT_INVALID", env(base.replace("@host/", "@host:0/"))],
    ["ROLE_IDENTITY_MISMATCH", env(base, "another_fixture_role")],
    ["SCHEMA_UNSUPPORTED", env(base + "?schema=" + privateMarker)],
    ["POOL_HINT_INVALID", env(base + "?connection_limit=" + privateMarker)],
    ["SSL_VALUE_INVALID", env(base + "?sslcert=%00")],
    ["SSL_MODE_INVALID", env(base + "?sslmode=" + privateMarker)],
    ["SSL_PATH_UNSUPPORTED", env(base + "?sslrootcert=" + privateMarker)],
    ["CONNECT_TIMEOUT_HINT_INVALID", env(base + "?connect_timeout=" + privateMarker)],
    ["PARAM_UNSUPPORTED_APPLICATION_NAME", env(base + "?application_name=" + privateMarker)],
    ["PARAM_UNSUPPORTED_SESSION_OPTIONS", env(base + "?options=-c%20default_transaction_read_only=off")],
    ["PARAM_UNSUPPORTED_HOST_OR_SOCKET", env(base + "?host=%2Fprivate-fixture-socket")],
    ["PARAM_UNSUPPORTED_IDENTITY_OVERRIDE", env(base + "?user=" + privateMarker)],
    ["PARAM_UNSUPPORTED_SSL", env(base + "?sslpassword=" + privateMarker)],
    ["PARAM_UNSUPPORTED_PRISMA", env(base + "?pgbouncer=true")],
    ["PARAM_UNSUPPORTED_OTHER", env(base + "?unknown_" + privateMarker + "=" + privateMarker)],
    ["PARAM_DUPLICATED_SSL", env(base + "?sslmode=require&sslmode=disable")],
    ["PARAM_DUPLICATED_PRISMA", env(base + "?schema=public&schema=public")],
  ]
  for (const [detail, text] of cases) {
    const report = inspectRemote(sql, bindings, sha, { uid: 0, read: path => path.endsWith(".deploy-sha") ? sha : text, query: () => assert.fail("env rejection must never query SQL") })
    assert.equal(report.version, 2)
    assert.equal(report.status, "ERROR")
    assert.equal(report.code, "ENV_INVALID")
    assert.equal(report.envDetail, detail)
    assert.equal(report.sqlState, null)
    assert.equal(report.productionArtifactSha, null)
    assert.equal(report.defaults, null)
    assert.equal(report.snapshot, null)
    assert.equal(validateReport(report, sha), report)
    assert.doesNotMatch(JSON.stringify(report), /private-fixture-marker-31f1|unknown_|postgresql:\/\/|another_fixture_role|host_name|raw space/)
  }
  // This lower-level predicate is masked by the prior mandatory role check in
  // parseMigrationEnv; it still retains the same connection rejection.
  assert.throws(() => databaseConnectionEnvironment(base.replace("synthetic:", "invalid%20user:")), error => error.message === "ENV_INVALID" && error.envDetail === "USERNAME_PROFILE_INVALID")
})

test("v2 error report accepts only finite env details and forbids them outside ENV_INVALID", () => {
  assert.equal(new Set(ENV_DETAILS).size, ENV_DETAILS.length)
  assert.ok(Object.isFrozen(ENV_DETAILS))
  assert.ok(ENV_DETAILS.every(detail => /^[A-Z_]+$/.test(detail)))
  const failure = inspectRemote(sql, bindings, sha, { uid: 0, read: path => path.endsWith(".deploy-sha") ? sha : "", query: () => assert.fail("missing env must never query SQL") })
  for (const envDetail of ENV_DETAILS) assert.equal(validateReport({ ...failure, envDetail }, sha).envDetail, envDetail)
  for (const invalid of [
    { ...failure, envDetail: "private-forged-detail" },
    { ...failure, envDetail: null },
    { ...failure, envDetail: { value: "private-forged-detail" } },
    { ...failure, envDetail: 1 },
    { ...failure, sqlState: "42501" },
    { ...failure, version: 1 },
    { ...failure, roleName: "private-forged-role" },
    { ...failure, connectionParameter: "private-forged-name" },
    { ...failure, bindings: { ...bindings, rawEnvironment: "private-forged-env" } },
  ]) assert.throws(() => validateReport(invalid, sha), { message: "OUTPUT_INVALID" })
  const missing = { ...failure }; delete missing.envDetail
  assert.throws(() => validateReport(missing, sha), { message: "OUTPUT_INVALID" })
  const nonEnvFailure = inspectRemote(sql, bindings, sha, { uid: 1 })
  assert.equal(nonEnvFailure.envDetail, null)
  assert.throws(() => validateReport({ ...nonEnvFailure, envDetail: "CONTENT_INVALID" }, sha), { message: "OUTPUT_INVALID" })
  const ready = inspectRemote(sql, bindings, sha, { uid: 0, read: fakeRead, query: encoded })
  assert.equal(ready.envDetail, null)
  assert.throws(() => validateReport({ ...ready, envDetail: "CONTENT_INVALID" }, sha), { message: "OUTPUT_INVALID" })
  const changed = snapshot(); changed.activity.visibilityComplete = false
  const incomplete = inspectRemote(sql, bindings, sha, { uid: 0, read: fakeRead, query: () => JSON.stringify(defaults()) + "\n" + JSON.stringify(changed) + "\n" })
  assert.equal(incomplete.status, "INCOMPLETE")
  assert.equal(incomplete.envDetail, null)
  assert.throws(() => validateReport({ ...incomplete, envDetail: "CONTENT_INVALID" }, sha), { message: "OUTPUT_INVALID" })
})

test("env error sanitization preserves only finite nested detail and never unknown error metadata", () => {
  for (const [code, innerDetail, expectedDetail] of [
    ["ENV_INVALID", "PARAM_UNSUPPORTED_OTHER", "PARAM_UNSUPPORTED_OTHER"],
    ["ENV_INVALID", "private-unknown-env-key", "UNCLASSIFIED_ENV_REJECTION"],
    ["ENV_INVALID", undefined, "UNCLASSIFIED_ENV_REJECTION"],
    ["FILES_UNSAFE", "CONTENT_INVALID", null],
    ["private-error-message", "CONTENT_INVALID", null],
  ]) {
    const report = inspectRemote(sql, bindings, sha, { uid: 0, read: path => {
      if (path.endsWith(".deploy-sha")) return sha
      const error = new Error(code)
      error.envDetail = innerDetail
      error.connection = "postgresql://private-secret@private-host/private-db"
      error.stderr = "private-raw-env"
      throw error
    }, query: () => assert.fail("failed env read must never query SQL") })
    assert.equal(report.envDetail, expectedDetail)
    assert.equal(report.code, code === "private-error-message" ? "INSPECTION_FAILED" : code)
    assert.doesNotMatch(JSON.stringify(report), /private-/)
  }
})

test("connect_timeout hints normalize away while every explicit psql budget and startup guard remains fixed", () => {
  const base = "postgresql://synthetic:private-timeout-fixture@host/fixture?schema=public&sslmode=verify-full"
  const normalized = "postgresql://synthetic:private-timeout-fixture@host/fixture?sslmode=verify-full"
  for (const value of ["10", "1", "0", "-0", "-1", "-2147483648", "2147483647", "+10", "0000000010"]) {
    const connection = base + "&connect_timeout=" + encodeURIComponent(value)
    const text = "MIGRATION_DATABASE_URL='" + connection + "'\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"
    assert.equal(parseMigrationEnv(text), normalized)
    assert.deepEqual(databaseConnectionEnvironment(connection), databaseConnectionEnvironment(normalized))
    let observed
    assert.equal(queryMetadata(connection, sql, (binary, args, options) => { observed = { binary, args, options }; return "bounded" }), "bounded")
    assert.equal(observed.options.env.PGCONNECT_TIMEOUT, "10")
    assert.equal(observed.options.timeout, 30000)
    assert.equal(observed.options.env.PGOPTIONS, "-c default_transaction_read_only=on -c application_name=hrm_migration_metadata_preflight -c hrm.preflight_expected_role=synthetic")
    assert.equal(observed.options.env.PGSSLMODE, "verify-full")
    assert.equal(observed.options.input, sql)
    assert.deepEqual(observed.args, ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"])
    assert.equal(Object.values(observed.options.env).some(field => field.includes("connect_timeout") || field.includes("postgresql://")), false)
    const report = inspectRemote(sql, bindings, sha, { uid: 0, read: path => path.endsWith(".deploy-sha") ? sha : text, query: url => { assert.equal(url, normalized); return encoded() } })
    assert.equal(report.status, "READY_FOR_REVIEW")
    assert.equal(report.envDetail, null)
    assert.doesNotMatch(JSON.stringify(report), /private-timeout-fixture|connect_timeout|postgresql:\/\//)
  }
})

test("connect_timeout raw plus and percent-encoded plus retain the same libpq URI meaning", () => {
  const base = "postgresql://synthetic:private-plus-fixture@host/fixture"
  for (const suffix of ["?connect_timeout=+10", "?connect_timeout=%2B10"]) {
    assert.equal(parseMigrationEnv("MIGRATION_DATABASE_URL='" + base + suffix + "'\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"), base)
    assert.deepEqual(databaseConnectionEnvironment(base + suffix), databaseConnectionEnvironment(base))
    queryMetadata(base + suffix, sql, (binary, args, options) => {
      assert.equal(options.env.PGCONNECT_TIMEOUT, "10")
      assert.equal(options.timeout, 30000)
      assert.equal(options.env.PGOPTIONS, "-c default_transaction_read_only=on -c application_name=hrm_migration_metadata_preflight -c hrm.preflight_expected_role=synthetic")
      return "bounded"
    })
  }
})

test("malformed or repeated connect_timeout fails privately before SQL and never enables other URL overrides", () => {
  const base = "postgresql://synthetic:private-timeout-fixture@host/fixture"
  const rejected = [
    ...["", "2147483648", "-2147483649", "999999999999999999", "1.5", "1e2", "0x10", "10s", " 10", "10 ", "\n10", "+", "--1", "private-timeout-value"].map(value => ["CONNECT_TIMEOUT_HINT_INVALID", "?connect_timeout=" + encodeURIComponent(value)]),
    ["CONNECT_TIMEOUT_HINT_INVALID", "?connect_timeout=%2B%2010"],
    ["PARAM_DUPLICATED_CONNECT_TIMEOUT", "?connect_timeout=10&connect_timeout=10"],
    ["PARAM_DUPLICATED_CONNECT_TIMEOUT", "?connect_timeout=0&%63onnect_timeout=-1"],
    ["PARAM_UNSUPPORTED_SESSION_OPTIONS", "?connect_timeout=10&options=-c%20default_transaction_read_only=off"],
    ["PARAM_UNSUPPORTED_APPLICATION_NAME", "?connect_timeout=10&application_name=private-app-name"],
    ["PARAM_UNSUPPORTED_HOST_OR_SOCKET", "?connect_timeout=10&host=%2Fprivate-socket"],
    ["PARAM_UNSUPPORTED_IDENTITY_OVERRIDE", "?connect_timeout=10&user=private-override"],
    ["PARAM_UNSUPPORTED_SSL", "?connect_timeout=10&sslpassword=private-override"],
    ["PARAM_UNSUPPORTED_PRISMA", "?connect_timeout=10&pgbouncer=true"],
    ["PARAM_UNSUPPORTED_OTHER", "?connect_timeout=10&private-unknown-name=private-value"],
  ]
  for (const [detail, suffix] of rejected) {
    const text = "MIGRATION_DATABASE_URL='" + base + suffix + "'\nMIGRATION_EXPECTED_DB_ROLE=synthetic\n"
    assert.throws(() => parseMigrationEnv(text), error => error.message === "ENV_INVALID" && error.envDetail === detail)
    const report = inspectRemote(sql, bindings, sha, { uid: 0, read: path => path.endsWith(".deploy-sha") ? sha : text, query: () => assert.fail("invalid hint or override must never query SQL") })
    assert.equal(report.code, "ENV_INVALID")
    assert.equal(report.envDetail, detail)
    assert.equal(report.sqlState, null)
    assert.equal(report.defaults, null)
    assert.equal(report.snapshot, null)
    assert.doesNotMatch(JSON.stringify(report), /private-|connect_timeout|postgresql:\/\//)
  }
  assert.ok(ENV_DETAILS.includes("PARAM_UNSUPPORTED_CONNECT_TIMEOUT"), "retain the original finite failure code for prior evidence")
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

test("finite catalog arrays must retain canonical order; the validator never repairs it", () => {
  for (const select of [s => s.ledger.known, s => s.relations, s => s.indexes]) {
    const s = snapshot()
    const entries = select(s)
    ;[entries[0], entries[1]] = [entries[1], entries[0]]
    assert.throws(() => validateSnapshot(defaults(), s), { message: "OUTPUT_INVALID" })
  }
  assert.equal((sql.match(/ORDER BY name COLLATE "C"/g) ?? []).length, 3)
  // Exact e87 source bytes, used only by the already-fenced hosted reproducer.
  assert.equal(digest(historicalSql.replaceAll(' ORDER BY name COLLATE "C")', ' ORDER BY name)')), "9fff72bc44e1e9d7fa5e552cdd56ab53d857b20dd1b8bdc1e1fcdb704bf74299")
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
  assert.equal(observed.options.env.PGHOST, "host")
  assert.equal(observed.options.env.PGPORT, "5432")
  assert.equal(observed.options.env.PGDATABASE, "fixture")
  assert.equal(observed.options.env.PGUSER, "synthetic")
  assert.equal(observed.options.env.PGPASSWORD, "protected")
  assert.equal(observed.options.env.PGPASSFILE, "/dev/null")
  assert.equal(observed.options.env.PGOPTIONS, "-c default_transaction_read_only=on -c application_name=hrm_migration_metadata_preflight -c hrm.preflight_expected_role=synthetic")
  assert.equal(observed.options.env.HOME, undefined)
  assert.equal(observed.options.timeout, 30000)
  assert.equal(observed.options.maxBuffer, 65536)
  assert.ok(observed.args.includes("VERBOSITY=sqlstate"))
  assert.throws(() => queryMetadata(connection, sql, () => { throw new Error(connection) }), { message: "QUERY_FAILED" })
})

test("only whitelisted SQLSTATE survives query failures; messages and unknown codes are withheld", () => {
  for (const [state, expected] of [["42501", "42501"], ["42601", "42601"], ["42P01", "42P01"], ["57014", "57014"], ["25006", "25006"], ["99999", null]]) {
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
  const envReport = inspectRemote(sql, bindings, sha, { uid: 0, read: path => path.endsWith(".deploy-sha") ? sha : "", query: () => assert.fail("missing env must never query SQL") })
  assert.deepEqual(JSON.parse(run(envReport)), envReport)
  for (const invalid of [{ ...report, rawEnvironment: "protected marker" }, { ...report, bindings: { ...bindings, sqlSha256: "b".repeat(64) } }, { ...envReport, envDetail: "private-forged-parameter" }, { ...envReport, version: 1 }]) {
    try { run(invalid); assert.fail("invalid output must fail") }
    catch (error) { assert.equal(error.status, 1); assert.equal(error.stdout, ""); assert.equal(error.stderr, "HRM metadata output invalid; raw data withheld\n") }
  }
})

// Only this hosted-only test writes a disposable SQL fixture. The production
// helper has no test mode, privilege bypass or mutation path.
test("hosted PostgreSQL executes the real fixed catalog query and rejects writes", { skip: !process.env.HRM_PREFLIGHT_TEST_DATABASE_URL }, async context => {
  const receipt = { status: "RUNNING", sourceSha: process.env.HRM_PREFLIGHT_TEST_HEAD_SHA,
    fixture: "SYNTHETIC_SELECTED_DDL_NOT_RESTORED_BASELINE", productionObserved: false, historicalReplay: false,
    cases: [], cleanup: [], sourceBindings: [], originalFailure: null }
  const sourcePaths = ["scripts/hrm-migration-metadata-preflight.sql", "scripts/hrm-migration-metadata-preflight.mjs",
    "scripts/hrm-migration-metadata-preflight.test.mjs", ".github/workflows/hrm-migration-metadata-preflight.yml",
    "scripts/ci/fixtures/hrm-metadata-preflight/assignment-trigger-before.sql",
    "prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql",
    "prisma/migrations/20260927014000_workforce_exception_case_revisions/migration.sql",
    "prisma/migrations/20260927014100_workforce_exception_case_revisions_backfill/migration.sql"]
  const sourceBindings = () => sourcePaths.map(path => { const bytes = fs.readFileSync(path); return { path, bytes: bytes.length, sha256: digest(bytes) } })
  let execute, ownsRole = false, originalFailure
  try {
  const url = new URL(process.env.HRM_PREFLIGHT_TEST_DATABASE_URL)
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.CI, "true")
  assert.match(receipt.sourceSha, /^[0-9a-f]{40}$/)
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), receipt.sourceSha)
  receipt.sourceBindings = sourceBindings()
  assert.equal(url.protocol, "postgresql:")
  assert.equal(url.search, ""); assert.equal(url.hash, "")
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.pathname, "/hrm_preflight_test")
  assert.equal(url.username, "postgres")
  const env = databaseConnectionEnvironment(url.href)
  execute = text => {
    try { return execFileSync("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], { input: text, encoding: "utf8", env, timeout: 20000, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }) }
    catch (failure) {
      const error = new Error("HOSTED_FIXTURE_SQL_QUERY_FAILED")
      const state = String(failure.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1]
      error.sqlState = ["23514", "25006", "2BP01", "42501", "42601", "42703", "42704", "42710", "42804", "42883", "42P01", "55P03", "57014"].includes(state) ? state : null
      throw error
    }
  }
  assert.equal(execute("SELECT current_database()='hrm_preflight_test' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);\n").trim(), "t")
  assert.equal(execute(`SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hrm_preflight_migration')
    AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE refclassid='pg_namespace'::regclass AND refobjid='public'::regnamespace)
    AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace)
    AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace);`).trim(), "t")
  receipt.pristineFixtureAdmission = true
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
  execute(`BEGIN; CREATE ROLE hrm_preflight_migration LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'isolated-preflight-migration'; GRANT USAGE,CREATE ON SCHEMA public TO hrm_preflight_migration; SET ROLE hrm_preflight_migration; CREATE TABLE _prisma_migrations(id text NOT NULL,migration_name text NOT NULL,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz); CREATE TYPE "WorkforceDefinitionStatus" AS ENUM ('ACTIVE','DRAFT','RETIRED'); ${tables}\n${guard[0]}\n${append[0]}\n${revision[0]}\nCREATE TRIGGER workforce_shift_assignments_guard BEFORE INSERT OR UPDATE ON workforce_shift_assignments FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_assignment(); CREATE TRIGGER workforce_exception_decisions_append_only BEFORE UPDATE OR DELETE ON workforce_exception_decisions FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_decision_mutation(); CREATE TRIGGER workforce_exception_decisions_assign_case_revision BEFORE INSERT ON workforce_exception_decisions FOR EACH ROW EXECUTE FUNCTION workforce_assign_exception_decision_revision(); COMMIT;`)
  ownsRole = true
  execute("ALTER ROLE hrm_preflight_migration SET lock_timeout='10s'; ALTER ROLE hrm_preflight_migration SET statement_timeout='14min';")
  const migrationUrl = new URL(url.href)
  migrationUrl.username = "hrm_preflight_migration"
  migrationUrl.password = "isolated-preflight-migration"
  // Known synthetic URI hint only; the real fixed query retains our budget.
  migrationUrl.searchParams.set("connect_timeout", "0")
  assert.equal(databaseConnectionEnvironment(migrationUrl.href).PGCONNECT_TIMEOUT, "10")
  assert.equal(new URL(parseMigrationEnv("MIGRATION_DATABASE_URL='" + migrationUrl.href + "'\nMIGRATION_EXPECTED_DB_ROLE=hrm_preflight_migration\n")).searchParams.has("connect_timeout"), false)
    const query = (source = sql) => {
      let output
      try { output = queryMetadata(migrationUrl.href, source) }
      catch (error) { const failure = new Error("HOSTED_FIXED_SQL_QUERY_FAILED"); failure.sqlState = error?.sqlState ?? null; throw failure }
      const lines = output.trim().split("\n")
      assert.equal(lines.length, 2)
      try { return lines.map(JSON.parse) }
      catch { throw new Error("HOSTED_FIXED_SQL_OUTPUT_JSON_INVALID") }
    }
    let [d, s] = query()
    // Diagnose only declared catalog names, fields and primitive predicates.
    // Never place an unknown name/key/value or the raw snapshot in test output.
    const record = (actual, declared, path) => assert.ok(actual && typeof actual === "object" && !Array.isArray(actual) && Object.keys(actual).sort().join(",") === Object.keys(declared).sort().join(","), "HOSTED_METADATA_SHAPE path=" + path)
    const integer = (value, min, max, path) => assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, "HOSTED_METADATA_INTEGER path=" + path)
    const primitiveRecord = (actual, declared, path) => {
      record(actual, declared, path)
      for (const [field, value] of Object.entries(declared)) {
        if (typeof value === "boolean") assert.equal(typeof actual[field], "boolean", "HOSTED_METADATA_TYPE path=" + path + "." + field)
        if (typeof value === "number") integer(actual[field], field === "estimatedRows" ? -1 : 0, Number.MAX_SAFE_INTEGER, path + "." + field)
      }
    }
    const names = (entries, declared, path) => {
      assert.ok(Array.isArray(entries), "HOSTED_METADATA_TYPE path=" + path)
      assert.deepEqual(entries.map(entry => declared.includes(entry?.name) ? entry.name : "UNDECLARED_NAME"), declared, "HOSTED_METADATA_CANONICAL_ORDER path=" + path)
    }
    const declared = snapshot()
    primitiveRecord(d, defaults(), "defaults")
    record(s, declared, "snapshot")
    names(s.relations, RELATIONS, "relations.name")
    names(s.indexes, INDEXES, "indexes.name")
    record(s.ledger, declared.ledger, "ledger")
    names(s.ledger.known, MIGRATIONS, "ledger.known.name")
    for (const [array, entries, schema] of [["relations", s.relations, declared.relations], ["indexes", s.indexes, declared.indexes], ["ledger.known", s.ledger.known, declared.ledger.known]]) {
      for (const [i, entry] of entries.entries()) primitiveRecord(entry, schema[i], array + "." + schema[i].name)
    }
    for (const field of ["roleProfile", "guard", "ledgerGuards", "defaultAcl", "activity"]) primitiveRecord(s[field], declared[field], field)
    for (const field of ["readOnly", "repeatableRead"]) assert.equal(typeof s[field], "boolean", "HOSTED_METADATA_TYPE path=" + field)
    integer(s.ledger.totalRows, 0, 5000, "ledger.totalRows")
    integer(s.ledger.unresolvedRows, 0, s.ledger.totalRows, "ledger.unresolvedRows")
    for (const entry of s.ledger.known) {
      for (const field of ["rows", "applied", "unresolved", "rolledBack"]) integer(entry[field], 0, s.ledger.totalRows, "ledger.known." + entry.name + "." + field)
      assert.ok(entry.applied + entry.unresolved + entry.rolledBack === entry.rows, "HOSTED_METADATA_COUNT_PARTITION migration=" + entry.name)
    }
    assert.ok(s.ledger.known.reduce((sum, entry) => sum + entry.rows, 0) <= s.ledger.totalRows, "HOSTED_METADATA_COUNT_PARTITION ledger")
    assert.ok(s.guard.bodyMd5 === null || /^[0-9a-f]{32}$/.test(s.guard.bodyMd5), "HOSTED_METADATA_MD5 guard.bodyMd5")
    for (const field of ["explicitPrivilegeRows", "publicPrivilegeRows", "nonOwnerWriteRows", "grantableRows"]) integer(s.defaultAcl[field], 0, 10000, "defaultAcl." + field)
    for (const field of ["otherActiveSessions", "otherOpenTransactions", "lockWaitSessions"]) integer(s.activity[field], 0, 10000, "activity." + field)
    // Replay the byte-bound previous query through the same read-only connection.
    // The boolean is sufficient evidence; no raw locale/snapshot is exported.
    const [legacyDefaults, legacy] = query(historicalSql.replaceAll(' ORDER BY name COLLATE "C")', ' ORDER BY name)'))
    const legacyOrderIsCanonical = [
      [legacy.ledger.known, MIGRATIONS], [legacy.relations, RELATIONS], [legacy.indexes, INDEXES],
    ].every(([entries, expected]) => Array.isArray(entries) && entries.length === expected.length && entries.every((entry, i) => entry?.name === expected[i]))
    context.diagnostic("Legacy default catalog-name order canonical=" + legacyOrderIsCanonical)
    if (!legacyOrderIsCanonical) assert.throws(() => validateSnapshot(legacyDefaults, legacy), { message: "OUTPUT_INVALID" })
    assert.deepEqual(assessMetadata(d, s), { status: "READY_FOR_REVIEW", reasons: [], migrationStates: ["pending", "pending"] })
    receipt.cases.push({ name: "healthy original catalog contract", status: "PASS", observed: "READY_FOR_REVIEW" })
    const trigger = (events, condition = "", args = "") => execute(`DROP TRIGGER workforce_shift_assignments_guard ON workforce_shift_assignments;
      CREATE TRIGGER workforce_shift_assignments_guard BEFORE ${events} ON workforce_shift_assignments FOR EACH ROW ${condition} EXECUTE FUNCTION workforce_guard_shift_assignment(${args});`)
    const probe = `BEGIN; INSERT INTO workforce_shift_assignments ("organizationId",id,"agentId","templateId","assignedByUserId","effectiveFrom")
      VALUES ('synthetic-org','synthetic-assignment','synthetic-missing-agent','synthetic-template','synthetic-actor','2026-10-09'); ROLLBACK;`
    assert.throws(() => execute(probe), error => error.sqlState === "23514")
    assert.equal(execute('SELECT count(*) FROM workforce_shift_assignments;').trim(), "0")
    receipt.cases.push({ name: "unconditional guard rejects missing-agent insert", status: "PASS", sqlState: "23514", rollbackRows: 0 })
    for (const [name, events, condition, args] of [
      ["conditional assignment trigger", "INSERT OR UPDATE", "WHEN (false)", ""],
      ["column-restricted assignment trigger", 'INSERT OR UPDATE OF "agentId"', "", ""],
      ["argument-bearing assignment trigger", "INSERT OR UPDATE", "", "'synthetic-unused-argument'"],
    ]) {
      await context.test(name, () => {
        const entry = { name, status: "RUNNING" }; receipt.cases.push(entry)
        let caseFailure
        try {
          trigger(events, condition, args)
          const [observedDefaults, observedSnapshot] = query()
          const assessment = assessMetadata(observedDefaults, observedSnapshot)
          entry.triggerBound = observedSnapshot.guard.triggerBound; entry.observed = assessment.status
          entry.reasons = assessment.reasons
          if (condition) {
            const before = execute('SELECT count(*) FROM workforce_shift_assignments;').trim()
            execute(probe)
            const after = execute('SELECT count(*) FROM workforce_shift_assignments;').trim()
            assert.equal(before, "0"); assert.equal(after, before)
            entry.syntheticBypassProved = true; entry.rollbackRowsUnchanged = true
          }
          assert.equal(observedSnapshot.guard.triggerBound, false)
          assert.equal(assessment.status, "INCOMPLETE")
          assert.ok(assessment.reasons.includes("FUNCTION_SHAPE"))
          entry.status = "PASS"
        } catch (error) { entry.status = "FAIL"; entry.code = "TRIGGER_BINDING_ASSERTION_FAILED"; entry.sqlState = error.sqlState ?? null; caseFailure = error }
        finally {
          try { trigger("INSERT OR UPDATE"); entry.restoration = { status: "PASS" } }
          catch (error) {
            entry.status = "FAIL"; entry.restoration = { status: "FAIL", code: "HOSTED_TRIGGER_RESTORE_FAILED", sqlState: error.sqlState ?? null }
            if (!caseFailure) caseFailure = new Error("HOSTED_TRIGGER_RESTORE_FAILED")
          }
        }
        if (caseFailure) throw caseFailure
      })
    }
    ;[d, s] = query()
    assert.equal(s.guard.triggerBound, true)
    assert.equal(assessMetadata(d, s).status, "READY_FOR_REVIEW")
    receipt.cases.push({ name: "restored unconditional trigger", status: "PASS", observed: "READY_FOR_REVIEW" })
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
    receipt.cases.push({ name: "original ledger, index, timeout and write-refusal contracts", status: "PASS" })
    assert.deepEqual(sourceBindings(), receipt.sourceBindings)
    assert.ok(receipt.cases.every(entry => entry.status === "PASS"))
    receipt.status = "PASS_ISOLATED_ASSIGNMENT_TRIGGER_METADATA_ONLY"
  } catch (error) {
    originalFailure = error; receipt.status = "FAIL"
    receipt.originalFailure = { code: error.message === "HOSTED_FIXTURE_SQL_QUERY_FAILED" ? error.message : "FIXTURE_OR_ASSERTION_FAILED", sqlState: error.sqlState ?? null }
  } finally {
    if (ownsRole) {
      try {
        // The principal was absent before admission; every fixture object is
        // owned by that principal. Preserve public itself and unrelated roles.
        execute("DROP OWNED BY hrm_preflight_migration; DROP ROLE hrm_preflight_migration;")
        receipt.cleanup.push({ action: "owned-fixture-role-and-objects", status: "PASS" })
      } catch (error) {
        receipt.status = "FAIL"; receipt.cleanup.push({ action: "owned-fixture-role-and-objects", status: "FAIL", sqlState: error.sqlState ?? null })
        if (!originalFailure) originalFailure = new Error("HOSTED_OWNED_FIXTURE_CLEANUP_FAILED")
      }
    }
    if (process.env.HRM_PREFLIGHT_TEST_RECEIPT) {
      try { fs.writeFileSync(process.env.HRM_PREFLIGHT_TEST_RECEIPT, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" }) }
      catch { if (!originalFailure) originalFailure = new Error("HOSTED_RECEIPT_WRITE_FAILED") }
    }
  }
  if (originalFailure) throw originalFailure
})
