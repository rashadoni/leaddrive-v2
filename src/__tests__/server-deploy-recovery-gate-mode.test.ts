import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

const scratch = mkdtempSync(join(tmpdir(), "recovery-gate-mode-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/**
 * Run the real gate-mode function out of the deploy script against a fake
 * backup environment file, and return exactly what a `$(...)` caller would see.
 *
 * This is the test that matters. A source-text match cannot catch the failure
 * this function actually had in production: `log` writes to stdout, so a
 * diagnostic printed here was captured by the command substitution, the value
 * became "[14:03:55] Recovery gate: …plain" instead of "plain", every
 * comparison against "plain" failed, and the deploy walked into the
 * commissioned ceremony it cannot satisfy.
 */
function resolveGateMode(backupEnv: string | null): string {
  const envPath = join(scratch, "backup.env")
  if (backupEnv === null) {
    rmSync(envPath, { force: true })
  } else {
    writeFileSync(envPath, backupEnv)
  }

  const start = deployScript.indexOf("event_platform_recovery_gate_mode() {")
  const end = deployScript.indexOf("\n}\n", start) + 3
  // The function under test, with its one dependency and its host path stubbed.
  const harness = [
    "set -u",
    'log() { echo "[stub-log] $1"; }',
    'fatal_after_standalone_replacement() { echo "FATAL: $1" >&2; exit 1; }',
    "read_static_env_value() {",
    `  sed -nE 's/^'"$2"'[[:space:]]*=[[:space:]]*//p' "$1"`,
    "}",
    'EVENT_PLATFORM_RECOVERY_GATE_MODE=""',
    deployScript
      .slice(start, end)
      .replaceAll("/etc/leaddrive/backup.env", envPath),
    "event_platform_recovery_gate_mode",
  ].join("\n")

  return execFileSync("bash", ["-c", harness], { encoding: "utf8" })
}

function functionBody(name: string): string {
  const start = deployScript.indexOf(`${name}() {`)
  expect(start, `${name} must exist`).toBeGreaterThan(-1)
  const end = deployScript.indexOf("\n}\n", start)
  expect(end, `${name} must be a complete function`).toBeGreaterThan(start)
  return deployScript.slice(start, end)
}

/**
 * The Fund cutover's encrypted, Object-Locked recovery ceremony is the reviewed
 * authority on a commissioned host. On a host that was never commissioned it
 * cannot pass at all, and between 2026-09-05 and 2026-09-07 it blocked every
 * release. These tests hold the two-mode split in place: the commissioned path
 * must stay exactly as reviewed, and the plain path must still take and prove a
 * recovery point rather than skip one.
 */
describe("production deploy recovery-gate mode", () => {
  it("returns exactly the mode word, with no log output mixed into it", () => {
    // Byte-exact: a caller compares this against the literal "plain".
    expect(resolveGateMode("BACKUP_ENCRYPTION=off\n")).toBe("plain")
    expect(resolveGateMode("BACKUP_ENCRYPTION=age\n")).toBe("commissioned")
    expect(resolveGateMode("")).toBe("plain")
    expect(resolveGateMode(null)).toBe("plain")
    // Only the literal age setting may claim the commissioned ceremony.
    expect(resolveGateMode("BACKUP_ENCRYPTION=aged\n")).toBe("plain")
    expect(resolveGateMode("BACKUP_ENCRYPTION=AGE\n")).toBe("plain")
    expect(resolveGateMode("BACKUP_ENCRYPTION=none\n")).toBe("plain")
  })

  it("keeps the mode function silent on stdout", () => {
    const mode = functionBody("event_platform_recovery_gate_mode")
    // log() writes to stdout and this function's stdout is its return value.
    expect(mode).not.toMatch(/^\s*log\s/m)
  })

  it("chooses the mode from the host's backup encryption, not from the artifact", () => {
    const mode = functionBody("event_platform_recovery_gate_mode")

    expect(mode).toContain("read_static_env_value /etc/leaddrive/backup.env BACKUP_ENCRYPTION")
    expect(mode).toContain('EVENT_PLATFORM_RECOVERY_GATE_MODE="commissioned"')
    expect(mode).toContain('EVENT_PLATFORM_RECOVERY_GATE_MODE="plain"')
    // Only the literal age setting may select the reviewed ceremony.
    expect(mode).toContain('if [ "$encryption" = "age" ]; then')
    // No workflow input, environment variable or artifact file may pick it.
    expect(mode).not.toMatch(/DEPLOY_MODE|GITHUB_|ARTIFACT_DEPLOY_SHA/)
  })

  it("keeps the commissioned ceremony reachable and unchanged when age is active", () => {
    const preconditions = functionBody("validate_event_platform_backup_preconditions")
    const plainBranch = preconditions.indexOf('if [ "$(event_platform_recovery_gate_mode)" = "plain" ]')
    const ageRequirement = preconditions.indexOf("Fund cutover requires age-encrypted PostgreSQL backups")
    const recipientRequirement = preconditions.indexOf("Fund cutover requires an offline BACKUP_AGE_RECIPIENT")
    const authorityPolicy = preconditions.indexOf("overrides the reviewed recovery authority")

    expect(plainBranch).toBeGreaterThan(-1)
    expect(ageRequirement).toBeGreaterThan(plainBranch)
    expect(recipientRequirement).toBeGreaterThan(plainBranch)
    expect(authorityPolicy).toBeGreaterThan(plainBranch)
  })

  it("still creates and proves a recovery point in plain mode", () => {
    const plainBackup = functionBody("backup_event_platform_pilot_database_plain")

    // A dump alone is not a recovery point: it must restore into a throwaway
    // database and match the fenced source row for row.
    expect(plainBackup).toContain("pg_dump -Fc -Z6")
    expect(plainBackup).toContain("pg_restore --no-owner --no-privileges --single-transaction")
    expect(plainBackup).toContain('[ "$canary_counts" = "$source_counts" ]')
    expect(plainBackup).toContain("canary restore row counts")
    expect(plainBackup).toContain("validate_event_platform_recovery_evidence")
    expect(plainBackup).toContain("validate_event_platform_backup_preconditions fenced")

    const dumpAt = plainBackup.indexOf("pg_dump -Fc -Z6")
    const restoreAt = plainBackup.indexOf("pg_restore --no-owner")
    const countCompareAt = plainBackup.indexOf('[ "$canary_counts" = "$source_counts" ]')
    const evidenceAt = plainBackup.indexOf("validate_event_platform_recovery_evidence")
    expect(restoreAt).toBeGreaterThan(dumpAt)
    expect(countCompareAt).toBeGreaterThan(restoreAt)
    expect(evidenceAt).toBeGreaterThan(countCompareAt)
  })

  it("binds a plain recovery point to this artifact, database and exact bytes on retry", () => {
    const plainEvidence = functionBody("validate_plain_recovery_point_evidence")

    expect(plainEvidence).toContain('[ "$artifact_sha" = "$ARTIFACT_DEPLOY_SHA" ]')
    expect(plainEvidence).toContain("plain pre-pilot recovery point belongs to another database instance")
    expect(plainEvidence).toContain('[ "$(sha256sum "$dump_path" | awk \'{print $1}\')" = "$dump_sha" ]')
    // A commissioned recovery record must never be accepted by the plain path.
    expect(plainEvidence).toContain('"3:verified:$EVENT_PLATFORM_PLAIN_RECOVERY_POINT_KIND"')
  })

  it("proves the host can dump and restore before the write fence closes", () => {
    const plainPreconditions = functionBody("validate_plain_recovery_point_preconditions")

    for (const command of ["pg_dump", "pg_restore", "createdb", "dropdb", "runuser", "psql"]) {
      expect(plainPreconditions).toContain(command)
    }
    expect(plainPreconditions).toContain("peer-authenticated postgres superuser access")
    expect(plainPreconditions).toContain("ensure_root_only_backup_directory")
    expect(plainPreconditions).toContain("plain recovery point needs")
  })
})
