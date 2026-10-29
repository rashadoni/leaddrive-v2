import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { createLineHealthCheck, type InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import * as watch from "../../scripts/zeytun-line/watch.mjs"

// Owner, 2026-10-28: «сторож линии с сообщением в Telegram».
const now = Date.parse("2026-10-29T08:00:00Z")
const line = {
  version: 1, enabled: true, purpose: "zeytun_line", id: "dddddddd-1111-4111-8111-111111111111",
  organizationId: "tenant-test", channelConfigId: "line-test", issuedAt: new Date(now - 60_000).toISOString(),
  approvalReference: "owner-2026-10-24", approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64) },
  orderOrganizationId: "org-zeytun",
}
function dependencies(overrides: { catalogAgeMs?: number; config?: unknown; call?: () => Promise<unknown> } = {}) {
  const state = { now }
  const catalog = { organizationId: "inspection-test", scopeKey: "a".repeat(64), version: "e".repeat(64),
    observedAt: new Date(now - (overrides.catalogAgeMs ?? 60_000)).toISOString(), source: "live" } as InboundPilotCatalog
  return {
    state,
    loadConfig: vi.fn(async () => ("config" in overrides ? overrides.config : structuredClone(line))),
    loadCatalog: vi.fn(async () => catalog),
    loadCall: vi.fn(async (_config: unknown, _callId: string): Promise<unknown> => (overrides.call ? overrides.call() : null)),
    clock: () => state.now,
  }
}

describe("whether the line would take a call now", () => {
  it("is ready with an active grant, a fresh live catalog and a database that answers", async () => {
    const d = dependencies()
    expect(await createLineHealthCheck(d)()).toEqual({ ok: true, checks: { grant: true, catalog: true, database: true } })
    // The call lookup ran with a call id nobody has.
    expect(d.loadCall.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("names what is missing: no grant, a stale catalog, a database that fails", async () => {
    expect(await createLineHealthCheck(dependencies({ config: null }))()).toEqual({ ok: false, checks: { grant: false, catalog: false, database: false } })
    expect((await createLineHealthCheck(dependencies({ catalogAgeMs: 25 * 3600_000 }))()).checks).toEqual({ grant: true, catalog: false, database: true })
    expect((await createLineHealthCheck(dependencies({ call: async () => { throw new Error("db") } }))()).checks)
      .toEqual({ grant: true, catalog: true, database: false })
    // The rehearsal grant is not the line.
    const rehearsal = { ...line, purpose: "owner_inbound_preview", testPhoneE164: "+994500000001", expiresAt: new Date(now + 600_000).toISOString(),
      approvedSource: { ...line.approvedSource, catalogVersion: "e".repeat(64) } }
    expect((await createLineHealthCheck(dependencies({ config: rehearsal }))()).ok).toBe(false)
  })

  it("asks at most once in ten seconds, whoever asks", async () => {
    const d = dependencies()
    const check = createLineHealthCheck(d)
    await Promise.all([check(), check(), check()])
    d.state.now += 9_000
    await check()
    expect(d.loadConfig).toHaveBeenCalledTimes(1)
    d.state.now += 1_000
    await check()
    expect(d.loadConfig).toHaveBeenCalledTimes(2)
  })

  it("is reachable without a session and sends only the three answers", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/internal/voice-agent/line-health/route.ts"), "utf8")
    expect(route).toContain("{ ...health, proc: processRole() }")
    expect(readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8")).toContain('"/api/internal/voice-agent/line-health"')
  })
})

describe("the line watch", () => {
  const ready = { status: 200, body: { ok: true, checks: { grant: true, catalog: true, database: true }, proc: "line" }, ms: 120 }

  it("sees nothing on a ready line", () => {
    expect(watch.evaluate(ready)).toEqual([])
  })

  it("tells an unreachable line, a line that would refuse a call, the web fallback and slowness apart", () => {
    expect(watch.evaluate({ error: "ECONNREFUSED" }).map((p: { id: string }) => p.id)).toEqual(["line-unreachable"])
    // A Cloudflare page is not the CRM's answer.
    expect(watch.evaluate({ status: 502, body: null, ms: 40 }).map((p: { id: string }) => p.id)).toEqual(["line-unreachable"])
    const refused = watch.evaluate({ ...ready, status: 503, body: { ok: false, checks: { grant: true, catalog: false, database: true }, proc: "line" } })
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ id: "line-not-ready", severity: "critical" })
    expect(refused[0].detail).toContain("каталог Зейтуна")
    expect(refused[0].detail).not.toContain("база")
    expect(watch.evaluate({ ...ready, body: { ...ready.body, proc: "web" } }).map((p: { id: string }) => p.id)).toEqual(["line-on-web"])
    expect(watch.evaluate({ ...ready, ms: 3500 }).map((p: { id: string; severity: string }) => [p.id, p.severity])).toEqual([["line-slow", "warning"]])
  })

  it("tells a problem after two passes, reminds hourly while the line is down, and tells its end after two clean passes", () => {
    const down = watch.evaluate({ error: "ECONNREFUSED" })
    let state: { incidents?: Record<string, unknown> } = {}
    const pass = (problems: unknown[], at: number) => {
      const next = watch.step(state, problems, at)
      const out = watch.messages(next)
      for (const message of out) watch.applySent(next.incidents, message, at)
      state = { incidents: next.incidents }
      return out.map((m: { kind: string; title: string }) => [m.kind, m.title])
    }
    expect(pass(down, now)).toEqual([])
    expect(pass(down, now + 60_000)).toEqual([["raise", "❗ Линия Зейтуна не отвечает станции"]])
    expect(pass(down, now + 120_000)).toEqual([])
    expect(pass(down, now + 60_000 + 3600_000)).toEqual([["remind", "⏰ Линия Зейтуна: всё ещё не исправлено"]])
    expect(pass([], now + 3720_000)).toEqual([])
    expect(pass([], now + 3780_000)).toEqual([["clear", "✅ Линия Зейтуна: снова в порядке"]])
    expect(state.incidents).toEqual({})
    // A single bad pass is never told.
    expect(pass(down, now + 4000_000)).toEqual([])
    expect(pass([], now + 4060_000)).toEqual([])
    expect(state.incidents).toEqual({})
  })

  it("asks the line by the station's road, and reads a timeout as no answer", async () => {
    expect(watch.HEALTH_URL).toBe("https://app.leaddrivecrm.org/api/internal/voice-agent/line-health")
    const fetchOk = vi.fn(async () => new Response(JSON.stringify(ready.body), { status: 200 }))
    expect(await watch.ask("https://x.test", fetchOk, () => 0)).toEqual({ status: 200, body: ready.body, ms: 0 })
    const timeout = vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }) })
    expect(await watch.ask("https://x.test", timeout)).toEqual({ error: "нет ответа за 10 с" })
  })

  it("runs every minute and tells its own failure", () => {
    const timer = readFileSync(join(process.cwd(), "ops/zeytun-line/watch/ld-line-watch.timer"), "utf8")
    expect(timer).toContain("OnCalendar=*-*-* *:*:20")
    expect(readFileSync(join(process.cwd(), "ops/zeytun-line/watch/ld-line-watch.service"), "utf8")).toContain("OnFailure=ld-line-watch-failed.service")
  })
})
