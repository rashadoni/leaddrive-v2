import { describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PrismaClient } from "@prisma/client"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { DEMO, DEMO_AGENTS, DEMO_WORKDAYS, assertContext, assertOwnedOrganization, authenticatedReport,
  databaseUrlFromEnv, expectedRows, prepareDemo, readOnlyDemo, safeFailure, validateEvidence, verifyParity,
} from "../../scripts/mtm-attendance-demo-verification"

const at = (day: string, clock: string) => new Date(`${day}T${clock}:00.000+04:00`)
const snapshot = () => ({ workdays: DEMO_WORKDAYS.map((day) => ({
  id: day.id, agentId: day.agentId, workDate: new Date(`${day.date}T00:00:00Z`), status: "COMPLETED" as const,
  startedAt: at(day.date, day.events[0][1]), completedAt: at(day.date, day.events.at(-1)![1]), totalPausedSeconds: day.paused,
  events: day.events.map(([type, time], i) => ({ id: `${day.id}-event-${i}`, type,
    occurredAt: at(day.date, time), appliedAt: at(day.date, time), claimedAt: at(day.date, time), serverReceivedAt: new Date(at(day.date, time).getTime() + 1000) })),
})) })
const report = () => buildMtmAttendanceReport({ employees: DEMO_AGENTS.map((id) => ({ id, name: "Fictional", teamId: null, teamName: null })),
  workdays: snapshot().workdays, calendar: [], rules: [], from: DEMO.from, to: DEMO.to, now: "2026-10-13T10:00:00Z" })
const owned = { id: DEMO.id, slug: DEMO.slug, settings: { attendanceDemoOwner: DEMO.marker } }
const sha = "a".repeat(40)

