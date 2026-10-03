import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { countMatchingInfo, inspectReadiness, parseProcStat, parseStartupEnvironment, readCurrentProcess, readRuntime, readSafeFile, safeMetadata, validateReadinessOutput, validateRuntime } from "./inspect-support-ux-readiness.mjs"

const root = "/opt/leaddrive-v2/.next/standalone"
const logs = "/var/lib/leaddrive-v2-logs"
const pids = "/root/.pm2/pids"
const sha = "a".repeat(40)
const utc = "2020-01-01T09:00:00.000Z"
const builtAt = "2020-01-01T00:00:00Z"
const runtime = { artifactSha: sha, builtAt }
const context = { artifactSha: sha, pid: 42, startedAtUtc: "2020-01-01T00:00:01.000Z", infoNotBeforeUtc: "2020-01-01T00:00:02.000Z", observedAtUtc: utc }
function event(overrides = {}) { return { event: "support_ux_observation", schema_version: 1, observed_at_utc: "2020-01-01T08:00:00.000Z", artifact_sha: sha, tenant_key: "b".repeat(64), operation: "CATEGORY_LIST", mode: "database", http_status: 200, outcome: "success", duration_ms: 5, level: 30, time: Date.parse("2020-01-01T08:00:00.001Z"), pid: 42, hostname: "PRIVATE_HOST", msg: "support ux observation", ...overrides } }
const line = (overrides = {}) => "2020-01-01 08:00:00 +00:00: " + JSON.stringify(event(overrides)) + "\n"
function startup(overrides = {}) { return Buffer.from(Object.entries({ name: "leaddrive-v2", pm_exec_path: root + "/server.js", pm_cwd: root, pm_out_log_path: logs + "/out.log", NODE_ENV: "production", LOG_LEVEL: "info", PRIVATE_KEY: "PRIVATE_ENV", ...overrides }).map(([k, v]) => k + "=" + v).join("\0") + "\0") }
function statText(pid = 42, ticks = "100") { const fields = Array(50).fill("0"); fields[0] = "S"; fields[19] = ticks; return pid + " (node) " + fields.join(" ") }

// In-memory root-owned filesystem, with real read/open positions and inode/stat
// changes. No process, PM2, HTTP or production filesystem access in these tests.
function fixture() {
  const files = new Map(); let inode = 1n; const descriptors = new Map(); let fd = 1
  const metadata = (kind, data = Buffer.alloc(0)) => ({ kind, data, dev: 1n, ino: inode++, size: BigInt(data.length), mtimeNs: 1577865600000000000n, ctimeNs: 1577865600000000000n, mtimeMs: 1577865600000n, uid: 0n, mode: kind === "directory" ? 0o40750n : 0o100644n, isSymbolicLink() { return this.kind === "symlink" }, isFile() { return this.kind === "file" }, isDirectory() { return this.kind === "directory" } })
  function add(file, data, kind = "file") {
    const parts = file.split("/").filter(Boolean)
    for (let i = 0; i < parts.length; i++) { const parent = "/" + parts.slice(0, i).join("/"); if (!files.has(parent)) files.set(parent, metadata("directory")) }
    files.set(file, metadata(kind, Buffer.isBuffer(data) ? data : Buffer.from(data)))
  }
  add(pids + "/leaddrive-v2-0.pid", "42\n")
  add("/proc/42/stat", statText())
  add("/proc/42/environ", startup())
  add("/proc/sys/kernel/random/boot_id", "00000000-0000-0000-0000-000000000000\n")
  add("/proc/stat", "cpu 1 2 3\nbtime 1577836800\n")
  add("/usr/bin/node", "synthetic executable")
  add(logs + "/out.log", line())
  add(logs + "/out.log.1.gz", "not decompressed")
  add("/etc/logrotate.d/leaddrive-v2", "daily\nrotate 14\ncopytruncate\n")
  add(root + "/ops/logrotate/leaddrive-v2", "daily\nrotate 14\ncopytruncate\n")
  const io = {
    lstatSync(file) { const s = files.get(file); if (!s) throw new Error("PRIVATE_MISSING_PATH"); return { ...s } },
    openSync(file, flags) { assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); const s = files.get(file); if (!s || s.kind !== "file") throw new Error("PRIVATE_OPEN"); const n = fd++; descriptors.set(n, s); return n },
    fstatSync(n) { return { ...descriptors.get(n) } },
    readSync(n, buffer, offset, length, position) { const data = descriptors.get(n).data; const slice = data.subarray(position, position + length); slice.copy(buffer, offset); return slice.length },
    closeSync(n) { descriptors.delete(n) },
    opendirSync(directory) { const entries = [...files.keys()].filter((p) => path.dirname(p) === directory && p !== directory).map((p) => ({ name: path.basename(p) })); let index = 0; return { readSync() { return entries[index++] ?? null }, closeSync() {} } },
    readlinkSync(file) { if (file === "/proc/42/cwd") return root; if (file === "/proc/42/exe") return "/usr/bin/node"; throw new Error("PRIVATE_LINK") },
  }
  const process = () => readCurrentProcess(io, (command, args, options) => { assert.equal(command, "getconf"); assert.deepEqual(args, ["CLK_TCK"]); assert.equal(options.timeout, 1000); return "100\n" })
  return { files, io, process, add, inspect: (overrides = {}) => inspectReadiness({ io, process, runtime: async () => runtime, now: () => utc, ...overrides }) }
}

