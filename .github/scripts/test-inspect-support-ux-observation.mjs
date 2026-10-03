import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { literalAppEnvValue, observationDatabaseEnvironment, observationDayBounds, observationLogSourcesSnapshot, observationTenantKey, summarizeObservationLogs, validateObservationOutput } from "./inspect-support-ux-observation.mjs"

const tenantSlug = "synthetic-support"
const secret = "synthetic-observation-secret-0123456789"
const tenantKey = observationTenantKey("cltenantobservation00000001", secret)
const day = "2020-01-01"
const now = new Date("2020-01-02T00:00:00.000Z")
function event(overrides = {}) {
  return { event: "support_ux_observation", schema_version: 1, observed_at_utc: "2020-01-01T08:00:00.000Z", artifact_sha: "a".repeat(40), tenant_key: tenantKey, operation: "CATEGORY_CREATE", mode: "database", http_status: 201, outcome: "success", duration_ms: 10, ...overrides }
}
function summarize(events) { return summarizeObservationLogs([events.map((value) => JSON.stringify(value)).join("\n")], { tenantKey, tenantSlug, day, now }) }

test("Baku day boundaries exclude partial/future days and reject normalized invalid dates", () => {
  assert.deepEqual(observationDayBounds(day, now), { start: new Date("2019-12-31T20:00:00.000Z"), end: new Date("2020-01-01T20:00:00.000Z") })
  assert.throws(() => observationDayBounds("2020-02-30", now), /INPUT_INVALID/)
  assert.throws(() => observationDayBounds("2020-01-02", now), /INCOMPLETE_DAY/)
})

test("HMAC is tenant/key specific and never a plaintext identifier", () => {
  assert.match(tenantKey, /^[a-f0-9]{64}$/)
  assert.notEqual(tenantKey, observationTenantKey("cltenantobservation00000002", secret))
  assert.notEqual(tenantKey, observationTenantKey("cltenantobservation00000001", secret + "rotated"))
  assert.throws(() => observationTenantKey("tenant", "short"), /APP_ENV_INVALID/)
})

test("all authenticated outcomes have an honest denominator and nearest-rank latency", () => {
  const report = summarize([event(), event({ duration_ms: 20 }), event({ duration_ms: 30, http_status: 409, outcome: "client_rejection" }), event({ duration_ms: 40, http_status: 500, outcome: "server_error" }), event({ duration_ms: 50, http_status: null, outcome: "thrown" })])
  assert.deepEqual(report.groups[0], { artifactSha: "a".repeat(40), operation: "CATEGORY_CREATE", mode: "database", attempts: 5, successes: 2, clientRejections: 1, serverErrors: 1, thrown: 1, failureNumerator: 2, denominator: 5, errorRate: 0.4, latencySamples: 5, p50Ms: 30, p75Ms: 40, comparableSampleCount: false })
  assert.equal(report.coverage.status, "UNVERIFIED")
  assert.equal(report.observationAdmitted, false)
  validateObservationOutput(report, tenantSlug, day)
})

test("tenant/day/source/operation/mode stay separate, with strict midnight bounds", () => {
  const report = summarize([event(), event({ tenant_key: "b".repeat(64) }), event({ observed_at_utc: "2020-01-01T20:00:00.000Z" }), event({ observed_at_utc: "2019-12-31T19:59:59.999Z" }), event({ artifact_sha: "b".repeat(40), operation: "CATEGORY_LIST", mode: "browser" })])
  assert.equal(report.groups.length, 2)
  assert.equal(report.groups.reduce((sum, group) => sum + group.attempts, 0), 2)
  assert.equal(report.coverage.scannedTelemetryEvents, 5)
})

test("PM2 prefixes/Pino metadata are consumed without raw logs or private fields in output", () => {
  const raw = "2020-01-01 08:00:00 +00:00: " + JSON.stringify(event({ level: 30, time: 1577865600000, pid: 1, hostname: "PRIVATE_HOST", msg: "PRIVATE_PAYLOAD" }))
  const report = summarizeObservationLogs([raw], { tenantKey, tenantSlug, day, now })
  const output = JSON.stringify(report)
  for (const value of ["PRIVATE_HOST", "PRIVATE_PAYLOAD", secret, tenantKey, "cltenantobservation00000001"]) assert.equal(output.includes(value), false)
  assert.throws(() => summarize([event({ body: "PRIVATE_PAYLOAD" })]), /EVENT_INVALID/)
})

test("unknown or malformed event fields cannot be coerced into accepted source identities", () => {
  for (const overrides of [{ artifact_sha: ["a".repeat(40)] }, { tenant_key: [tenantKey] }, { observed_at_utc: "2020-01-01T08:00:00Z" }, { http_status: 500 }, { duration_ms: -1 }, { duration_ms: 600001 }, { operation: "UNKNOWN" }, { mode: "UNKNOWN" }, { schema_version: 2 }]) assert.throws(() => summarize([event(overrides)]), /EVENT_INVALID/)
  const output = summarize([event()])
  output.groups[0].artifactSha = ["a".repeat(40)]
  assert.throws(() => validateObservationOutput(output, tenantSlug, day), /OUTPUT_INVALID/)
})

test("unavailable records are fixed/strict and counted across retained sources, never false zero coverage", () => {
  const unavailable = { event: "support_ux_observation_unavailable", schema_version: 1, reason: "ARTIFACT_UNAVAILABLE" }
  const report = summarize([unavailable])
  assert.equal(report.status, "no-observed-traffic")
  assert.equal(report.coverage.unavailableTelemetryEventsInRetainedSources, 1)
  assert.equal(report.observationAdmitted, false)
  for (const value of [{ ...unavailable, reason: "PRIVATE_ERROR" }, { ...unavailable, schema_version: 2 }, { ...unavailable, body: "PRIVATE_PAYLOAD" }]) assert.throws(() => summarize([value]), /EVENT_INVALID/)
})

