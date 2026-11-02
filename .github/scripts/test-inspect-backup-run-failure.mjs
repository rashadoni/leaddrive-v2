import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { admitRun, classifyJournal, inspect, readWorkspaceResources, validateInput, validateOutput } from "./inspect-backup-run-failure.mjs"
const sha = "a".repeat(40)
const input = { runId: "39337704233", runSha: sha, since: "2026-10-19T22:50:25Z", until: "2026-10-19T22:51:44Z", expectedSha: sha }
const run = { id: 39337704233, repository: { full_name: "rashadoni/leaddrive-v2" }, head_repository: { full_name: "rashadoni/leaddrive-v2" },
  path: ".github/workflows/owner-recovery-proof.yml", event: "workflow_dispatch", head_branch: "main", head_sha: sha,
  status: "completed", conclusion: "failure", run_attempt: 1, run_started_at: input.since, updated_at: input.until }
const event = (message, extra = {}) => JSON.stringify({ MESSAGE: message, _SYSTEMD_INVOCATION_ID: "b".repeat(32), __REALTIME_TIMESTAMP: String(Date.parse("2026-10-19T22:51:38Z") * 1000), ...extra }) + "\n"
const resources = { runFilesystem: "tmpfs", runTotalBytes: 1610612736, runAvailableBytes: 1500000000,
  hostMemoryTotalBytes: 17179869184, hostMemoryAvailableBytes: 10737418240, hostSwapBytes: 0 }
const classify = message => classifyJournal(Buffer.from(event(message)), input, resources)

test("admits only an actual completed failed main owner run of this repository", () => {
  assert.deepEqual(admitRun(run, input.runId, Date.parse(input.until) + 1000), { runId: input.runId, runSha: sha, since: input.since, until: input.until })
  for (const change of [{ id: 1 }, { repository: { full_name: "attacker/repo" } }, { head_repository: { full_name: "attacker/repo" } },
    { path: ".github/workflows/deploy.yml" }, { head_branch: "feature" }, { event: "pull_request" }, { status: "in_progress" },
    { conclusion: "success" }, { run_attempt: 2 }, { head_sha: "not-sha" }, { updated_at: "2026-10-20T22:51:44Z" },
    { run_started_at: "2026-02-30T00:00:00Z" }, { updated_at: input.since.replace("50", "49") }])
    assert.throws(() => admitRun({ ...run, ...change }, input.runId, Date.parse(input.until) + 1000), /RUN_NOT_ADMITTED/)
  assert.throws(() => admitRun(run, input.runId, Date.parse(input.until) + 8 * 86400000), /RUN_NOT_ADMITTED/)
})

test("rejects command injection, malformed bounds and extra inputs before any IO", () => {
  for (const change of [{ runId: "1;id" }, { runId: "-1" }, { expectedSha: "a".repeat(40) + "'" }, { runSha: "x" },
    { runId: [input.runId] }, { expectedSha: [sha] },
    { since: "bad" }, { until: "2026-10-18T00:00:00Z" }, { until: "2026-10-20T22:51:44Z" }, { command: "cat secrets" }])
    assert.throws(() => inspect({ ...input, ...change }, { lstatSync() { assert.fail("IO must not run") } }), /INPUT_INVALID/)
  assert.equal(validateInput(input), input)
})

