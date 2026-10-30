import { readFileSync, writeFileSync, lstatSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

// BEGIN IDENTITY RELEASE PURE CONTRACT
export function parseIdentityArtifact(raw, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("IDENTITY_ARTIFACT_SHA_INVALID")
  if (raw === "") return null
  if (Buffer.byteLength(raw) > 512) throw new Error("IDENTITY_ARTIFACT_INVALID")
  const value = JSON.parse(raw)
  if (!value || Object.keys(value).length !== 3 || value.version !== 1
    || value.contract !== "identity-canonical-auth/v1" || value.artifactSha !== sha) throw new Error("IDENTITY_ARTIFACT_INVALID")
  return { version: 1, contract: value.contract, artifactSha: sha }
}
export function parseIdentityReleaseState(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 512) throw new Error("IDENTITY_RELEASE_STATE_INVALID")
  const state = JSON.parse(raw)
  if (!state || Object.keys(state).length !== 4 || typeof state.expanded !== "boolean"
    || !Number.isSafeInteger(state.canonicalCount) || state.canonicalCount < 0
    || state.readOnly !== true || state.rlsUnfiltered !== true
    || (!state.expanded && state.canonicalCount !== 0)) throw new Error("IDENTITY_RELEASE_STATE_INVALID")
  return state
}
export function admitIdentityArtifact(state, candidate, rollback = false, drained = false) {
  // A rollout flag cannot make a person legacy again. The retained cutover
  // marker is the floor, including disabled people and suspended companies.
  if (rollback && !drained) throw new Error("IDENTITY_ROLLBACK_DRAIN_REQUIRED")
  // Historical recovery executes a historical deploy script. Once expansion
  // exists, refuse that route even with zero current accounts: an otherwise
  // permitted conversion could race a preflight followed by old-script staging.
  if (!rollback && state.expanded && !candidate) throw new Error("IDENTITY_LEGACY_RECOVERY_FORBIDDEN")
  if (state.canonicalCount > 0 && !candidate) throw new Error("IDENTITY_LEGACY_ARTIFACT_FORBIDDEN")
}
// END IDENTITY RELEASE PURE CONTRACT

function inspectionHelpers() {
  const source = readFileSync(new URL("../event-platform/inspect-production.sh", import.meta.url), "utf8")
  const boundary = "\nreport_connection_file_metadata() {"
  if (source.split(boundary).length !== 2) throw new Error("IDENTITY_INSPECTION_HELPERS_CHANGED")
  return source.split(boundary)[0]
}
export function identityStateScript(drained = false) {
  const sql = readFileSync(new URL("./release-state.sql", import.meta.url), "utf8")
    .replace("app.identity_release_require_drained = 'off'", "app.identity_release_require_drained = '" + (drained ? "on" : "off") + "'")
  return inspectionHelpers() + '\nrun_readonly_psql "$IDENTITY_RELEASE_DB_URL" 2>/dev/null <<\'IDENTITY_STATE_SQL\'\n' + sql + "IDENTITY_STATE_SQL\n"
}
export function readIdentityArtifact(directory, requireRoot = true) {
  const marker = path.join(directory, ".identity-backend-contract.json")
  try { lstatSync(marker) } catch (error) { if (error.code === "ENOENT") return null; throw error }
  for (const file of [directory, marker, path.join(directory, ".deploy-sha")]) {
    const stat = lstatSync(file)
    if (stat.isSymbolicLink() || (requireRoot && (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022)))) throw new Error("IDENTITY_ARTIFACT_UNSAFE")
  }
  const raw = readFileSync(marker, "utf8")
  if (!raw) throw new Error("IDENTITY_ARTIFACT_INVALID")
  return parseIdentityArtifact(raw, readFileSync(path.join(directory, ".deploy-sha"), "utf8").trim())
}
function databaseState(drained) {
  const deadline = Date.now() + 15000
  do {
    const result = spawnSync("bash", ["-s"], { input: identityStateScript(drained), encoding: "utf8",
      timeout: Math.max(1, deadline - Date.now()), maxBuffer: 8192, env: process.env })
    if (result.status !== 0) throw new Error("IDENTITY_RELEASE_STATE_UNAVAILABLE")
    if (result.stdout.trim() !== "IDENTITY_WRITERS_BUSY") return parseIdentityReleaseState(result.stdout.trim())
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  } while (Date.now() < deadline)
  throw new Error("IDENTITY_WRITERS_NOT_DRAINED")
}
/** Current-main admission executes before staging even a historical artifact.
 * The candidate cannot supply the program that decides its compatibility. */
export function emitIdentityAdmission(sha, raw) {
  const candidate = parseIdentityArtifact(raw, sha)
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const core = source.split("// BEGIN IDENTITY RELEASE PURE CONTRACT")[1]?.split("// END IDENTITY RELEASE PURE CONTRACT")[0]?.replaceAll("export function ", "function ")
  if (!core) throw new Error("IDENTITY_RELEASE_EMISSION_FAILED")
  const sql = readFileSync(new URL("./release-state.sql", import.meta.url), "utf8")
  return inspectionHelpers() + `
require_root_file /etc/leaddrive/migration.env 600 || exit 1
identity_release_url="$(read_static_env_value /etc/leaddrive/migration.env MIGRATION_DATABASE_URL)" || exit 1
identity_release_state="$(run_readonly_psql "$identity_release_url" 2>/dev/null <<'IDENTITY_STATE_SQL'
${sql}IDENTITY_STATE_SQL
)" || exit 1
IDENTITY_RELEASE_STATE="$identity_release_state" node <<'IDENTITY_ADMISSION_JS'
${core}
try {
  admitIdentityArtifact(parseIdentityReleaseState(process.env.IDENTITY_RELEASE_STATE),${JSON.stringify(candidate)});
  console.log('identity_artifact_admission=PASS');
} catch { console.error('identity_artifact_admission=BLOCKED');process.exitCode=1; }
IDENTITY_ADMISSION_JS
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2)
    if (mode === "--write-manifest") {
      const [directory, sha] = args
      const marker = parseIdentityArtifact(JSON.stringify({ version: 1, contract: "identity-canonical-auth/v1", artifactSha: sha }), sha)
      writeFileSync(path.join(directory, ".identity-backend-contract.json"), JSON.stringify(marker) + "\n", { flag: "wx", mode: 0o600 })
    } else if (mode === "--emit-admission") process.stdout.write(emitIdentityAdmission(args[0], readFileSync(0, "utf8").trim()))
    else if (mode === "--check-admission") {
      const [candidateFile, sha] = args
      admitIdentityArtifact(databaseState(false), parseIdentityArtifact(readFileSync(candidateFile, "utf8").trim(), sha))
      process.stdout.write("identity_artifact_admission=PASS\n")
    } else if (mode === "--check-rollback") {
      const [directory, drained] = args
      if (drained !== "true") throw new Error("IDENTITY_ROLLBACK_DRAIN_REQUIRED")
      admitIdentityArtifact(databaseState(true), readIdentityArtifact(directory), true, true)
      process.stdout.write("identity_rollback_admission=PASS\n")
    } else throw new Error("IDENTITY_RELEASE_COMMAND_INVALID")
  } catch {
    // Neither credentials, SQL errors, filenames from the artifact nor values
    // read from the database are suitable for deployment logs.
    process.stderr.write("IDENTITY_RELEASE_ADMISSION_BLOCKED\n")
    process.exitCode = 1
  }
}