test("stable snapshot observes only matching INFO and retains all longitudinal fields UNVERIFIED", async () => {
  const report = await fixture().inspect()
  assert.equal(report.logs.infoEventCount, 1)
  assert.equal(report.logs.latestInfoAtUtc, "2020-01-01T08:00:00.000Z")
  assert.equal(report.logs.logrotateMatchesArtifact, true)
  assert.equal(report.process.startedAtUtc, context.startedAtUtc)
  for (const key of ["effectiveInfo", "fullDayRetention", "processContinuityCoverage"]) assert.equal(report[key], "UNVERIFIED")
  assert.equal(report.process.restartCount, "UNVERIFIED")
  assert.equal(report.observationAdmitted, false)
  assert.deepEqual(report.logs.sources.map((s) => s.name), ["out.log", "out.log.1.gz"])
  const output = JSON.stringify(report)
  for (const privateValue of ["PRIVATE_ENV", "PRIVATE_KEY", "PRIVATE_HOST", "tenant_key", "b".repeat(64), "00000000-0000-0000-0000-000000000000", "signature"]) assert.equal(output.includes(privateValue), false)
})

test("startup metadata validates identity, strips unrelated environment and never claims running Pino state", () => {
  assert.deepEqual(parseStartupEnvironment(startup()), { startupLogLevel: "info" })
  assert.deepEqual(parseStartupEnvironment(startup({ LOG_LEVEL: "" })), { startupLogLevel: "unset" })
  assert.deepEqual(parseStartupEnvironment(startup({ LOG_LEVEL: "PRIVATE_LEVEL" })), { startupLogLevel: "unrecognized" })
  for (const overrides of [{ name: "another-app" }, { pm_cwd: "/other" }, { pm_out_log_path: "/other" }, { NODE_ENV: "development" }, { pm_exec_path: "/other" }]) assert.throws(() => parseStartupEnvironment(startup(overrides)), /PROCESS_UNVERIFIED/)
  assert.throws(() => parseStartupEnvironment(Buffer.concat([startup(), Buffer.from("LOG_LEVEL=warn\0")])), /PROCESS_UNVERIFIED/)
  assert.throws(() => parseStartupEnvironment(Buffer.alloc(65537)), /PROCESS_UNVERIFIED/)
})

test("bounded pidfile/proc discovery rejects ambiguity, stale identities and unsafe executables without PM2", () => {
  const f = fixture()
  assert.equal(f.process().pid, 42)
  f.add(pids + "/leaddrive-v2-1.pid", "43\n")
  assert.throws(f.process, /PROCESS_UNVERIFIED/)
  f.files.delete(pids + "/leaddrive-v2-1.pid")
  f.add(pids + "/leaddrive-v2-0.pid", "0\n")
  assert.throws(f.process, /PROCESS_UNVERIFIED/)
  assert.throws(() => parseProcStat(statText(43), 42), /PROCESS_UNVERIFIED/)
  assert.throws(() => parseProcStat(statText().replace(" S ", " Z "), 42), /PROCESS_UNVERIFIED/)
  assert.throws(() => parseProcStat("x".repeat(4097), 42), /PROCESS_UNVERIFIED/)
})

