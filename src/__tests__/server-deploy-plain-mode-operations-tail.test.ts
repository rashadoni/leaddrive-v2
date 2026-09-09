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
 * The tail of a deployment installs the release-owned operations (cron
 * scripts, systemd units, logrotate rules) and then completes the immutable
 * log-evidence genesis. Both steps demand evidence that only the offline
 * `certify-offline-restore` ceremony can produce, and that ceremony needs a
 * private age identity and an independent host — things a production server
 * is designed never to hold.
 *
 * On an uncommissioned host the result was not safety. From 2026-09-05 the
 * application deployed, health-checked green, and then the run exited 1, so
 * the operations assets were never installed: production ran cron scripts
 * from 8fbd00c410c6 against an application many releases newer, and every
 * deploy reported failure after a successful cutover. A deploy that is always
 * red is how the next real failure goes unread.
 *
 * These tests hold the shape of the fix: the skip is keyed on the host's own
 * commissioning state, it is limited to the ordinary release path, and the
 * bootstrap ceremony — whose entire purpose is the signed chain — keeps its
 * certificate unconditionally.
 */
describe("production deploy operations tail on an uncommissioned host", () => {
  const certify = functionBody("validate_certified_recovery_program_set")

  it("skips the offline certificate only for the ordinary release scope", () => {
    expect(certify).toContain('[ "$expected_scope" = "full-recovery" ]')
    expect(certify).toContain('[ "$(event_platform_recovery_gate_mode)" = "plain" ]')

    // The skip must be decided before the marker is required, or the missing
    // file fails the deployment before the mode is ever consulted.
    const skipAt = certify.indexOf("event_platform_recovery_gate_mode")
    const markerAt = certify.indexOf('assert_root_owned_nonwritable_file "offline restore marker"')
    expect(skipAt).toBeGreaterThan(-1)
    expect(markerAt).toBeGreaterThan(skipAt)
  })

  it("never skips the certificate for the bootstrap ceremony", () => {
    // The bootstrap call site passes its own marker and scope; the guard above
    // names full-recovery, so this path cannot fall through it.
    expect(deployScript).toContain(
      'validate_certified_recovery_program_set "$stage" "$BACKUP_BOOTSTRAP_RESTORE_MARKER"',
    )
    expect(certify).not.toContain('"log-genesis-bootstrap-only" ]] && [ "$(event_platform')
  })

  /** The top-level `if/else/fi` around the release path's genesis call. */
  function releaseGenesisBlock(): string {
    const guardAt = deployScript.lastIndexOf(
      'if [ "$(event_platform_recovery_gate_mode)" = "plain" ]; then',
    )
    expect(guardAt, "the release path must guard the genesis on the host mode").toBeGreaterThan(-1)
    const endAt = deployScript.indexOf("\nfi\n", guardAt)
    expect(endAt).toBeGreaterThan(guardAt)
    return deployScript.slice(guardAt, endAt + 4)
  }

  it("guards the log-evidence genesis in the release path but not in the ceremony", () => {
    const block = releaseGenesisBlock()
    expect(block).toContain("skipping the immutable log-evidence genesis")
    // Commissioned hosts still run it: the call lives in the else branch.
    expect(block).toMatch(/\nelse\n\s+complete_log_evidence_genesis\n/)

    // The bootstrap ceremony calls it inside its own function and must keep
    // calling it unconditionally — that run is what creates the anchor.
    const ceremony = functionBody("run_recovery_bootstrap_deploy")
    expect(ceremony).toContain("  complete_log_evidence_genesis")
    expect(ceremony).not.toContain("event_platform_recovery_gate_mode")
  })

  it("still closes the operations activation journal when the genesis is skipped", () => {
    // Otherwise the operations pointer stays mid-transaction and the next
    // deployment inherits an ambiguous recovery boundary.
    const block = releaseGenesisBlock()
    const after = deployScript.slice(deployScript.indexOf(block) + block.length)
    expect(block).not.toContain("finalize_operations_activation_after_genesis")
    expect(after.trimStart().startsWith("finalize_operations_activation_after_genesis")).toBe(true)
  })
})
