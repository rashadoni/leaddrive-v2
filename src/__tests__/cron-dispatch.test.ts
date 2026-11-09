/**
 * scripts/cron-dispatch.sh — the one crontab line that starts every LeadDrive
 * schedule, each job in its own second of the minute.
 *
 * Why it exists: cron forks, runs PAM and logs a session for every line due in
 * a minute, all in the minute's first second. Production 2026-11-08: 25 lines
 * that only `sleep` made /api/v1/ping take 0.99 s instead of 0.05 s, and after
 * the five-minute jobs were spread over phases the eleven every-minute lines
 * still cost 0.3–0.7 s at the top of every minute.
 *
 * If the dispatcher misreads the schedule, every job stops or runs at the
 * wrong time, and nothing else would notice — so its reading of cron's syntax
 * is checked against an independent one over a whole day, and its launching
 * against real commands.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const ROOT = process.cwd()
const DISPATCH = join(ROOT, "scripts/cron-dispatch.sh")
const INSTALLER = join(ROOT, "scripts/install-resilience-crons.sh")
const BEGIN = "# BEGIN LEADDRIVE RESILIENCE CRONS"
const END = "# END LEADDRIVE RESILIENCE CRONS"

const hasTools = ["awk", "cksum", "sort"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0)

let root: string
let bin: string
let state: string

beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "cron-dispatch-"))
  bin = join(root, "bin")
  state = join(root, "crontab")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "crontab"),
    `#!/bin/sh\nset -eu\nif [ "\${1:-}" = "-l" ]; then\n  cat "$CRONTAB_STATE"\nelse\n  cp "$1" "$CRONTAB_STATE"\nfi\n`,
  )
  chmodSync(join(bin, "crontab"), 0o755)
  // Records each wait instead of waiting.
  writeFileSync(join(bin, "sleep"), `#!/bin/sh\necho "$1" >> "${join(root, "sleeps")}"\n`)
  chmodSync(join(bin, "sleep"), 0o755)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const epochOf = (utc: string) => Math.floor(Date.parse(`${utc}Z`) / 1000)

function dispatch(crontab: string, epoch: number, env: Record<string, string> = {}) {
  writeFileSync(state, crontab)
  return spawnSync("bash", [DISPATCH], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      TZ: "UTC",
      CRONTAB_STATE: state,
      CRON_DISPATCH_EPOCH: String(epoch),
      ...env,
    },
  })
}

function dueAt(crontab: string, epoch: number) {
  const run = dispatch(crontab, epoch, { CRON_DISPATCH_DRY_RUN: "1" })
  expect(run.status).toBe(0)
  return run.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [second, command] = line.split("\t")
      return { second: Number(second), command }
    })
}

/** cron's field rule, written independently of the dispatcher's awk. */
function fieldMatches(field: string, value: number, low: number, high: number) {
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/")
    const step = stepText ? Number(stepText) : 1
    let from: number
    let to: number
    if (range === "*") [from, to] = [low, high]
    else if (range.includes("-")) [from, to] = range.split("-").map(Number)
    else [from, to] = stepText ? [Number(range), high] : [Number(range), Number(range)]
    return value >= from && value <= to && (value - from) % step === 0
  })
}

function installedCrontab() {
  const scripts = join(root, "scripts")
  mkdirSync(scripts, { recursive: true })
  for (const name of ["cron-trigger.sh", "cron-dispatch.sh"]) {
    writeFileSync(join(scripts, name), "#!/bin/sh\nexit 0\n")
    chmodSync(join(scripts, name), 0o755)
  }
  writeFileSync(state, "")
  execFileSync("bash", [INSTALLER], {
    env: { ...process.env, CRONTAB_STATE: state, LOG: join(root, "cron.log"), PATH: `${bin}:${process.env.PATH ?? ""}`, SCRIPTS: scripts },
    stdio: "pipe",
  })
  return readFileSync(state, "utf8")
}