test("zero stat-size proc files are still read with the fixed byte bounds", () => {
  const f = fixture()
  for (const [name, file] of f.files) if (name.startsWith("/proc/") && file.kind === "file") file.size = 0n
  assert.equal(f.process().startedAtUtc, context.startedAtUtc)
  assert.equal(f.process().infoNotBeforeUtc, context.infoNotBeforeUtc)
  assert.equal(f.process().startupLogLevel, "info")
})

test("wrong pid/SHA, stale/future timestamps and non-INFO records are not counted", () => {
  const bytes = Buffer.from(line() + line({ pid: 43 }) + line({ artifact_sha: "c".repeat(40) }) + line({ observed_at_utc: "2020-01-01T00:00:00.000Z" }) + line({ observed_at_utc: "2020-01-02T00:00:00.000Z" }) + line({ time: Date.parse("2020-01-02T00:00:00Z") }) + line({ level: 20 }))
  assert.deepEqual(countMatchingInfo(bytes, false, context), { count: 1, latestAtUtc: "2020-01-01T08:00:00.000Z" })
  assert.deepEqual(countMatchingInfo(Buffer.from(line({ pid: 43 })), false, context), { count: 0, latestAtUtc: null })
})

test("INFO lower bound omits uncertain first second at a reused PID's estimated start", () => {
  const before = line({ observed_at_utc: "2020-01-01T00:00:01.999Z", time: Date.parse("2020-01-01T00:00:02.000Z") })
  const at = line({ observed_at_utc: context.infoNotBeforeUtc, time: Date.parse(context.infoNotBeforeUtc) })
  assert.deepEqual(countMatchingInfo(Buffer.from(before + at), false, context), { count: 1, latestAtUtc: context.infoNotBeforeUtc })
  assert.throws(() => countMatchingInfo(Buffer.from(at), false, { ...context, infoNotBeforeUtc: context.startedAtUtc }), /INPUT_INVALID/)
})

test("malformed INFO cannot pass schema, outcome or privacy rules", () => {
  for (const change of [{ level: "30" }, { pid: "42" }, { artifact_sha: [sha] }, { duration_ms: 600001 }, { operation: "PRIVATE_OPERATION" }, { observed_at_utc: "2020-02-30T08:00:00.000Z" }, { http_status: 500 }, { body: "PRIVATE_BODY" }, { tenant_key: "invalid" }, { hostname: null }, { schema_version: 2 }]) assert.throws(() => countMatchingInfo(Buffer.from(line(change)), false, context), /EVENT_INVALID/)
  assert.throws(() => countMatchingInfo(Buffer.from('{"event":"support_ux_observation",broken\n'), false, context), /EVENT_INVALID/)
})

test("partial head/tail and split UTF8 are discarded before decoding; only complete bounded lines count", () => {
  const bytes = Buffer.concat([Buffer.from([0xff]), Buffer.from("partial\n" + line() + line().trimEnd())])
  assert.equal(countMatchingInfo(bytes, true, context).count, 1)
  assert.deepEqual(countMatchingInfo(Buffer.from(line().trimEnd()), false, context), { count: 0, latestAtUtc: null })
  assert.equal(countMatchingInfo(Buffer.from(line() + line()), true, context).count, 1)
  assert.throws(() => countMatchingInfo(Buffer.alloc(1048577), false, context), /INPUT_INVALID/)
})

test("root ownership, writable directories/files, symlinks and bounded reads fail closed", () => {
  const f = fixture()
  for (const field of [{ uid: 1n }, { mode: 0o100666n }, { kind: "symlink" }, { kind: "directory" }]) {
    const old = f.files.get(logs + "/out.log"); f.files.set(logs + "/out.log", { ...old, ...field })
    assert.throws(() => safeMetadata(logs + "/out.log", false, f.io), /FILES_UNSAFE/)
    f.files.set(logs + "/out.log", old)
  }
  const old = f.files.get(logs); f.files.set(logs, { ...old, mode: 0o40777n })
  assert.throws(() => readSafeFile(logs + "/out.log", 1024, f.io), /FILES_UNSAFE/)
  f.files.set(logs, old)
  assert.throws(() => readSafeFile(logs + "/out.log", 1, f.io), /FILES_UNSAFE/)
  assert.throws(() => readSafeFile(logs + "/out.log", 1048577, f.io), /INPUT_INVALID/)
})

