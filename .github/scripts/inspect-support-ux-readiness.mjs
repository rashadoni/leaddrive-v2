// Standalone, tenant-independent snapshot. Never import the app, read app.env,
// invoke PM2 (which can start its daemon), mutate files or admit observation.
import fs from "node:fs"
import http from "node:http"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const ROOT = "/opt/leaddrive-v2/.next/standalone"
const LOGS = "/var/lib/leaddrive-v2-logs"
const PIDS = "/root/.pm2/pids"
const ROTATE = "/etc/logrotate.d/leaddrive-v2"
const ARTIFACT_ROTATE = ROOT + "/ops/logrotate/leaddrive-v2"
const TAIL_BYTES = 1048576
const MAX_OUTPUT = 32768
const SHA = /^[a-f0-9]{40}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SOURCE_NAME = /^out\.log(?:\.(?:[1-9]|1[0-4])|-\d{8})?(?:\.gz)?$/
const levels = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent", "unset", "unrecognized"])
const codes = new Set(["INPUT_INVALID", "PROCESS_UNVERIFIED", "FILES_UNSAFE", "SOURCE_CHANGED", "RUNTIME_UNAVAILABLE", "RUNTIME_INVALID", "EVENT_INVALID", "OUTPUT_INVALID", "INSPECTION_FAILED"])
const fail = (code) => { throw new Error(code) }
const digest = (value) => createHash("sha256").update(value).digest("hex")
const validUtc = (value) => typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.split(",").sort().join(",")
const fingerprint = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode, s.uid].join(":")

export function safeMetadata(file, directory = false, io = fs) {
  const s = io.lstatSync(file, { bigint: true })
  if (s.isSymbolicLink() || !(directory ? s.isDirectory() : s.isFile()) || s.uid !== 0n || (s.mode & 0o022n) !== 0n || s.size < 0n || s.size > BigInt(Number.MAX_SAFE_INTEGER)) fail("FILES_UNSAFE")
  return s
}

function safeParents(file, io) {
  const parts = file.split("/").filter(Boolean)
  for (let i = 0; i < parts.length; i++) safeMetadata("/" + parts.slice(0, i).join("/"), true, io)
}

export function readSafeFile(file, limit, io = fs, tail = false) {
  if (!Number.isInteger(limit) || limit < 1 || limit > TAIL_BYTES) fail("INPUT_INVALID")
  safeParents(file, io)
  const expected = safeMetadata(file, false, io)
  let fd
  try {
    fd = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const before = io.fstatSync(fd, { bigint: true })
    if (fingerprint(before) !== fingerprint(expected)) fail("SOURCE_CHANGED")
    // proc files report size zero; bounded reads still consume their contents.
    const start = tail ? Math.max(0, Number(before.size) - limit) : 0
    const buffer = Buffer.alloc(limit + (tail ? 0 : 1))
    let length = 0
    while (length < buffer.length) {
      const count = io.readSync(fd, buffer, length, buffer.length - length, start + length)
      if (!count) break
      length += count
    }
    if (length > limit) fail("FILES_UNSAFE")
    if (fingerprint(before) !== fingerprint(io.fstatSync(fd, { bigint: true })) || fingerprint(before) !== fingerprint(safeMetadata(file, false, io))) fail("SOURCE_CHANGED")
    return { data: buffer.subarray(0, length), startsMidFile: start > 0, signature: fingerprint(before) }
  } finally { if (fd !== undefined) io.closeSync(fd) }
}

function boundedNames(directory, io) {
  const handle = io.opendirSync(directory)
  const names = []
  try {
    let entry
    while ((entry = handle.readSync())) {
      if (names.length >= 64 || entry.name.length > 128) fail("FILES_UNSAFE")
      names.push(entry.name)
    }
  } finally { handle.closeSync() }
  return names.sort()
}

export function parseProcStat(text, pid) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 4096 || !Number.isInteger(pid) || pid < 1 || !text.startsWith(pid + " (")) fail("PROCESS_UNVERIFIED")
  const end = text.lastIndexOf(") ")
  const fields = text.slice(end + 2).trim().split(/\s+/)
  if (end < 0 || !/^[RSID]$/.test(fields[0]) || !/^\d{1,20}$/.test(fields[19] ?? "")) fail("PROCESS_UNVERIFIED")
  return fields[19]
}

