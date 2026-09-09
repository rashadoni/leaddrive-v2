/**
 * The migration quiet window has to outwait ordinary traffic, not fail on it.
 *
 * Sixty seconds was not enough, and the script already knew: the no-migration
 * path skips the window entirely with a comment saying a collector lease
 * "simply never drops to 0 within 60s". The migration path had no such escape
 * and failed the whole deploy instead.
 *
 * Observed on 2026-08-25: three consecutive production deploys died here, every
 * attempt reporting `tx=1 system=1..2` — and a check moments later found no
 * non-idle session and no running lease at all. Nothing was stuck. Ordinary
 * periodic jobs are simply never all absent during one particular minute.
 *
 * What must NOT change is the meaning of the gate: it waits for quiet, it never
 * forces it. A genuinely stuck lease still has to fail the deploy rather than
 * let a migration run underneath live work.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

const windowFn = deployScript.slice(
  deployScript.indexOf("wait_for_migration_window() {"),
  deployScript.indexOf("new_build_has_pending_migrations()"),
)

describe("migration quiet window", () => {
  it("waits minutes rather than one minute", () => {
    expect(windowFn).toBeTruthy()
    const attempts = windowFn.match(/attempts=\$\{MIGRATION_WINDOW_ATTEMPTS:-(\d+)\}/)
    expect(attempts).toBeTruthy()
    // Five-second polls, so this is the wait in seconds divided by five. Sixty
    // attempts is five minutes; the old twelve was the minute that kept losing.
    expect(Number(attempts![1])).toBeGreaterThanOrEqual(36)
  })

  it("still refuses to migrate while anything is live", () => {
    // The whole value of this gate is the refusal. Waiting longer must not
    // become waiting less carefully.
    expect(windowFn).toContain('[ "$active_transactions" = "0" ]')
    expect(windowFn).toContain('[ "$live_system_jobs" = "0" ]')
    expect(windowFn).toContain('[ "$live_collector_jobs" = "0" ]')
    expect(windowFn).toContain('[ "$live_outbound_jobs" = "0" ]')
    expect(windowFn).toMatch(/fatal "migration quiet window unavailable/)
  })

  it("does not print a line every five seconds", () => {
    // Five seconds apart reads as a hang and buries the line that matters.
    expect(windowFn).toMatch(/attempt % 6/)
  })
})