test("real filesystem symlinks and a write during read are rejected", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "support-readiness-test-"))
  try {
    const file = path.join(directory, "file"); fs.writeFileSync(file, "before\n"); fs.symlinkSync(file, path.join(directory, "link"))
    // Only ownership/mode emulate root; inode, timestamps, descriptors and
    // symlink behavior come from the real filesystem.
    const rootInfo = (s) => { s.uid = 0n; s.mode &= ~0o022n; return s }
    const io = { ...fs, lstatSync: (...args) => rootInfo(fs.lstatSync(...args)), fstatSync: (...args) => rootInfo(fs.fstatSync(...args)) }
    assert.throws(() => readSafeFile(path.join(directory, "link"), 64, io), /FILES_UNSAFE/)
    assert.equal(readSafeFile(file, 64, io).data.toString(), "before\n")
    let changed = false
    io.readSync = (...args) => { const result = fs.readSync(...args); if (!changed) { changed = true; fs.writeFileSync(file, "after longer\n") } return result }
    assert.throws(() => readSafeFile(file, 64, io), /SOURCE_CHANGED/)
  } finally { fs.rmSync(directory, { recursive: true }) }
})

test("inode replacement between lstat and open is rejected", () => {
  const f = fixture(); const open = f.io.openSync
  f.io.openSync = (file, flags) => { if (file === logs + "/out.log") f.add(file, line()); return open(file, flags) }
  assert.throws(() => readSafeFile(logs + "/out.log", 1024, f.io), /SOURCE_CHANGED/)
})

test("changed PID/start, startup environment, cwd, clock mapping, runtime and files invalidate the probe", async () => {
  for (const changed of ["process", "pid", "environment", "cwd", "clock", "runtime", "log", "rotation", "authority"]) {
    const f = fixture(); let calls = 0
    const runtimeFn = async () => { calls++; if (calls === 2) {
      if (changed === "process") f.add("/proc/42/stat", statText(42, "200"))
      if (changed === "pid") f.add(pids + "/leaddrive-v2-0.pid", "43\n")
      if (changed === "environment") f.add("/proc/42/environ", startup({ LOG_LEVEL: "warn" }))
      if (changed === "cwd") f.io.readlinkSync = () => "/other"
      if (changed === "clock") f.add("/proc/stat", "cpu 1 2 3\nbtime 1577836801\n")
      if (changed === "log") f.add(logs + "/out.log", line() + line())
      if (changed === "rotation") f.add(logs + "/out.log.2.gz", "new rotation")
      if (changed === "authority") f.add("/etc/logrotate.d/leaddrive-v2", "changed")
      if (changed === "runtime") return { ...runtime, artifactSha: "c".repeat(40) }
    } return runtime }
    await assert.rejects(f.inspect({ runtime: runtimeFn }), /SOURCE_CHANGED|PROCESS_UNVERIFIED|PRIVATE_MISSING_PATH/)
  }
})

test("HTTP uses fixed localhost, bounded whole-body deadline and rejects redirect/oversize/aborted bodies", async () => {
  for (const scenario of ["success", "redirect", "cache", "oversize", "aborted", "timeout", "invalid"]) {
    let cleared = false; let timeout; let requestDestroyed = false
    const get = (options, callback) => {
      assert.deepEqual(options, { hostname: "127.0.0.1", port: 3001, path: "/api/v1/public/build-info", headers: { Accept: "application/json" }, agent: false })
      const request = new EventEmitter(); request.destroy = () => { requestDestroyed = true }
      queueMicrotask(() => {
        const response = new EventEmitter(); response.destroy = () => {}; response.statusCode = scenario === "redirect" ? 302 : 200
        response.headers = { "cache-control": scenario === "cache" ? "public" : "no-store" }; response.complete = false
        callback(response)
        if (scenario === "redirect" || scenario === "cache") return
        request.emit("close") // headers/request closure must not cancel body deadline
        assert.equal(cleared, false)
        if (scenario === "timeout") { timeout(); return }
        if (scenario === "aborted") { response.emit("aborted"); return }
        response.emit("data", Buffer.from(scenario === "oversize" ? "x".repeat(4097) : scenario === "invalid" ? "PRIVATE_BODY" : JSON.stringify({ sha: sha.slice(0, 12), artifactSha: sha, builtAt })))
        response.complete = true; response.emit("end")
      })
      return request
    }
    const promise = readRuntime(get, { setTimeout(callback, ms) { assert.equal(ms, 5000); timeout = callback; return 1 }, clearTimeout() { cleared = true } })
    if (scenario === "success") assert.deepEqual(await promise, runtime)
    else { await assert.rejects(promise, scenario === "invalid" ? /RUNTIME_INVALID/ : /RUNTIME_UNAVAILABLE/); assert.equal(requestDestroyed, true) }
    assert.equal(cleared, true)
  }
})

