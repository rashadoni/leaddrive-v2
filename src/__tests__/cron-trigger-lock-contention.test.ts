import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * Deploy run 33415973322 went red on a healthy production because the
 * every-minute `/api/cron/voice-call-queues` schedule happened to hold the
 * local flock at the moment the verification step asked the same endpoint to
 * prove itself. `cron-trigger.sh` printed SKIPPED and exited 0 without ever
 * calling the endpoint, the step asserted on `"success":true`, and the failure
 * skipped six unrelated checks behind it.
 *
 * SKIPPED is neither a pass nor a failure — it is the absence of a measurement.
 * These tests pin the three outcomes that follow from that: schedules still
 * skip, verifiers wait and then measure, and a lock that never frees is a real
 * error that stays out of the stream the caller asserts on.
 */

const TRIGGER = join(process.cwd(), "scripts/cron-trigger.sh")
// Port 1 is privileged and closed: curl fails to connect immediately, which is
// all these tests need — reaching curl at all proves the lock was acquired.
const DEAD_APP_URL = "http://127.0.0.1:1"
const TARGET = "/api/cron/lock-contention-probe"
const LOCK_NAME = "leaddrive-_api_cron_lock-contention-probe.lock"

const hasFlock = spawnSync("flock", ["--version"]).status === 0

function runTrigger(lockDir: string, env: Record<string, string> = {}) {
  return spawnSync("bash", [TRIGGER, TARGET], {
    encoding: "utf8",
    env: {
      ...process.env,
      CRON_LOCK_DIR: lockDir,
      CRON_SECRET: "test-secret",
      APP_ENV_FILE: join(lockDir, "no-such-app.env"),
      APP_URL: DEAD_APP_URL,
      CRON_MAX_TIME_SECONDS: "2",
      no_proxy: "*",
      NO_PROXY: "*",
      ...env,
    },
  })
}

/** Holds the lock until `release()`; `cat` keeps the fd open until stdin ends. */
async function holdLock(lockFile: string) {
  const child = spawn("flock", ["-x", lockFile, "-c", "printf R; cat"], {
    stdio: ["pipe", "pipe", "ignore"],
  })
  let held = false
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("R")) {
        held = true
        resolve()
      }
    })
    child.on("error", reject)
    child.on("exit", () => {
      if (!held) reject(new Error("lock holder exited before acquiring"))
    })
  })
  return {
    release: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.on("exit", () => resolve())
        child.stdin.end()
      }),
  }
}

/** Holds the lock for `seconds`, releasing on its own clock; resolves once held. */
async function holdLockFor(lockFile: string, seconds: number) {
  const child = spawn("flock", ["-x", lockFile, "-c", `printf R; sleep ${seconds}`], {
    stdio: ["ignore", "pipe", "ignore"],
  })
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("R")) resolve()
    })
    child.on("error", reject)
    child.on("exit", () => reject(new Error("lock holder exited before acquiring")))
  })
}

// Never skipped on CI. A silent skip on the one gate guarding this behaviour
// would be the same "unverified reads as verified" trap the fix is about, and
// nothing on that box can run a cron without flock anyway. Locally it still
// degrades, so a machine without util-linux does not get a red file.
const skipContention = !hasFlock && !process.env.CI

describe.skipIf(skipContention)("cron-trigger.sh under local lock contention", () => {
  let lockDir: string
  let lockFile: string

  beforeEach(() => {
    lockDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "cron-lock-"))
    lockFile = join(lockDir, LOCK_NAME)
  })

  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true })
  })

  it("still lets an unattended schedule skip rather than stack up", async () => {
    const holder = await holdLock(lockFile)
    try {
      const result = runTrigger(lockDir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        "SKIPPED - previous local invocation still running",
      )
    } finally {
      await holder.release()
    }
  })

  it("waits for the holder and then actually calls the endpoint", async () => {
    // The holder must free the lock on its own clock: runTrigger is synchronous
    // and pins the event loop, so a timer in this process could not release it.
    await holdLockFor(lockFile, 2)
    const started = Date.now()

    const result = runTrigger(lockDir, { CRON_TRIGGER_LOCK_WAIT_SECONDS: "20" })

    // Getting past the lock is the whole point: the endpoint was contacted, so
    // the step's assertion is made against a real response instead of a skip.
    // Either curl outcome proves that; which one depends on the network the
    // test happens to run on, and that is not what is under test here.
    const combined = result.stdout + result.stderr
    expect(combined).not.toContain("SKIPPED")
    expect(combined).not.toContain("lock still held")
    expect(combined).toMatch(/curl exited|HTTP \d/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(500)
  })

  it("fails, rather than skips, when the lock never frees", async () => {
    const holder = await holdLock(lockFile)
    try {
      const result = runTrigger(lockDir, {
        CRON_TRIGGER_LOCK_WAIT_SECONDS: "1",
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("lock still held after 1s")
      // The caller captures stdout to assert on the endpoint's response. A
      // diagnostic explaining why there is no response must not land inside
      // the text being matched, or it becomes the thing under test.
      expect(result.stdout).toBe("")
    } finally {
      await holder.release()
    }
  })

  it("rejects a non-numeric wait budget instead of silently not waiting", () => {
    const result = runTrigger(lockDir, {
      CRON_TRIGGER_LOCK_WAIT_SECONDS: "2 minutes",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("must be whole seconds")
    expect(existsSync(lockFile)).toBe(true)
  })
})

describe("deploy workflow scheduler verification", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github/workflows/deploy.yml"),
    "utf8",
  )

  it("gives every cron-trigger verification a lock budget", () => {
    const calls = workflow
      .split("\n")
      .filter((line) => line.includes("cron-scripts/cron-trigger.sh"))
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).toContain("CRON_TRIGGER_LOCK_WAIT_SECONDS=")
    }
  })

  it("lets each post-deploy check report independently of the others", () => {
    // One probe losing a race must not decide whether the rest get measured.
    const [, deployJob] = workflow.split(
      "      - name: Deploy atomically on production\n",
    )
    expect(deployJob).toBeDefined()
    // Other jobs have their own orchestration. Keep this assertion scoped to
    // deploy's post-release probes so their setup steps cannot be mistaken for
    // production smoke checks.
    //
    // The boundary is "the next job", not the name of whichever job currently
    // follows. Cutting at a literal `recovery:` made the scope depend on file
    // order: a job added between deploy and recovery was swept in, and the
    // failure read as "your step is not decoupled" when the step was not a
    // post-deploy probe at all. Job headers are the only two-space keys under
    // `jobs:`; everything inside a job is indented deeper.
    const [afterDeploy] = deployJob.split(/\n {2}[A-Za-z_][A-Za-z0-9_-]*:\n/)
    const steps = afterDeploy.split("\n      - name: ").slice(1)
    expect(steps.length).toBeGreaterThanOrEqual(11)
    for (const step of steps) {
      const [title] = step.split("\n")
      const decoupled =
        step.includes("if: ${{ !cancelled() && steps.deploy_atomic.outcome") ||
        step.includes("if: always()")
      expect(decoupled, `post-deploy step is not decoupled: ${title}`).toBe(true)
    }
  })
})
