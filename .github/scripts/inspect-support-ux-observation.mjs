// Stream this trusted, standalone controller to the registered host through
// the existing protected diagnostic. No application import, DB/log mutation,
// raw log export, dotenv evaluation or credential-bearing command argument.
import fs from "node:fs"
import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"

const MAX_BYTES = 64 * 1024 * 1024
const MAX_EVENTS = 100000
const operations = new Set(["CATEGORY_LIST", "CATEGORY_CREATE", "CATEGORY_RENAME", "CATEGORY_DELETE"])
const modes = new Set(["database", "browser", "unverified"])
const eventKeys = new Set(["event", "schema_version", "observed_at_utc", "artifact_sha", "tenant_key", "operation", "mode", "http_status", "outcome", "duration_ms"])
const pinoKeys = new Set(["level", "time", "pid", "hostname", "msg"])
const unavailableReasons = new Set(["INVALID_CONTEXT", "ARTIFACT_UNAVAILABLE", "TENANT_KEY_UNAVAILABLE", "CLOCK_UNAVAILABLE", "MODE_INVALID", "RESPONSE_UNAVAILABLE"])
const codes = new Set(["INPUT_INVALID", "APP_ENV_UNSAFE", "APP_ENV_INVALID", "DATABASE_OPTIONS_UNSUPPORTED", "DATABASE_QUERY_FAILED", "TENANT_NOT_ACTIVE", "LOGS_UNSAFE", "LOG_LIMIT_EXCEEDED", "EVENT_INVALID", "OUTPUT_INVALID", "INSPECTION_FAILED", "INCOMPLETE_DAY"])

export function observationDayBounds(day, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) throw new Error("INPUT_INVALID")
  const start = new Date(day + "T00:00:00+04:00")
  if (!Number.isFinite(start.getTime()) || new Date(start.getTime() + 4 * 3600000).toISOString().slice(0, 10) !== day) throw new Error("INPUT_INVALID")
  const end = new Date(start.getTime() + 86400000)
  if (!Number.isFinite(now.getTime()) || end > now) throw new Error("INCOMPLETE_DAY")
  return { start, end }
}

export function observationTenantKey(orgId, secret) {
  if (typeof orgId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(orgId) || typeof secret !== "string" || Buffer.byteLength(secret) < 32 || /\s/u.test(secret) || new Set(secret).size < 8) throw new Error("APP_ENV_INVALID")
  return createHmac("sha256", secret).update("support-ux-observation-v1:" + orgId).digest("hex")
}

function readBoundedRegularFile(file, limit, identities) {
  let fd
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0 || info.size > limit) throw new Error("LOGS_UNSAFE")
    const identity = info.dev + ":" + info.ino
    if (identities?.has(identity)) throw new Error("LOGS_UNSAFE")
    identities?.add(identity)
    const data = Buffer.alloc(info.size)
    let read = 0
    while (read < data.length) {
      const count = fs.readSync(fd, data, read, data.length - read, read)
      if (!count) throw new Error("LOGS_UNSAFE")
      read += count
    }
    const after = fs.fstatSync(fd)
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error("LOGS_UNSAFE")
    return data
  } finally { if (fd !== undefined) fs.closeSync(fd) }
}