test("source bound, duplicate inode and mismatching logrotate stay honest", async () => {
  const f = fixture(); f.add("/etc/logrotate.d/leaddrive-v2", "different\n")
  assert.equal((await f.inspect()).logs.logrotateMatchesArtifact, false)
  f.files.get(logs + "/out.log.1.gz").ino = f.files.get(logs + "/out.log").ino
  await assert.rejects(f.inspect(), /FILES_UNSAFE/)
  const many = fixture()
  for (let i = 1; i <= 16; i++) many.add(logs + "/out.log-202001" + String(i).padStart(2, "0"), "rotation")
  await assert.rejects(many.inspect(), /FILES_UNSAFE/)
})

test("runtime shape and output cannot expose unknown data or grant observation admission", async () => {
  assert.deepEqual(validateRuntime({ sha: sha.slice(0, 12), artifactSha: sha, builtAt }), runtime)
  for (const change of [{ sha: "wrong" }, { artifactSha: [sha] }, { builtAt: "2020-02-30T00:00:00Z" }, { privateValue: "PRIVATE_ENV" }]) assert.throws(() => validateRuntime({ sha: sha.slice(0, 12), artifactSha: sha, builtAt, ...change }), /RUNTIME_INVALID/)
  const report = await fixture().inspect()
  for (const change of [{ observationAdmitted: true }, { effectiveInfo: "VERIFIED" }, { fullDayRetention: "VERIFIED" }, { processContinuityCoverage: "VERIFIED" }, { privateValue: "PRIVATE_ENV" }]) assert.throws(() => validateReadinessOutput({ ...report, ...change }), /OUTPUT_INVALID/)
  assert.throws(() => validateReadinessOutput({ ...report, process: { ...report.process, environment: "PRIVATE_ENV" } }), /OUTPUT_INVALID/)
  assert.throws(() => validateReadinessOutput({ ...report, logs: { ...report.logs, latestInfoAtUtc: null } }), /OUTPUT_INVALID/)
})

test("CLI validator is bounded, standalone streamable and never echoes private invalid input", async () => {
  const controller = new URL("./inspect-support-ux-readiness.mjs", import.meta.url)
  const valid = JSON.stringify(await fixture().inspect())
  const accepted = spawnSync(process.execPath, [controller.pathname, "--validate-output"], { input: valid, encoding: "utf8" })
  assert.equal(accepted.status, 0); assert.equal(JSON.parse(accepted.stdout).observationAdmitted, false)
  for (const input of [valid.slice(0, -1) + ',"PRIVATE_ENV":"PRIVATE_VALUE"}', "PRIVATE_VALUE", "x".repeat(32769)]) {
    const result = spawnSync(process.execPath, [controller.pathname, "--validate-output"], { input, encoding: "utf8" })
    assert.equal(result.status, 1); assert.equal(result.stdout.includes("PRIVATE"), false)
    assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), ["code", "schemaVersion", "status"])
  }
  const streamed = spawnSync(process.execPath, ["--input-type=module", "-", "invalid-argument"], { input: fs.readFileSync(controller), encoding: "utf8" })
  assert.equal(streamed.status, 1); assert.deepEqual(JSON.parse(streamed.stdout), { schemaVersion: 1, status: "error", code: "INPUT_INVALID" })
})
