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
import { runnableCronLines } from "./helpers/installed-cron"

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
  writeFileSync(join(scripts, "cron-dispatch.sh"), "#!/bin/sh\nexit 0\n")
  chmodSync(join(scripts, "cron-dispatch.sh"), 0o755)
  execFileSync("bash", [INSTALLER], {
    env: { ...process.env, CRONTAB_STATE: state, LOG: join(root, "cron.log"), PATH: `${bin}:${process.env.PATH ?? ""}`, SCRIPTS: scripts },
    stdio: "pipe",
  })
  return readFileSync(state, "utf8")
}

/** Does a crontab minute field fire at minute 0, the minute every schedule shares? */
/** Does a crontab field (`*`, `N`, `A-B`, any of them with `/step`, comma lists) match `value`? */
function fieldMatches(field: string, value: number, max: number) {
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/")
    const step = stepText ? Number(stepText) : 1
    const [low, high] = range === "*" ? [0, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)]
    return value >= low && value <= high && (value - low) % step === 0
  })
}

/** Scheduled jobs of the installed crontab, as [minute, hour, target]. */
function activeTicks(crontab: string) {
  return runnableCronLines(crontab)
    .filter((line) => line.includes("cron-trigger.sh "))
    .map((line) => line.trim().split(/\s+/))
    .map((fields) => ({ minute: fields[0], hour: fields[1], target: fields[6] }))
}

/** Targets cron starts in each minute of a day, keyed "h:m". */
function startsPerMinute(crontab: string) {
  const ticks = activeTicks(crontab)
  const perMinute = new Map<string, string[]>()
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 1) {
      perMinute.set(
        `${hour}:${minute}`,
        ticks.filter((tick) => fieldMatches(tick.minute, minute, 59) && fieldMatches(tick.hour, hour, 23)).map((tick) => tick.target),
      )
    }
  }
  return perMinute
}

describe.skipIf(!hasTools)("the installed crontab spreads its ticks", () => {
  // cron forks, runs PAM and logs a session for every line due in a minute, all
  // in its first second (production 2026-11-08: 25 lines, /api/v1/ping 0.99 s).
  // So cron runs one line, the dispatcher, and every job is a `#@<second>`
  // line it starts in that second (scripts/cron-dispatch.sh).
  it("gives cron one line to start: the dispatcher", () => {
    const installed = installCrontab("17 * * * * /other/job\n")
    const block = installed.slice(installed.indexOf("# BEGIN LEADDRIVE RESILIENCE CRONS"))
    const cronLines = block.split("\n").filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    expect(cronLines).toEqual([`* * * * * ${join(root, "scripts", "cron-dispatch.sh")} >> ${join(root, "cron.log")} 2>&1`])
    expect(installed.startsWith("17 * * * * /other/job\n")).toBe(true)
    expect(installed).not.toContain("CRON_TRIGGER_SPREAD_SECONDS=")
  })

  it("starts each job in its target's own second, the one cron-trigger.sh used to sleep", () => {
    const jobs = installCrontab("").split("\n").filter((line) => line.startsWith("#@"))
    expect(jobs.length).toBeGreaterThan(30)
    for (const line of jobs) {
      const fields = line.split(/\s+/)
      expect(Number(fields[0].slice(2))).toBe(offsetOf(fields[7], 50))
    }
  })

  it("installs the same crontab again, with one dispatcher line", () => {
    const once = installCrontab("")
    const twice = installCrontab(once)
    expect(twice).toBe(once)
    expect(twice.split("\n").filter((line) => line.includes("cron-dispatch.sh"))).toHaveLength(1)
  })

  it("never starts more than two schedules in the same second of the busiest minute", () => {
    const busiest = [...startsPerMinute(installCrontab("")).values()].sort((a, b) => b.length - a.length)[0]
    expect(busiest.length).toBeGreaterThan(12)
    const perSecond = new Map<number, string[]>()
    for (const target of busiest) {
      const offset = offsetOf(target, 50)
      perSecond.set(offset, [...(perSecond.get(offset) ?? []), target])
    }
    const crowded = [...perSecond.entries()].filter(([, targets]) => targets.length > 2)
    expect(crowded).toEqual([])
  })

  // The spread moves each job's HTTP call, not its start: cron forks, runs PAM
  // and logs a session for every line due that minute in its first second.
  // Production 2026-11-08: 25 lines that only `sleep` put 41 threads in the run
  // queue and /api/v1/ping took 0.99 s; the five-minute jobs all on minutes
  // 0, 5, 10… made that every fifth minute (1.2 s). Now no minute starts more
  // than fifteen. A new five-minute job goes into the least busy phase.
  it("starts at most fifteen schedules in any minute of the day", () => {
    const perMinute = startsPerMinute(installCrontab(""))
    const crowded = [...perMinute.entries()].filter(([, targets]) => targets.length > 15)
    expect(crowded.map(([minute, targets]) => `${minute}: ${targets.length}`)).toEqual([])
    expect(activeTicks(installCrontab("")).filter((tick) => tick.minute === "*/5")).toEqual([])
  })
})
