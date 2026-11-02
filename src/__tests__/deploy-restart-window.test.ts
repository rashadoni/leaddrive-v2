import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { installServerShutdownDeadline } from "@/lib/server-shutdown-deadline"

/**
 * The minute after every deploy, measured on 2026-10-28 10:30 UTC with the
 * phone station's own route as the probe: 23 s of 502 (10.6 s of it pm2
 * waiting for the old process to exit), then 7–11 s per answer for about a
 * minute while Next.js loaded all 1 765 route modules in the background.
 * Each fix below is one of those seconds.
 */

const ROOT = process.cwd()
const deploy = readFileSync(join(ROOT, "scripts/server-deploy.sh"), "utf8")

class FakeProcess extends EventEmitter {
  exits: Array<{ code: number; at: number }> = []
  exit = ((code: number) => {
    this.exits.push({ code, at: Date.now() })
  }) as (code: number) => never
}

// What Next.js 16.2 does on SIGINT in production (start-server.js): stop
// listening, then exit only once every open connection has ended.
function nextLikeCleanup(server: Server, proc: FakeProcess) {
  let closed = false
  proc.once("SIGINT", () => {
    server.close(() => {
      closed = true
      proc.exit(130)
    })
  })
  return () => closed
}

describe("a stopping server process", () => {
  let server: Server | null = null
  afterEach(async () => {
    server?.closeAllConnections()
    await new Promise((resolve) => server ? server.close(resolve) : resolve(undefined))
    server = null
  })

  async function serverWithOpenEventStream() {
    // The shell's event stream: a response that never ends.
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write(": open\n\n")
    })
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    await new Promise<void>((resolve) => {
      request({ host: "127.0.0.1", port, path: "/api/v1/shell/events" }, (res) => {
        res.once("data", () => resolve())
      }).end()
    })
  }

  it("never exits on its own while a tab holds its event stream", async () => {
    await serverWithOpenEventStream()
    const proc = new FakeProcess()
    const closed = nextLikeCleanup(server!, proc)
    proc.emit("SIGINT")
    await new Promise((resolve) => setTimeout(resolve, 300))
    // pm2 waited its kill_timeout here, with the port already closed.
    expect(closed()).toBe(false)
    expect(proc.exits).toEqual([])
  })

  it("exits after the grace period with Next.js's own code, stream or not", async () => {
    await serverWithOpenEventStream()
    const proc = new FakeProcess()
    nextLikeCleanup(server!, proc)
    installServerShutdownDeadline(proc, 100)
    const signalledAt = Date.now()
    proc.emit("SIGINT")
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(proc.exits.map((exit) => exit.code)).toEqual([130])
    expect(proc.exits[0].at - signalledAt).toBeGreaterThanOrEqual(90)
    expect(server!.listening).toBe(false)
  })

  it("uses 143 for SIGTERM", async () => {
    const proc = new FakeProcess()
    installServerShutdownDeadline(proc, 10)
    proc.emit("SIGTERM")
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(proc.exits.map((exit) => exit.code)).toEqual([143])
  })

  it("is installed by the server's instrumentation hook", () => {
    const hook = readFileSync(join(ROOT, "src/instrumentation.ts"), "utf8")
    expect(hook).toContain("installServerShutdownDeadline()")
  })
})

describe("the new process does not load every route while it answers", () => {
  it("turns off Next.js's start-up preload of all route modules", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8")
    expect(config).toMatch(/^\s*preloadEntriesOnStart: false,$/m)
  })
})

