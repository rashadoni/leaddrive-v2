import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { databaseConnectionEnvironment } from "./hrm-migration-metadata-preflight.mjs"
import { inspectAclRemote } from "./hrm-default-acl-inspection.mjs"
import { LIVE_LIMITS, LIVE_CODES, verifyLoopbackEndpoints, validateLiveSnapshot, validateLiveReport, startLiveRuntime, queryLiveMigration, inspectLiveAclRemote } from "./hrm-loopback-acl-inspection.mjs"

const source = name => fs.readFileSync(new URL(name, import.meta.url), "utf8")
const digest = value => createHash("sha256").update(value).digest("hex")
const sql = source("./hrm-loopback-acl-inspection.sql")
const bindings = { baseHelperSha256: digest(source("./hrm-migration-metadata-preflight.mjs")), aclHelperSha256: digest(source("./hrm-default-acl-inspection.mjs")), helperSha256: digest(source("./hrm-loopback-acl-inspection.mjs")), sqlSha256: digest(sql) }
const sha = "a".repeat(40), marker = "private-live-fixture-marker"
const nonce = "b".repeat(32), probeName = "hrm_loopback_acl_" + nonce
const appUrl = "postgresql://live_runtime:" + marker + "@localhost:5432/fixture"
const migrationUrl = "postgresql://live_migration:" + marker + "@127.0.0.1:5432/fixture"
const runtimeProfile = () => ({ present: true, noSuperuser: true, noBypassRls: true, canLogin: true, setPrivilegedCount: 0 })
const migrationProfile = () => ({ ...runtimeProfile(), noBypassRls: false })
const entry = (privilege = "INSERT", recipient = "EXPECTED_RUNTIME", profile = runtimeProfile()) => ({ scope: "PUBLIC_SCHEMA", recipient, privilege, grantable: false, rowCount: 1, recipientProfile: profile })
const acl = (entries = [entry("SELECT"), entry("INSERT"), entry("UPDATE"), entry("DELETE"), entry("SELECT", "OTHER", { ...runtimeProfile(), canLogin: false })]) => ({
  explicitPrivilegeRows: entries.reduce((sum, e) => sum + e.rowCount, 0), publicPrivilegeRows: entries.filter(e => e.recipient === "PUBLIC").reduce((sum, e) => sum + e.rowCount, 0),
  nonOwnerWriteRows: entries.filter(e => e.recipient !== "OWNER" && e.privilege !== "SELECT").reduce((sum, e) => sum + e.rowCount, 0), grantableRows: entries.filter(e => e.grantable).reduce((sum, e) => sum + e.rowCount, 0), entries,
})
const snapshot = (mode = "migration") => ({ mode, identity: { expectedIdentity: true, sessionIdentityUnchanged: true, primary: true, readOnly: true, repeatableRead: true, probeNameVerified: true, backendPid: mode === "runtime" ? "12345" : "12346", databaseOid: "12345", databaseName: "fixture", liveRuntimeSeen: mode === "migration" }, roleProfile: mode === "runtime" ? runtimeProfile() : migrationProfile(), acl: acl(mode === "runtime" ? [] : undefined) })
const read = path => path.endsWith(".deploy-sha") ? sha : path.endsWith("migration.env") ? "MIGRATION_DATABASE_URL='" + migrationUrl + "'\nMIGRATION_EXPECTED_DB_ROLE=live_migration\n" : "DATABASE_URL='" + appUrl + "'\n"
const lookup = async () => [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }]
const inspect = (overrides = {}) => inspectLiveAclRemote(sql, bindings, sha, { uid: 0, read, lookup, nonce: () => nonce, startRuntime: async () => ({ raw: JSON.stringify(snapshot("runtime")), finish: async () => {} }), queryMigration: async () => JSON.stringify(snapshot()), ...overrides })
const assertPrivate = report => assert.doesNotMatch(JSON.stringify(report), /private-live-fixture|postgresql:\/\/|live_runtime|live_migration|databaseOid|databaseName|backendPid|probeName|rawEnvironment|roleName|"12345"|"12346"|hrm_loopback_acl_[0-9a-f]{32}/)
const checkError = (report, code, cleanup = "PASS") => { assert.equal(report.status, "ERROR"); assert.equal(report.code, code); assert.equal(report.cleanup, cleanup); assert.equal(report.proof, null); assert.equal(report.productionArtifactSha, null); assert.equal(validateLiveReport(report, sha), report); assertPrivate(report) }

