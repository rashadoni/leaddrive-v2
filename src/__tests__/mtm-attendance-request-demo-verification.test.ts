import { describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PrismaClient } from "@prisma/client"
import { DEMO, DEMO_AGENTS } from "../../scripts/mtm-attendance-demo-verification"
import { REQUEST_DEMO, assertRequestContext, exerciseRequestDemo, prepareRequestDemo, readRequestDemo, validateRequestEvidence, verifyRequestReport } from "../../scripts/mtm-attendance-request-demo-verification"

const id = "253f98f2-2359-45c8-aa57-33554e5dde17"
const initial = { status: "NONE" as const, requestId: null, submittedAudits: 0, decidedAudits: 0, reviewerBells: 0, employeeReplies: 0 }
function report(approved: boolean) { return { rows: [REQUEST_DEMO.from, REQUEST_DEMO.to].map(date => ({ employeeId: DEMO_AGENTS[0], date,
  kind: approved ? "APPROVED_REQUEST" : "ABSENT", workedSeconds: 0, pausedSeconds: 0, dayKind: approved ? { key: "ANNUAL_LEAVE" } : undefined })),
  totals: { rowCount: 2, absentCount: approved ? 0 : 2, annualLeaveDays: approved ? 2 : 0, workedSeconds: 0 } } }
function httpFixture(alreadyApproved = false, corrupt?: (path: string, response: Response) => Response) {
  let approved = alreadyApproved, submitted = alreadyApproved
  const calls: Array<{ path: string; init: RequestInit }> = []
  const request = () => ({ id, agentId: DEMO_AGENTS[0], status: approved ? "APPROVED" : "PENDING", version: "2026-10-13T10:00:00Z", decisionNote: approved ? REQUEST_DEMO.note : null })
  const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)), path = url.pathname; calls.push({ path, init })
    expect(url.origin).toBe(DEMO.origin); expect(init.redirect).toBe("manual")
    const payload = (value: unknown, status = 200) => Response.json({ success: true, data: value }, { status })
    let response: Response
    if (path === "/api/auth/csrf") response = Response.json({ csrfToken: "c".repeat(64) })
    else if (path === "/api/auth/callback/credentials") response = Response.json({ url: `${DEMO.origin}/ru/mtm/attendance` }, { headers: { "set-cookie": "authjs.session-token=PRIVATE_CRM_TOKEN" } })
    else if (path === "/api/auth/session") response = Response.json({ user: { id: DEMO.userId, organizationId: DEMO.id, role: "admin" } })
    else if (path === "/api/v1/mtm/mobile/auth") {
      expect(JSON.parse(init.body as string)).toEqual({ email: REQUEST_DEMO.email, password: "PRIVATE_PASSWORD", organizationSlug: DEMO.slug })
      response = payload({ token: "PRIVATE_MOBILE_TOKEN", agent: { id: DEMO_AGENTS[0], organizationId: DEMO.id, role: "AGENT" } })
    } else if (path === "/api/v1/mtm/attendance/report") response = payload(report(approved))
    else if (path === "/api/v1/mtm/mobile/attendance/requests") {
      expect(init.headers).toMatchObject({ Authorization: "Bearer PRIVATE_MOBILE_TOKEN" })
      if (init.method === "POST") {
        expect(JSON.parse(init.body as string)).toMatchObject({ clientRequestId: REQUEST_DEMO.clientRequestId, kind: "ANNUAL_LEAVE", startDate: REQUEST_DEMO.from, endDate: REQUEST_DEMO.to })
        response = payload({ request: request(), idempotent: submitted }, submitted ? 200 : 201); submitted = true
      } else response = payload({ items: [request()] })
    } else if (path === "/api/v1/mtm/attendance/requests") response = payload({ items: [request()] })
    else if (path === "/api/v1/notifications") response = payload({ notifications: [{ entityType: "mtm_attendance_request", entityId: id }] })
    else if (path === "/api/v1/mtm/week/attention") response = payload({ items: [{ kind: "attendanceRequests", count: approved ? 0 : 1 }] })
    else if (path === `/api/v1/mtm/attendance/requests/${id}/decision`) {
      expect(JSON.parse(init.body as string)).toMatchObject({ decision: "APPROVED", note: REQUEST_DEMO.note }); const idempotent = approved; approved = true
      response = payload({ request: request(), idempotent })
    } else if (path === "/api/v1/mtm/mobile/notifications") response = payload({ items: [{ metadata: { attendanceRequestId: id, status: "APPROVED" } }] })
    else if (path === "/api/v1/mtm/attendance/decisions") response = payload({ items: [{ id, employeeId: DEMO_AGENTS[0], source: "EMPLOYEE", decision: { at: "2026-10-13T10:00:00Z" } }] })
    else throw new Error("Unexpected acceptance path")
    return corrupt ? corrupt(path, response) : response
  }) as typeof fetch
  return { fetcher, calls }
}
const evidence = () => ({ version: 1, status: "PASS", artifactSha: "a".repeat(40), tenant: DEMO.slug,
  period: { from: REQUEST_DEMO.from, to: REQUEST_DEMO.to }, loginMethods: ["credentials", "mobile-credentials"], readOnlyComparison: true, physicalPhone: "NOT_RUN", transitioned: true,
  checks: { submission: true, replay: true, reviewerQueue: true, reviewerBell: true, reviewerPanel: true, decision: true, employeeReply: true, report: true, history: true, phoneFactsUnchanged: true },
  counts: { submittedAudits: 1, decidedAudits: 1, reviewerBells: 1, employeeReplies: 1 }, report: { rowCount: 2, absentCount: 0, annualLeaveDays: 2, workedSeconds: 0 } })

