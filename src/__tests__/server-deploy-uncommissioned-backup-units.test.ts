import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

function functionBody(name: string): string {
  const start = deployScript.indexOf(`${name}() {`)
  expect(start, `${name} must exist`).toBeGreaterThan(-1)
  const end = deployScript.indexOf("\n}\n", start)
  expect(end, `${name} must be a complete function`).toBeGreaterThan(start)
  return deployScript.slice(start, end)
}

/** Run a fragment of the deploy script under bash with the given stubs. */
function runShell(lines: string[]): { status: number | null; out: string } {
  const result = spawnSync("bash", ["-c", ["set -uo pipefail", ...lines].join("\n")], {
    encoding: "utf8",
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

/**
 * The four recovery runners — postgres-backup, secrets-snapshot,
 * runtime-files-snapshot, log-ship — belong to a backup subsystem that is
 * commissioned per host through docs/BACKUP_RUNBOOK.md. Production was
 * commissioned for a Hetzner host shipping to an off-site destination that no
 * longer exists; the host moved and the subsystem was deliberately retired.
 *
 * The deploy nevertheless demanded that subsystem's persistent locks before it
 * would activate ANY release-owned operations, so from 2026-09-05 every
 * release died on "PostgreSQL backup persistent lock authority is missing",
 * and a read-only readiness report on 2026-09-07 counted 43 such findings on
 * the host. That is the failure mode already written into this file's recovery
 * gate: a gate demanding inputs the host was never given does not protect
 * production, it makes production unreachable.
 *
 * So this mirrors the recovery gate exactly — two modes, chosen from the host
 * (BACKUP_ENCRYPTION=age) and never from the artifact.
 *
 * The invariant that matters most is the LAST one in this file: the
 * application's own cron scripts, the release tree and the logrotate policy
 * are installed by the same function and are not part of that subsystem, so
 * they must keep being installed in both modes. A blunt skip would have
 * silently stopped the application's scheduled work.
 */
describe("production deploy operations activation on a host without the backup subsystem", () => {
  const acquire = functionBody("acquire_operations_runner_locks")
  const install = functionBody("install_release_owned_operations")

  it("decides from the host's commissioning state, not from the artifact", () => {
    expect(deployScript).toContain("operations_backup_subsystem_is_commissioned() {")
    // One source of truth: the same host authority the recovery gate reads.
    expect(functionBody("operations_backup_subsystem_is_commissioned")).toContain(
      'event_platform_recovery_gate_mode',
    )
  })

  it("skips the runner locks when the subsystem is not commissioned", () => {
    const { status, out } = runShell([
      'log() { printf "%s\\n" "$*"; }',
      'event_platform_recovery_gate_mode() { printf plain; }',
      'open_operations_runner_lock() { echo "OPENED_A_LOCK"; return 1; }',
      'OPERATIONS_BACKUP_LOCK_FD=""; OPERATIONS_SECRETS_LOCK_FD=""',
      'OPERATIONS_RUNTIME_FILES_LOCK_FD=""; OPERATIONS_LOG_LOCK_FD=""',
      functionBody("operations_backup_subsystem_is_commissioned"),
      "}",
      acquire,
      "}",
      "acquire_operations_runner_locks; echo \"rc=$?\"",
    ])
    expect(status).toBe(0)
    expect(out).toContain("rc=0")
    expect(out).toContain("skipped")
    // It must not even try: the lock files belong to programs that are absent.
    expect(out).not.toContain("OPENED_A_LOCK")
  })

  it("still demands every lock when the subsystem IS commissioned", () => {
    const { out } = runShell([
      'log() { printf "%s\\n" "$*"; }',
      'event_platform_recovery_gate_mode() { printf commissioned; }',
      'open_operations_runner_lock() { echo "OPENED_A_LOCK"; return 1; }',
      'OPERATIONS_BACKUP_LOCK_FD=""; OPERATIONS_SECRETS_LOCK_FD=""',
      'OPERATIONS_RUNTIME_FILES_LOCK_FD=""; OPERATIONS_LOG_LOCK_FD=""',
      functionBody("operations_backup_subsystem_is_commissioned"),
      "}",
      acquire,
      "}",
      "acquire_operations_runner_locks; echo \"rc=$?\"",
    ])
    // The real path runs and fails closed on the stubbed-out lock.
    expect(out).toContain("OPENED_A_LOCK")
    expect(out).toContain("rc=1")
  })

  it("does not install the subsystem's unit files on such a host", () => {
    const unitLoop = install.indexOf('for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"')
    expect(unitLoop).toBeGreaterThan(-1)
    const guard = install.lastIndexOf("operations_backup_subsystem_is_commissioned", unitLoop)
    expect(guard, "the unit install loop must sit behind the mode guard").toBeGreaterThan(-1)
    expect(install.slice(guard, unitLoop)).not.toContain("\nfi\n")
  })

  it("does not verify units it did not install", () => {
    // systemd-analyze verify on absent unit files fails; it must be gated too.
    const verifyAt = install.indexOf("systemd-analyze verify")
    expect(verifyAt).toBeGreaterThan(-1)
    const guard = install.lastIndexOf("operations_backup_subsystem_is_commissioned", verifyAt)
    expect(guard).toBeGreaterThan(-1)
    expect(install.slice(guard, verifyAt)).not.toContain("\n  fi\n")
  })

  it("stops the subsystem's timers instead of enabling them", () => {
    const plainBranch = install.slice(
      install.indexOf("if ! operations_backup_subsystem_is_commissioned; then"),
    )
    expect(plainBranch).toContain('systemctl disable --now "$timer"')
    expect(plainBranch).toContain("is still scheduled on a host where the backup subsystem is not commissioned")
    // It must return before the enable loop; otherwise the timers it just
    // stopped are started again three lines later.
    const returnAt = plainBranch.indexOf("return 0")
    const enableAt = plainBranch.indexOf('systemctl enable --now "$timer"')
    expect(returnAt).toBeGreaterThan(-1)
    expect(enableAt).toBeGreaterThan(returnAt)
  })

  it("keeps installing everything that is NOT part of that subsystem", () => {
    // The application's scheduled work and log rotation live in the same
    // function and must survive in both modes. If any of these ever moves
    // behind the guard, production silently stops running its own cron jobs.
    for (const call of [
      'install_release_owned_operations "$APP_DIR/.next/standalone" full-recovery',
      "migrate_legacy_cron_paths",
      'run_resilience_cron_installer "$RESILIENCE_CRON_INSTALLER"',
    ]) {
      expect(deployScript).toContain(call)
    }
    const logrotate = install.indexOf('for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"')
    const plainBranchAt = install.indexOf("if ! operations_backup_subsystem_is_commissioned; then")
    expect(logrotate).toBeGreaterThan(-1)
    expect(logrotate).toBeLessThan(plainBranchAt)
    expect(install).toContain('cp -- "$artifact_root/scripts/release-cron-script-manifest.txt"')
  })

  it("leaves the commissioned path byte-for-byte as it was", () => {
    // The enable loop, its log-ship fence and its assertions are untouched.
    expect(install).toContain('systemctl enable --now "$timer"')
    expect(install).toContain('fatal "$timer is not enabled after installation"')
    expect(install).toContain('fatal "$timer is not active after installation"')
    expect(install).toContain(
      'fatal "$timer must remain disabled at the current recovery activation stage"',
    )
  })
})