describe("the deploy's stop and start", () => {
  const step4 = deploy.slice(deploy.indexOf("# ── Step 4:"), deploy.indexOf('log "Starting PM2..."'))
  const step6 = deploy.slice(deploy.indexOf("# ── Step 6:"), deploy.indexOf("HEALTHY=false"))

  it("flushes the disk while the old release still answers", () => {
    expect(step4.indexOf("sync || true")).toBeGreaterThan(-1)
    expect(step4.indexOf("sync || true")).toBeLessThan(step4.indexOf('log "Stopping old processes..."'))
  })

  it("stops the relay and the jobs process before the web process", () => {
    const web = step4.search(/^pm2 delete "\$PM2_PROCESS" 2>\/dev\/null \|\| true$/m)
    const relay = step4.search(/^pm2 delete softphone-relay 2>\/dev\/null \|\| true$/m)
    const jobs = step4.search(/^pm2 delete "\$JOBS_PM2_PROCESS" 2>\/dev\/null \|\| true$/m)
    expect(relay).toBeGreaterThan(-1)
    expect(jobs).toBeGreaterThan(relay)
    expect(web).toBeGreaterThan(jobs)
  })

  it("waits for the ports instead of sleeping a fixed time", () => {
    expect(step4).not.toMatch(/^sleep 2$/m)
    expect(step6).not.toMatch(/^sleep 1[05]$/m)
    expect(step6).toContain('ss -tln | grep -q ":3001 "')
  })

  it("warms every route the phone station calls before the health check", () => {
    const dir = join(ROOT, "scripts/pbx")
    const station = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => readFileSync(join(dir, entry.name), "utf8"))
      .join("\n")
    const called = new Set(station.match(/\/api\/internal\/[a-z\-/]+[a-z]/g))
    expect(called.size).toBeGreaterThan(0)
    for (const path of called) expect(step6).toContain(` ${path}"`)
    // Waited on by pid: a bare `wait` would also wait for a Fund cutover's
    // background lock holder, up to 180 s.
    expect(step6).toContain('wait "${WARM_PIDS[@]}"')
  })
})