describe.skipIf(!hasTools)("cron-dispatch.sh reads the schedule as cron would", () => {
  it("starts exactly the installed jobs cron would have started, across a whole day", () => {
    const crontab = installedCrontab()
    const jobs = crontab
      .split("\n")
      .filter((line) => line.startsWith("#@"))
      .map((line) => {
        const fields = line.split(" ")
        return { minute: fields[1], hour: fields[2], command: fields.slice(6).join(" ") }
      })
    // Every 7th minute walks through all minute phases and every hour.
    for (let at = 0; at < 24 * 60; at += 7) {
      const hour = Math.floor(at / 60)
      const minute = at % 60
      const expected = jobs
        .filter((job) => fieldMatches(job.minute, minute, 0, 59) && fieldMatches(job.hour, hour, 0, 23))
        .map((job) => job.command)
        .sort()
      const stamp = `2026-11-09T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`
      const got = dueAt(crontab, epochOf(stamp)).map((job) => job.command).sort()
      expect(got, stamp).toEqual(expected)
    }
  }, 120_000)

  it("follows day, month and weekday the way cron does", () => {
    const crontab = [
      BEGIN,
      "#@0 0 9 * * 1 monday",
      "#@0 0 9 15 * * fifteenth",
      "#@0 0 9 15 * 1 fifteenth-or-monday",
      "#@0 0 9 * 11 * november",
      "#@0 0 9 * * 7 sunday-as-seven",
      "#@0 0 9 * * 0 sunday-as-zero",
      END,
    ].join("\n")
    const names = (utc: string) => dueAt(crontab, epochOf(utc)).map((job) => job.command).sort()
    // 2026-11-09 is a Monday, 2026-11-15 a Sunday, 2026-12-15 a Tuesday.
    expect(names("2026-11-09T09:00:00")).toEqual(["fifteenth-or-monday", "monday", "november"])
    expect(names("2026-11-15T09:00:00")).toEqual(["fifteenth", "fifteenth-or-monday", "november", "sunday-as-seven", "sunday-as-zero"])
    expect(names("2026-12-15T09:00:00")).toEqual(["fifteenth", "fifteenth-or-monday"])
    expect(names("2026-11-09T09:01:00")).toEqual([])
  })

  it("reads only the managed block, and not the plain comments in it", () => {
    const crontab = [
      "#@0 * * * * * outside-the-block",
      BEGIN,
      "* * * * * /scripts/cron-dispatch.sh >> /log 2>&1",
      "# 4-59/5 * * * * disabled-by-comment",
      "#@5 * * * * * inside",
      END,
    ].join("\n")
    expect(dueAt(crontab, epochOf("2026-11-09T10:04:00"))).toEqual([{ second: 5, command: "inside" }])
  })

  it("orders the jobs by their second and keeps the whole command", () => {
    const crontab = [BEGIN, "#@40 * * * * * /t.sh /api/b >> /log 2>&1", "#@3 * * * * * /t.sh /api/a >> /log 2>&1", END].join("\n")
    expect(dueAt(crontab, epochOf("2026-11-09T10:04:00"))).toEqual([
      { second: 3, command: "/t.sh /api/a >> /log 2>&1" },
      { second: 40, command: "/t.sh /api/b >> /log 2>&1" },
    ])
  })

  it("reports a line it cannot read instead of guessing, and still starts the rest", () => {
    const crontab = [BEGIN, "#@1 */0 * * * * zero-step", "#@2 * * * mon * names", "#@3 * * * *", "#@70 * * * * * late", "#@4 * * * * * fine", END].join("\n")
    const run = dispatch(crontab, epochOf("2026-11-09T10:04:00"), { CRON_DISPATCH_DRY_RUN: "1" })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe("4\tfine\n")
    for (const bad of ["zero-step", "names", "#@3 * * * *", "late"]) expect(run.stderr).toContain(bad)
  })

  it("starts nothing and says so when the crontab cannot be read", () => {
    writeFileSync(join(bin, "crontab"), "#!/bin/sh\nexit 1\n")
    const run = spawnSync("bash", [DISPATCH], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? ""}` } })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("cannot read the crontab")
  })
})

describe.skipIf(!hasTools)("cron-dispatch.sh starts each job in its second", () => {
  it("waits for each job's second, then runs it as cron would, without a second wait", () => {
    const out = join(root, "out")
    const crontab = [
      BEGIN,
      `#@30 * * * * * echo "late $CRON_TRIGGER_SPREAD_SECONDS" >> ${out}`,
      `#@10 * * * * * echo "early $CRON_TRIGGER_SPREAD_SECONDS" >> ${out}`,
      `#@20 0 0 1 1 * echo never >> ${out}`,
      END,
    ].join("\n")
    // The minute began long ago, so the dispatcher asks to wait from that
    // minute's start: the stand-in sleep records it and returns at once.
    const minute = Math.floor(Date.now() / 1000 / 60) * 60 + 3600
    const run = dispatch(crontab, minute, { CRON_TRIGGER_SPREAD_SECONDS: "50" })
    expect(run.status).toBe(0)
    for (let i = 0; i < 50 && !(existsSync(out) && readFileSync(out, "utf8").split("\n").filter(Boolean).length === 2); i += 1) {
      execFileSync("sh", ["-c", "command sleep 0.1"])
    }
    expect(readFileSync(out, "utf8").split("\n").filter(Boolean).sort()).toEqual(["early 0", "late 0"])
    const waits = readFileSync(join(root, "sleeps"), "utf8").split("\n").filter(Boolean).map(Number)
    expect(waits).toHaveLength(2)
    // Waits come in second order: the later job never starts before the earlier.
    expect(waits[0]).toBeGreaterThan(0)
    expect(waits[1]).toBeGreaterThanOrEqual(waits[0])
  })
})