test("scanned-event bound covers other tenants and unavailable data", () => {
  const line = JSON.stringify(event({ tenant_key: "b".repeat(64) })) + "\n"
  assert.throws(() => summarizeObservationLogs([line.repeat(100001)], { tenantKey, tenantSlug, day, now }), /LOG_LIMIT_EXCEEDED/)
})

test("literal env values never evaluate shell expressions and ambiguity fails closed", () => {
  assert.equal(literalAppEnvValue("NEXTAUTH_SECRET='$(synthetic-literal-only)'\n", "NEXTAUTH_SECRET"), "$(synthetic-literal-only)")
  assert.throws(() => literalAppEnvValue("DATABASE_URL=first\nDATABASE_URL=second\n", "DATABASE_URL"), /APP_ENV_INVALID/)
  assert.throws(() => literalAppEnvValue("DATABASE_URL='unclosed\n", "DATABASE_URL"), /APP_ENV_INVALID/)
})

test("DB credentials stay in environment, inherited PG settings are stripped and TLS is preserved", () => {
  const env = observationDatabaseEnvironment("postgresql://user:synthetic-password@db.example:5432/app?schema=public&connection_limit=1&sslmode=verify-full&sslrootcert=%2Fsafe%2Fca.pem", { PGOPTIONS: "unsafe", PGPASSWORD: "inherited", KEEP: "yes" })
  assert.equal(env.PGPASSWORD, "synthetic-password")
  assert.equal(env.PGSSLMODE, "verify-full")
  assert.equal(env.PGSSLROOTCERT, "/safe/ca.pem")
  assert.equal(env.KEEP, "yes")
  assert.match(env.PGOPTIONS, /default_transaction_read_only=on/)
  assert.throws(() => observationDatabaseEnvironment("postgresql://user:pass@db/app?sslmode=verify-full&sslmode=disable"), /DATABASE_OPTIONS_UNSUPPORTED/)
  assert.throws(() => observationDatabaseEnvironment("postgresql://user:pass@db/app?unsupported=value"), /DATABASE_OPTIONS_UNSUPPORTED/)
})

test("output cannot grant observation admission or invent zero attempts", () => {
  const report = summarize([event()])
  assert.throws(() => validateObservationOutput({ ...report, observationAdmitted: true }, tenantSlug, day), /OUTPUT_INVALID/)
  report.groups[0].denominator = 0
  assert.throws(() => validateObservationOutput(report, tenantSlug, day), /OUTPUT_INVALID/)
  const empty = summarize([])
  assert.equal(empty.status, "no-observed-traffic")
  assert.deepEqual(empty.groups, [])
  validateObservationOutput(empty, tenantSlug, day)
  const impossible = summarize([event()])
  impossible.coverage.unavailableTelemetryEventsInRetainedSources = 1
  assert.throws(() => validateObservationOutput(impossible, tenantSlug, day), /OUTPUT_INVALID/)
})

test("whole-source snapshots detect real copytruncate even when individual reads are stable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "support-observation-log-test-"))
  try {
    fs.writeFileSync(path.join(directory, "out.log"), "new events\n")
    fs.writeFileSync(path.join(directory, "out.log.1"), "old events\n")
    const names = ["out.log", "out.log.1"]
    const before = observationLogSourcesSnapshot(directory, names)
    assert.equal(before, observationLogSourcesSnapshot(directory, names))
    fs.copyFileSync(path.join(directory, "out.log"), path.join(directory, "out.log.1"))
    fs.truncateSync(path.join(directory, "out.log"), 0)
    assert.notEqual(before, observationLogSourcesSnapshot(directory, names))
  } finally { fs.rmSync(directory, { recursive: true }) }
})

test("CLI rejects malformed tenant before any production inspection and validates bounded JSON without echoing secrets", () => {
  const script = new URL("./inspect-support-ux-observation.mjs", import.meta.url)
  const report = summarize([event()])
  const env = { ...process.env, SUPPORT_UX_TENANT: tenantSlug, SUPPORT_UX_DAY: day }
  const output = execFileSync(process.execPath, [script.pathname, "--validate-output"], { env, input: JSON.stringify(report), encoding: "utf8" })
  assert.equal(JSON.parse(output).observationAdmitted, false)
  const rejected = spawnSync(process.execPath, [script.pathname], { env: { ...env, SUPPORT_UX_TENANT: "invalid'PRIVATE_TOKEN" }, encoding: "utf8" })
  assert.equal(rejected.status, 1)
  assert.deepEqual(JSON.parse(rejected.stdout), { schemaVersion: 1, status: "error", code: "INPUT_INVALID" })
  assert.equal(rejected.stderr, "")
  const oversized = spawnSync(process.execPath, [script.pathname, "--validate-output"], { env, input: "PRIVATE_TOKEN".repeat(30000), encoding: "utf8" })
  assert.equal(oversized.status, 1)
  assert.equal(oversized.stdout.includes("PRIVATE_TOKEN"), false)
})

test("production controller remains bounded/read-only and never spawns a shell", () => {
  const source = fs.readFileSync(new URL("./inspect-support-ux-observation.mjs", import.meta.url), "utf8")
  assert.match(source, /BEGIN READ ONLY/)
  assert.match(source, /ROLLBACK/)
  assert.match(source, /O_NOFOLLOW/)
  assert.match(source, /maxBuffer: 65536/)
  assert.match(source, /timeout: 12000/)
  assert.equal(/shell:\s*true/.test(source), false)
})