test("one held runtime backend is observed before rollback, with finite public evidence only", async () => {
  const calls = [], reads = []; let alive = false
  const report = await inspect({ read: (path, limit, mode) => { reads.push({ path, limit, mode }); return read(path) }, startRuntime: async (connection, statement, probe) => { assert.equal(connection, appUrl); assert.equal(statement, sql); assert.deepEqual(probe, { runtimeRole: "live_runtime", nonce: probeName, pid: 0 }); calls.push("start"); alive = true; return { raw: JSON.stringify(snapshot("runtime")), finish: async () => { calls.push("rollback"); alive = false } } }, queryMigration: async (connection, statement, probe) => { assert.equal(alive, true); assert.equal(connection, migrationUrl); assert.equal(statement, sql); assert.equal(probe.pid, 12345); assert.equal(probe.nonce, probeName); calls.push("observe"); return JSON.stringify(snapshot()) } })
  assert.deepEqual(calls, ["start", "observe", "rollback"]); assert.equal(alive, false)
  assert.equal(report.status, "READ_COMPLETE"); assert.equal(report.cleanup, "PASS"); assert.equal(report.proof.sameLiveDatabaseBackend, true); assert.equal(report.proof.declaredHostsEqual, false); assert.equal(report.proof.businessRowsRead, false); assert.equal(report.proof.acl.nonOwnerWriteRows, 3)
  assert.equal(validateLiveReport(report, sha), report); assertPrivate(report)
  assert.deepEqual(reads.filter(r => r.path.endsWith(".env")).map(r => [r.path, r.limit, r.mode]), [["/etc/leaddrive/app.env", 65536, 0o600], ["/etc/leaddrive/migration.env", 32768, 0o600], ["/etc/leaddrive/app.env", 65536, 0o600], ["/etc/leaddrive/migration.env", 32768, 0o600]])
  assert.ok(LIVE_LIMITS.some(text => text.includes("not ACL approval")))
})

test("topology is limited to unchanged loopback hosts, distinct roles and equal port/database", async () => {
  const runtime = databaseConnectionEnvironment(appUrl), migration = databaseConnectionEnvironment(migrationUrl)
  await verifyLoopbackEndpoints(runtime, migration, lookup)
  await verifyLoopbackEndpoints({ ...runtime, PGHOST: "::1" }, migration, () => assert.fail("literal address needs no DNS"))
  for (const [r, m, resolve, code] of [[{ ...runtime, PGHOST: "arbitrary.invalid" }, migration, lookup, "NOT_EXPECTED_LOOPBACK"], [runtime, { ...migration, PGUSER: runtime.PGUSER }, lookup, "PRINCIPALS_EQUAL"], [runtime, { ...migration, PGPORT: "5433" }, lookup, "PORT_OR_DATABASE_MISMATCH"], [runtime, { ...migration, PGDATABASE: "other" }, lookup, "PORT_OR_DATABASE_MISMATCH"], [runtime, migration, async () => [], "NOT_EXPECTED_LOOPBACK"], [runtime, migration, async () => [{ address: "192.0.2.1", family: 4 }], "NOT_EXPECTED_LOOPBACK"], [runtime, migration, async () => [{ address: "::ffff:127.0.0.1", family: 6 }], "NOT_EXPECTED_LOOPBACK"], [runtime, migration, async () => { throw new Error(marker) }, "NOT_EXPECTED_LOOPBACK"]]) await assert.rejects(verifyLoopbackEndpoints(r, m, resolve), { message: code })
})

test("root, artifact, private files, canonical parser and topology failures never start SQL", async () => {
  const cases = [[{ uid: 1 }, "INPUT_INVALID"], [{ read: () => "c".repeat(40) }, "ARTIFACT_MISMATCH"], [{ read: path => path.endsWith("app.env") ? "" : read(path) }, "ENV_INVALID"], [{ read: path => path.endsWith("migration.env") ? "" : read(path) }, "ENV_INVALID"], [{ read: path => { if (path.endsWith("app.env")) throw new Error("FILES_UNSAFE"); return read(path) } }, "FILES_UNSAFE"], [{ read: path => { if (path.endsWith("app.env")) throw new Error("SOURCE_CHANGED"); return read(path) } }, "SOURCE_CHANGED"], [{ lookup: async () => [{ address: "192.0.2.1" }] }, "NOT_EXPECTED_LOOPBACK"]]
  for (const [replace, code] of [["@localhost:", "NOT_EXPECTED_LOOPBACK"], ["?options=-c%20default_transaction_read_only=off", "ENV_INVALID"], ["?unknown_private=secret", "ENV_INVALID"]]) cases.push([{ read: path => path.endsWith("app.env") ? "DATABASE_URL='" + (replace.startsWith("@") ? appUrl.replace(replace, "@other.invalid:") : appUrl + replace) + "'" : read(path) }, code])
  for (const [field, value, code] of [["username", "live_migration", "PRINCIPALS_EQUAL"], ["port", "5433", "PORT_OR_DATABASE_MISMATCH"], ["pathname", "/other", "PORT_OR_DATABASE_MISMATCH"]]) { const u = new URL(appUrl); u[field] = value; cases.push([{ read: path => path.endsWith("app.env") ? "DATABASE_URL='" + u.href + "'" : read(path) }, code]) }
  for (const [overrides, code] of cases) checkError(await inspect({ ...overrides, startRuntime: () => assert.fail("rejected configuration must not open a connection"), queryMigration: () => assert.fail("rejected configuration must not query") }), code, "NOT_STARTED")
})

