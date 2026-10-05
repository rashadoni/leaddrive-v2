import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildObservationArtifact } from "./support-ux-observation-artifact.mjs"
import { summarizeObservationLogs } from "./inspect-support-ux-observation.mjs"

const env = {
  GITHUB_REPOSITORY: "rashadoni/leaddrive-v2", GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40), EXPECTED_MAIN_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "37230421845", GITHUB_RUN_ATTEMPT: "1",
  SUPPORT_UX_TENANT: "leaddrive", SUPPORT_UX_DAY: "2000-01-01",
}
const context = { tenantKey: "b".repeat(64), tenantSlug: env.SUPPORT_UX_TENANT, day: env.SUPPORT_UX_DAY }
const empty = () => summarizeObservationLogs([""], context)
const encode = (value) => JSON.stringify(value)
const script = fileURLToPath(new URL("./support-ux-observation-artifact.mjs", import.meta.url))

test("preserves exact run identity, empty traffic and explicit non-admission", () => {
  const result = buildObservationArtifact(encode(empty()), env)
  assert.equal(result.provenance.executionSha, env.GITHUB_SHA)
  assert.equal(result.provenance.runUrl, "https://github.com/rashadoni/leaddrive-v2/actions/runs/37230421845")
  assert.equal(result.collector.coverage.status, "UNVERIFIED")
  assert.equal(result.collector.observationAdmitted, false)
  assert.equal(result.admission.observationAdmitted, false)
  assert.equal(result.admission.continuity, "UNVERIFIED")
  for (const code of ["NO_OBSERVED_TRAFFIC", "ACTIVATION_RECEIPT_UNVERIFIED", "AUTHENTICATED_TENANT_REREAD_UNVERIFIED", "FULL_DAY_LOG_COVERAGE_UNVERIFIED", "PROCESS_CONTINUITY_UNVERIFIED", "TELEMETRY_LOSS_UNVERIFIED", "INCIDENT_REVIEW_UNVERIFIED"]) {
    assert.ok(result.admission.blockers.includes(code))
  }
})

test("keeps observed production source separate from workflow SHA and sample limits", () => {
  const event = {
    event: "support_ux_observation", schema_version: 1, observed_at_utc: "2000-01-01T00:00:00.000Z",
    artifact_sha: "c".repeat(40), tenant_key: context.tenantKey, operation: "CATEGORY_LIST",
    mode: "database", http_status: 200, outcome: "success", duration_ms: 12,
  }
  const report = summarizeObservationLogs([encode(event)], context)
  const result = buildObservationArtifact(encode(report), env)
  assert.equal(result.collector.groups[0].artifactSha, event.artifact_sha)
  assert.notEqual(result.collector.groups[0].artifactSha, result.provenance.executionSha)
  assert.ok(result.admission.blockers.includes("INSUFFICIENT_COMPARABLE_SAMPLES"))
  assert.ok(!result.admission.blockers.includes("NO_OBSERVED_TRAFFIC"))
  const unavailable = { event: "support_ux_observation_unavailable", schema_version: 1, reason: "CLOCK_UNAVAILABLE" }
  const withUnavailable = summarizeObservationLogs([encode(unavailable)], context)
  assert.ok(buildObservationArtifact(encode(withUnavailable), env).admission.blockers.includes("UNAVAILABLE_TELEMETRY_IN_RETAINED_SOURCES"))
})

test("rejects raw output, unknown fields, unsafe data, false admission and invalid counts", () => {
  const report = empty()
  const attacks = [
    "raw private log line",
    encode({ ...report, credentials: "DO_NOT_ECHO_SECRET" }),
    encode({ ...report, coverage: { ...report.coverage, rawLog: "DO_NOT_ECHO_SECRET" } }),
    encode({ ...report, groups: [{ categoryName: "private customer" }] }),
    encode({ ...report, observationAdmitted: true }),
    encode({ ...report, coverage: { ...report.coverage, status: "VERIFIED" } }),
    encode({ ...report, coverage: { ...report.coverage, bytesRead: -1 } }),
    encode({ ...report, tenantSlug: "https://unsafe.example/secret" }),
    encode({ ...report, day: "2000-01-02" }),
    encode({ schemaVersion: 1, status: "error", code: "LOGS_UNSAFE" }),
    " ".repeat(262145),
  ]
  for (const attack of attacks) assert.throws(() => buildObservationArtifact(attack, env), /ARTIFACT_INPUT_INVALID/)
})

test("rejects untrusted repository/ref, wrong tenant/day/SHA/run metadata and unsafe URLs", () => {
  for (const mutation of [
    { GITHUB_REPOSITORY: "other/repo" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_SHA: "d".repeat(40) }, { EXPECTED_MAIN_SHA: "short" },
    { GITHUB_RUN_ID: "https://unsafe.example" }, { GITHUB_RUN_ID: "1\n2" },
    { GITHUB_RUN_ATTEMPT: "0" }, { SUPPORT_UX_TENANT: "other" },
    { SUPPORT_UX_DAY: "2000-01-02" }, { SUPPORT_UX_DAY: "2000-02-30" },
  ]) assert.throws(() => buildObservationArtifact(encode(empty()), { ...env, ...mutation }), /ARTIFACT_INPUT_INVALID/)
  assert.throws(() => buildObservationArtifact(encode({ ...empty(), tenantSlug: "https://unsafe.example" }), { ...env, SUPPORT_UX_TENANT: "https://unsafe.example" }), /ARTIFACT_INPUT_INVALID/)
  assert.throws(() => buildObservationArtifact(encode(empty()), env, new Date(NaN)), /ARTIFACT_INPUT_INVALID/)
})

test("CLI persists only fixed safe JSON, rejects input without echo and never overwrites", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "support-observation-artifact-test-"))
  try {
    const invoke = (input) => spawnSync(process.execPath, [script], { input, encoding: "utf8", env: { ...env, RUNNER_TEMP: temp } })
    const invalid = invoke("DO_NOT_ECHO_SECRET")
    assert.equal(invalid.status, 1)
    assert.ok(!(invalid.stdout + invalid.stderr).includes("DO_NOT_ECHO_SECRET"))
    assert.deepEqual(fs.readdirSync(temp), [])
    const valid = invoke(encode(empty()))
    assert.equal(valid.status, 0)
    const file = path.join(temp, "support-ux-observation-evidence", "result.json")
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).admission.status, "NOT_ADMITTED")
    const original = fs.readFileSync(file, "utf8")
    assert.equal(invoke(encode(empty())).status, 1)
    assert.equal(fs.readFileSync(file, "utf8"), original)
    assert.equal(invoke(Buffer.from([0xff, 0xfe])).status, 1)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