function loadApps(env: Record<string, string | undefined>) {
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

/**
 * Owner, 2026-11-02: /mtm/access answered a bare "Internal Server Error". The
 * deploy of #1248 had unpacked its build over .next/standalone at 10:10:19 and
 * stopped the old web process at 10:14:36; for those four minutes the old
 * process, running from that tree, loaded the NEW build's files for every page
 * it had not opened yet. The web app and the scheduler now run from a copy of
 * their own release, the way the phone line already did.
 */
describe("the old web process keeps its own build until it is stopped", () => {
  it("pm2 runs the web app and the scheduler from the release copy the deploy names", () => {
    const apps = loadApps({ WEB_RELEASE_DIR: "/opt/leaddrive-v2/web-releases/abc-20261102T101000Z", APP_DIR: undefined })
    for (const name of ["leaddrive-v2", "leaddrive-v2-jobs"]) {
      const app = apps.find((a) => a.name === name)!
      expect(app.script).toBe("/opt/leaddrive-v2/web-releases/abc-20261102T101000Z/server.js")
      expect(app.cwd).toBe("/opt/leaddrive-v2/web-releases/abc-20261102T101000Z")
      // A copy cannot infer the checkout root from its cwd; it is told.
      expect(app.env.APP_DIR).toBe("/opt/leaddrive-v2")
    }
    // The relay is not a page server and stays where it was.
    expect(apps.find((a) => a.name === "softphone-relay")?.cwd ?? "/.next/standalone").toContain("/.next/standalone")
  })

  it("without one — an operator's `pm2 start`, a rollback — they run from .next/standalone as before", () => {
    const apps = loadApps({ WEB_RELEASE_DIR: undefined, APP_DIR: undefined })
    expect(apps.find((a) => a.name === "leaddrive-v2")!.script).toBe("/opt/leaddrive-v2/.next/standalone/server.js")
    expect(apps.find((a) => a.name === "leaddrive-v2-jobs")!.script).toBe("/opt/leaddrive-v2/.next/standalone/server.js")
  })

  const step4 = deploy.slice(deploy.indexOf("# ── Step 4:"), deploy.indexOf("# ── Step 6:"))
  const copyBlock = step4.slice(step4.indexOf("WEB_RELEASE_NEW_DIR=\""), step4.indexOf('log "Web release copy:'))
  const pruneBlock = deploy.slice(deploy.indexOf('for dir in "$WEB_RELEASES_DIR"/*; do'), deploy.indexOf("# ── Step 7b:"))
  const rollback = deploy.slice(deploy.indexOf("recover_application_handoff() {"), deploy.indexOf("rollback_replaced_standalone_on_exit() {"))

  it("copies before the old process stops, and starts the new one from that copy only", () => {
    expect(copyBlock).toContain('cp -al -- "$APP_DIR/.next/standalone" "$WEB_RELEASE_NEW_DIR"')
    expect(step4.indexOf("cp -al --")).toBeLessThan(step4.indexOf('log "Stopping old processes..."'))
    expect(step4).toMatch(/^WEB_RELEASE_DIR="\$WEB_RELEASE_NEW_DIR" \\\npm2 start "\$PM2_CONFIG"/m)
    // Never exported: the rollback below must start the restored tree.
    expect(deploy).not.toMatch(/export[^\n]*WEB_RELEASE_DIR/)
    expect(rollback).not.toContain("WEB_RELEASE")
    // An app env file cannot steer it either.
    expect(deploy).toContain("WEB_RELEASES_DIR|WEB_RELEASE_NEW_DIR|WEB_RELEASE_DIR|")
  })

  it("removes earlier copies only after the new web process passed its health gate", () => {
    expect(pruneBlock).toContain('[ "$dir" != "$WEB_RELEASE_NEW_DIR" ] && rm -rf -- "$dir"')
    const prune = deploy.indexOf('for dir in "$WEB_RELEASES_DIR"/*; do')
    expect(prune).toBeGreaterThan(deploy.indexOf('if [ "$HEALTHY" = false ]; then'))
    expect(prune).toBeGreaterThan(deploy.indexOf("HANDOFF_STARTED=false\nHANDOFF_RECOVERY_COMPLETE=true"))
  })

  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  /** Step 4's copy as written, then the next deploy's Step 2 and its prune. */
  function run(script: string, app: string, sha: string) {
    const out = spawnSync("bash", ["-c", [
      "set -euo pipefail",
      `log() { echo "LOG $*"; }`, `fatal_after_standalone_replacement() { echo "FATAL $*"; exit 1; }`,
      `APP_DIR="${app}"`, `WEB_RELEASES_DIR="${app}/web-releases"`, `DEPLOY_SHA=${sha}`,
      script,
      'echo "DIR $WEB_RELEASE_NEW_DIR"',
    ].join("\n")], { encoding: "utf8" })
    expect(out.status, out.stdout + out.stderr).toBe(0)
    return /^DIR (.+)$/m.exec(out.stdout)![1]
  }

  it.skipIf(spawnSync("bash", ["--version"]).status !== 0)("a page the old process opens late still gets its own build", () => {
    const app = mkdtempSync(join(tmpdir(), "web-release-"))
    dirs.push(app)
    const standalone = join(app, ".next/standalone")
    const page = ".next/server/app/mtm/access/page.js"
    mkdirSync(join(standalone, ".next/server/app/mtm/access"), { recursive: true })
    writeFileSync(join(standalone, "server.js"), "")
    writeFileSync(join(standalone, page), "build A")

    const first = run(copyBlock, app, "aaa")
    // The next deploy's Step 2: the tree is removed and the new build unpacked.
    rmSync(standalone, { recursive: true })
    mkdirSync(join(standalone, ".next/server/app/mtm/access"), { recursive: true })
    writeFileSync(join(standalone, "server.js"), "")
    writeFileSync(join(standalone, page), "build B")
    expect(readFileSync(join(first, page), "utf8")).toBe("build A")

    // Redeploying the same SHA makes a new copy and never touches the live one.
    spawnSync("sleep", ["1"])
    const second = run(copyBlock, app, "aaa")
    expect(second).not.toBe(first)
    expect(readFileSync(join(first, page), "utf8")).toBe("build A")
    expect(readFileSync(join(second, page), "utf8")).toBe("build B")

    // Once the new process is healthy only its copy stays.
    run(`WEB_RELEASE_NEW_DIR="${second}"\n${pruneBlock}`, app, "aaa")
    expect(existsSync(first)).toBe(false)
    expect(readdirSync(join(app, "web-releases"))).toEqual([second.split("/").pop()])
  })
})