test("session identity, primary/read-only isolation, private probe and database correlation fail closed", async () => {
  const cases = []
  for (const mode of ["runtime", "migration"]) for (const field of ["expectedIdentity", "sessionIdentityUnchanged", "primary", "readOnly", "repeatableRead", "probeNameVerified", ...(mode === "migration" ? ["liveRuntimeSeen"] : [])]) cases.push([mode, s => { s.identity[field] = false }])
  for (const [field, value] of [["backendPid", "12345"], ["databaseOid", "98765"], ["databaseName", "other-private-db"]]) cases.push(["migration", s => { s.identity[field] = value }])
  cases.push(["runtime", s => { s.identity.databaseName = "other-private-db" }])
  for (const [target, mutate] of cases) {
    let finished = 0, queried = 0
    const report = await inspect({ startRuntime: async () => { const s = snapshot("runtime"); if (target === "runtime") mutate(s); return { raw: JSON.stringify(s), finish: async () => { finished++ } } }, queryMigration: async () => { queried++; const s = snapshot(); if (target === "migration") mutate(s); return JSON.stringify(s) } })
    checkError(report, "IDENTITY_UNPROVED"); assert.equal(finished, 1); if (target === "runtime" && !String(mutate).includes("databaseName")) assert.equal(queried, 0)
  }
})

test("runtime remains NOSUPERUSER/NOBYPASSRLS/no privileged SET and migration remains bounded expected profile", async () => {
  const cases = []
  for (const mode of ["runtime", "migration"]) for (const field of ["present", "noSuperuser", "canLogin"]) cases.push([mode, s => { s.roleProfile[field] = false }])
  cases.push(["runtime", s => { s.roleProfile.noBypassRls = false }], ["runtime", s => { s.roleProfile.setPrivilegedCount = 1 }], ["migration", s => { s.roleProfile.noBypassRls = true }])
  for (const [target, mutate] of cases) checkError(await inspect({ startRuntime: async () => { const s = snapshot("runtime"); if (target === "runtime") mutate(s); return { raw: JSON.stringify(s), finish: async () => {} } }, queryMigration: async () => { const s = snapshot(); if (target === "migration") mutate(s); return JSON.stringify(s) } }), "PROFILE_UNPROVED")
})

test("strict private snapshots reject identifier/shape/type injection and runtime ACL output", () => {
  for (const mutate of [s => { s.rawEnvironment = marker }, s => { s.identity.roleName = marker }, s => { s.roleProfile.roleName = marker }, s => { s.identity.backendPid = "0" }, s => { s.identity.backendPid = "2147483648" }, s => { s.identity.databaseOid = "4294967296" }, s => { s.identity.databaseName = "x".repeat(64) }, s => { s.identity.databaseName = "secret\n" }, s => { s.identity.readOnly = "true" }, s => { s.mode = "owner" }, s => { s.acl.explicitPrivilegeRows++ }, s => { s.acl.entries[0].recipient = marker }]) { const s = snapshot(); mutate(s); assert.throws(() => validateLiveSnapshot(s, "migration"), { message: "OUTPUT_INVALID" }) }
  const s = snapshot("runtime"); s.acl = acl(); assert.throws(() => validateLiveSnapshot(s, "runtime"), { message: "OUTPUT_INVALID" })
  const seen = snapshot("runtime"); seen.identity.liveRuntimeSeen = true; assert.throws(() => validateLiveSnapshot(seen, "runtime"), { message: "OUTPUT_INVALID" })
})

test("changes to artifact or either private file during cleanup discard all successful observation", async () => {
  for (const target of [".deploy-sha", "app.env", "migration.env"]) {
    let changed = false, finished = 0
    const report = await inspect({ read: path => changed && path.endsWith(target) ? target === ".deploy-sha" ? "c".repeat(40) : read(path) + "# changed\n" : read(path), startRuntime: async () => ({ raw: JSON.stringify(snapshot("runtime")), finish: async () => { changed = true; finished++ } }) })
    checkError(report, target === ".deploy-sha" ? "ARTIFACT_MISMATCH" : "SOURCE_CHANGED"); assert.equal(finished, 1)
  }
})

test("cleanup is mandatory and secondary failures retain the original primary error", async () => {
  checkError(await inspect({ startRuntime: async () => ({ raw: JSON.stringify(snapshot("runtime")), finish: async () => { throw new Error(marker) } }) }), "CLEANUP_UNPROVED", "FAILED")
  const wrong = snapshot(); wrong.identity.liveRuntimeSeen = false
  checkError(await inspect({ startRuntime: async () => ({ raw: JSON.stringify(snapshot("runtime")), finish: async () => { throw new Error(marker) } }), queryMigration: async () => JSON.stringify(wrong) }), "IDENTITY_UNPROVED", "FAILED")
  checkError(await inspect({ startRuntime: async () => { throw new Error("QUERY_FAILED") } }), "QUERY_FAILED", "NOT_STARTED")
  checkError(await inspect({ startRuntime: async () => ({ raw: JSON.stringify(snapshot("runtime")) }) }), "OUTPUT_INVALID", "NOT_STARTED")
})

