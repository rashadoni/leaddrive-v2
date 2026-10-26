import { execFile, spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * The scheduler has a server process of its own (pm2 `leaddrive-v2-jobs`).
 *
 * Measured on production 2026-10-26: the single web process sat at 0–1% CPU
 * between scheduled ticks and at 50–140% inside them — every minute ~20 jobs in
 * the same second, every fifth minute more, the social poll for 96 s — and
 * Node runs JavaScript on one thread, so /api/v1/ping went from 0.1 s to 7 s and
 * each of a dashboard's requests waited 4–11 s. The fix only holds while four
 * things stay true together: pm2 starts the second process, cron-trigger.sh
 * posts there (except where the web process's own memory is the point), the
 * deploy takes it down and brings it up with the web app without ever rolling
 * the web app back on its account, and every job that restarts the web app into
 * a new environment restarts this one too — it keeps its own copy, and runs the
 * jobs those keys steer.
 */

const ROOT = process.cwd()
const TRIGGER = join(ROOT, "scripts/cron-trigger.sh")

function loadApps(env: Record<string, string | undefined> = {}) {
  const saved: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    const source = readFileSync(join(ROOT, "ecosystem.config.cjs"), "utf8")
    const module_ = { exports: {} as { apps: Array<Record<string, any>> } }
    new Function("module", "process", "require", source)(module_, process, () => ({}))
    return module_.exports.apps
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const megabytes = (value: string) => Number(/^(\d+)M$/.exec(value)?.[1] ?? Number.NaN)

describe("pm2 runs the scheduler beside the web app", () => {
  it("starts the same bundle twice, the second on loopback :3002", () => {
    const apps = loadApps({ SOFTPHONE_RELAY_SECRET: undefined, SOFTPHONE_PBX_SECRET: undefined })
    const web = apps.find((a) => a.name === "leaddrive-v2")!
    const jobs = apps.find((a) => a.name === "leaddrive-v2-jobs")!
    expect(jobs).toBeTruthy()
    expect(jobs.script).toBe(web.script)
    expect(jobs.cwd).toBe(web.cwd)
    expect(String(jobs.env.PORT)).toBe("3002")
    expect(String(web.env.PORT)).toBe("3001")
    // Same environment apart from where it listens: a job must not behave
    // differently because of the process it landed in.
    const { PORT: _webPort, HOSTNAME: _webHost, ...webEnv } = web.env
    const { PORT: _jobsPort, HOSTNAME: _jobsHost, ...jobsEnv } = jobs.env
    expect(jobsEnv).toEqual(webEnv)
  })

  it("keeps the jobs port off every other interface, whatever the web bind is", () => {
    const apps = loadApps({ APP_HOSTNAME: "0.0.0.0" })
    expect(apps.find((a) => a.name === "leaddrive-v2-jobs")!.env.HOSTNAME).toBe("127.0.0.1")
  })

  it("writes the jobs' logs to their own files", () => {
    const apps = loadApps()
    const web = apps.find((a) => a.name === "leaddrive-v2")!
    const jobs = apps.find((a) => a.name === "leaddrive-v2-jobs")!
    expect(jobs.out_file).not.toBe(web.out_file)
    expect(jobs.error_file).not.toBe(web.error_file)
  })

  it("lets the web process grow past the sawtooth pm2 was killing it on", () => {
    // pm2 logged `exceeds --max-memory-restart` 5–15 times a day at 1536M while
    // the process swung between ~1.0 and 1.6 GB; each kill was ~30 s of 502s.
    const web = loadApps().find((a) => a.name === "leaddrive-v2")!
    expect(megabytes(web.max_memory_restart)).toBeGreaterThanOrEqual(2048)
  })
})

const hasTools =
  spawnSync("flock", ["--version"]).status === 0 && spawnSync("curl", ["--version"]).status === 0

type Seen = { method: string; url: string; secret: string | undefined }
type Respond = (req: IncomingMessage) => { status: number; body: string } | null

async function serve(respond: Respond) {
  const seen: Seen[] = []
  const server: Server = createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", secret: req.headers["x-cron-secret"] as string | undefined })
    const answer = respond(req)
    if (!answer) return // never answers: the caller's timeout is what is under test
    res.writeHead(answer.status, { "content-type": "application/json" })
    res.end(answer.body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, seen, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }) }
}

/** A port nothing listens on: bound, read, released. */
async function closedUrl() {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return `http://127.0.0.1:${port}`
}

function trigger(target: string, env: Record<string, string>, lockDir: string) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile("bash", [TRIGGER, target], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        CRON_LOCK_DIR: lockDir,
        CRON_SECRET: "test-secret",
        APP_ENV_FILE: join(lockDir, "no-such-app.env"),
        CRON_MAX_TIME_SECONDS: "5",
        no_proxy: "*",
        NO_PROXY: "*",
        ...env,
      },
    }, (error, stdout, stderr) => {
      resolve({ status: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr })
    })
  })
}

