// Read-only failed-run inspection. Raw journal bytes never leave this process.
import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const REPO = "rashadoni/leaddrive-v2"
const SHA = /^[a-f0-9]{40}$/
const ID = /^[1-9][0-9]{0,19}$/
const validId = v => typeof v === "string" && ID.test(v)
const validSha = v => typeof v === "string" && SHA.test(v)
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const MAX_BYTES = 65536
const MAX_LINES = 100
const failures = new Set(["INPUT_INVALID", "RUN_NOT_ADMITTED", "ARTIFACT_MISMATCH", "JOURNAL_UNAVAILABLE", "JOURNAL_INVALID", "OUTPUT_INVALID"])
const codes = new Set(["UNKNOWN", "ENV_NOT_READABLE", "PERMISSION_DENIED", "DB_AUTH_FAILED", "DB_CONNECTION_FAILED", "TLS_FAILED", "REQUIRED_CONFIG", "MISSING_TOOL", "FILE_MISSING", "PGPASS_POLICY", "CA_POLICY", "WORKSPACE_POLICY", "WORKSPACE_CAPACITY", "WORKSPACE_NOT_TMPFS", "WORKSPACE_PATH", "WORKSPACE_STATE_OWNER", "WORKSPACE_CAPACITY_INPUT", "LOCK_POLICY", "ROLE_POLICY", "SCHEMA_POLICY"])
const fail = code => { throw new Error(code) }
const keys = (v, expected) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === expected.split(",").sort().join()
const utc = v => typeof v === "string" && UTC.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace(".000Z", "Z") === v

export function admitRun(run, runId, now = Date.now()) {
  if (!validId(runId) || !run || String(run.id) !== runId ||
      run.repository?.full_name !== REPO || run.head_repository?.full_name !== REPO ||
      run.path !== ".github/workflows/owner-recovery-proof.yml" || run.event !== "workflow_dispatch" ||
      run.head_branch !== "main" || !validSha(run.head_sha) || run.status !== "completed" ||
      run.conclusion !== "failure" || run.run_attempt !== 1 || !utc(run.run_started_at) || !utc(run.updated_at))
    fail("RUN_NOT_ADMITTED")
  const start = Date.parse(run.run_started_at), end = Date.parse(run.updated_at)
  if (end < start || end - start > 302 * 60000 || start > now || now - end > 7 * 86400000) fail("RUN_NOT_ADMITTED")
  return { runId, runSha: run.head_sha, since: run.run_started_at, until: run.updated_at }
}

export function validateInput(input) {
  if (!keys(input, "runId,runSha,since,until,expectedSha") || !validId(input.runId) ||
      !validSha(input.runSha) || !validSha(input.expectedSha) || !utc(input.since) || !utc(input.until) ||
      Date.parse(input.until) < Date.parse(input.since) ||
      Date.parse(input.until) - Date.parse(input.since) > 302 * 60000) fail("INPUT_INVALID")
  return input
}

function classify(message) {
  // Only constant classifications, never log substrings, paths or SQL values.
  if (message === "[postgres-backup] ERROR: backup tmpfs has insufficient free capacity") return "WORKSPACE_CAPACITY"
  if (message === "[postgres-backup] ERROR: backup plaintext work root must be backed by tmpfs") return "WORKSPACE_NOT_TMPFS"
  if (/^\[postgres-backup\] ERROR: backup work root must (be a real non-symlink directory|resolve to its canonical reviewed path)$/.test(message)) return "WORKSPACE_PATH"
  if (message === "[postgres-backup] ERROR: backup state root has unsafe ownership/mode") return "WORKSPACE_STATE_OWNER"
  if (/^\[postgres-backup\] ERROR: (calculated backup capacity requirement is invalid|BACKUP_MIN_WORK_AVAILABLE_BYTES must be at least 1073741824)$/.test(message)) return "WORKSPACE_CAPACITY_INPUT"
  if (/backup\.env: Permission denied/.test(message)) return "ENV_NOT_READABLE"
  if (/password authentication failed|no password supplied|no pg_hba\.conf entry/i.test(message)) return "DB_AUTH_FAILED"
  if (/certificate verify failed|server certificate|SSL error|SSL SYSCALL|root certificate/i.test(message)) return "TLS_FAILED"
  if (/connection refused|could not connect to server|could not translate host name|timeout expired/i.test(message)) return "DB_CONNECTION_FAILED"
  if (/\[postgres-backup\] ERROR: PGPASSFILE /.test(message)) return "PGPASS_POLICY"
  if (/\[postgres-backup\] ERROR: PGSSLROOTCERT /.test(message)) return "CA_POLICY"
  if (/\[postgres-backup\] ERROR: (backup work root|backup state root|backup plaintext|backup tmpfs|calculated backup capacity)/.test(message)) return "WORKSPACE_POLICY"
  if (/\[postgres-backup\] ERROR: (backup lock|another backup run)/.test(message)) return "LOCK_POLICY"
  if (/\[postgres-backup\] ERROR: (backup role|connected as|connected to|[0-9]+ role membership)/.test(message)) return "ROLE_POLICY"
  if (/\[postgres-backup\] ERROR: (source Prisma ledger|Prisma migration ledger|successful Prisma|recovery DB contract)/.test(message)) return "SCHEMA_POLICY"
  if (/\[postgres-backup\] ERROR: [A-Z_]+ is required$/.test(message)) return "REQUIRED_CONFIG"
  if (/required command not found:/.test(message)) return "MISSING_TOOL"
  if (/Permission denied/.test(message)) return "PERMISSION_DENIED"
  if (/No such file or directory|\[postgres-backup\] ERROR: (canary\.sql is missing|migration-ledger\.sql is missing|recovery-db-contract\.tsv is missing|postgres-restore-canary\.sh is not executable)/.test(message)) return "FILE_MISSING"
  return null
}

