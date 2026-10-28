import { execFile, spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

/**
 * The phone station has a server process of its own (pm2 `leaddrive-v2-line`).
 *
 * Owner, 2026-10-28: «отдельная программа для линии». A call to Zeytun's line
 * dropped after the first ring because the web process — busy with people's
 * pages and the minute's jobs — answered the station's "ringing" in 1–4 s.
 * The fix holds only while these stay true together: pm2 starts the process,
 * nginx sends every station route to it with the web app as backup, the
 * line's catalog loaders warm it, the deploy carries it without ever rolling
 * the web app back on its account, and every job that restarts the web app
 * into a new environment restarts it too.
 */

const ROOT = process.cwd()

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

describe("pm2 runs the phone line beside the web app", () => {
  it("starts the same bundle on loopback :3003 with the web app's environment", () => {
    const apps = loadApps({ APP_HOSTNAME: "0.0.0.0" })
    const web = apps.find((a) => a.name === "leaddrive-v2")!
    const line = apps.find((a) => a.name === "leaddrive-v2-line")!
    expect(line.script).toBe(web.script)
    expect(line.cwd).toBe(web.cwd)
    expect(String(line.env.PORT)).toBe("3003")
    expect(line.env.HOSTNAME).toBe("127.0.0.1")
    expect(line.pmx).toBe(false)
    const { PORT: _a, HOSTNAME: _b, LEADDRIVE_PROCESS_ROLE: webRole, ...webEnv } = web.env
    const { PORT: _c, HOSTNAME: _d, LEADDRIVE_PROCESS_ROLE: lineRole, ...lineEnv } = line.env
    expect([webRole, lineRole]).toEqual(["web", "line"])
    expect(lineEnv).toEqual(webEnv)
    expect(line.out_file).not.toBe(web.out_file)
    expect(line.error_file).not.toBe(web.error_file)
  })
})

describe("nginx sends the station to the line's process, the web app as backup", () => {
  const upstream = readFileSync(join(ROOT, "ops/nginx/leaddrive-station-upstream.conf"), "utf8")
  const routes = readFileSync(join(ROOT, "ops/nginx/leaddrive-station-routes.conf"), "utf8")
  const directives = (text: string) => text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join("\n")

  it("tries :3003 first and falls back to :3001", () => {
    expect(directives(upstream)).toMatch(/server 127\.0\.0\.1:3003[^;]*;\s+server 127\.0\.0\.1:3001 backup;/)
  })

  it("covers every route under the two prefixes the station calls", () => {
    const prefixes = [...directives(routes).matchAll(/location \^~ (\S+) \{/g)].map((m) => m[1])
    expect(prefixes).toEqual(["/api/internal/asterisk/", "/api/internal/voice-agent/"])
    for (const prefix of ["asterisk", "voice-agent"]) {
      expect(readdirSync(join(ROOT, "src/app/api/internal", prefix)).length).toBeGreaterThan(0)
    }
  })

  it("moves a request to the backup only when the connection failed, never on a slow answer", () => {
    // These POSTs save orders and call events: a timeout retried on the web app
    // would send a second copy while the first may still be running.
    const blocks = directives(routes).split("location ").slice(1)
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      expect(block).toContain("proxy_pass http://leaddrive_station;")
      expect(block).toMatch(/proxy_next_upstream error;/)
      expect(block).not.toMatch(/proxy_next_upstream[^;]*(timeout|http_5|non_idempotent)/)
      expect(block).toContain('proxy_set_header X-Request-Start "t=${msec}";')
    }
  })

  it("the installer includes the snippet once, in the TLS block, and restores on a failed nginx -t", () => {
    const installer = readFileSync(join(ROOT, "scripts/nginx-install-station-routes.sh"), "utf8")
    expect(installer).toContain('INCLUDE_LINE="    include snippets/leaddrive-station-routes.conf;"')
    expect(installer).toContain("!done && $0 == anchor")
    const check = installer.indexOf('if ! "$NGINX" -t')
    const reload = installer.indexOf("systemctl reload nginx")
    expect(check).toBeGreaterThan(0)
    expect(installer.slice(check, reload)).toContain("restore")
    expect(reload).toBeGreaterThan(check)
  })
})

const hasTools =
  spawnSync("flock", ["--version"]).status === 0 && spawnSync("curl", ["--version"]).status === 0

describe.skipIf(!hasTools)("cron-trigger.sh warms the line where the station is answered", () => {
  const closers: Array<() => Promise<void>> = []
  const dirs: string[] = []
  afterEach(async () => {
    while (closers.length) await closers.pop()!()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function serve() {
    const seen: string[] = []
    const server: Server = createServer((req, res) => {
      seen.push(req.url ?? "")
      res.writeHead(200, { "content-type": "application/json" })
      res.end('{"outcome":"warm","ms":1}')
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    closers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen }
  }

  async function closedUrl() {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
    const { port } = probe.address() as AddressInfo
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    return `http://127.0.0.1:${port}`
  }

  function trigger(target: string, env: Record<string, string>) {
    const lockDir = mkdtempSync(join(tmpdir(), "line-route-"))
    dirs.push(lockDir)
    return new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
      execFile("bash", [join(ROOT, "scripts/cron-trigger.sh"), target], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", CRON_LOCK_DIR: lockDir, CRON_SECRET: "test-secret",
          APP_ENV_FILE: join(lockDir, "none.env"), CRON_MAX_TIME_SECONDS: "5", no_proxy: "*", NO_PROXY: "*", ...env },
      }, (error, stdout, stderr) => resolve({ status: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }))
    })
  }

  it("warms the web process instead when the line's process is not listening", async () => {
    // nginx sends the station to the web app in that case, so that is where
    // the catalog has to be.
    const web = await serve()
    const jobs = await serve()
    const run = await trigger("/api/cron/zeytun-line-warm", { WEB_APP_URL: web.url, JOBS_APP_URL: jobs.url, LINE_APP_URL: await closedUrl() })
    expect(run.status).toBe(0)
    expect(web.seen).toEqual(["/api/cron/zeytun-line-warm"])
    expect(jobs.seen).toEqual([])
    expect(run.stderr).toContain("line process not listening")
  })
})