describe("fixed-tenant request acceptance controller", () => {
  it("requires the whole request period to be complete and the exact deployed revision", () => {
    const sha = "a".repeat(40)
    expect(() => assertRequestContext(sha, sha, new Date("2026-10-08T19:59:59Z"))).toThrow()
    expect(() => assertRequestContext(sha, sha, new Date("2026-10-08T20:00:00Z"))).not.toThrow()
    expect(() => assertRequestContext(sha, "b".repeat(40))).toThrow()
  })
  it("uses both real login protocols, one repeated UUID, queue/bell/panel, decision and report in order", async () => {
    const { fetcher, calls } = httpFixture()
    const result = await exerciseRequestDemo("PRIVATE_PASSWORD", initial, fetcher)
    expect(result).toEqual({ transitioned: true, report: { rowCount: 2, absentCount: 0, annualLeaveDays: 2, workedSeconds: 0 } })
    expect(calls.filter(call => call.path.endsWith("/attendance/report"))).toHaveLength(2)
    expect(calls.filter(call => call.init.method === "POST").map(call => call.path)).toEqual([
      "/api/auth/callback/credentials", "/api/v1/mtm/mobile/auth", "/api/v1/mtm/mobile/attendance/requests", "/api/v1/mtm/mobile/attendance/requests", `/api/v1/mtm/attendance/requests/${id}/decision`, `/api/v1/mtm/attendance/requests/${id}/decision`,
    ])
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|token|password/)
  })
  it("rechecks an already approved fixture without claiming a new pending-to-approved transition", async () => {
    const { fetcher, calls } = httpFixture(true)
    const result = await exerciseRequestDemo("PRIVATE_PASSWORD", { ...initial, status: "APPROVED", requestId: id, submittedAudits: 1, decidedAudits: 1, reviewerBells: 1, employeeReplies: 1 }, fetcher)
    expect(result.transitioned).toBe(false)
    expect(calls.filter(call => call.path.endsWith("/week/attention"))).toHaveLength(1)
    expect(calls.filter(call => call.path.endsWith("/attendance/report"))).toHaveLength(1)
  })
  it.each(["/api/v1/mtm/mobile/auth", "/api/v1/mtm/attendance/requests", "/api/v1/notifications", "/api/v1/mtm/week/attention", "/api/v1/mtm/mobile/notifications", "/api/v1/mtm/attendance/decisions"])("fails closed on a missing required result at %s", async path => {
    const { fetcher } = httpFixture(false, (target, response) => target === path ? Response.json({ success: true, data: {} }) : response)
    await expect(exerciseRequestDemo("PRIVATE_PASSWORD", initial, fetcher)).rejects.toThrow("VERIFICATION_FAILED")
  })
  it("refuses wrong totals, dates, employee or facts rather than accepting a changed baseline", () => {
    expect(verifyRequestReport(report(true), true).annualLeaveDays).toBe(2)
    for (const changed of [() => { const r = report(true); r.totals.workedSeconds = 1; return r },
      () => { const r = report(true); r.rows[0].employeeId = "foreign" as typeof DEMO_AGENTS[0]; return r },
      () => { const r = report(true); r.rows[0].date = REQUEST_DEMO.to; return r }]) expect(() => verifyRequestReport(changed(), true)).toThrow()
  })
  it("does not replace a credential or linked identity and only enters the marker-owned tenant", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    let owner: unknown = { id: DEMO.id, slug: DEMO.slug, settings: { attendanceDemoOwner: DEMO.marker } }
    let agent: unknown = { email: null, passwordHash: null, userId: null, role: "AGENT", status: "ACTIVE" }
    const tx = { $executeRaw: vi.fn(), organization: { findUnique: vi.fn(async () => owner) }, mtmAgent: { findFirst: vi.fn(async () => agent), updateMany } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    expect(await prepareRequestDemo(db, "PRIVATE_HASH")).toBe(true)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: DEMO.id, id: DEMO_AGENTS[0], email: null, passwordHash: null, userId: null }) }))
    updateMany.mockClear()
    agent = { email: REQUEST_DEMO.email, passwordHash: "old-hash", userId: null, role: "AGENT", status: "ACTIVE" }
    expect(await prepareRequestDemo(db, "never-replace")).toBe(false)
    agent = { email: "foreign@example.invalid", passwordHash: "old-hash", userId: null, role: "AGENT", status: "ACTIVE" }
    await expect(prepareRequestDemo(db, "never-replace")).rejects.toThrow()
    owner = { id: DEMO.id, slug: DEMO.slug, settings: {} }
    await expect(prepareRequestDemo(db, "never-replace")).rejects.toThrow("TENANT_NOT_OWNED")
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("begins database comparison READ ONLY before the fixed ownership lookup", async () => {
    const order: string[] = []
    const tx = { $executeRawUnsafe: async (sql: string) => { order.push(sql) }, $executeRaw: async () => { order.push("tenant") },
      organization: { findUnique: async () => { order.push("owner"); return null } } }
    const db = { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
    await expect(readRequestDemo(db)).rejects.toThrow()
    expect(order).toEqual(["SET TRANSACTION READ ONLY", "tenant", "owner"])
  })
  it("allowlists every output field and never labels API evidence as a physical phone test", () => {
    expect(validateRequestEvidence(evidence())).toEqual(evidence())
    for (const value of [{ ...evidence(), token: "PRIVATE" }, { ...evidence(), physicalPhone: "PASS" },
      { ...evidence(), counts: { submittedAudits: 2 } }, { ...evidence(), report: { password: "PRIVATE" } }]) expect(() => validateRequestEvidence(value)).toThrow()
  })
  it("bundles only reviewed sources and refuses unknown output without printing it", () => {
    const output = join(mkdtempSync(join(tmpdir(), "attendance-request-controller-")), "controller.cjs")
    const build = spawnSync(process.execPath, ["scripts/build-mtm-attendance-request-demo-controller.mjs", output], { encoding: "utf8" })
    expect(build.status, build.stderr).toBe(0)
    const good = spawnSync(process.execPath, [output, "--validate-requests"], { input: JSON.stringify(evidence()), encoding: "utf8" })
    expect(good.status, good.stderr).toBe(0); expect(JSON.parse(good.stdout)).toEqual(evidence())
    const bad = spawnSync(process.execPath, [output, "--validate-requests"], { input: JSON.stringify({ ...evidence(), password: "PRIVATE" }), encoding: "utf8" })
    expect(bad.status).toBe(1); expect(bad.stdout + bad.stderr).not.toContain("PRIVATE")
  })
})
