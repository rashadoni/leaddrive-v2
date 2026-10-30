/**
 * Scheduled ticks are spread over the minute instead of all starting in its
 * first second.
 *
 * Measured on production 2026-10-28: cron started sixteen `cron-trigger.sh`
 * lines at once every minute, and for 2–3 s the run queue held 13–22 threads
 * on six cores. The web process had nothing to do and still waited for a
 * core — a request that takes 0.02 s took 0.4–1.4 s through nginx, and the
 * PBX station hung up a call whose "ringing" went unanswered for 2 s.
 *
 * `sleep` is replaced by a stand-in that writes down what it was asked to
 * wait, so the offsets are checked without waiting for them.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const ROOT = process.cwd()
const TRIGGER = join(ROOT, "scripts/cron-trigger.sh")
const INSTALLER = join(ROOT, "scripts/install-resilience-crons.sh")
// Port 1 is privileged and closed: curl fails to connect at once, which is all
// these tests need — what matters is what happened before the call.
const DEAD_APP_URL = "http://127.0.0.1:1"

const hasTools = ["flock", "cksum"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0)

let root: string
let bin: string
let sleeps: string

beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "cron-spread-"))
  bin = join(root, "bin")
  sleeps = join(root, "sleeps")
  mkdirSync(bin)
  writeFileSync(join(bin, "sleep"), `#!/bin/sh\necho "$1" >> "${sleeps}"\n`)
  chmodSync(join(bin, "sleep"), 0o755)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function runTrigger(target: string, env: Record<string, string> = {}) {
  return spawnSync("bash", [TRIGGER, target], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      CRON_LOCK_DIR: root,
      CRON_SECRET: "test-secret",
      APP_ENV_FILE: join(root, "no-such-app.env"),
      APP_URL: DEAD_APP_URL,
      CRON_MAX_TIME_SECONDS: "2",
      no_proxy: "*",
      NO_PROXY: "*",
      ...env,
    },
  })
}

const waited = () => (existsSync(sleeps) ? readFileSync(sleeps, "utf8").trim().split("\n").filter(Boolean).map(Number) : [])

/** The offset cron-trigger.sh derives for a target, computed the same way here. */
function offsetOf(target: string, window: number) {
  const sum = execFileSync("sh", ["-c", 'printf "%s" "$1" | cksum', "sh", target], { encoding: "utf8" })
  return Number(sum.trim().split(/\s+/)[0]) % window
}

describe.skipIf(!hasTools)("cron-trigger.sh spreads scheduled ticks over the minute", () => {
  it("waits the target's own offset, the same one every minute", () => {
    const target = "/api/cron/voice-call-queues"
    runTrigger(target, { CRON_TRIGGER_SPREAD_SECONDS: "50" })
    runTrigger(target, { CRON_TRIGGER_SPREAD_SECONDS: "50" })
    const expected = offsetOf(target, 50)
    expect(waited()).toEqual([expected, expected])
  })

  it("gives different targets different seconds", () => {
    for (const target of ["/api/cron/voice-call-queues", "/api/cron/booking-effects", "/api/v1/journeys/process"]) {
      runTrigger(target, { CRON_TRIGGER_SPREAD_SECONDS: "50" })
    }
    expect(new Set(waited()).size).toBe(3)
    for (const offset of waited()) expect(offset).toBeLessThan(50)
  })

  it("calls the endpoint after waiting, not instead of it", () => {
    const run = runTrigger("/api/cron/booking-effects", { CRON_TRIGGER_SPREAD_SECONDS: "50" })
    expect(waited()).toHaveLength(1)
    // Reaching curl is what the dead port proves.
    expect(run.stdout).toContain("ERROR - curl exited 7")
  })

  it("does not delay a run by hand, which does not set the window", () => {
    runTrigger("/api/cron/voice-call-queues")
    expect(waited()).toEqual([])
  })

  it("does not delay a verifier, which asks for an answer now", () => {
    runTrigger("/api/cron/voice-call-queues", {
      CRON_TRIGGER_SPREAD_SECONDS: "50",
      CRON_TRIGGER_LOCK_WAIT_SECONDS: "5",
    })
    expect(waited()).toEqual([])
  })

  it("refuses a window that would push a tick into the next minute", () => {
    const run = runTrigger("/api/cron/voice-call-queues", { CRON_TRIGGER_SPREAD_SECONDS: "90" })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("must stay under a minute")
    expect(waited()).toEqual([])
    expect(run.stdout).not.toContain("curl exited")
  })

  it("refuses a window that is not whole seconds", () => {
    const run = runTrigger("/api/cron/voice-call-queues", { CRON_TRIGGER_SPREAD_SECONDS: "0.5" })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("must be whole seconds")
  })
})

/** Runs the real installer against a stand-in `crontab` and returns what it installed. */
function installCrontab(initial: string) {
  const scripts = join(root, "scripts")
  const state = join(root, "crontab")
  mkdirSync(scripts, { recursive: true })
  writeFileSync(state, initial)
  writeFileSync(
    join(bin, "crontab"),
    `#!/bin/sh\nset -eu\nif [ "\${1:-}" = "-l" ]; then\n  cat "$CRONTAB_STATE"\nelse\n  cp "$1" "$CRONTAB_STATE"\nfi\n`,
  )
  chmodSync(join(bin, "crontab"), 0o755)
  writeFileSync(join(scripts, "cron-trigger.sh"), "#!/bin/sh\nexit 0\n")
  chmodSync(join(scripts, "cron-trigger.sh"), 0o755)
  execFileSync("bash", [INSTALLER], {
    env: { ...process.env, CRONTAB_STATE: state, LOG: join(root, "cron.log"), PATH: `${bin}:${process.env.PATH ?? ""}`, SCRIPTS: scripts },
    stdio: "pipe",
  })
  return readFileSync(state, "utf8")
}

/** Does a crontab minute field fire at minute 0, the minute every schedule shares? */
function firesAtMinuteZero(field: string) {
  return field.split(",").some((part) => part === "*" || /^\*\/\d+$/.test(part) || part === "0")
}

describe.skipIf(!hasTools)("the installed crontab spreads its ticks", () => {
  it("sets the window before the first tick, so every tick gets it", () => {
    const lines = installCrontab("").split("\n")
    const env = lines.indexOf("CRON_TRIGGER_SPREAD_SECONDS=50")
    const firstTick = lines.findIndex((line) => line.includes("cron-trigger.sh "))
    expect(env).toBeGreaterThan(-1)
    expect(env).toBeLessThan(firstTick)
  })

  it("keeps one window line when the installer runs again", () => {
    const reinstalled = installCrontab(installCrontab(""))
    expect(reinstalled.split("\n").filter((line) => line.startsWith("CRON_TRIGGER_SPREAD_SECONDS="))).toHaveLength(1)
  })

  it("never starts more than two schedules in the same second of the busiest minute", () => {
    const ticks = installCrontab("")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#") && line.includes("cron-trigger.sh "))
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => firesAtMinuteZero(fields[0]))
      .map((fields) => fields[6])
    expect(ticks.length).toBeGreaterThan(15)
    const perSecond = new Map<number, string[]>()
    for (const target of ticks) {
      const offset = offsetOf(target, 50)
      perSecond.set(offset, [...(perSecond.get(offset) ?? []), target])
    }
    const crowded = [...perSecond.entries()].filter(([, targets]) => targets.length > 2)
    expect(crowded).toEqual([])
  })
})