export function parseStartupEnvironment(data) {
  if (!Buffer.isBuffer(data) || data.length > 65536 || data.length === 0 || data.at(-1) !== 0) fail("PROCESS_UNVERIFIED")
  const allowed = new Set(["name", "pm_exec_path", "pm_cwd", "pm_out_log_path", "NODE_ENV", "LOG_LEVEL"])
  const values = {}
  for (const line of new TextDecoder("utf-8", { fatal: true }).decode(data).split("\0")) {
    const at = line.indexOf("="); const key = line.slice(0, at)
    if (at < 1 || !allowed.has(key)) continue
    if (Object.hasOwn(values, key)) fail("PROCESS_UNVERIFIED")
    values[key] = line.slice(at + 1)
  }
  if (values.name !== "leaddrive-v2" || values.pm_exec_path !== ROOT + "/server.js" || values.pm_cwd !== ROOT || values.pm_out_log_path !== LOGS + "/out.log" || values.NODE_ENV !== "production") fail("PROCESS_UNVERIFIED")
  return { startupLogLevel: values.LOG_LEVEL ? levels.has(values.LOG_LEVEL) && !["unset", "unrecognized"].includes(values.LOG_LEVEL) ? values.LOG_LEVEL : "unrecognized" : "unset" }
}

export function readCurrentProcess(io = fs, exec = execFileSync) {
  safeParents(PIDS + "/placeholder", io)
  const directory = safeMetadata(PIDS, true, io)
  const names = boundedNames(PIDS, io).filter((name) => /^leaddrive-v2-[0-9]{1,5}\.pid$/.test(name))
  if (names.length !== 1) fail("PROCESS_UNVERIFIED")
  const pidFile = readSafeFile(PIDS + "/" + names[0], 32, io)
  const literal = pidFile.data.toString("ascii").trim()
  if (!/^[1-9][0-9]{0,8}$/.test(literal)) fail("PROCESS_UNVERIFIED")
  const pid = Number(literal); const proc = "/proc/" + pid
  safeMetadata(proc, true, io)
  const ticks = parseProcStat(readSafeFile(proc + "/stat", 4096, io).data.toString("utf8"), pid)
  const boot = readSafeFile("/proc/sys/kernel/random/boot_id", 64, io).data.toString("ascii").trim()
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(boot)) fail("PROCESS_UNVERIFIED")
  const cwd = io.readlinkSync(proc + "/cwd"); const executable = io.readlinkSync(proc + "/exe")
  if (cwd !== ROOT || !executable.startsWith("/") || !executable.endsWith("/node")) fail("PROCESS_UNVERIFIED")
  safeParents(executable, io); safeMetadata(executable, false, io)
  const environment = readSafeFile(proc + "/environ", 65536, io).data
  const startup = parseStartupEnvironment(environment)
  const hz = exec("getconf", ["CLK_TCK"], { timeout: 1000, maxBuffer: 128, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"] }).trim()
  const bootTime = readSafeFile("/proc/stat", 65536, io).data.toString("ascii").match(/^btime ([0-9]{1,12})$/m)?.[1]
  if (!/^[1-9][0-9]{0,5}$/.test(hz) || !bootTime) fail("PROCESS_UNVERIFIED")
  const startedMs = Number(bootTime) * 1000 + Number(ticks) * 1000 / Number(hz)
  if (!Number.isSafeInteger(Math.floor(startedMs)) || startedMs < 0) fail("PROCESS_UNVERIFIED")
  const startedAtUtc = new Date(Math.floor(startedMs)).toISOString()
  // btime has one-second precision: omit that first estimated second to avoid
  // counting an old reused PID's event near the kernel-derived start boundary.
  const infoNotBeforeUtc = new Date(Math.floor(startedMs) + 1000).toISOString()
  const identitySha256 = digest(boot + ":" + pid + ":" + ticks)
  return { pid, identitySha256, startedAtUtc, infoNotBeforeUtc, ...startup, restartCount: "UNVERIFIED", signature: JSON.stringify([fingerprint(directory), names[0], pidFile.signature, identitySha256, startedAtUtc, infoNotBeforeUtc, cwd, executable, digest(environment)]) }
}

export function validateRuntime(value) {
  if (!exactKeys(value, "sha,artifactSha,builtAt") || typeof value.artifactSha !== "string" || !SHA.test(value.artifactSha) || value.sha !== value.artifactSha.slice(0, 12) || typeof value.builtAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.builtAt) || !Number.isFinite(Date.parse(value.builtAt)) || new Date(value.builtAt).toISOString().replace(".000Z", "Z") !== value.builtAt) fail("RUNTIME_INVALID")
  return { artifactSha: value.artifactSha, builtAt: value.builtAt }
}