describe("the deploy carries the line's process", () => {
  const deploy = readFileSync(join(ROOT, "scripts/server-deploy.sh"), "utf8")

  it("pins its name and port and denies both to the app's dotenv", () => {
    expect(deploy).toMatch(/^LINE_PM2_PROCESS="leaddrive-v2-line"$/m)
    expect(deploy).toMatch(/^LINE_PORT=3003$/m)
    expect(deploy).toMatch(/^unset PM2_NAME PM2_JOBS_NAME PM2_LINE_NAME$/m)
    expect(deploy).toContain("LINE_PM2_PROCESS|LINE_HEALTH_URL|PM2_LINE_NAME|LINE_PORT|")
  })

  it("takes it down before `pm2 start`, in a handoff rollback and in the Fund fence", () => {
    const startAt = deploy.search(/^pm2 start "\$PM2_CONFIG"/m)
    const deleteAt = deploy.search(/^pm2 delete "\$LINE_PM2_PROCESS" 2>\/dev\/null \|\| true$/m)
    expect(deleteAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeLessThan(startAt)
    const rollbackStart = deploy.indexOf('pm2 start "$rollback_config"')
    const recovery = deploy.lastIndexOf('load_dotenv_file "$APP_ENV_FILE"', rollbackStart)
    expect(deploy.slice(recovery, rollbackStart)).toContain('pm2 delete "$LINE_PM2_PROCESS"')
    const fence = deploy.slice(
      deploy.indexOf("persist_event_platform_pm2_stop_fence() {"),
      deploy.indexOf("quiesce_event_platform_pilot() {"),
    )
    expect(fence.match(/"\$JOBS_PM2_PROCESS" "\$LINE_PM2_PROCESS"/g)).toHaveLength(3)
    expect(fence).toContain('pm2 delete "$LINE_PM2_PROCESS"')
  })

  it("checks it only after the web handoff, and never rolls the web app back on its account", () => {
    const block = deploy.slice(deploy.indexOf("# ── Step 7c:"), deploy.indexOf("# ── Step 8:"))
    expect(deploy.indexOf("# ── Step 7c:")).toBeGreaterThan(deploy.indexOf("# ── Step 7b:"))
    expect(block).toContain('"$LINE_HEALTH_URL/api/v1/ping"')
    expect(block).toContain('"$LINE_HEALTH_URL/api/cron/pii-key-check"')
    expect(block).toContain('pm2 delete "$LINE_PM2_PROCESS"')
    expect(block).not.toContain("HEALTHY=false")
    expect(block).not.toContain("recover_application_handoff")
    expect(deploy).toContain("jobs=$JOBS_STATUS line=$LINE_STATUS")
  })
})

describe("operator jobs restart the line's process into a new environment", () => {
  const dir = join(ROOT, ".github/workflows")

  it("follows every web restart with --update-env by a line restart", () => {
    const offenders: string[] = []
    let webRestarts = 0
    for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const lines = readFileSync(join(dir, name), "utf8").split("\n")
      lines.forEach((line, index) => {
        if (/^\s*#/.test(line)) return
        if (!/pm2 restart (leaddrive-v2|"\$PM2_PROCESS") --update-env/.test(line)) return
        webRestarts += 1
        const after = lines.slice(index + 1, index + 10).join("\n")
        if (!/pm2 restart (leaddrive-v2-line|"\$LINE_PM2_PROCESS") --update-env/.test(after)) offenders.push(`${name}:${index + 1}`)
      })
    }
    expect(webRestarts).toBeGreaterThan(5)
    expect(offenders).toEqual([])
  })

  it("asserts the voice gates on the line's process too: it answers call results", () => {
    const cutover = readFileSync(join(dir, "set-voice-provider-registry-cutover.yml"), "utf8")
    expect(cutover).toContain('LINE_PM2_PROCESS="leaddrive-v2-line"')
    const lister = cutover.slice(cutover.indexOf("voice_runtime_processes() {"), cutover.indexOf("assert_automation_off() {"))
    expect(lister).toContain('"$LINE_PM2_PROCESS"')
  })
})
