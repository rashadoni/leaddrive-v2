import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync, spawn } from "node:child_process"
import { parseIdentityArtifact, parseIdentityReleaseState, admitIdentityArtifact, readIdentityArtifact, identityStateScript, emitIdentityAdmission } from "./release-contract.mjs"

const sha = "a".repeat(40)
const artifact = { version: 1, contract: "identity-canonical-auth/v1", artifactSha: sha }
const state = (changes = {}) => ({ expanded: false, canonicalCount: 0, readOnly: true, rlsUnfiltered: true, ...changes })
test("identity artifacts distinguish absent historical support from tampering", () => {
  assert.equal(parseIdentityArtifact("", sha), null)
  assert.deepEqual(parseIdentityArtifact(JSON.stringify(artifact), sha), artifact)
  for (const value of [null, [], {}, { ...artifact, version: 2 }, { ...artifact, contract: "other" }, { ...artifact, artifactSha: "b".repeat(40) }, { ...artifact, extra: 1 }]) {
    assert.throws(() => parseIdentityArtifact(JSON.stringify(value), sha))
  }
  assert.throws(() => parseIdentityArtifact("x".repeat(513), sha))
  assert.throws(() => parseIdentityArtifact("", "$(invalid)"))
})
test("state is bounded, unfiltered, read-only and coherent", () => {
  assert.deepEqual(parseIdentityReleaseState(JSON.stringify(state())), state())
  for (const value of [null, {}, state({ rlsUnfiltered: false }), state({ readOnly: false }), state({ canonicalCount: 1 }), state({ canonicalCount: -1 }), state({ canonicalCount: 1.1 }), state({ extra: true })]) {
    assert.throws(() => parseIdentityReleaseState(JSON.stringify(value)))
  }
})
test("canonical people prevent legacy rollback even when a feature flag is disabled", () => {
  const canonical = state({ expanded: true, canonicalCount: 1 })
  assert.throws(() => admitIdentityArtifact(canonical, null, true, true), /LEGACY_ARTIFACT_FORBIDDEN/)
  assert.doesNotThrow(() => admitIdentityArtifact(canonical, artifact, true, true))
  assert.throws(() => admitIdentityArtifact(canonical, artifact, true, false), /DRAIN_REQUIRED/)
  // A fresh zero-count snapshot after process drain permits same-deploy health
  // rollback. Historical scripts are never admitted after schema expansion.
  const shadow = state({ expanded: true })
  assert.doesNotThrow(() => admitIdentityArtifact(shadow, null, true, true))
  assert.throws(() => admitIdentityArtifact(shadow, null), /LEGACY_RECOVERY_FORBIDDEN/)
  assert.doesNotThrow(() => admitIdentityArtifact(state(), null))
})
test("local artifact marker is SHA-bound and cannot be a symlink or empty marker", () => {
  const root = mkdtempSync(path.join(tmpdir(), "identity-artifact-"))
  try {
    assert.equal(readIdentityArtifact(root, false), null)
    writeFileSync(path.join(root, ".deploy-sha"), sha)
    writeFileSync(path.join(root, ".identity-backend-contract.json"), JSON.stringify(artifact))
    assert.deepEqual(readIdentityArtifact(root, false), artifact)
    writeFileSync(path.join(root, ".deploy-sha"), "b".repeat(40))
    assert.throws(() => readIdentityArtifact(root, false))
    writeFileSync(path.join(root, ".identity-backend-contract.json"), "")
    assert.throws(() => readIdentityArtifact(root, false))
    rmSync(path.join(root, ".identity-backend-contract.json"))
    symlinkSync(path.join(root, ".deploy-sha"), path.join(root, ".identity-backend-contract.json"))
    assert.throws(() => readIdentityArtifact(root, false))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
const deploy = readFileSync("scripts/server-deploy.sh", "utf8")
function deploymentFunction(name) {
  const start = deploy.indexOf(name + "() {")
  assert.ok(start >= 0)
  return deploy.slice(start, deploy.indexOf("\n}", start) + 2)
}
test("actual restore drains and refuses incompatible bytes before copying or restarting", () => {
  for (const allowed of [false, true]) {
    const root = mkdtempSync(path.join(tmpdir(), "identity-restore-"))
    try {
      mkdirSync(path.join(root, "app/.next/standalone"), { recursive: true })
      mkdirSync(path.join(root, "backup/standalone"), { recursive: true })
      writeFileSync(path.join(root, "app/.next/standalone/test-value"), "candidate")
      writeFileSync(path.join(root, "backup/standalone/test-value"), "previous")
      const shell = `set -eu
APP_DIR='${root}/app'
BACKUP_PATH='${root}/backup'
IDENTITY_RELEASE_CONTROLLER=reviewed-identity-controller
IDENTITY_RELEASE_AUTO_RECOVERY_BLOCKED=false
STANDALONE_REPLACED=true
log() { :; }
persist_event_platform_pm2_stop_fence() { printf 'stop\\n' >> '${root}/trace'; }
with_booking_release_database() { printf 'verify:%s\\n' "$*" >> '${root}/trace'; return ${allowed ? 0 : 1}; }
ensure_booking_rollback_compatible() { printf 'booking\\n' >> '${root}/trace'; }
safe_remove_tree() { rm -rf -- "$1"; }
${deploymentFunction("ensure_identity_rollback_compatible")}
${deploymentFunction("restore_standalone_before_pm2")}
if restore_standalone_before_pm2; then printf 'allowed'; else printf 'blocked'; fi
printf ':%s' "$IDENTITY_RELEASE_AUTO_RECOVERY_BLOCKED"
`
      const result = spawnSync("bash", ["-s"], { input: shell, encoding: "utf8" })
      assert.equal(result.status, 0)
      assert.equal(result.stdout, allowed ? "allowed:false" : "blocked:true")
      assert.equal(readFileSync(path.join(root, "app/.next/standalone/test-value"), "utf8"), allowed ? "previous" : "candidate")
      const trace = readFileSync(path.join(root, "trace"), "utf8").trim().split("\n")
      assert.equal(trace[0], "stop")
      assert.match(trace[1], /--check-rollback .* true$/)
      assert.equal(trace.length, allowed ? 3 : 2)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
test("emitted current-main preflight rejects historical recovery without executing candidate code", () => {
  const script = emitIdentityAdmission(sha, "")
  const js = script.split("node <<'IDENTITY_ADMISSION_JS'\n")[1].split("\nIDENTITY_ADMISSION_JS")[0]
  for (const expanded of [false, true]) {
    const result = spawnSync(process.execPath, ["-e", js], { encoding: "utf8", env: { ...process.env, IDENTITY_RELEASE_STATE: JSON.stringify(state({ expanded })) } })
    assert.equal(result.status, expanded ? 1 : 0)
    assert.doesNotMatch(result.stderr, /password|postgresql|cutoverAt/)
  }
})
test("both process recovery paths call identity admission before restoring bytes", () => {
  for (const name of ["restore_standalone_before_pm2", "recover_application_handoff"]) {
    const source = deploymentFunction(name)
    assert.ok(source.indexOf("ensure_identity_rollback_compatible") < source.indexOf("safe_remove_tree"))
  }
  assert.match(deploymentFunction("rollback_replaced_standalone_on_exit"), /IDENTITY_RELEASE_AUTO_RECOVERY_BLOCKED/)
})
test("application environment cannot redirect or disable identity release admission", () => {
  for (const key of ["IDENTITY_RELEASE_CONTROLLER", "IDENTITY_RELEASE_AUTO_RECOVERY_BLOCKED", "IDENTITY_RELEASE_CONTROL_DIR", "IDENTITY_RELEASE_DB_URL", "identity_control_file"]) {
    const result = spawnSync("bash", ["-s", "--", key], { input: `set -eu\nfatal() { exit 17; }\n${deploymentFunction("assert_dotenv_key_allowed")}\nassert_dotenv_key_allowed app "$1"`, encoding: "utf8" })
    assert.equal(result.status, 17)
  }
  for (const key of ["IDENTITY_MOBILE_SESSION_KEYS", "IDENTITY_PHONE_PROOF_KEYS"]) {
    const result = spawnSync("bash", ["-s", "--", key], { input: `set -eu\nfatal() { exit 17; }\n${deploymentFunction("assert_dotenv_key_allowed")}\nassert_dotenv_key_allowed app "$1"`, encoding: "utf8" })
    assert.equal(result.status, 0)
  }
})
test("recovery preserves current-main identity admission before historical checkout and runs it before staging", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8")
  const preserve = workflow.indexOf('cp scripts/identity/release-contract.mjs scripts/identity/release-state.sql "$admission/scripts/identity/"')
  const historical = workflow.indexOf("Checkout deployment script from the recovered revision")
  const admission = workflow.indexOf('node "$RUNNER_TEMP/booking-current-main-admission/scripts/identity/release-contract.mjs"')
  const staging = workflow.indexOf("Stage exact retained recovery artifact on production disk")
  assert.ok(preserve > 0 && preserve < historical && historical < admission && admission < staging)
})
test("build marker carries exact revision, cannot overwrite an existing marker and emitted shell parses", () => {
  const root = mkdtempSync(path.join(tmpdir(), "identity-marker-"))
  try {
    const args = [new URL("./release-contract.mjs", import.meta.url).pathname, "--write-manifest", root, sha]
    assert.equal(spawnSync(process.execPath, args).status, 0)
    assert.deepEqual(parseIdentityArtifact(readFileSync(path.join(root, ".identity-backend-contract.json"), "utf8").trim(), sha), artifact)
    assert.equal(spawnSync(process.execPath, args).status, 1)
    assert.equal(spawnSync("bash", ["-n"], { input: emitIdentityAdmission(sha, JSON.stringify(artifact)) }).status, 0)
    assert.equal(spawnSync("bash", ["-n"], { input: identityStateScript(true) }).status, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const databaseUrl = process.env.IDENTITY_RELEASE_TEST_DATABASE_URL
test("real PostgreSQL drain rejects a canonical commit finishing after process exit", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl)
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname))
  assert.equal(url.pathname, "/identity_snapshot_contract_test")
  const database = `identity_release_contract_test_${process.pid}`
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "postgres" }
  const sql = (input, db = database) => spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", timeout: 10000, env: { ...env, PGDATABASE: db } })
  assert.equal(sql(`CREATE DATABASE ${database}`, "postgres").status, 0)
  const scratch = new URL(url); scratch.pathname = "/" + database
  const inspect = drained => spawnSync("bash", ["-s"], { input: identityStateScript(drained), encoding: "utf8", timeout: 10000, env: { ...process.env, IDENTITY_RELEASE_DB_URL: scratch.href } })
  const legacyArtifact = mkdtempSync(path.join(tmpdir(), "identity-pg-rollback-"))
  let held, heldExit
  try {
    assert.deepEqual(parseIdentityReleaseState(inspect(false).stdout.trim()), state())
    assert.equal(sql('CREATE TABLE identity_accounts(id text PRIMARY KEY,"cutoverAt" timestamptz);').status, 0)
    assert.deepEqual(parseIdentityReleaseState(inspect(false).stdout.trim()), state({ expanded: true }))
    assert.equal(sql(`ALTER ROLE CURRENT_USER IN DATABASE ${database} SET default_transaction_isolation='repeatable read'`).status, 0)
    held = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { env: { ...env, PGDATABASE: database }, stdio: ["pipe", "ignore", "ignore"] })
    heldExit = new Promise(resolve => { held.once("exit", resolve); held.once("error", () => resolve(-1)) })
    held.stdin.end("BEGIN; INSERT INTO identity_accounts VALUES ('late',now()); SELECT pg_sleep(3); COMMIT;")
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      ready = Number(sql("SELECT count(*) FROM pg_locks WHERE relation='identity_accounts'::regclass AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND mode='RowExclusiveLock'").stdout.trim()) > 0
      if (!ready) await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(ready, true)
    const during = inspect(true)
    assert.equal(during.status, 0)
    assert.equal(during.stdout.trim(), "IDENTITY_WRITERS_BUSY")
    const began = Date.now()
    const rollback = spawnSync(process.execPath, [new URL("./release-contract.mjs", import.meta.url).pathname,
      "--check-rollback", legacyArtifact, "true"], { encoding: "utf8", timeout: 20000,
      env: { ...process.env, IDENTITY_RELEASE_DB_URL: scratch.href } })
    assert.equal(rollback.status, 1)
    assert.equal(rollback.stderr.trim(), "IDENTITY_RELEASE_ADMISSION_BLOCKED")
    assert.ok(Date.now() - began > 500, "controller must wait for the in-flight canonical commit")
    assert.equal(await heldExit, 0)
    const after = parseIdentityReleaseState(inspect(true).stdout.trim())
    assert.equal(after.canonicalCount, 1)
    assert.throws(() => admitIdentityArtifact(after, null, true, true), /LEGACY_ARTIFACT_FORBIDDEN/)
    assert.doesNotThrow(() => admitIdentityArtifact(after, artifact, true, true))
  } finally {
    if (held && held.exitCode === null) { held.kill(); await heldExit }
    assert.equal(sql(`DROP DATABASE ${database}`, "postgres").status, 0)
    rmSync(legacyArtifact, { recursive: true, force: true })
  }
})