test("malformed/raw output and private process errors never enter the public receipt", async () => {
  for (const raw of [marker, JSON.stringify(snapshot()) + "\n" + marker, "x".repeat(65537)]) checkError(await inspect({ queryMigration: async () => raw }), "OUTPUT_INVALID")
  checkError(await inspect({ queryMigration: async () => { throw new Error("private-" + marker) } }), "INSPECTION_FAILED")
  let finished = 0; checkError(await inspect({ startRuntime: async () => ({ raw: marker, finish: async () => { finished++ } }) }), "OUTPUT_INVALID"); assert.equal(finished, 1)
})

test("reports reject readiness/secret fields, forged enums, invalid proof and role contradictions", async () => {
  const complete = await inspect()
  for (const mutate of [r => { r.status = "READY" }, r => { r.rawEnvironment = marker }, r => { r.bindings.roleName = marker }, r => { r.proof.backendPid = "12345" }, r => { r.proof.sameLiveDatabaseBackend = false }, r => { r.proof.businessRowsRead = true }, r => { r.cleanup = "NOT_STARTED" }, r => { r.proof.runtimeProfile.setPrivilegedCount = 1 }, r => { r.proof.acl.entries[0].recipientProfile.noSuperuser = false }, r => { r.limits = [] }, r => { r.productionArtifactSha = "c".repeat(40) }]) { const r = structuredClone(complete); mutate(r); assert.throws(() => validateLiveReport(r, sha), { message: "OUTPUT_INVALID" }) }
  const failed = await inspect({ uid: 1 })
  for (const code of LIVE_CODES) assert.equal(validateLiveReport({ ...failed, code, cleanup: code === "CLEANUP_UNPROVED" ? "FAILED" : "NOT_STARTED" }, sha).code, code)
  assert.throws(() => validateLiveReport({ ...failed, code: marker }, sha), { message: "OUTPUT_INVALID" })
  assert.throws(() => validateLiveReport({ ...failed, proof: complete.proof }, sha), { message: "OUTPUT_INVALID" })
})

test("PUBLIC, OTHER write privileges and grant options remain finite observations without automatic ACL approval", async () => {
  const publicProfile = { present: false, noSuperuser: false, noBypassRls: false, canLogin: false, setPrivilegedCount: 0 }
  const unsafe = [entry("TRUNCATE", "OTHER", { ...runtimeProfile(), noBypassRls: false, setPrivilegedCount: 1 }), { ...entry("SELECT", "PUBLIC", publicProfile), scope: "GLOBAL" }, { ...entry("INSERT", "OTHER"), grantable: true }]
  const report = await inspect({ queryMigration: async () => JSON.stringify({ ...snapshot(), acl: acl(unsafe) }) })
  assert.equal(report.status, "READ_COMPLETE"); assert.equal(report.proof.acl.publicPrivilegeRows, 1); assert.equal(report.proof.acl.grantableRows, 1); assert.equal(report.proof.acl.nonOwnerWriteRows, 2); assert.equal(validateLiveReport(report, sha), report); assertPrivate(report)
})

// Fake streams observe transport/rollback contracts without spawning PostgreSQL.
const fakeChild = output => {
  const child = new EventEmitter(), input = []; child.stdout = new EventEmitter(); child.stdin = new EventEmitter()
  child.stdout.setEncoding = () => {}; child.stdout.destroy = () => {}; child.stdin.destroy = () => {}; child.unref = () => {}; child.kill = () => queueMicrotask(() => child.emit("close", 137))
  child.stdin.write = text => { input.push(text); queueMicrotask(() => child.stdout.emit("data", output + "\n")) }
  child.stdin.end = text => { input.push(text); queueMicrotask(() => { if (input.length === 1) child.stdout.emit("data", output + "\n"); child.emit("close", 0) }) }
  return { child, input }
}

test("clean libpq transport holds runtime stdin until explicit rollback and keeps credentials out of argv", async () => {
  const probe = { runtimeRole: "live_runtime", nonce: probeName, pid: 0 }, runtime = fakeChild(JSON.stringify(snapshot("runtime"))); let call
  const held = await startLiveRuntime(appUrl + "?connect_timeout=-10", sql, probe, (binary, args, options) => { call = { binary, args, options }; return runtime.child })
  assert.equal(call.binary, "psql"); assert.doesNotMatch(call.args.join(" "), /postgresql:\/\/|private-live|live_runtime|live_migration|hrm_loopback_acl_/); assert.equal(call.options.env.PGCONNECT_TIMEOUT, "10"); assert.equal(call.options.env.PGPASSFILE, "/dev/null"); assert.equal(call.options.env.HOME, undefined); assert.equal(call.options.env.PGSERVICE, undefined); assert.equal(call.options.env.PGSERVICEFILE, undefined); assert.equal(call.options.env.PGSYSCONFDIR, undefined); assert.equal(call.options.stdio[2], "ignore"); assert.equal(runtime.input.length, 1); assert.equal(runtime.input[0], sql + "\n"); assert.equal(call.options.env.PGOPTIONS, "-c default_transaction_read_only=on -c application_name=" + probeName + " -c hrm.live_expected_role=live_runtime -c hrm.live_runtime_role=live_runtime -c hrm.live_mode=runtime -c hrm.live_probe_name=" + probeName + " -c hrm.live_expected_pid=0")
  assert.equal(call.options.env.PGAPPNAME, probeName)
  await held.finish(); assert.equal(runtime.input[1], "ROLLBACK;\n\\q\n"); await assert.rejects(held.finish(), { message: "CLEANUP_UNPROVED" })
  const migration = fakeChild(JSON.stringify(snapshot())); let migrationCall
  await queryLiveMigration(migrationUrl, sql, { ...probe, pid: 12345 }, (binary, args, options) => { migrationCall = { binary, args, options }; return migration.child })
  assert.equal(migration.input[0], sql + "\nROLLBACK;\n"); assert.equal(migrationCall.options.stdio[2], "ignore"); assert.match(migrationCall.options.env.PGOPTIONS, /application_name=hrm_loopback_acl_inspection /); assert.match(migrationCall.options.env.PGOPTIONS, /hrm.live_expected_pid=12345$/)
  assert.equal(migrationCall.options.env.PGAPPNAME, "hrm_loopback_acl_inspection")
  await assert.rejects(startLiveRuntime(appUrl, sql, { ...probe, nonce: marker }, () => assert.fail("invalid probe must not spawn")), { message: "QUERY_FAILED" })
  await assert.rejects(queryLiveMigration(migrationUrl, sql, probe, () => { throw new Error(marker) }), { message: "QUERY_FAILED" })
})