export function literalAppEnvValue(text, key) {
  if (!new Set(["DATABASE_URL", "NEXTAUTH_SECRET"]).has(key) || Buffer.byteLength(text) > 65536) throw new Error("APP_ENV_INVALID")
  const values = [...text.matchAll(new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=\\s*(.*?)\\s*$", "gm"))]
  if (values.length !== 1) throw new Error("APP_ENV_INVALID")
  let value = values[0][1]
  if (/^["']/.test(value)) {
    if (value.length < 2 || value.at(-1) !== value[0]) throw new Error("APP_ENV_INVALID")
    value = value.slice(1, -1)
  }
  if (!value || /[\n\r\0]/.test(value)) throw new Error("APP_ENV_INVALID")
  return value
}

export function observationDatabaseEnvironment(databaseUrl, inherited = process.env) {
  let url
  try { url = new URL(databaseUrl) } catch { throw new Error("APP_ENV_INVALID") }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.hash) throw new Error("APP_ENV_INVALID")
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith("PG")))
  const decode = (value) => { try { return decodeURIComponent(value) } catch { throw new Error("APP_ENV_INVALID") } }
  Object.assign(env, { PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decode(url.pathname.slice(1)), PGUSER: decode(url.username), PGPASSWORD: decode(url.password), PGCONNECT_TIMEOUT: "5", PGAPPNAME: "support-ux-observation-read-only", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000" })
  const ignore = new Set(["connection_limit", "pool_timeout", "pgbouncer", "socket_timeout"])
  const tls = { sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", sslcrl: "PGSSLCRL", hostaddr: "PGHOSTADDR" }
  const seen = new Set()
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) throw new Error("DATABASE_OPTIONS_UNSUPPORTED")
    seen.add(key)
    if (key === "schema" && value === "public" || ignore.has(key)) continue
    if (!Object.hasOwn(tls, key) || !value || key === "sslmode" && !new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]).has(value)) throw new Error("DATABASE_OPTIONS_UNSUPPORTED")
    env[tls[key]] = value
  }
  return env
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || Object.keys(event).some((key) => !eventKeys.has(key) && !pinoKeys.has(key)) || [...eventKeys].some((key) => !Object.hasOwn(event, key))) throw new Error("EVENT_INVALID")
  const timestamp = new Date(event.observed_at_utc)
  const status = event.http_status
  const expected = status === null ? "thrown" : Number.isInteger(status) && status >= 200 && status < 300 ? "success" : Number.isInteger(status) && status >= 400 && status < 500 ? "client_rejection" : Number.isInteger(status) && status >= 500 && status <= 599 ? "server_error" : null
  if (event.event !== "support_ux_observation" || event.schema_version !== 1 || typeof event.observed_at_utc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.observed_at_utc) || !Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== event.observed_at_utc || typeof event.artifact_sha !== "string" || !/^[a-f0-9]{40}$/.test(event.artifact_sha) || typeof event.tenant_key !== "string" || !/^[a-f0-9]{64}$/.test(event.tenant_key) || !operations.has(event.operation) || !modes.has(event.mode) || !expected || expected !== event.outcome || !Number.isInteger(event.duration_ms) || event.duration_ms < 0 || event.duration_ms > 600000) throw new Error("EVENT_INVALID")
  return timestamp
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

export function observationLogSourcesSnapshot(directory, names) {
  const signature = (file) => {
    const info = fs.lstatSync(file, { bigint: true })
    return [info.dev, info.ino, info.size, info.mode, info.uid, info.mtimeNs, info.ctimeNs].map(String)
  }
  return JSON.stringify({ directory: signature(directory), files: names.map((name) => [name, ...signature(directory + "/" + name)]) })
}

export function summarizeObservationLogs(texts, { tenantKey, tenantSlug, day, now = new Date() }) {
  if (typeof tenantKey !== "string" || !/^[a-f0-9]{64}$/.test(tenantKey) || typeof tenantSlug !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(tenantSlug) || !Array.isArray(texts) || texts.length < 1 || texts.length > 16 || texts.some((text) => typeof text !== "string")) throw new Error("INPUT_INVALID")
  const { start, end } = observationDayBounds(day, now)
  const groups = new Map()
  let bytes = 0
  let events = 0
  let unavailable = 0
  let scannedTelemetryEvents = 0
  for (const text of texts) {
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_BYTES) throw new Error("LOG_LIMIT_EXCEEDED")
    for (const line of text.split("\n")) {
      if (!line.includes('"support_ux_observation')) continue
      if (Buffer.byteLength(line) > 65536) throw new Error("EVENT_INVALID")
      let event
      try { event = JSON.parse(line.slice(line.indexOf("{"))) } catch { throw new Error("EVENT_INVALID") }
      scannedTelemetryEvents += 1
      if (scannedTelemetryEvents > MAX_EVENTS) throw new Error("LOG_LIMIT_EXCEEDED")
      if (event?.event === "support_ux_observation_unavailable") {
        const allowed = new Set(["event", "schema_version", "reason", ...pinoKeys])
        if (event.schema_version !== 1 || !unavailableReasons.has(event.reason) || Object.keys(event).some((key) => !allowed.has(key))) throw new Error("EVENT_INVALID")
        unavailable += 1; continue
      }
      if (event.event !== "support_ux_observation") continue
      const timestamp = validateEvent(event)
      if (event.tenant_key !== tenantKey || timestamp < start || timestamp >= end) continue
      events += 1
      if (events > MAX_EVENTS) throw new Error("LOG_LIMIT_EXCEEDED")
      const key = event.artifact_sha + "|" + event.operation + "|" + event.mode
      if (!groups.has(key)) groups.set(key, { artifactSha: event.artifact_sha, operation: event.operation, mode: event.mode, attempts: 0, successes: 0, clientRejections: 0, serverErrors: 0, thrown: 0, durations: [] })
      if (groups.size > 256) throw new Error("LOG_LIMIT_EXCEEDED")
      const group = groups.get(key)
      group.attempts += 1
      if (event.outcome === "success") group.successes += 1
      if (event.outcome === "client_rejection") group.clientRejections += 1
      if (event.outcome === "server_error") group.serverErrors += 1
      if (event.outcome === "thrown") group.thrown += 1
      group.durations.push(event.duration_ms)
    }
  }
  return { schemaVersion: 1, status: events ? "collected" : "no-observed-traffic", tenantSlug, day, dayStartUtc: start.toISOString(), dayEndUtc: end.toISOString(), scope: "category-handlers-after-base-auth-v1", coverage: { status: "UNVERIFIED", filesRead: texts.length, bytesRead: bytes, scannedTelemetryEvents, unavailableTelemetryEventsInRetainedSources: unavailable }, percentileMethod: "nearest-rank", observationAdmitted: false, groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, { durations, ...group }]) => ({ ...group, failureNumerator: group.serverErrors + group.thrown, denominator: group.attempts, errorRate: (group.serverErrors + group.thrown) / group.attempts, latencySamples: durations.length, p50Ms: percentile(durations, 0.5), p75Ms: percentile(durations, 0.75), comparableSampleCount: durations.length >= 7 })) }
}