describe("dedicated attendance demo controller", () => {
  it("refuses an existing tenant with the same slug unless both identity and task marker match", () => {
    expect(() => assertOwnedOrganization(owned)).not.toThrow()
    for (const org of [null, { ...owned, id: "another-tenant" }, { ...owned, settings: {} }, { ...owned, slug: "customer" }]) {
      expect(() => assertOwnedOrganization(org)).toThrow("TENANT_NOT_OWNED")
    }
  })
  it("requires a completed period, explicit mode and exact deployed revision", () => {
    expect(() => assertContext("read-only-check", sha, sha, new Date("2026-10-13"))).not.toThrow()
    expect(() => assertContext("prepare-and-check", sha, sha, new Date("2026-10-06"))).toThrow("PERIOD_NOT_COMPLETE")
    expect(() => assertContext("read-only-check", sha, "b".repeat(40))).toThrow("REVISION_OR_MODE_INVALID")
    expect(() => assertContext("seed-any-tenant", sha, sha)).toThrow("REVISION_OR_MODE_INVALID")
  })
  it("ownership collision stops preparation before any create; an owned repeat performs no rewrite", async () => {
    const create = vi.fn()
    const tx = { $executeRaw: vi.fn(), organization: { findMany: vi.fn(async () => [{ ...owned, settings: {} }]), create } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    await expect(prepareDemo(db, "not-logged")).rejects.toThrow("TENANT_NOT_OWNED")
    expect(create).not.toHaveBeenCalled()
    tx.organization.findMany.mockResolvedValue([owned])
    await expect(prepareDemo(db, "not-logged")).resolves.toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it("sets transaction READ ONLY before even the ownership lookup", async () => {
    const calls: string[] = []
    const tx = { $executeRawUnsafe: vi.fn(async (sql: string) => { calls.push(sql) }),
      $executeRaw: vi.fn(async () => { calls.push("tenant context") }),
      organization: { findMany: vi.fn(async () => { calls.push("ownership"); return [] }) } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown, options: unknown) => {
      expect(options).toMatchObject({ isolationLevel: "RepeatableRead" }); return fn(tx)
    } } as unknown as PrismaClient
    await expect(readOnlyDemo(db)).rejects.toThrow("TENANT_NOT_OWNED")
    expect(calls).toEqual(["SET TRANSACTION READ ONLY", "tenant context", "ownership"])
  })
  it("independently matches actual report rows, shared-parser pauses, journal clocks and totals", () => {
    const parity = verifyParity(snapshot(), report())
    expect(parity.totals).toMatchObject({ workedSeconds: 90540, pausedSeconds: 3000, lateSeconds: 1260, earlyLeaveSeconds: 1800, absentCount: 1 })
    expect(expectedRows(snapshot()).at(-1)?.lateSeconds).toBe(0)
    const evidence = { version: 1, status: "PASS", mode: "read-only-check", artifactSha: sha, tenant: DEMO.slug, created: false,
      period: { from: DEMO.from, to: DEMO.to }, readOnlyComparison: true, loginMethod: "credentials", ...parity }
    expect(validateEvidence(evidence)).toEqual(evidence)
    expect(() => validateEvidence({ ...evidence, cookie: "PRIVATE" })).toThrow("OUTPUT_INVALID")
    expect(() => validateEvidence({ ...evidence, rows: [{ ...parity.rows[0], password: "PRIVATE" }] })).toThrow("OUTPUT_INVALID")
  })
  it("detects wrong rounding, planned-lunch subtraction, missing journal, duplicate rows and changed totals", () => {
    for (const change of [
      (value: ReturnType<typeof report>) => { value.rows[0].workedSeconds! -= 3600 },
      (value: ReturnType<typeof report>) => { value.rows[0].lateSeconds! -= 600 },
      (value: ReturnType<typeof report>) => { value.rows[0].events.pop() },
      (value: ReturnType<typeof report>) => { value.rows[1] = value.rows[0] },
      (value: ReturnType<typeof report>) => { value.totals.workedSeconds++ },
    ]) { const value = report(); change(value); expect(() => verifyParity(snapshot(), value)).toThrow(/PARITY_FAILED/) }
    const changed = snapshot(); changed.workdays[0].totalPausedSeconds++
    expect(() => expectedRows(changed)).toThrow("PAUSE_PARITY_FAILED")
  })
  it("returns only fixed error codes, never an exception or credential-bearing payload", () => {
    expect(safeFailure(new Error("postgres://user:PRIVATE@host/db cookie=PRIVATE"))).toEqual({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED" })
    expect(() => validateEvidence({ version: 1, status: "FAIL", code: "LOGIN_FAILED", detail: "PRIVATE" })).toThrow("OUTPUT_INVALID")
    expect(databaseUrlFromEnv("DATABASE_URL='postgresql://app:pass@localhost/db'\n")).toBe("postgresql://app:pass@localhost/db")
    expect(() => databaseUrlFromEnv("DATABASE_URL=x\nDATABASE_URL=y")).toThrow("APP_ENV_INVALID")
  })
  it("uses normal CSRF and credentials login, validates the fixture session, then performs only report GET", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      if (String(url).endsWith("/csrf")) return Response.json({ csrfToken: "c".repeat(64) }, { headers: { "set-cookie": "__Host-authjs.csrf-token=opaque; Secure; HttpOnly" } })
      if (String(url).endsWith("/credentials")) return Response.json({ url: `${DEMO.origin}/ru/mtm/attendance` }, { headers: { "set-cookie": "__Secure-authjs.session-token=opaque-session; Secure; HttpOnly" } })
      if (String(url).endsWith("/session")) return Response.json({ user: { id: DEMO.userId, organizationId: DEMO.id, role: "admin" } })
      return Response.json({ success: true, data: report() })
    }) as typeof fetch
    expect(await authenticatedReport("runtime-secret", fetcher)).toEqual(report())
    expect(calls.map((call) => [new URL(call.url).pathname, call.init.method ?? "GET"])).toEqual([
      ["/api/auth/csrf", "GET"], ["/api/auth/callback/credentials", "POST"], ["/api/auth/session", "GET"], ["/api/v1/mtm/attendance/report", "GET"],
    ])
    expect(new URLSearchParams(calls[1].init.body as URLSearchParams).get("organizationSlug")).toBe(DEMO.slug)
    expect(new URLSearchParams(calls[1].init.body as URLSearchParams).get("password")).toBe("runtime-secret")
    expect(calls[3].init.headers).toMatchObject({ cookie: expect.stringContaining("__Secure-authjs.session-token=opaque-session") })
    expect(calls.every((call) => new URL(call.url).origin === DEMO.origin && call.init.redirect === "manual")).toBe(true)
  })
  it("does not fetch a report after a denied or foreign-tenant session", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: "c".repeat(64) }))
      .mockResolvedValueOnce(Response.json({ url: `${DEMO.origin}/ru/mtm/attendance` }, { headers: { "set-cookie": "authjs.session-token=opaque" } }))
      .mockResolvedValueOnce(Response.json({ user: { id: DEMO.userId, organizationId: "customer", role: "admin" } }))
    await expect(authenticatedReport("runtime-secret", fetcher)).rejects.toThrow("LOGIN_FAILED")
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it("builds the standalone controller from the actual parser and rejects secret-bearing artifact input", () => {
    const output = join(mkdtempSync(join(tmpdir(), "attendance-demo-controller-")), "controller.cjs")
    const build = spawnSync(process.execPath, ["scripts/build-mtm-attendance-demo-controller.mjs", output], { encoding: "utf8" })
    expect(build.status, build.stderr).toBe(0)
    expect(readFileSync(output, "utf8")).toContain("function mtmWorkdayPauses(")
    const ok = spawnSync(process.execPath, [output, "--validate-output"], { input: JSON.stringify(safeFailure(new Error("PRIVATE"))), encoding: "utf8" })
    expect(ok.status).toBe(0)
    expect(JSON.parse(ok.stdout)).toEqual({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED" })
    const bad = spawnSync(process.execPath, [output, "--validate-output"], { input: '{"status":"FAIL","password":"PRIVATE"}', encoding: "utf8" })
    expect(bad.status).toBe(1)
    expect(bad.stdout + bad.stderr).not.toContain("PRIVATE")
  })
})
