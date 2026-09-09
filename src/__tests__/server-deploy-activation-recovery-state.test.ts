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

/**
 * A deployment that dies mid-activation leaves a journal on the host. The next
 * deployment reads it, rolls the activation back, and continues — that part
 * works, and it is what "Rolled back / Recovered interrupted immutable
 * operations activation" in the log means.
 *
 * What did not work: to perform the rollback, the recovery adopts the
 * journal's state into this shell — snapshot taken, /etc written, activation
 * in flight. Those values describe the world BEFORE the rollback. Once the
 * rollback is proven they are false, and nothing was resetting them, so the
 * deployment's own activation then refused to start:
 *
 *   FATAL: operations system configuration was already snapshotted
 *
 * On 2026-09-07 that turned a successful recovery into a failed release —
 * the host had a journal precisely because earlier releases had been failing,
 * so every attempt recovered and then blocked itself.
 *
 * The `finalized` branch of the same function already resets what its own
 * outcome invalidates. These tests hold that the rollback branch does too.
 */
describe("interrupted operations activation recovery", () => {
  const recover = functionBody("recover_pending_operations_activation")

  const rollbackTail = recover.slice(
    recover.indexOf('log "Recovering interrupted immutable operations activation'),
  )

  it("clears every state flag the adopted journal had set", () => {
    // Exactly the variables the adoption block above assigns. If someone adds
    // a new one there and not here, the next recovery blocks the release again.
    for (const assignment of [
      'OPERATIONS_SYSTEM_CONFIG_SNAPSHOT=false',
      'OPERATIONS_SYSTEM_CONFIG_APPLIED=false',
      'OPERATIONS_ACTIVATION_STARTED=false',
      'OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR=""',
      'OPERATIONS_SYSTEM_CONFIG_RELEASE_ROOT=""',
      'OPS_CURRENT_PREVIOUS_TARGET=""',
      'OPS_CURRENT_NEW_TARGET=""',
      'OPS_CURRENT_SWITCHED=false',
      'OPS_POINTER_SWITCH_INTENT=false',
      'OPERATIONS_CRONTAB_BEFORE=""',
      'OPERATIONS_CRONTAB_EXPECTED=""',
      'OPERATIONS_CRONTAB_INTENT=false',
      'OPERATIONS_CRONTAB_MUTATED=false',
    ]) {
      expect(rollbackTail, `${assignment} must be reset after a proven rollback`).toContain(
        assignment,
      )
    }
  })

  it("resets only after the rollback is proven, never before", () => {
    const rollbackAt = rollbackTail.indexOf("rollback_operations_activation_on_exit")
    const resetAt = rollbackTail.indexOf("OPERATIONS_SYSTEM_CONFIG_SNAPSHOT=false")
    expect(rollbackAt).toBeGreaterThan(-1)
    // Clearing the flags before the rollback would leave the rollback with
    // nothing to act on and silently strand the host's /etc.
    expect(resetAt).toBeGreaterThan(rollbackAt)
  })

  it("lets a fresh snapshot proceed after a recovery, and still blocks a real double snapshot", () => {
    // Run the actual guard from snapshot_operations_system_config against both
    // states, so this is behaviour and not a string match.
    const guard =
      '[ "$OPERATIONS_SYSTEM_CONFIG_SNAPSHOT" = "false" ] || { echo REFUSED; exit 9; }; echo PROCEEDED'

    const afterRecovery = spawnSync(
      "bash",
      ["-c", `set -u\nOPERATIONS_SYSTEM_CONFIG_SNAPSHOT=false\n${guard}`],
      { encoding: "utf8" },
    )
    expect(afterRecovery.stdout).toContain("PROCEEDED")
    expect(afterRecovery.status).toBe(0)

    const genuineDouble = spawnSync(
      "bash",
      ["-c", `set -u\nOPERATIONS_SYSTEM_CONFIG_SNAPSHOT=true\n${guard}`],
      { encoding: "utf8" },
    )
    expect(genuineDouble.stdout).toContain("REFUSED")
    expect(genuineDouble.status).toBe(9)
  })

  it("keeps the finalized branch resetting its own outcome", () => {
    // The precedent this fix follows; if it ever regresses, the same class of
    // bug comes back through the other terminal branch.
    const finalized = recover.slice(recover.indexOf('if [ "$phase" = "finalized" ]'))
    expect(finalized).toContain("OPERATIONS_ACTIVATION_STARTED=false")
    expect(finalized).toContain("OPERATIONS_RELEASE_FINALIZED=true")
  })
})