export function readRuntime(get = http.get, timers = { setTimeout, clearTimeout }) {
  return new Promise((resolve, reject) => {
    let request; let timer; let finished = false
    const finish = (code, value) => {
      if (finished) return
      finished = true
      if (timer !== undefined) timers.clearTimeout(timer)
      if (code) { request?.destroy(); reject(new Error(code)) } else resolve(value)
    }
    try { request = get({ hostname: "127.0.0.1", port: 3001, path: "/api/v1/public/build-info", headers: { Accept: "application/json" }, agent: false }, (response) => {
      let bytes = 0; const chunks = []
      response.on("error", () => finish("RUNTIME_UNAVAILABLE"))
      response.on("aborted", () => finish("RUNTIME_UNAVAILABLE"))
      response.on("close", () => { if (!response.complete) finish("RUNTIME_UNAVAILABLE") })
      if (response.statusCode !== 200 || !String(response.headers["cache-control"] ?? "").split(",").some((v) => v.trim() === "no-store")) { response.destroy(); finish("RUNTIME_UNAVAILABLE"); return }
      response.on("data", (chunk) => { if (finished) return; if (!Buffer.isBuffer(chunk) || (bytes += chunk.length) > 4096) finish("RUNTIME_UNAVAILABLE"); else chunks.push(chunk) })
      response.on("end", () => { if (!response.complete) { finish("RUNTIME_UNAVAILABLE"); return } try { finish(null, validateRuntime(JSON.parse(Buffer.concat(chunks).toString("utf8")))) } catch { finish("RUNTIME_INVALID") } })
    }) } catch { finish("RUNTIME_UNAVAILABLE"); return }
    if (!finished) timer = timers.setTimeout(() => finish("RUNTIME_UNAVAILABLE"), 5000)
    request.on("error", () => finish("RUNTIME_UNAVAILABLE"))
  })
}

export function countMatchingInfo(data, startsMidFile, { artifactSha, pid, startedAtUtc, infoNotBeforeUtc, observedAtUtc }) {
  if (!Buffer.isBuffer(data) || data.length > TAIL_BYTES || typeof startsMidFile !== "boolean" || typeof artifactSha !== "string" || !SHA.test(artifactSha) || !Number.isInteger(pid) || pid < 1 || !validUtc(startedAtUtc) || !validUtc(infoNotBeforeUtc) || Date.parse(infoNotBeforeUtc) !== Date.parse(startedAtUtc) + 1000 || !validUtc(observedAtUtc) || infoNotBeforeUtc > observedAtUtc) fail("INPUT_INVALID")
  let start = 0
  if (startsMidFile) { start = data.indexOf(10) + 1; if (!start) return { count: 0, latestAtUtc: null } }
  const end = data.lastIndexOf(10)
  if (end < start) return { count: 0, latestAtUtc: null }
  let count = 0; let latestAtUtc = null
  const keys = new Set(["event", "schema_version", "observed_at_utc", "artifact_sha", "tenant_key", "operation", "mode", "http_status", "outcome", "duration_ms", "level", "time", "pid", "hostname", "msg"])
  for (const line of new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(start, end)).split("\n")) {
    if (!line.includes('"support_ux_observation"')) continue
    let event
    try { event = JSON.parse(line.slice(line.indexOf("{"))) } catch { fail("EVENT_INVALID") }
    if (!event || typeof event !== "object" || Array.isArray(event) || Object.keys(event).some((key) => !keys.has(key)) || event.event !== "support_ux_observation" || event.schema_version !== 1 || !validUtc(event.observed_at_utc) || typeof event.artifact_sha !== "string" || !SHA.test(event.artifact_sha) || typeof event.tenant_key !== "string" || !/^[a-f0-9]{64}$/.test(event.tenant_key) || !["CATEGORY_LIST", "CATEGORY_CREATE", "CATEGORY_RENAME", "CATEGORY_DELETE"].includes(event.operation) || !["database", "browser", "unverified"].includes(event.mode) || !Number.isInteger(event.duration_ms) || event.duration_ms < 0 || event.duration_ms > 600000 || !Number.isInteger(event.pid) || event.pid < 1 || !Number.isInteger(event.level) || !Number.isSafeInteger(event.time) || typeof event.hostname !== "string" || event.msg !== "support ux observation") fail("EVENT_INVALID")
    const outcome = event.http_status === null ? "thrown" : Number.isInteger(event.http_status) && event.http_status >= 200 && event.http_status < 300 ? "success" : Number.isInteger(event.http_status) && event.http_status >= 400 && event.http_status < 500 ? "client_rejection" : Number.isInteger(event.http_status) && event.http_status >= 500 && event.http_status < 600 ? "server_error" : null
    if (!outcome || event.outcome !== outcome) fail("EVENT_INVALID")
    if (event.level !== 30 || event.pid !== pid || event.artifact_sha !== artifactSha || event.observed_at_utc < infoNotBeforeUtc || event.observed_at_utc > observedAtUtc || event.time < Date.parse(infoNotBeforeUtc) || event.time > Date.parse(observedAtUtc)) continue
    count += 1
    if (latestAtUtc === null || event.observed_at_utc > latestAtUtc) latestAtUtc = event.observed_at_utc
  }
  return { count, latestAtUtc }
}

