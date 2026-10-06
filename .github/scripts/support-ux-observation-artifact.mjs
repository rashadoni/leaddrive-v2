// Persist only the existing strict collector's sanitized public projection.
// No production access, raw-log input retention, credentials or admission writes.
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { validateObservationOutput } from "./inspect-support-ux-observation.mjs"

const MAX_BYTES = 262144
const REPOSITORY = "rashadoni/leaddrive-v2"
const SHA = /^[a-f0-9]{40}$/
const BLOCKERS = [
  "ACTIVATION_RECEIPT_UNVERIFIED",
  "AUTHENTICATED_TENANT_REREAD_UNVERIFIED",
  "EFFECTIVE_INFO_LOGGING_UNVERIFIED",
  "FULL_DAY_LOG_COVERAGE_UNVERIFIED",
  "PROCESS_CONTINUITY_UNVERIFIED",
  "TELEMETRY_LOSS_UNVERIFIED",
  "AUTH_KEY_CONTINUITY_UNVERIFIED",
  "DEPLOYMENT_FLAG_CHRONOLOGY_UNVERIFIED",
  "INCIDENT_REVIEW_UNVERIFIED",
  "MATCHED_HANDLER_BASELINE_UNVERIFIED",
]
const fail = () => { throw new Error("ARTIFACT_INPUT_INVALID") }

export function buildObservationArtifact(text, env, now = new Date()) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES
    || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/main"
    || !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(env.SUPPORT_UX_TENANT ?? "")
    || !SHA.test(env.GITHUB_SHA ?? "") || env.GITHUB_SHA !== env.EXPECTED_MAIN_SHA
    || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? "")
    || !/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT ?? "")
    || !Number.isFinite(now.getTime())) fail()
  let result
  try {
    result = validateObservationOutput(JSON.parse(text), env.SUPPORT_UX_TENANT, env.SUPPORT_UX_DAY)
  } catch { fail() }
  // Failed collectors must fail the workflow, never leave a success artifact.
  if (result.status === "error") fail()
  // Rebuild the JSON value rather than storing or copying the original input.
  const collector = JSON.parse(JSON.stringify(result))
  const blockers = [...BLOCKERS]
  if (collector.status === "no-observed-traffic") blockers.push("NO_OBSERVED_TRAFFIC")
  if (collector.coverage.unavailableTelemetryEventsInRetainedSources > 0) {
    blockers.push("UNAVAILABLE_TELEMETRY_IN_RETAINED_SOURCES")
  }
  if (collector.groups.some((group) => !group.comparableSampleCount)) {
    blockers.push("INSUFFICIENT_COMPARABLE_SAMPLES")
  }
  return {
    schemaVersion: 1,
    kind: "support-ux-observation-evidence",
    generatedAtUtc: now.toISOString(),
    provenance: {
      repository: REPOSITORY,
      workflowPath: ".github/workflows/tail-app-logs.yml",
      executionSha: env.GITHUB_SHA,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      runUrl: "https://github.com/" + REPOSITORY + "/actions/runs/" + env.GITHUB_RUN_ID,
    },
    collector,
    admission: {
      status: "NOT_ADMITTED",
      observationAdmitted: false,
      coverage: "UNVERIFIED",
      continuity: "UNVERIFIED",
      blockers,
    },
  }
}

function main() {
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const count = fs.readSync(0, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    if (length > MAX_BYTES) fail()
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))
    const artifact = buildObservationArtifact(text, process.env)
    const temp = process.env.RUNNER_TEMP
    if (typeof temp !== "string" || !path.isAbsolute(temp)) fail()
    // Fixed, fresh directory: never overwrite or follow a pre-existing artifact.
    const directory = path.join(temp, "support-ux-observation-evidence")
    fs.mkdirSync(directory, { mode: 0o700 })
    fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(artifact, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    process.stdout.write("Support observation evidence saved; admission remains NOT_ADMITTED.\n")
  } catch {
    // Never echo the offending input, environment, file path or exception.
    process.stderr.write("Support observation artifact validation failed.\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