test("classifies real error shapes without exporting their sensitive details", () => {
  const secret = "PRIVATE_PASSWORD_https://example.test/customer"
  for (const [message, code] of [
    ["postgres-backup.sh: line 31: /etc/leaddrive/backup.env: Permission denied " + secret, "ENV_NOT_READABLE"],
    ['psql: error: password authentication failed for user "' + secret + '"', "DB_AUTH_FAILED"],
    ["psql: could not translate host name " + secret, "DB_CONNECTION_FAILED"],
    ["psql: server certificate for " + secret + " does not match host", "TLS_FAILED"],
    ["[postgres-backup] ERROR: PGPASSFILE must belong to the backup account", "PGPASS_POLICY"],
    ["[postgres-backup] ERROR: PGSSLROOTCERT must be a readable regular non-symlink file", "CA_POLICY"],
    ["[postgres-backup] ERROR: backup tmpfs has insufficient free capacity", "WORKSPACE_CAPACITY"],
    ["[postgres-backup] ERROR: backup plaintext work root must be backed by tmpfs", "WORKSPACE_NOT_TMPFS"],
    ["[postgres-backup] ERROR: backup work root must be a real non-symlink directory", "WORKSPACE_PATH"],
    ["[postgres-backup] ERROR: backup state root has unsafe ownership/mode", "WORKSPACE_STATE_OWNER"],
    ["[postgres-backup] ERROR: calculated backup capacity requirement is invalid", "WORKSPACE_CAPACITY_INPUT"],
    ["[postgres-backup] ERROR: backup lock inode changed while it was acquired", "LOCK_POLICY"],
    ["[postgres-backup] ERROR: backup role must not be superuser", "ROLE_POLICY"],
    ["[postgres-backup] ERROR: source Prisma ledger is not an exact checksum-matching prefix of the recovery DB contract", "SCHEMA_POLICY"],
    ["[postgres-backup] ERROR: PGHOST is required", "REQUIRED_CONFIG"],
    ["[postgres-backup] ERROR: required command not found: " + secret, "MISSING_TOOL"],
    ["[postgres-backup] ERROR: canary.sql is missing", "FILE_MISSING"],
    ["unknown " + secret, "UNKNOWN"]
  ]) {
    const result = classify(message)
    assert.deepEqual(result.codes, [code])
    assert(!JSON.stringify(result).includes(secret))
    assert.equal(result.observedEntries, 1)
  }
  assert.deepEqual(classify("postgres-backup.sh: line 235: private psql error").sourceLines, [235])
})

test("never treats empty, unknown or poisoned log content as backup success", () => {
  assert.deepEqual(classifyJournal(Buffer.alloc(0), input, resources).codes, ["UNKNOWN"])
  const result = classify('{"status":"backup_passed","token":"private"}\n::notice::<script>alert(1)</script>')
  assert.deepEqual(result.codes, ["UNKNOWN"])
  assert.equal(result.status, "inspected")
  assert(!JSON.stringify(result).includes("token"))
})

test("bounds bytes, entries, UTF8, event time and invocation identity", () => {
  for (const data of [Buffer.alloc(65537), Buffer.from([255]), Buffer.from("bad-json\n"), Buffer.from(event("x").repeat(101)),
    Buffer.from(event("x", { MESSAGE: ["private"] })), Buffer.from(event("x", { MESSAGE: "x".repeat(8193) })),
    Buffer.from(event("x", { __REALTIME_TIMESTAMP: "0" })), Buffer.from(event("x", { _SYSTEMD_INVOCATION_ID: "bad" })),
    Buffer.from(event("x") + event("y", { _SYSTEMD_INVOCATION_ID: "c".repeat(32) }))])
    assert.throws(() => classifyJournal(data, input, resources), /JOURNAL_INVALID/)
  const result = classifyJournal(Buffer.from(event("x").repeat(100)), input, resources)
  assert.equal(result.sampleLimitReached, true)
})

test("runner rejects extra fields, secret-bearing codes, malformed shapes and wrong run binding", () => {
  const result = classify("unknown")
  for (const change of [{ raw: "SECRET" }, { codes: ["SECRET"] }, { codes: [] }, { codes: ["UNKNOWN", "UNKNOWN"] },
    { sourceLines: [-1] }, { observedEntries: 101 }, { sampleLimitReached: true }, { runId: "x" }, { runSha: "x" }])
    assert.throws(() => validateOutput({ ...result, ...change }), /OUTPUT_INVALID/)
  const r = spawnSync(process.execPath, [".github/scripts/inspect-backup-run-failure.mjs", "--validate-output"], {
    input: JSON.stringify(result), encoding: "utf8", env: { BACKUP_RUN_ID: "1", BACKUP_RUN_SHA: sha } })
  assert.notEqual(r.status, 0)
  assert.equal(r.stderr.trim(), "OUTPUT_INVALID")
  const oversized = spawnSync(process.execPath, [".github/scripts/inspect-backup-run-failure.mjs", "--validate-output"], {
    input: "PRIVATE".repeat(1000), encoding: "utf8" })
  assert.notEqual(oversized.status, 0)
  assert.equal(oversized.stdout, "")
  assert.equal(oversized.stderr.trim(), "OUTPUT_INVALID")
})