export function classifyJournal(bytes, input, resources) {
  validateInput(input)
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) fail("JOURNAL_INVALID")
  let text
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { fail("JOURNAL_INVALID") }
  const lines = text.trim() ? text.trimEnd().split("\n") : []
  if (lines.length > MAX_LINES) fail("JOURNAL_INVALID")
  const findings = new Set(), sourceLines = new Set(), invocations = new Set()
  let sourceIdentityStageSeen = false
  for (const line of lines) {
    let event
    try { event = JSON.parse(line) } catch { fail("JOURNAL_INVALID") }
    if (!event || typeof event.MESSAGE !== "string" || Buffer.byteLength(event.MESSAGE) > 8192 ||
        !/^[a-f0-9]{32}$/.test(event._SYSTEMD_INVOCATION_ID ?? "") ||
        !/^[0-9]{10,20}$/.test(event.__REALTIME_TIMESTAMP ?? "")) fail("JOURNAL_INVALID")
    const at = Number(event.__REALTIME_TIMESTAMP) / 1000
    if (!Number.isFinite(at) || at < Date.parse(input.since) || at > Date.parse(input.until) + 999) fail("JOURNAL_INVALID")
    invocations.add(event._SYSTEMD_INVOCATION_ID)
    if (invocations.size > 1) fail("JOURNAL_INVALID")
    const code = classify(event.MESSAGE)
    if (event.MESSAGE.startsWith("[postgres-backup] source database identity ")) sourceIdentityStageSeen = true
    if (code) findings.add(code)
    for (const match of event.MESSAGE.matchAll(/postgres-backup\.sh: line ([1-9][0-9]{0,4}):/g)) sourceLines.add(Number(match[1]))
  }
  if (!findings.size) findings.add("UNKNOWN")
  return validateOutput({ format: 2, status: "inspected", runId: input.runId, runSha: input.runSha,
    observedEntries: lines.length, sampleLimitReached: lines.length === MAX_LINES,
    codes: [...findings].sort(), sourceLines: [...sourceLines].sort((a, b) => a - b), sourceIdentityStageSeen, resources })
}

function validateResources(value) {
  if (!keys(value, "runFilesystem,runTotalBytes,runAvailableBytes,hostMemoryTotalBytes,hostMemoryAvailableBytes,hostSwapBytes") ||
      !["tmpfs", "other"].includes(value.runFilesystem) ||
      [value.runTotalBytes, value.runAvailableBytes, value.hostMemoryTotalBytes, value.hostMemoryAvailableBytes, value.hostSwapBytes]
        .some(n => !Number.isSafeInteger(n) || n < 0) || value.runAvailableBytes > value.runTotalBytes ||
      value.hostMemoryAvailableBytes > value.hostMemoryTotalBytes) fail("OUTPUT_INVALID")
  return value
}

