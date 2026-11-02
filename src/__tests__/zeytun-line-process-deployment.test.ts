import { execFile, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

describe("pm2 runs the phone line from its own release, in a slot", () => {
  it("is not part of the web app's own `pm2 start`", () => {
    const names = loadApps({ LINE_RELEASE_DIR: undefined, LINE_SLOT: undefined }).map((a) => a.name)
    expect(names.filter((n) => n.startsWith("leaddrive-v2-line"))).toEqual([])
  })

  it("starts the named slot from the release copy on loopback, with the web app's environment", () => {
    for (const [slot, port] of [["a", "3004"], ["b", "3005"]]) {
      const apps = loadApps({ APP_HOSTNAME: "0.0.0.0", LINE_RELEASE_DIR: "/opt/leaddrive-v2/line-releases/abc-" + slot, LINE_SLOT: slot })
      const web = apps.find((a) => a.name === "leaddrive-v2")!
      const line = apps.find((a) => a.name === `leaddrive-v2-line-${slot}`)!
      expect(line.script).toBe(`/opt/leaddrive-v2/line-releases/abc-${slot}/server.js`)
      expect(line.cwd).toBe(`/opt/leaddrive-v2/line-releases/abc-${slot}`)
      expect(String(line.env.PORT)).toBe(port)
      expect(line.env.HOSTNAME).toBe("127.0.0.1")
      expect(line.pmx).toBe(false)
      const { PORT: _a, HOSTNAME: _b, LEADDRIVE_PROCESS_ROLE: webRole, ...webEnv } = web.env
      const { PORT: _c, HOSTNAME: _d, LEADDRIVE_PROCESS_ROLE: lineRole, ...lineEnv } = line.env
      expect([webRole, lineRole]).toEqual(["web", "line"])
      expect(lineEnv).toEqual(webEnv)
      expect(line.out_file).not.toBe(web.out_file)
    }
  })

  it("ignores a slot it does not know", () => {
    const names = loadApps({ LINE_RELEASE_DIR: "/x", LINE_SLOT: "c" }).map((a) => a.name)
    expect(names.some((n) => n.startsWith("leaddrive-v2-line"))).toBe(false)
  })
})

describe("nginx sends the station to the line's process, the web app as backup", () => {
  const upstream = readFileSync(join(ROOT, "ops/nginx/leaddrive-station-upstream.conf"), "utf8")
  const routes = readFileSync(join(ROOT, "ops/nginx/leaddrive-station-routes.conf"), "utf8")
  const directives = (text: string) => text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join("\n")

  it("tries the line's slot first and falls back to :3001, in the form the deploy rewrites", () => {
    expect(directives(upstream)).toMatch(/^    server 127\.0\.0\.1:3004 max_fails=1 fail_timeout=5s;\n    server 127\.0\.0\.1:3001 backup;$/m)
    const deploy = readFileSync(join(ROOT, "scripts/server-deploy.sh"), "utf8")
    expect(deploy).toContain("^    server 127\\.0\\.0\\.1:[0-9]+ max_fails=1 fail_timeout=5s;$")
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

describe("the deploy replaces the line without a gap", () => {
  const deploy = readFileSync(join(ROOT, "scripts/server-deploy.sh"), "utf8")
  const step7c = deploy.slice(deploy.indexOf("# ── Step 7c:"), deploy.indexOf("# ── Step 8:"))
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it("never stops the line before the web app's `pm2 start`", () => {
    const startAt = deploy.search(/^pm2 start "\$PM2_CONFIG" 2>\/dev\/null/m)
    const stopPhase = deploy.slice(deploy.indexOf("# ── Step 4:"), startAt)
    expect(stopPhase).not.toMatch(/pm2 delete "\$LINE_/)
    expect(stopPhase).not.toMatch(/fuser -k "\$LINE_/)
  })

  it("leaves the answering slot running through the Fund fence, which every deploy runs", () => {
    // 2026-10-28: the fence (run on every deploy with a booking controller)
    // stopped the slots too, and the station got 8 s of 502s. The slots run
    // from their own copy and write no Fund or booking state.
    const fence = deploy.slice(
      deploy.indexOf("persist_event_platform_pm2_stop_fence() {"),
      deploy.indexOf("quiesce_event_platform_pilot() {"),
    )
    expect(deploy).toMatch(/^if \[ -n "\$BOOKING_RELEASE_CONTROLLER" \]; then persist_event_platform_pm2_stop_fence; fi$/m)
    expect(fence).not.toContain("LINE_SLOT_")
    expect(fence).not.toMatch(/"300[45]"/)
    expect(fence).toContain('pm2 delete "$LINE_PM2_PROCESS"')
    expect(fence).toContain('["3001", "3002", "3003"]')
  })

  it.skipIf(spawnSync("node", ["--version"]).status !== 0)("the fence's own classifier does not pick a slot", () => {
    const fence = deploy.slice(deploy.indexOf("persist_event_platform_pm2_stop_fence() {"), deploy.indexOf("quiesce_event_platform_pilot() {"))
    const classifier = fence.slice(fence.indexOf("<<'NODE'\n") + 8, fence.indexOf("\nNODE\n"))
    const dir = mkdtempSync(join(tmpdir(), "line-fence-"))
    dirs.push(dir)
    const state = join(dir, "jlist.json")
    writeFileSync(state, JSON.stringify([
      { pm_id: 1, name: "leaddrive-v2", pm2_env: { pm_cwd: "/opt/leaddrive-v2/.next/standalone", env: { PORT: "3001" } } },
      { pm_id: 7, name: "leaddrive-v2-line-a", pm2_env: { pm_cwd: "/opt/leaddrive-v2/line-releases/x-a",
        pm_exec_path: "/opt/leaddrive-v2/line-releases/x-a/server.js", cwd: "/opt/leaddrive-v2/line-releases/x-a", env: { PORT: "3004" } } },
    ]))
    writeFileSync(join(dir, "classify.js"), classifier)
    const run = spawnSync("node", [join(dir, "classify.js"), state, "leaddrive-v2", "softphone-relay", "leaddrive-v2-jobs", "leaddrive-v2-line",
      "/opt/leaddrive-v2/.next/standalone"], { encoding: "utf8" })
    expect(run.stdout.trim().split("\n")).toEqual(["1"])
  })

  it("runs only after the web handoff, and never rolls the web app back on its account", () => {
    expect(deploy.indexOf("# ── Step 7c:")).toBeGreaterThan(deploy.indexOf("# ── Step 7b:"))
    expect(step7c).not.toContain("HEALTHY=false")
    expect(step7c).not.toContain("recover_application_handoff")
    expect(deploy).toContain("jobs=$JOBS_STATUS line=$LINE_STATUS")
  })

  const hasBash = spawnSync("bash", ["--version"]).status === 0

  /** Runs Step 7c as written, with pm2/curl/nginx/systemctl/fuser/sleep stubbed. */
  function runStep7c(options: { online: string[]; warm?: string; activePort?: string }) {
    const dir = mkdtempSync(join(tmpdir(), "line-7c-"))
    dirs.push(dir)
    const bin = join(dir, "bin"), app = join(dir, "app")
    mkdirSync(bin); mkdirSync(join(app, ".next/standalone"), { recursive: true })
    writeFileSync(join(app, ".next/standalone/server.js"), "")
    const calls = join(dir, "calls.log")
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${calls}"\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    stub("pm2", `case "$1" in
  describe) for n in ${options.online.join(" ")}; do [ "$n" = "$2" ] && { echo "│ status │ online │"; exit 0; }; done; exit 1 ;;
  jlist) echo "[]" ;;
esac
exit 0`)
    stub("curl", `url="\${@: -1}"
case "$url" in
  */api/v1/ping) printf 200 ;;
  */api/cron/pii-key-check) printf '{"ok":true,"source":"file"}' ;;
  */api/cron/zeytun-line-warm) printf '%s' '${options.warm ?? '{"outcome":"warm","ms":5}'}' ;;
esac`)
    stub("nginx", "exit 0")
    stub("systemctl", "exit 0")
    stub("fuser", "exit 1")
    stub("sleep", "exit 0")
    const upstream = join(dir, "upstream.conf")
    writeFileSync(upstream, readFileSync(join(ROOT, "ops/nginx/leaddrive-station-upstream.conf"), "utf8").replace(":3004 max_fails", ":3003 max_fails"))
    const web = join(dir, "web-upstream.conf")
    writeFileSync(web, readFileSync(join(ROOT, "ops/nginx/leaddrive-web-upstream.conf"), "utf8"))
    const state = join(dir, "active-port")
    if (options.activePort) writeFileSync(state, `${options.activePort}\n`)
    const script = [
      "set -uo pipefail",
      `log() { echo "LOG $*"; }`, `fatal() { echo "FATAL $*"; exit 1; }`, "harden_pm2_reboot_dump() { return 0; }",
      `APP_DIR="${app}"`, `PM2_CONFIG="${app}/.next/standalone/ecosystem.config.cjs"`, `DEPLOY_SHA=abc1234`, `CRON_SECRET=s`,
      `LINE_PM2_PROCESS=leaddrive-v2-line`, `LINE_PORT=3003`,
      `LINE_SLOT_A_PROCESS=leaddrive-v2-line-a`, `LINE_SLOT_B_PROCESS=leaddrive-v2-line-b`,
      `LINE_SLOT_A_PORT=3004`, `LINE_SLOT_B_PORT=3005`,
      `LINE_RELEASES_DIR="${app}/line-releases"`, `LINE_ACTIVE_PORT_FILE="${state}"`, `LINE_NGINX_UPSTREAM="${upstream}"`, `WEB_NGINX_UPSTREAM="${web}"`,
      step7c,
      `echo "STATUS $LINE_STATUS"`,
    ].join("\n")
    const run = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}` } })
    return {
      out: run.stdout + run.stderr,
      calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      upstream: readFileSync(upstream, "utf8"),
      web: readFileSync(web, "utf8"),
      state: existsSync(state) ? readFileSync(state, "utf8").trim() : "",
      releases: existsSync(join(app, "line-releases")) ? readdirSync(join(app, "line-releases")) : [],
    }
  }

  it.skipIf(!hasBash)("hands the station from slot a to b: start, warm, nginx, then stop a", () => {
    const run = runStep7c({ online: ["leaddrive-v2-line-a"], activePort: "3004" })
    expect(run.out).toContain("STATUS ok")
    const order = (needle: string) => run.calls.findIndex((c) => c.includes(needle))
    expect(order("pm2 start")).toBeGreaterThan(-1)
    expect(run.calls[order("pm2 start")]).toContain("--only leaddrive-v2-line-b")
    expect(order("zeytun-line-warm")).toBeGreaterThan(order("pm2 start"))
    expect(order("systemctl reload nginx")).toBeGreaterThan(order("zeytun-line-warm"))
    expect(order("pm2 delete leaddrive-v2-line-a")).toBeGreaterThan(order("systemctl reload nginx"))
    expect(run.upstream).toMatch(/^    server 127\.0\.0\.1:3005 max_fails=1 fail_timeout=5s;$/m)
    // People's pages fall back to the slot that is live now, never the one just deleted.
    expect(run.web).toMatch(/^    server 127\.0\.0\.1:3005 backup; # line slot$/m)
    expect(run.web).toMatch(/^    server 127\.0\.0\.1:3001 max_fails=1 fail_timeout=3s;$/m)
    expect(run.state).toBe("3005")
    expect(run.releases).toEqual(["abc1234-b"])
  })

  it.skipIf(!hasBash)("retires the first form of the line (:3003) the same way, into slot a", () => {
    const run = runStep7c({ online: ["leaddrive-v2-line"] })
    expect(run.out).toContain("STATUS ok")
    expect(run.calls.find((c) => c.startsWith("pm2 start"))).toContain("--only leaddrive-v2-line-a")
    expect(run.calls).toContain("pm2 delete leaddrive-v2-line")
    expect(run.upstream).toMatch(/:3004 max_fails/)
    expect(run.state).toBe("3004")
  })

  it.skipIf(!hasBash)("keeps the answering slot when the new one cannot load the catalog", () => {
    const run = runStep7c({ online: ["leaddrive-v2-line-a"], activePort: "3004", warm: '{"outcome":"failed"}' })
    expect(run.out).toContain("STATUS kept-previous")
    expect(run.calls).toContain("pm2 delete leaddrive-v2-line-b")
    expect(run.calls).not.toContain("pm2 delete leaddrive-v2-line-a")
    expect(run.calls.some((c) => c.startsWith("systemctl"))).toBe(false)
    expect(run.upstream).toMatch(/:3003 max_fails/)
    expect(run.web).toMatch(/:3004 backup; # line slot/)
    expect(run.state).toBe("3004")
    expect(run.releases).toEqual([])
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
        const after = lines.slice(index + 1, index + 14).join("\n")
        if (!/for line_app in (leaddrive-v2-line-a leaddrive-v2-line-b|\$LINE_PM2_PROCESSES)[\s\S]*pm2 restart "\$line_app" --update-env/.test(after)) offenders.push(`${name}:${index + 1}`)
      })
    }
    expect(webRestarts).toBeGreaterThan(5)
    expect(offenders).toEqual([])
  })

  it("asserts the voice gates on the line's process too: it answers call results", () => {
    const cutover = readFileSync(join(dir, "set-voice-provider-registry-cutover.yml"), "utf8")
    expect(cutover).toContain('LINE_PM2_PROCESSES="leaddrive-v2-line-a leaddrive-v2-line-b"')
    const lister = cutover.slice(cutover.indexOf("voice_runtime_processes() {"), cutover.indexOf("assert_automation_off() {"))
    expect(lister).toContain('for line_app in $LINE_PM2_PROCESSES')
  })
})