test("transport rejects already-dead/error/oversize processes and proves failed rollback cannot pass", async () => {
  const probe = { runtimeRole: "live_runtime", nonce: probeName, pid: 0 }
  for (const mode of ["runtime", "migration"]) for (const failure of ["DEAD", "ERROR", "OVERSIZE"]) {
    const child = fakeChild("x".repeat(65537)).child
    child.stdin.write = child.stdin.end = () => queueMicrotask(() => { if (failure === "ERROR") { child.emit("error", new Error(marker)); child.emit("close", 1) } else if (failure === "DEAD") child.emit("close", 1); else child.stdout.emit("data", "x".repeat(65537)) })
    await assert.rejects((mode === "runtime" ? startLiveRuntime : queryLiveMigration)(mode === "runtime" ? appUrl : migrationUrl, sql, probe, () => child), { message: "QUERY_FAILED" })
  }
  const early = fakeChild(JSON.stringify(snapshot("runtime"))); const held = await startLiveRuntime(appUrl, sql, probe, () => early.child)
  early.child.emit("close", 0); await assert.rejects(held.finish(), { message: "CLEANUP_UNPROVED" })
  const extra = fakeChild(JSON.stringify(snapshot("runtime"))); const heldExtra = await startLiveRuntime(appUrl, sql, probe, () => extra.child)
  extra.child.stdout.emit("data", marker); await assert.rejects(heldExtra.finish(), { message: "CLEANUP_UNPROVED" })
})

test("fixed SQL proves only live PID/name/user/database catalogs and original nine source files remain exact", () => {
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/); assert.match(sql, /SET LOCAL lock_timeout = '2s';/); assert.match(sql, /SET LOCAL statement_timeout = '10s';/); assert.doesNotMatch(sql, /ROLLBACK;/)
  for (const fragment of ["a.pid=pg_catalog.current_setting('hrm.live_expected_pid')::integer", "a.application_name=pg_catalog.current_setting('hrm.live_probe_name')", "a.usename=pg_catalog.current_setting('hrm.live_runtime_role')", "a.datid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())"]) assert.ok(sql.includes(fragment))
  assert.doesNotMatch(sql, /pg_control_system|pg_read_all_stats|a\.(?:query|state|xact_start|backend_type)/); assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+public\./i)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY)\s+(?:INTO|FROM|TABLE|INDEX|ROLE|USER|FUNCTION|POLICY)\b/i)
  assert.match(sql, /scope COLLATE "C",recipient COLLATE "C",privilege_type COLLATE "C"/)
  for (const [path, hash] of [["./hrm-migration-metadata-preflight.mjs", "46b417da7bbe763960b8ede8fa0e9dbd98543d090d54f73979289504bfe35771"], ["./hrm-migration-metadata-preflight.sql", "b174e32eb68a0dbcca98e8557fe8c716ed8277111e79ba822bce43f4e7023b6a"], ["./hrm-migration-metadata-preflight.test.mjs", "39c947982f5e7dc2ca1e96307ac5314518bfe748ec58a3cf217f8f09194c0eef"], ["../.github/workflows/hrm-migration-metadata-preflight.yml", "f90937ecda3b81e7dd017819cfaec1afdefc5fee58167fdfc2289ce012a1dcf1"], ["./hrm-default-acl-inspection.mjs", "a6aa4f3526fd5edf29bd2b3a1309f7703e85acad70c0e683cba69dbb281c2027"], ["./hrm-default-acl-inspection.sql", "524bc02f34a75f445aff6b3834df6e02aa86665dee9acd835b2b5fc621127e2a"], ["./hrm-default-acl-inspection.test.mjs", "402a2dde20443676d6bac430ab4e80a74f507c2dd3828b920c278cafcf0c7c3c"], ["../.github/workflows/hrm-default-acl-inspection.yml", "954c6d042bf00420f1ecd3c9ed0c378bc41305c0af08c30cdc3a97f06f81df2a"], ["../docs/hrm-default-acl-inspection-session-log.md", "8d3af68cc9a724374a30d5eba1e06d37537473cef61ca4d89549adced5500a5f"]]) assert.equal(digest(source(path)), hash)
})