export function validateObservationOutput(value, tenantSlug, day) {
  const expectedKeys = "coverage,day,dayEndUtc,dayStartUtc,groups,observationAdmitted,percentileMethod,schemaVersion,scope,status,tenantSlug"
  if (value?.status === "error") {
    if (Object.keys(value).sort().join(",") !== "code,schemaVersion,status" || value.schemaVersion !== 1 || !codes.has(value.code)) throw new Error("OUTPUT_INVALID")
    return value
  }
  if (!value || Object.keys(value).sort().join(",") !== expectedKeys || value.schemaVersion !== 1 || value.tenantSlug !== tenantSlug || value.day !== day || !new Set(["collected", "no-observed-traffic"]).has(value.status) || value.observationAdmitted !== false || value.scope !== "category-handlers-after-base-auth-v1" || value.percentileMethod !== "nearest-rank" || !Array.isArray(value.groups) || value.groups.length > 256 || value.coverage?.status !== "UNVERIFIED") throw new Error("OUTPUT_INVALID")
  const { start, end } = observationDayBounds(day)
  if (value.dayStartUtc !== start.toISOString() || value.dayEndUtc !== end.toISOString() || Object.keys(value.coverage).sort().join(",") !== "bytesRead,filesRead,scannedTelemetryEvents,status,unavailableTelemetryEventsInRetainedSources" || !Number.isInteger(value.coverage.filesRead) || value.coverage.filesRead < 1 || value.coverage.filesRead > 16 || !Number.isInteger(value.coverage.bytesRead) || value.coverage.bytesRead < 0 || value.coverage.bytesRead > MAX_BYTES || !Number.isInteger(value.coverage.scannedTelemetryEvents) || value.coverage.scannedTelemetryEvents < 0 || value.coverage.scannedTelemetryEvents > MAX_EVENTS || !Number.isInteger(value.coverage.unavailableTelemetryEventsInRetainedSources) || value.coverage.unavailableTelemetryEventsInRetainedSources < 0 || value.coverage.unavailableTelemetryEventsInRetainedSources > value.coverage.scannedTelemetryEvents) throw new Error("OUTPUT_INVALID")
  let total = 0
  const seen = new Set()
  for (const group of value.groups) {
    if (Object.keys(group).sort().join(",") !== "artifactSha,attempts,clientRejections,comparableSampleCount,denominator,errorRate,failureNumerator,latencySamples,mode,operation,p50Ms,p75Ms,serverErrors,successes,thrown" || typeof group.artifactSha !== "string" || !/^[a-f0-9]{40}$/.test(group.artifactSha) || !operations.has(group.operation) || !modes.has(group.mode)) throw new Error("OUTPUT_INVALID")
    const key = group.artifactSha + "|" + group.operation + "|" + group.mode
    if (seen.has(key)) throw new Error("OUTPUT_INVALID")
    seen.add(key)
    for (const field of ["attempts", "successes", "clientRejections", "serverErrors", "thrown", "failureNumerator", "denominator", "latencySamples", "p50Ms", "p75Ms"]) if (!Number.isInteger(group[field]) || group[field] < 0 || group[field] > (field.endsWith("Ms") ? 600000 : MAX_EVENTS)) throw new Error("OUTPUT_INVALID")
    if (group.attempts < 1 || group.successes + group.clientRejections + group.serverErrors + group.thrown !== group.attempts || group.failureNumerator !== group.serverErrors + group.thrown || group.denominator !== group.attempts || group.latencySamples !== group.attempts || group.errorRate !== group.failureNumerator / group.denominator || group.p50Ms > group.p75Ms || group.comparableSampleCount !== (group.latencySamples >= 7)) throw new Error("OUTPUT_INVALID")
    total += group.attempts
  }
  if (total + value.coverage.unavailableTelemetryEventsInRetainedSources > value.coverage.scannedTelemetryEvents || (value.status === "collected") !== (total > 0)) throw new Error("OUTPUT_INVALID")
  return value
}