export function readWorkspaceResources(io = fs) {
  const buffer = Buffer.alloc(8193)
  const fd = io.openSync("/proc/meminfo", fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let length = 0
  try {
    while (length < buffer.length) {
      const count = io.readSync(fd, buffer, length, buffer.length - length, length)
      if (!count) break
      length += count
    }
  } finally { io.closeSync(fd) }
  if (length > 8192) fail("OUTPUT_INVALID")
  const text = buffer.subarray(0, length).toString("utf8")
  const selected = ["MemTotal", "MemAvailable", "SwapTotal"].map(key => {
    const matches = [...text.matchAll(new RegExp("^" + key + ":\\s+([0-9]+) kB$", "gm"))]
    if (matches.length !== 1) fail("OUTPUT_INVALID")
    return Number(matches[0][1]) * 1024
  })
  const stat = io.statfsSync("/run", { bigint: true })
  return validateResources({ runFilesystem: stat.type === 0x01021994n ? "tmpfs" : "other",
    runTotalBytes: Number(stat.blocks * stat.bsize), runAvailableBytes: Number(stat.bavail * stat.bsize),
    hostMemoryTotalBytes: selected[0], hostMemoryAvailableBytes: selected[1], hostSwapBytes: selected[2] })
}

export function validateOutput(value) {
  if (!keys(value, "format,status,runId,runSha,observedEntries,sampleLimitReached,codes,sourceLines,sourceIdentityStageSeen,resources") ||
      value.format !== 2 || value.status !== "inspected" || !validId(value.runId) || !validSha(value.runSha) ||
      typeof value.sourceIdentityStageSeen !== "boolean" ||
      !Number.isInteger(value.observedEntries) || value.observedEntries < 0 || value.observedEntries > MAX_LINES ||
      typeof value.sampleLimitReached !== "boolean" || value.sampleLimitReached !== (value.observedEntries === MAX_LINES) ||
      !Array.isArray(value.codes) || !value.codes.length || value.codes.length > codes.size ||
      value.codes.some(c => !codes.has(c)) || new Set(value.codes).size !== value.codes.length ||
      !Array.isArray(value.sourceLines) || value.sourceLines.length > MAX_LINES ||
      value.sourceLines.some(n => !Number.isInteger(n) || n < 1 || n > 99999) ||
      new Set(value.sourceLines).size !== value.sourceLines.length) fail("OUTPUT_INVALID")
  validateResources(value.resources)
  return value
}

export function inspect(input, io = fs, exec = execFileSync) {
  validateInput(input)
  const marker = "/opt/leaddrive-v2/.next/standalone/.deploy-sha"
  for (const path of ["/", "/opt", "/opt/leaddrive-v2", "/opt/leaddrive-v2/.next", "/opt/leaddrive-v2/.next/standalone", marker]) {
    const stat = io.lstatSync(path)
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) ||
        (path === marker ? !stat.isFile() || stat.size > 64 : !stat.isDirectory())) fail("ARTIFACT_MISMATCH")
  }
  const fd = io.openSync(marker, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const data = Buffer.alloc(65), count = io.readSync(fd, data, 0, 65, 0)
    if (data.subarray(0, count).toString().trim() !== input.expectedSha) fail("ARTIFACT_MISMATCH")
  } finally { io.closeSync(fd) }
  let bytes
  try {
    bytes = exec("/usr/bin/journalctl", ["--quiet", "--no-pager", "--output=json",
      "--output-fields=MESSAGE,_SYSTEMD_INVOCATION_ID,__REALTIME_TIMESTAMP",
      // Exact emitting process unit, not --unit's additional manager messages
      // that have no invocation ID and cannot be attributed to this process.
      "_SYSTEMD_UNIT=leaddrive-backup-commission-database-" + input.runId + ".service",
      "--since=" + input.since, "--until=" + input.until, "--lines=100"], {
      timeout: 10000, maxBuffer: MAX_BYTES, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"] })
  } catch { fail("JOURNAL_UNAVAILABLE") }
  return classifyJournal(bytes, input, readWorkspaceResources(io))
}

async function main() {
  if (process.argv[2] === "--admit") {
    const id = process.env.BACKUP_RUN_ID
    if (!validId(id)) fail("INPUT_INVALID")
    let run
    try { run = JSON.parse(execFileSync("gh", ["api", "repos/" + REPO + "/actions/runs/" + id],
      { encoding: "utf8", timeout: 15000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "ignore"] })) }
    catch { fail("RUN_NOT_ADMITTED") }
    const input = admitRun(run, id)
    for (const [key, value] of Object.entries(input)) console.log(key + "=" + value)
  } else if (process.argv[2] === "--validate-output") {
    const buffer = Buffer.alloc(4097)
    let length = 0
    while (length < buffer.length) {
      const count = fs.readSync(0, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    if (length > 4096) fail("OUTPUT_INVALID")
    const value = validateOutput(JSON.parse(buffer.subarray(0, length).toString("utf8")))
    if (value.runId !== process.env.BACKUP_RUN_ID || value.runSha !== process.env.BACKUP_RUN_SHA) fail("OUTPUT_INVALID")
    console.log(JSON.stringify(value))
  } else {
    const [runId, runSha, since, until, expectedSha] = process.argv.slice(2)
    if (process.argv.length !== 7) fail("INPUT_INVALID")
    console.log(JSON.stringify(inspect({ runId, runSha, since, until, expectedSha })))
  }
}

if (process.argv[1] === "-" || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(error => { console.error(failures.has(error?.message) ? error.message : "JOURNAL_INVALID"); process.exitCode = 1 })
}