test("stdin source bindings and output validation reject forged private receipts without database access", async () => {
  const bundle = execFileSync(process.execPath, ["scripts/hrm-loopback-acl-inspection.mjs", "--emit-remote"], { encoding: "utf8", maxBuffer: 250000 })
  const safe = bundle.replace(",process.env.EXPECTED_MAIN_SHA);", ",process.env.EXPECTED_MAIN_SHA,{uid:1});"); assert.notEqual(safe, bundle)
  try { execFileSync(process.execPath, ["--input-type=module", "-"], { input: safe, encoding: "utf8", env: { EXPECTED_MAIN_SHA: sha }, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }); assert.fail("non-root must fail") }
  catch (error) { assert.equal(error.status, 1); assert.equal(error.stderr, ""); const r = JSON.parse(error.stdout); checkError(r, "INPUT_INVALID", "NOT_STARTED"); assert.deepEqual(r.bindings, bindings) }
  const run = r => execFileSync(process.execPath, ["scripts/hrm-loopback-acl-inspection.mjs", "--validate-output", sha], { input: JSON.stringify(r), encoding: "utf8", maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] })
  const complete = await inspect(); assert.deepEqual(JSON.parse(run(complete)), complete)
  for (const r of [{ ...complete, rawEnvironment: marker }, { ...complete, bindings: { ...bindings, aclHelperSha256: "c".repeat(64) } }, { ...complete, status: "READY" }]) {
    try { run(r); assert.fail("forged receipt must fail") } catch (error) { assert.equal(error.status, 1); assert.equal(error.stdout, ""); assert.equal(error.stderr, "HRM live loopback ACL output invalid; raw data withheld\n") }
  }
})