export function inspectObservation(tenantSlug, day) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(tenantSlug ?? "")) throw new Error("INPUT_INVALID")
  observationDayBounds(day)
  let text
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(readBoundedRegularFile("/etc/leaddrive/app.env", 65536)) } catch { throw new Error("APP_ENV_UNSAFE") }
  const secret = literalAppEnvValue(text, "NEXTAUTH_SECRET")
  const env = observationDatabaseEnvironment(literalAppEnvValue(text, "DATABASE_URL"))
  let rows
  try {
    const raw = execFileSync("psql", ["-X", "--no-password", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=support_tenant=" + tenantSlug], { env, timeout: 12000, maxBuffer: 65536, encoding: "utf8", input: 'BEGIN READ ONLY; SET LOCAL app.rls_bypass = \'on\'; SELECT COALESCE(json_agg(row_to_json(o)), \'[]\'::json) FROM (SELECT id, "isActive" AS active FROM public.organizations WHERE slug = :\'support_tenant\' LIMIT 2) o; ROLLBACK;' })
    rows = JSON.parse(raw)
  } catch { throw new Error("DATABASE_QUERY_FAILED") }
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.active !== true || Object.keys(rows[0]).sort().join(",") !== "active,id") throw new Error("TENANT_NOT_ACTIVE")
  const tenantKey = observationTenantKey(rows[0].id, secret)
  const directory = "/var/lib/leaddrive-v2-logs"
  const directoryInfo = fs.lstatSync(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.uid !== 0 || (directoryInfo.mode & 0o022) !== 0) throw new Error("LOGS_UNSAFE")
  const names = fs.readdirSync(directory).filter((name) => /^out\.log(?:\.(?:[1-9]|1[0-4])|-\d{8})?(?:\.gz)?$/.test(name)).sort()
  if (!names.length || names.length > 16) throw new Error("LOGS_UNSAFE")
  const beforeSources = observationLogSourcesSnapshot(directory, names)
  let bytes = 0
  const identities = new Set()
  const texts = names.map((name) => {
    const raw = readBoundedRegularFile(directory + "/" + name, MAX_BYTES - bytes, identities)
    const data = name.endsWith(".gz") ? gunzipSync(raw, { maxOutputLength: MAX_BYTES - bytes }) : raw
    bytes += data.length
    if (bytes > MAX_BYTES) throw new Error("LOG_LIMIT_EXCEEDED")
    return new TextDecoder("utf-8", { fatal: true }).decode(data)
  })
  // copytruncate produces another inode containing already-read events. All
  // paths and the directory must stay unchanged across the WHOLE collection,
  // not just each individual read. Never report duplicate partial counts.
  const afterNames = fs.readdirSync(directory).filter((name) => /^out\.log(?:\.(?:[1-9]|1[0-4])|-\d{8})?(?:\.gz)?$/.test(name)).sort()
  if (JSON.stringify(names) !== JSON.stringify(afterNames) || beforeSources !== observationLogSourcesSnapshot(directory, afterNames)) throw new Error("LOGS_UNSAFE")
  return validateObservationOutput(summarizeObservationLogs(texts, { tenantKey, tenantSlug, day }), tenantSlug, day)
}

function main() {
  const tenantSlug = process.env.SUPPORT_UX_TENANT ?? ""
  const day = process.env.SUPPORT_UX_DAY ?? ""
  try {
    let value
    if (process.argv.slice(2).join(" ") === "--validate-output") {
      const buffer = Buffer.alloc(262145)
      let length = 0
      while (length < buffer.length) {
        const count = fs.readSync(0, buffer, length, buffer.length - length, null)
        if (!count) break
        length += count
      }
      if (length > 262144) throw new Error("OUTPUT_INVALID")
      value = validateObservationOutput(JSON.parse(buffer.subarray(0, length).toString("utf8")), tenantSlug, day)
    } else if (process.argv.length === 2) value = inspectObservation(tenantSlug, day)
    else throw new Error("INPUT_INVALID")
    process.stdout.write(JSON.stringify(value) + "\n")
    if (value.status === "error") process.exitCode = 1
  } catch (error) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, status: "error", code: codes.has(error?.message) ? error.message : "INSPECTION_FAILED" }) + "\n")
    process.exitCode = 1
  }
}

if (process.argv[1] === "-" || process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