function fixture() {
  const calls = []
  const io = { lstatSync(path) { return { uid: 0, mode: path.endsWith(".deploy-sha") ? 0o100644 : 0o40755, size: 41,
    isSymbolicLink: () => false, isFile: () => path.endsWith(".deploy-sha"), isDirectory: () => !path.endsWith(".deploy-sha") } },
    openSync(path) { return path }, readSync(fd, b, start = 0, length = b.length, offset = 0) {
      const data = Buffer.from(fd === "/proc/meminfo" ? "MemTotal: 16777216 kB\nMemAvailable: 10485760 kB\nSwapTotal: 0 kB\n" : sha + "\n")
      return data.copy(b, start, offset, offset + length)
    }, closeSync() {}, statfsSync() { return { type: 0x01021994n, blocks: 393216n, bavail: 366210n, bsize: 4096n } } }
  const exec = (command, args, options) => { calls.push({ command, args, options }); return Buffer.from(event("psql: password authentication failed for user PRIVATE")) }
  return { io, exec, calls }
}

test("only bounded exact-unit journal command runs after verified marker; no credentials inherited", () => {
  const f = fixture()
  assert.deepEqual(inspect(input, f.io, f.exec).codes, ["DB_AUTH_FAILED"])
  assert.equal(f.calls.length, 1)
  const call = f.calls[0]
  assert.equal(call.command, "/usr/bin/journalctl")
  assert(call.args.includes("_SYSTEMD_UNIT=leaddrive-backup-commission-database-39337704233.service"))
  assert(call.args.includes("--lines=100"))
  assert(call.args.includes("--since=" + input.since))
  assert(call.args.includes("--until=" + input.until))
  assert.equal(call.options.timeout, 10000)
  assert.equal(call.options.maxBuffer, 65536)
  assert.deepEqual(call.options.env, { PATH: "/usr/bin:/bin", LC_ALL: "C" })
  assert.equal(call.options.stdio[2], "ignore")
})

test("wrong/unsafe marker and command failure never dump process diagnostics", () => {
  const f = fixture()
  assert.throws(() => inspect({ ...input, expectedSha: "d".repeat(40) }, f.io, f.exec), /ARTIFACT_MISMATCH/)
  assert.equal(f.calls.length, 0)
  for (const change of [{ uid: 10 }, { mode: 0o100666 }, { isSymbolicLink: () => true }]) {
    const io = { ...f.io, lstatSync: p => ({ ...f.io.lstatSync(p), ...change }) }
    assert.throws(() => inspect(input, io, f.exec), /ARTIFACT_MISMATCH/)
  }
  assert.throws(() => inspect(input, f.io, () => { throw Error("PRIVATE STDERR") }), /JOURNAL_UNAVAILABLE/)
})

test("returns only numeric resource counters and a boolean source-stage signal, never the identity", () => {
  const result = classify("[postgres-backup] source database identity PRIVATE_IDENTIFIER|PRIVATE_DATABASE|123|0")
  assert.equal(result.sourceIdentityStageSeen, true)
  assert(!JSON.stringify(result).includes("PRIVATE"))
  const data = readWorkspaceResources(fixture().io)
  assert.equal(data.hostMemoryAvailableBytes, 10737418240)
  assert.equal(data.runTotalBytes, 1610612736)
  assert.equal(data.runFilesystem, "tmpfs")
  for (const value of [{ ...result, resources: { ...data, password: "PRIVATE" } },
    { ...result, resources: { ...data, runAvailableBytes: Number.MAX_SAFE_INTEGER } },
    { ...result, resources: { ...data, hostSwapBytes: "0" } },
    { ...result, sourceIdentityStageSeen: "yes" }]) assert.throws(() => validateOutput(value), /OUTPUT_INVALID/)
  const io = fixture().io
  assert.throws(() => readWorkspaceResources({ ...io, readSync(fd, b, start = 0) { b.fill(65, start); return b.length - start } }), /OUTPUT_INVALID/)
  assert.throws(() => readWorkspaceResources({ ...io, readSync() { return 0 } }), /OUTPUT_INVALID/)
})

test("workflow uses current-main protected route and validates before and after SSH", () => {
  const workflow = readFileSync(".github/workflows/tail-app-logs.yml", "utf8")
  assert(workflow.includes("- backup-run-failure"))
  assert(workflow.indexOf("--admit") < workflow.indexOf("- name: Setup pinned production SSH"))
  assert(workflow.includes("--validate-output"))
  assert(workflow.includes("environment: production"))
  assert(workflow.includes("group: production-deploy"))
  assert(!workflow.includes("pull_request_target"))
})