const ok: Respond = () => ({ status: 200, body: '{"success":true}' })

describe.skipIf(!hasTools)("cron-trigger.sh posts to the jobs process", () => {
  let lockDir: string
  const closers: Array<() => Promise<void>> = []

  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "jobs-route-"))
  })
  afterEach(async () => {
    while (closers.length) await closers.pop()!()
    rmSync(lockDir, { recursive: true, force: true })
  })

  async function pair(jobsRespond: Respond = ok) {
    const web = await serve(ok)
    const jobs = await serve(jobsRespond)
    closers.push(web.close, jobs.close)
    return { web, jobs, env: { WEB_APP_URL: web.url, JOBS_APP_URL: jobs.url } }
  }

  it("sends a scheduled job to the jobs process, not to the web app", async () => {
    const { web, jobs, env } = await pair()
    const run = await trigger("mtm-cleanup", env, lockDir)
    expect(run.status).toBe(0)
    expect(jobs.seen).toEqual([{ method: "POST", url: "/api/cron/mtm-cleanup", secret: "test-secret" }])
    expect(web.seen).toEqual([])
  })

  it("sends the phone line's catalog loaders to the web process they warm", async () => {
    const { web, jobs, env } = await pair()
    for (const target of [
      "/api/cron/zeytun-line-warm",
      "zeytun-line-warm",
      "/api/cron/zeytun-catalog-refresh",
      "/api/cron/zeytun-catalog-refresh?force=1",
    ]) {
      expect((await trigger(target, env, lockDir)).status, target).toBe(0)
    }
    expect(web.seen.map((s) => s.url)).toEqual([
      "/api/cron/zeytun-line-warm",
      "/api/cron/zeytun-line-warm",
      "/api/cron/zeytun-catalog-refresh",
      "/api/cron/zeytun-catalog-refresh?force=1",
    ])
    expect(jobs.seen).toEqual([])
  })

  it("does not mistake a lookalike for the phone line's loaders", async () => {
    const { web, jobs, env } = await pair()
    expect((await trigger("/api/cron/zeytun-line-warm-extra", env, lockDir)).status).toBe(0)
    expect(jobs.seen.map((s) => s.url)).toEqual(["/api/cron/zeytun-line-warm-extra"])
    expect(web.seen).toEqual([])
  })

  it("runs the job on the web process when nothing listens on the jobs port", async () => {
    const web = await serve(ok)
    closers.push(web.close)
    const run = await trigger("mtm-cleanup", { WEB_APP_URL: web.url, JOBS_APP_URL: await closedUrl() }, lockDir)
    expect(run.status).toBe(0)
    expect(web.seen.map((s) => s.url)).toEqual(["/api/cron/mtm-cleanup"])
    expect(run.stdout).toContain("HTTP 200")
    // The note goes to stderr: a verifier asserts on stdout, the cron log keeps both.
    expect(run.stderr).toContain("jobs process not listening")
    expect(run.stdout).not.toContain("jobs process not listening")
  })

  it("never re-runs a job the jobs process answered, even with an error", async () => {
    const { web, jobs, env } = await pair(() => ({ status: 500, body: '{"error":"Internal server error"}' }))
    const run = await trigger("mtm-cleanup", env, lockDir)
    expect(run.status).not.toBe(0)
    expect(jobs.seen).toHaveLength(1)
    expect(web.seen).toEqual([])
  })

  it("never re-runs a job that may have started: a timeout is not a refused connection", async () => {
    const { web, jobs, env } = await pair(() => null)
    const run = await trigger("mtm-cleanup", { ...env, CRON_MAX_TIME_SECONDS: "1" }, lockDir)
    expect(run.status).toBe(28)
    expect(jobs.seen).toHaveLength(1)
    expect(web.seen).toEqual([])
  })

  it("leaves an explicit APP_URL alone: no routing, no fallback", async () => {
    const { web, jobs, env } = await pair()
    const run = await trigger("mtm-cleanup", { ...env, APP_URL: await closedUrl() }, lockDir)
    expect(run.status).toBe(7)
    expect(web.seen).toEqual([])
    expect(jobs.seen).toEqual([])
  })
})