function sourcesSnapshot(io) {
  safeParents(LOGS + "/out.log", io)
  const directory = safeMetadata(LOGS, true, io)
  const names = boundedNames(LOGS, io).filter((name) => SOURCE_NAME.test(name))
  if (names.length < 1 || names.length > 16 || !names.includes("out.log")) fail("FILES_UNSAFE")
  const identities = new Set()
  const signatures = []
  const sources = names.map((name) => {
    const s = safeMetadata(LOGS + "/" + name, false, io); const identity = s.dev + ":" + s.ino
    if (identities.has(identity)) fail("FILES_UNSAFE")
    identities.add(identity)
    signatures.push(fingerprint(s))
    return { name, bytes: Number(s.size), modifiedAtUtc: new Date(Number(s.mtimeMs)).toISOString() }
  })
  return { sources, signature: JSON.stringify([fingerprint(directory), names, signatures]) }
}

export async function inspectReadiness({ io = fs, runtime = readRuntime, process = () => readCurrentProcess(io), now = () => new Date().toISOString() } = {}) {
  const beforeRuntime = await runtime(); const beforeProcess = process()
  const beforeSources = sourcesSnapshot(io)
  const liveRotate = readSafeFile(ROTATE, 65536, io); const artifactRotate = readSafeFile(ARTIFACT_ROTATE, 65536, io)
  const tail = readSafeFile(LOGS + "/out.log", TAIL_BYTES, io, true)
  const observedAtUtc = now()
  const info = countMatchingInfo(tail.data, tail.startsMidFile, { ...beforeProcess, artifactSha: beforeRuntime.artifactSha, observedAtUtc })
  const afterRuntime = await runtime(); const afterProcess = process()
  if (JSON.stringify(beforeRuntime) !== JSON.stringify(afterRuntime) || JSON.stringify(beforeProcess) !== JSON.stringify(afterProcess) || beforeSources.signature !== sourcesSnapshot(io).signature || liveRotate.signature !== fingerprint(safeMetadata(ROTATE, false, io)) || artifactRotate.signature !== fingerprint(safeMetadata(ARTIFACT_ROTATE, false, io))) fail("SOURCE_CHANGED")
  const { signature: _private, ...publicProcess } = beforeProcess
  return validateReadinessOutput({ schemaVersion: 1, status: "snapshot-collected", observedAtUtc, runtime: beforeRuntime, process: publicProcess, logs: { sources: beforeSources.sources, tailBytes: tail.data.length, infoEventCount: info.count, latestInfoAtUtc: info.latestAtUtc, logrotateMatchesArtifact: liveRotate.data.equals(artifactRotate.data) }, snapshotStable: true, effectiveInfo: "UNVERIFIED", fullDayRetention: "UNVERIFIED", processContinuityCoverage: "UNVERIFIED", observationAdmitted: false })
}

