import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const cron = vi.hoisted(() => ({ denied: null as Response | null }))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => cron.denied) }))

import { POST } from "@/app/api/cron/zeytun-catalog-refresh/route"
import { refreshZeytunLineCatalog } from "@/lib/voice-agent/pharmacy/zeytun-catalog-refresh"
import { zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"

const roots: string[] = []
afterEach(async () => { cron.denied = null; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe("Zeytun line catalog refresh", () => {
  it("does nothing, and says so, without the private 1C connection file", async () => {
    expect(await refreshZeytunLineCatalog({})).toEqual({ outcome: "not_configured" })
    const root = await mkdtemp(join(tmpdir(), "zeytun-refresh-")); roots.push(root)
    expect(await refreshZeytunLineCatalog({ grantFile: join(root, "grant.json"), cacheDir: join(root, "cache") }))
      .toEqual({ outcome: "not_configured" })
  })

  it("answers a tick that is not due from the attempt record alone, before any download or parse", async () => {
    const root = await mkdtemp(join(tmpdir(), "zeytun-refresh-")); roots.push(root)
    const grantDir = join(root, "grant"), cacheDir = join(root, "cache")
    await mkdir(grantDir, { mode: 0o700 })
    const config = { organizationId: "zeytun-test", endpoint: "https://1c.example.test/balances", username: "u", password: "p",
      request: { GUID: "11111111-2222-4333-8444-555555555555", METRO: false, Warehouse: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } }
    await writeFile(join(grantDir, "zeytun-1c-connection.json"), JSON.stringify(config), { mode: 0o600 })
    const scopeKey = zeytunBalanceScopeKey(config), next = Date.now() + 30 * 60_000
    await new ZeytunSnapshotStore(cacheDir, config.organizationId, scopeKey).saveAttempt({
      scopeKey, attemptedAt: Date.now(), nextAttemptAt: next, failures: 0, lastError: null })
    const download = vi.fn()
    vi.stubGlobal("fetch", download)
    expect(await refreshZeytunLineCatalog({ grantFile: join(grantDir, "grant.json"), cacheDir })).toEqual({ outcome: "throttled", nextAttemptAt: next })
    expect(download).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("answers only the cron", async () => {
    cron.denied = new Response(null, { status: 401 })
    expect((await POST(new NextRequest("http://localhost/api/cron/zeytun-catalog-refresh", { method: "POST" }))).status).toBe(401)
  })

  it("is scheduled by the resilience cron installer", () => {
    const installer = readFileSync(join(process.cwd(), "scripts/install-resilience-crons.sh"), "utf8")
    expect(installer).toContain('"*/30 * * * * $TRIGGER /api/cron/zeytun-catalog-refresh >> $LOG 2>&1"')
    expect(installer).toContain("/cron-trigger\\.sh \\/api\\/cron\\/zeytun-catalog-refresh/ { next }")
  })
})