describe("the deploy carries the jobs process", () => {
  const deploy = readFileSync(join(ROOT, "scripts/server-deploy.sh"), "utf8")

  it("pins its name and port and denies both to the app's dotenv", () => {
    expect(deploy).toMatch(/^JOBS_PM2_PROCESS="leaddrive-v2-jobs"$/m)
    expect(deploy).toMatch(/^JOBS_PORT=3002$/m)
    expect(deploy).toMatch(/^unset PM2_NAME PM2_JOBS_NAME$/m)
    expect(deploy).toContain("JOBS_PM2_PROCESS|JOBS_HEALTH_URL|PM2_JOBS_NAME|JOBS_PORT|")
  })

  it("takes it down before `pm2 start` brings the new release up", () => {
    // pm2 refuses to start an app that is already running — a non-zero exit
    // the deploy treats as fatal — and a survivor would serve the old code.
    const startAt = deploy.search(/^pm2 start "\$PM2_CONFIG"/m)
    const deleteAt = deploy.search(/^pm2 delete "\$JOBS_PM2_PROCESS" 2>\/dev\/null \|\| true$/m)
    const portFreedAt = deploy.search(/^fuser -k "\$JOBS_PORT\/tcp" 2>\/dev\/null \|\| true$/m)
    expect(startAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeLessThan(startAt)
    expect(portFreedAt).toBeGreaterThan(-1)
    expect(portFreedAt).toBeLessThan(startAt)
  })

  it("takes it down in a handoff rollback too, before the older artifact starts", () => {
    const rollbackStart = deploy.indexOf('pm2 start "$rollback_config"')
    const recovery = deploy.lastIndexOf("load_dotenv_file \"$APP_ENV_FILE\"", rollbackStart)
    expect(rollbackStart).toBeGreaterThan(0)
    expect(deploy.slice(recovery, rollbackStart)).toContain('pm2 delete "$JOBS_PM2_PROCESS"')
  })

  it("counts it among the standalone processes the Fund fence must stop", () => {
    const fence = deploy.slice(
      deploy.indexOf("persist_event_platform_pm2_stop_fence() {"),
      deploy.indexOf("quiesce_event_platform_pilot() {"),
    )
    expect(fence.match(/"\$PM2_PROCESS" softphone-relay "\$JOBS_PM2_PROCESS"/g)).toHaveLength(3)
    expect(fence).toContain('pm2 delete "$JOBS_PM2_PROCESS"')
    expect(fence).toContain('["3001", "3002"]')
  })

  it("checks it only after the web handoff, and never rolls the web app back on its account", () => {
    const handoffDone = deploy.indexOf("HANDOFF_RECOVERY_COMPLETE=true\nSTANDALONE_REPLACED=false")
    const step8 = deploy.indexOf("# ── Step 8:")
    const block = deploy.slice(deploy.indexOf("# ── Step 7b:"), step8)
    expect(handoffDone).toBeGreaterThan(0)
    expect(deploy.indexOf("# ── Step 7b:")).toBeGreaterThan(handoffDone)
    expect(block).toContain('"$JOBS_HEALTH_URL/api/v1/ping"')
    expect(block).toContain('"$JOBS_HEALTH_URL/api/cron/pii-key-check"')
    // A failed jobs process is removed so the schedule falls back to the web
    // port; it does not mark the release unhealthy.
    expect(block).toContain('pm2 delete "$JOBS_PM2_PROCESS"')
    expect(block).not.toContain("HEALTHY=false")
    expect(block).not.toContain("recover_application_handoff")
  })
})

describe("operator jobs restart both processes into a new environment", () => {
  // pm2 keeps each process's environment in its own entry; `--update-env` on
  // the web app alone would leave the scheduler on the old key until the next
  // deploy — and the scheduler runs the jobs most of these keys steer (voice
  // queues, social polling, Bright Data routing, demo switches).
  const dir = join(ROOT, ".github/workflows")
  const workflows = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))

  it("follows every web restart with --update-env by a jobs restart", () => {
    const offenders: string[] = []
    let webRestarts = 0
    for (const name of workflows) {
      const lines = readFileSync(join(dir, name), "utf8").split("\n")
      lines.forEach((line, index) => {
        if (/^\s*#/.test(line)) return
        if (!/pm2 restart (leaddrive-v2|"\$PM2_PROCESS") --update-env/.test(line)) return
        webRestarts += 1
        const after = lines.slice(index + 1, index + 6).join("\n")
        if (!/pm2 restart (leaddrive-v2-jobs|"\$JOBS_PM2_PROCESS") --update-env/.test(after)) {
          offenders.push(`${name}:${index + 1}`)
        }
      })
    }
    expect(webRestarts).toBeGreaterThan(5)
    expect(offenders).toEqual([])
  })

  it("asserts the voice gates on every process that runs the voice queue", () => {
    const cutover = readFileSync(join(dir, "set-voice-provider-registry-cutover.yml"), "utf8")
    expect(cutover).toContain('JOBS_PM2_PROCESS="leaddrive-v2-jobs"')
    expect(cutover).toContain('done < <(voice_runtime_processes)')
    expect(cutover).toContain('mapfile -t names < <(voice_runtime_processes)')
    expect(cutover).toContain('[ "$count" -eq "${#names[@]}" ]')
  })
})
