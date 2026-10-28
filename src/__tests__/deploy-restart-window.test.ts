import { EventEmitter } from "node:events"
import { readdirSync, readFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
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