export function validateReadinessOutput(value) {
  if (value?.status === "error") {
    if (!exactKeys(value, "schemaVersion,status,code") || value.schemaVersion !== 1 || !codes.has(value.code)) fail("OUTPUT_INVALID")
    return value
  }
  if (!exactKeys(value, "schemaVersion,status,observedAtUtc,runtime,process,logs,snapshotStable,effectiveInfo,fullDayRetention,processContinuityCoverage,observationAdmitted") || value.schemaVersion !== 1 || value.status !== "snapshot-collected" || !validUtc(value.observedAtUtc) || value.snapshotStable !== true || value.effectiveInfo !== "UNVERIFIED" || value.fullDayRetention !== "UNVERIFIED" || value.processContinuityCoverage !== "UNVERIFIED" || value.observationAdmitted !== false) fail("OUTPUT_INVALID")
  if (!exactKeys(value.runtime, "artifactSha,builtAt") || typeof value.runtime.artifactSha !== "string" || !SHA.test(value.runtime.artifactSha) || typeof value.runtime.builtAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.runtime.builtAt) || !Number.isFinite(Date.parse(value.runtime.builtAt)) || new Date(value.runtime.builtAt).toISOString().replace(".000Z", "Z") !== value.runtime.builtAt) fail("OUTPUT_INVALID")
  if (Date.parse(value.runtime.builtAt) > Date.parse(value.observedAtUtc)) fail("OUTPUT_INVALID")
  const p = value.process; const l = value.logs
  if (!exactKeys(p, "pid,identitySha256,startedAtUtc,infoNotBeforeUtc,startupLogLevel,restartCount") || !Number.isInteger(p.pid) || p.pid < 1 || p.pid > 999999999 || typeof p.identitySha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.identitySha256) || !validUtc(p.startedAtUtc) || !validUtc(p.infoNotBeforeUtc) || Date.parse(p.infoNotBeforeUtc) !== Date.parse(p.startedAtUtc) + 1000 || p.infoNotBeforeUtc > value.observedAtUtc || !levels.has(p.startupLogLevel) || p.restartCount !== "UNVERIFIED") fail("OUTPUT_INVALID")
  if (!exactKeys(l, "sources,tailBytes,infoEventCount,latestInfoAtUtc,logrotateMatchesArtifact") || !Array.isArray(l.sources) || l.sources.length < 1 || l.sources.length > 16 || !Number.isInteger(l.tailBytes) || l.tailBytes < 0 || l.tailBytes > TAIL_BYTES || !Number.isInteger(l.infoEventCount) || l.infoEventCount < 0 || l.infoEventCount > l.tailBytes || typeof l.logrotateMatchesArtifact !== "boolean" || (l.infoEventCount === 0 ? l.latestInfoAtUtc !== null : !validUtc(l.latestInfoAtUtc) || l.latestInfoAtUtc < p.infoNotBeforeUtc || l.latestInfoAtUtc > value.observedAtUtc)) fail("OUTPUT_INVALID")
  const names = new Set()
  for (const s of l.sources) {
    if (!exactKeys(s, "name,bytes,modifiedAtUtc") || typeof s.name !== "string" || !SOURCE_NAME.test(s.name) || names.has(s.name) || !Number.isSafeInteger(s.bytes) || s.bytes < 0 || !validUtc(s.modifiedAtUtc)) fail("OUTPUT_INVALID")
    names.add(s.name)
  }
  if (!names.has("out.log") || l.tailBytes > l.sources.find((s) => s.name === "out.log").bytes) fail("OUTPUT_INVALID")
  return value
}

async function main() {
  try {
    let output
    if (process.argv.slice(2).join(" ") === "--validate-output") {
      const buffer = Buffer.alloc(MAX_OUTPUT + 1); let length = 0
      while (length < buffer.length) { const n = fs.readSync(0, buffer, length, buffer.length - length, null); if (!n) break; length += n }
      if (length > MAX_OUTPUT) fail("OUTPUT_INVALID")
      output = validateReadinessOutput(JSON.parse(buffer.subarray(0, length).toString("utf8")))
    } else if (process.argv.length === 2) output = await inspectReadiness()
    else fail("INPUT_INVALID")
    process.stdout.write(JSON.stringify(output) + "\n")
    if (output.status === "error") process.exitCode = 1
  } catch (error) { process.stdout.write(JSON.stringify({ schemaVersion: 1, status: "error", code: codes.has(error?.message) ? error.message : "INSPECTION_FAILED" }) + "\n"); process.exitCode = 1 }
}

if (process.argv[1] === "-" || process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