// Role/ACL mutations are confined to the mandatory GitHub PostgreSQL16 fixture.
// Production has no fixture mode, identity fallback, monitoring grant or URL rewrite.
test("hosted PostgreSQL proves one live runtime backend, exact nonce/PID, read-only ACL projection and complete cleanup", { skip: !process.env.HRM_LOOPBACK_ACL_TEST_DATABASE_URL }, async context => {
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true")
  const admin = new URL(process.env.HRM_LOOPBACK_ACL_TEST_DATABASE_URL); assert.equal(admin.hostname, "127.0.0.1"); assert.equal(admin.pathname, "/hrm_preflight_test"); assert.equal(admin.username, "postgres")
  const adminEnv = databaseConnectionEnvironment(admin.href), sqlStates = new Set(["08001", "08006", "25006", "28000", "28P01", "42501", "42601", "42704", "42P01", "2BP01", "55P03", "57014", "XX000"])
  const execute = statement => { try { return execFileSync("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], { input: statement, encoding: "utf8", env: adminEnv, timeout: 20000, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }) } catch (error) { const state = String(error?.stderr ?? "").match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b/)?.[1]; const safe = new Error("HOSTED_LIVE_SQL_FAILED"); safe.fixtureSqlState = sqlStates.has(state) ? state : "UNAVAILABLE"; throw safe } }
  const failureDetail = error => "kind=" + (error?.fixtureSqlState ? "PSQL" : error?.code === "ERR_ASSERTION" ? "ASSERTION" : "OTHER") + " sqlState=" + (sqlStates.has(error?.fixtureSqlState) ? error.fixtureSqlState : "UNAVAILABLE")
  assert.equal(execute("SELECT current_database()='hrm_preflight_test' AND (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user);").trim(), "t"); assert.equal(execute("SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';").trim(), "0")
  const runtime = new URL(admin.href); runtime.username = "hrm_live_runtime"; runtime.password = "isolated-live-runtime"; runtime.hostname = "localhost"
  const migration = new URL(admin.href); migration.username = "hrm_live_migration"; migration.password = "isolated-live-migration"
  const privateRead = path => path.endsWith(".deploy-sha") ? sha : path.endsWith("migration.env") ? "MIGRATION_DATABASE_URL='" + migration.href + "'\nMIGRATION_EXPECTED_DB_ROLE=hrm_live_migration\n" : "DATABASE_URL='" + runtime.href + "'\n"
  const observe = async overrides => {
    let runtimeObserved
    // These flags exist only inside the GitHub-fenced synthetic fixture. Never
    // serialize the raw snapshot, role/DB identity, PID, probe or connection.
    const recordIdentity = (raw, mode) => {
      let observed
      try { observed = validateLiveSnapshot(JSON.parse(raw), mode) }
      catch { context.diagnostic("HOSTED_LIVE_OBSERVATION mode=" + mode + " snapshotShape=INVALID"); return }
      const fields = ["expectedIdentity", "sessionIdentityUnchanged", "primary", "readOnly", "repeatableRead", "probeNameVerified", "liveRuntimeSeen"]
      context.diagnostic("HOSTED_LIVE_OBSERVATION mode=" + mode + " " + fields.map(field => field + "=" + observed.identity[field]).join(" "))
      if (mode === "runtime") runtimeObserved = observed
      else if (runtimeObserved) context.diagnostic("HOSTED_LIVE_CORRELATION databaseOidEqual=" + (runtimeObserved.identity.databaseOid === observed.identity.databaseOid) + " databaseNameEqual=" + (runtimeObserved.identity.databaseName === observed.identity.databaseName) + " distinctBackendPids=" + (runtimeObserved.identity.backendPid !== observed.identity.backendPid))
    }
    const r = await inspectLiveAclRemote(sql, bindings, sha, { uid: 0, read: privateRead, startRuntime: async (connection, statement, probe) => { const held = await startLiveRuntime(connection, statement, probe); recordIdentity(held.raw, "runtime"); return held }, queryMigration: async (connection, statement, probe) => { const raw = await queryLiveMigration(connection, statement, probe); recordIdentity(raw, "migration"); return raw }, ...overrides })
    assert.equal(r.status, "READ_COMPLETE", "HOSTED_LIVE_INSPECTION status=" + r.status + " code=" + r.code + " cleanup=" + r.cleanup)
    assert.equal(r.cleanup, "PASS"); assert.equal(r.proof.sameLiveDatabaseBackend, true); assert.equal(r.proof.declaredHostsEqual, false); assert.equal(r.proof.businessRowsRead, false); assert.equal(validateLiveReport(r, sha), r)
    assert.doesNotMatch(JSON.stringify(r), /hrm_live_|isolated-live|postgresql:\/\/|backendPid|databaseOid|databaseName|hrm_loopback_acl_[0-9a-f]{32}/); return r
  }
  execute("BEGIN; CREATE ROLE hrm_live_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'isolated-live-runtime'; CREATE ROLE hrm_live_migration LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'isolated-live-migration'; CREATE ROLE hrm_live_other NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE hrm_live_privileged NOLOGIN NOSUPERUSER BYPASSRLS; GRANT USAGE,CREATE ON SCHEMA public TO hrm_live_migration; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_live_migration IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO hrm_live_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_live_migration IN SCHEMA public GRANT SELECT ON TABLES TO hrm_live_other; COMMIT;")
  let stage = "FIXTURE_IDENTITY", bodyError = null, cleanupError = null, migrationFixtureOid, otherDatabaseCreated = false
  try {
    migrationFixtureOid = execute("SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname='hrm_live_migration';").trim(); assert.ok(/^[1-9][0-9]{0,9}$/.test(migrationFixtureOid), "HOSTED_LIVE_FIXTURE_IDENTITY_UNPROVED")
    stage = "LIVE_CATALOG"; let report = await observe(); assert.equal(report.proof.acl.explicitPrivilegeRows, 5); assert.equal(report.proof.acl.nonOwnerWriteRows, 3); assert.equal(report.proof.acl.publicPrivilegeRows, 0); assert.equal(report.proof.acl.grantableRows, 0)
    assert.deepEqual(report.proof.acl.entries.filter(e => e.recipient === "EXPECTED_RUNTIME").map(e => e.privilege).sort(), ["DELETE", "INSERT", "SELECT", "UPDATE"]); assert.equal(report.proof.acl.entries.find(e => e.recipient === "OTHER").privilege, "SELECT")
    const old = inspectAclRemote(source("./hrm-default-acl-inspection.sql"), { baseHelperSha256: bindings.baseHelperSha256, helperSha256: bindings.aclHelperSha256, sqlSha256: digest(source("./hrm-default-acl-inspection.sql")) }, sha, { uid: 0, read: privateRead, query: () => assert.fail("original mismatched-host guard must still run before SQL") }); assert.equal(old.status, "ERROR"); assert.equal(old.code, "IDENTITY_ENDPOINT_HOST_MISMATCH"); assert.equal(old.proof, null)
    context.diagnostic("HOSTED_LIVE_MILESTONE liveBackendAndOriginalGuard=PASS")
    stage = "PID_NONCE_GUARDS"
    for (const mutate of [probe => ({ ...probe, pid: 2147483647 }), probe => ({ ...probe, nonce: "hrm_loopback_acl_" + "c".repeat(32) })]) {
      const denied = await inspectLiveAclRemote(sql, bindings, sha, { uid: 0, read: privateRead, queryMigration: (connection, statement, probe) => queryLiveMigration(connection, statement, mutate(probe)) })
      assert.equal(denied.status, "ERROR"); assert.equal(denied.code, "IDENTITY_UNPROVED"); assert.equal(denied.proof, null); assert.equal(denied.cleanup, "PASS")
    }
    context.diagnostic("HOSTED_LIVE_MILESTONE wrongPidAndNonce=PASS")
    stage = "OTHER_DATABASE_GUARD"
    execute("CREATE DATABASE hrm_preflight_live_other;"); otherDatabaseCreated = true
    const otherDatabase = new URL(migration.href); otherDatabase.pathname = "/hrm_preflight_live_other"
    const otherDenied = await inspectLiveAclRemote(sql, bindings, sha, { uid: 0, read: privateRead, queryMigration: (_connection, statement, probe) => queryLiveMigration(otherDatabase.href, statement, probe) })
    assert.equal(otherDenied.status, "ERROR"); assert.equal(otherDenied.code, "IDENTITY_UNPROVED"); assert.equal(otherDenied.proof, null); assert.equal(otherDenied.cleanup, "PASS")
    context.diagnostic("HOSTED_LIVE_MILESTONE otherDatabaseGuard=PASS")
    stage = "UNSAFE_CATALOG"
    execute("ALTER DEFAULT PRIVILEGES FOR ROLE hrm_live_migration GRANT SELECT ON TABLES TO PUBLIC; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_live_migration IN SCHEMA public GRANT TRUNCATE,TRIGGER,REFERENCES ON TABLES TO hrm_live_other; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_live_migration IN SCHEMA public GRANT INSERT ON TABLES TO hrm_live_other WITH GRANT OPTION;")
    report = await observe(); assert.equal(report.proof.acl.publicPrivilegeRows, 1); assert.equal(report.proof.acl.nonOwnerWriteRows, 7); assert.equal(report.proof.acl.grantableRows, 1); assert.ok(report.proof.acl.entries.some(e => e.scope === "GLOBAL" && e.recipient === "OWNER")); assert.deepEqual(report.proof.acl.entries.filter(e => e.recipient === "OTHER" && ["TRUNCATE", "TRIGGER", "REFERENCES"].includes(e.privilege)).map(e => e.privilege).sort(), ["REFERENCES", "TRIGGER", "TRUNCATE"])
    context.diagnostic("HOSTED_LIVE_MILESTONE unsafeAclIsEvidenceOnly=PASS")
    stage = "RUNTIME_SET_GUARD"; execute("GRANT hrm_live_privileged TO hrm_live_runtime;")
    const denied = await inspectLiveAclRemote(sql, bindings, sha, { uid: 0, read: privateRead }); assert.equal(denied.status, "ERROR"); assert.equal(denied.code, "PROFILE_UNPROVED"); assert.equal(denied.cleanup, "PASS"); assert.equal(denied.proof, null); execute("REVOKE hrm_live_privileged FROM hrm_live_runtime;")
    context.diagnostic("HOSTED_LIVE_MILESTONE runtimeSetGuard=PASS")
    stage = "READ_ONLY_GUARD"
    const probe = { runtimeRole: "hrm_live_runtime", nonce: "hrm_loopback_acl_" + "d".repeat(32), pid: 0 }
    assert.equal((await queryLiveMigration(migration.href, "SELECT current_setting('transaction_read_only');", probe)).trim(), "on")
    await assert.rejects(queryLiveMigration(migration.href, "CREATE TABLE hrm_live_forbidden(id integer);", probe), { message: "QUERY_FAILED" }); assert.equal(execute("SELECT to_regclass('public.hrm_live_forbidden') IS NULL;").trim(), "t")
    context.diagnostic("HOSTED_LIVE_BODY=PASS")
  } catch (error) { bodyError = error; context.diagnostic("HOSTED_LIVE_BODY=FAIL stage=" + stage + " " + failureDetail(error)) }
  finally {
    if (otherDatabaseCreated) {
      try { execute("DROP DATABASE hrm_preflight_live_other;"); assert.equal(execute("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname='hrm_preflight_live_other');").trim(), "t"); context.diagnostic("HOSTED_LIVE_CLEANUP otherDatabase=PASS") }
      catch (error) { cleanupError ??= error; context.diagnostic("HOSTED_LIVE_CLEANUP otherDatabase=FAIL " + failureDetail(error)) }
    }
    const roles = [["RUNTIME", "hrm_live_runtime"], ["MIGRATION", "hrm_live_migration"], ["OTHER", "hrm_live_other"], ["PRIVILEGED", "hrm_live_privileged"]]
    for (const command of ["DROP OWNED BY", "DROP ROLE"]) for (const [slot, role] of roles) {
      const action = command === "DROP OWNED BY" ? "DROP_OWNED" : "DROP_ROLE"
      try { execute(command + " " + role + ";"); context.diagnostic("HOSTED_LIVE_CLEANUP action=" + action + " slot=" + slot + " status=PASS") }
      catch (error) { cleanupError ??= error; context.diagnostic("HOSTED_LIVE_CLEANUP action=" + action + " slot=" + slot + " status=FAIL " + failureDetail(error)) }
    }
    try { assert.ok(/^[1-9][0-9]{0,9}$/.test(migrationFixtureOid), "HOSTED_LIVE_CLEANUP_IDENTITY_UNPROVED"); assert.equal(execute("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('hrm_live_runtime','hrm_live_migration','hrm_live_other','hrm_live_privileged')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole=" + migrationFixtureOid + ");").trim(), "t"); context.diagnostic("HOSTED_LIVE_CLEANUP residue=PASS") }
    catch (error) { cleanupError ??= error; context.diagnostic("HOSTED_LIVE_CLEANUP residue=FAIL " + failureDetail(error)) }
    if (!cleanupError) context.diagnostic("HOSTED_LIVE_CLEANUP=PASS")
  }
  if (bodyError) throw bodyError
  if (cleanupError) throw cleanupError
})
