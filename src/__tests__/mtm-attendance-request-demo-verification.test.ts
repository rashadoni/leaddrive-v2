import { describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { attendanceReportMarks } from "@/lib/mtm/attendance-location-report"
import { DEMO, DEMO_AGENTS, DEMO_WORKDAYS } from "../../scripts/mtm-attendance-demo-verification"
import { REQUEST_DEMO, assertRequestContext, exerciseRequestDemo, exerciseSurfaceDemo, prepareRequestDemo, readRequestDemo, readSurfaceDemo, safeRequestFailure, surfaceDemoEvidence, validateRequestEvidence, verifyRequestReport, verifySurfaceDemo } from "../../scripts/mtm-attendance-request-demo-verification"

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
  counts: { submittedAudits: 1, decidedAudits: 1, reviewerBells: 1, employeeReplies: 1 }, report: { rowCount: 2, absentCount: 0, annualLeaveDays: 2, workedSeconds: 0 }, surfaces: surfaceDemoEvidence() })

const at = (day: string, clock: string) => new Date(`${day}T${clock}:00.000+04:00`)
const phoneFacts = () => ({ workdays: DEMO_WORKDAYS.map(day => ({
  id: day.id, agentId: day.agentId, workDate: new Date(`${day.date}T00:00:00Z`), status: "COMPLETED" as const,
  startedAt: at(day.date, day.events[0][1]), completedAt: at(day.date, day.events.at(-1)![1]), totalPausedSeconds: day.paused,
  events: day.events.map(([type, time], i) => ({ id: `${day.id}-event-${i}`, type, occurredAt: at(day.date, time), appliedAt: at(day.date, time),
    claimedAt: at(day.date, time), serverReceivedAt: new Date(at(day.date, time).getTime() + 1000) })),
})) })
function surfaceSnapshot(): Awaited<ReturnType<typeof readSurfaceDemo>> {
  return { agents: DEMO_AGENTS.map(id => ({ id, role: "AGENT", status: "ACTIVE", teamId: null, userId: null })), users: [{ id: DEMO.userId, role: "admin" }],
    settings: [{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Asia/Baku" }], counts: {
      teams: 0, branches: 0, branchRevisions: 0, assignments: 0, locationPolicies: 0, locationConsents: 0, marks: 0, streamIntegrity: 0, risks: 0, riskDecisions: 0,
      installationRequests: 0, installationDecisions: 0, installationRevocations: 0, qrEvidence: 0, leavePolicies: 0, leaveProfiles: 0, monthCloses: 0, monthMembers: 0,
      monthDays: 0, shiftPlans: 0, shiftMembers: 0, reminderNotices: 0, schedules: 0, deliveries: 0, employment: 0,
    } }
}
function surfaceDatabase(snapshot = surfaceSnapshot()) {
  const order: string[] = []
  const state = { readOnly: "on", orgId: DEMO.id as string, bypass: "off" }
  const owner = { id: DEMO.id, slug: DEMO.slug, settings: { attendanceDemoOwner: DEMO.marker } }
  const tx = { $executeRawUnsafe: async (sql: string) => { order.push(sql) }, $executeRaw: async () => { order.push("tenant") },
    $queryRaw: vi.fn(async (query: TemplateStringsArray, ...values: unknown[]) => {
      if (query.join("").includes("current_setting")) return [state]
      expect(values).toHaveLength(25); expect(values.every(value => value === DEMO.id)).toBe(true)
      return [structuredClone(snapshot.counts)]
    }), organization: { findUnique: async () => { order.push("owner"); return owner } }, mtmAgent: { findMany: async () => structuredClone(snapshot.agents) },
    user: { findMany: async () => structuredClone(snapshot.users) }, mtmSetting: { findMany: async () => structuredClone(snapshot.settings) } }
  const db = { $transaction: (fn: (value: typeof tx) => unknown, options: unknown) => {
    expect(options).toEqual({ isolationLevel: "RepeatableRead", timeout: 15_000 }); return fn(tx)
  } } as unknown as PrismaClient
  return { db, order, state, owner }
}
function surfaceHttp() {
  const report = buildMtmAttendanceReport({ employees: DEMO_AGENTS.map(id => ({ id, name: "PRIVATE_NAME", teamId: null, teamName: null })),
    workdays: phoneFacts().workdays, calendar: [], rules: [], from: DEMO.from, to: DEMO.to, now: "2026-10-13T10:00:00Z" })
  const legacy = { ...report, rows: report.rows.map(row => ({ ...row, locationMarks: attendanceReportMarks(row, new Map()) })) }
  const paths: Record<string, Record<string, unknown>> = {
    "/api/v1/mtm/settings": { attendanceEnabled: true, timezone: "Asia/Baku", attendanceRequireInstallationApproval: false, attendanceBranchQrEnabled: false,
      attendanceEmployeeRemindersEnabled: false, attendanceManagerAlertsEnabled: false },
    "/api/v1/mtm/attendance/branches": { branches: [], canManageBranches: true },
    "/api/v1/mtm/attendance/employees": { timezone: "Asia/Baku", teams: [], users: [{ id: DEMO.userId }],
      employees: DEMO_AGENTS.map(id => ({ id, role: "AGENT", status: "ACTIVE", teamName: null, history: [] })) },
    "/api/v1/mtm/attendance/location-policy": { policy: null },
    [`/api/v1/mtm/attendance/review?from=${DEMO.from}&to=${REQUEST_DEMO.to}&status=ALL`]: { items: [], directory: DEMO_AGENTS.map(id => ({ id })) },
    "/api/v1/mtm/attendance/installations?status=ALL": { required: false, canConfigure: true, timezone: "Asia/Baku", nextCursor: null, items: [] },
    "/api/v1/mtm/attendance/branch-qr": { enabled: false, canConfigure: true, branches: [] },
    [`/api/v1/mtm/attendance/leave-balances?year=2026&usedThrough=${REQUEST_DEMO.to}`]: { year: 2026, usedThrough: REQUEST_DEMO.to, policy: null, canManage: true, hasMore: false,
      rows: DEMO_AGENTS.map(employeeId => ({ employeeId, state: "POLICY_MISSING", profile: null, serviceYears: null, allowanceDays: null, usedDays: null, plannedDays: null, remainingDays: null, availableDays: null })) },
    "/api/v1/mtm/attendance/months?month=2026-09": { month: "2026-09", canClose: true, moreEmployees: false, moreSnapshots: false, items: [], employees: DEMO_AGENTS.map(id => ({ id, closed: false, canClose: true })) },
    "/api/v1/mtm/attendance/shifts?from=2026-10-01&to=2026-10-31": { canManage: true, timezone: "Asia/Baku", revisionId: null, plans: [], rosters: [{ teamId: null, count: 2,
      hash: createHash("sha256").update(JSON.stringify({ organizationId: DEMO.id, teamId: null, ids: [...DEMO_AGENTS].sort() })).digest("hex") }] },
    "/api/v1/mtm/attendance/deliveries": { timezone: "Asia/Baku", schedules: [], receipts: [] },
    [`/api/v1/mtm/attendance/report?from=${DEMO.from}&to=${DEMO.to}&form=ALL`]: legacy,
  }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    expect(init).toEqual({ method: "GET" }); expect(paths[path]).toBeDefined()
    return { success: true, data: paths[path] }
  })
  return { paths, legacy, request }
}

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
  it("returns only a code-owned phase when a real HTTP response or exception contains private data", async () => {
    for (const [path, phase] of [["/api/v1/mtm/mobile/auth", "MOBILE_LOGIN"], ["/api/v1/notifications", "REVIEW_BELL"], ["/api/v1/mtm/mobile/notifications", "EMPLOYEE_REPLY"]]) {
      const { fetcher } = httpFixture(false, (target, response) => target === path ? Response.json({ password: "PRIVATE", token: "PRIVATE" }, { status: 500 }) : response)
      const failure = await exerciseRequestDemo("PRIVATE_PASSWORD", initial, fetcher).then(() => null, safeRequestFailure)
      expect(failure).toEqual({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED", phase })
      expect(validateRequestEvidence(failure)).toEqual(failure)
      expect(JSON.stringify(failure)).not.toContain("PRIVATE")
    }
    expect(safeRequestFailure(new Error("PRIVATE_TOKEN"))).toEqual({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED" })
    expect(() => validateRequestEvidence({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED", phase: "PRIVATE_URL" })).toThrow()
    expect(() => validateRequestEvidence({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED", phase: "WEB_LOGIN", error: "PRIVATE" })).toThrow()
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
      { ...evidence(), counts: { submittedAudits: 2 } }, { ...evidence(), report: { password: "PRIVATE" } },
      { ...evidence(), surfaces: { ...surfaceDemoEvidence(), browser: "PASS" } },
      { ...evidence(), surfaces: { ...surfaceDemoEvidence(), configurationUnchanged: false } },
      { ...evidence(), surfaces: { ...surfaceDemoEvidence(), name: "PRIVATE" } }]) expect(() => validateRequestEvidence(value)).toThrow()
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

describe("read-only deployed attendance surfaces", () => {
  it("independently reads the owned tenant with READ ONLY first and refuses foreign scope or nonempty state", async () => {
    const snapshot = surfaceSnapshot(), fixture = surfaceDatabase(snapshot)
    expect(await readSurfaceDemo(fixture.db)).toEqual(snapshot)
    expect(fixture.order.slice(0, 3)).toEqual(["SET TRANSACTION READ ONLY", "tenant", "owner"])
    fixture.state.orgId = "foreign"
    await expect(readSurfaceDemo(fixture.db)).rejects.toThrow()
    fixture.state.orgId = DEMO.id; fixture.state.bypass = "on"
    await expect(readSurfaceDemo(fixture.db)).rejects.toThrow()
    fixture.state.bypass = "off"; snapshot.counts.branches = 1
    await expect(readSurfaceDemo(fixture.db)).rejects.toThrow()
    expect(snapshot.counts.branches).toBe(1)
    snapshot.counts.branches = 0; snapshot.settings.push({ key: "attendanceBranchQrEnabled", value: true })
    await expect(readSurfaceDemo(fixture.db)).rejects.toThrow()
    snapshot.settings.pop(); fixture.owner.settings.attendanceDemoOwner = "foreign" as typeof DEMO.marker
    await expect(readSurfaceDemo(fixture.db)).rejects.toThrow("TENANT_NOT_OWNED")
  })
  it("checks all deployed directories with GET only, null legal balances and real report journal projections", async () => {
    const { request, paths, legacy } = surfaceHttp()
    expect(legacy.rows.flatMap(row => row.locationMarks)).toHaveLength(6)
    await expect(verifySurfaceDemo(surfaceSnapshot(), phoneFacts(), request)).resolves.toBeUndefined()
    expect(request.mock.calls.map(([path]) => path)).toEqual(Object.keys(paths))
    expect(JSON.stringify(surfaceDemoEvidence())).not.toContain("PRIVATE")
    expect(surfaceDemoEvidence()).toMatchObject({ mode: "READ_ONLY_DEFAULTS", browser: "NOT_RUN" })
  })
  it.each([
    ["settings", "SURFACE_SETTINGS", "attendanceBranchQrEnabled", true],
    ["attendance/branches", "SURFACE_BRANCHES", "branches", [{ id: "PRIVATE_FOREIGN_BRANCH" }]],
    ["attendance/location-policy", "SURFACE_GEO", "policy", { text: "PRIVATE_UNAPPROVED" }],
    ["attendance/leave-balances", "SURFACE_LEAVE", "policy", { reviewed: true }],
    ["attendance/employees", "SURFACE_EMPLOYEES", "employees", [{ id: "PRIVATE_FOREIGN_EMPLOYEE" }]],
    ["attendance/deliveries", "SURFACE_DELIVERIES", "schedules", [{ recipients: ["PRIVATE_EMAIL"] }]],
  ])("refuses a false %s response without exposing its payload", async (suffix, phase, field, value) => {
    const fixture = surfaceHttp(), path = Object.keys(fixture.paths).find(path => path.split("?")[0] === `/api/v1/mtm/${suffix}`)!
    fixture.paths[path][String(field)] = value
    const failure = await verifySurfaceDemo(surfaceSnapshot(), phoneFacts(), fixture.request).then(() => null, safeRequestFailure)
    expect(failure).toEqual({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED", phase })
    expect(validateRequestEvidence(failure)).toEqual(failure)
    expect(JSON.stringify(failure)).not.toContain("PRIVATE")
  })
  it("refuses zero substituted for an unknown legal balance, changed hours or fabricated location evidence", async () => {
    for (const change of [
      (fixture: ReturnType<typeof surfaceHttp>) => { const leave = fixture.paths[`/api/v1/mtm/attendance/leave-balances?year=2026&usedThrough=${REQUEST_DEMO.to}`]; (leave.rows as Array<Record<string, unknown>>)[0].usedDays = 0 },
      (fixture: ReturnType<typeof surfaceHttp>) => { fixture.legacy.rows[0].workedSeconds! -= 3600 },
      (fixture: ReturnType<typeof surfaceHttp>) => { fixture.legacy.rows[0].locationMarks[0].state = "INSIDE" },
      (fixture: ReturnType<typeof surfaceHttp>) => { fixture.legacy.rows[0].locationMarks[1] = fixture.legacy.rows[0].locationMarks[0] },
    ]) {
      const fixture = surfaceHttp(); change(fixture)
      await expect(verifySurfaceDemo(surfaceSnapshot(), phoneFacts(), fixture.request)).rejects.toThrow("VERIFICATION_FAILED")
    }
  })
  it("logs in normally, checks before/after database state and makes no feature mutation", async () => {
    const snapshot = surfaceSnapshot(), { db, order } = surfaceDatabase(snapshot), fixture = surfaceHttp(), calls: string[] = []
    let changeDuringRead = false
    const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input)), path = url.pathname + url.search; calls.push(path)
      expect(url.origin).toBe(DEMO.origin); expect(init.redirect).toBe("manual")
      if (path === "/api/auth/csrf") return Response.json({ csrfToken: "c".repeat(64) })
      if (path === "/api/auth/callback/credentials") {
        expect(init.method).toBe("POST")
        expect(new URLSearchParams(init.body as URLSearchParams).get("organizationSlug")).toBe(DEMO.slug)
        return Response.json({ url: `${DEMO.origin}/ru/mtm/attendance` }, { headers: { "set-cookie": "authjs.session-token=PRIVATE_SESSION" } })
      }
      if (path === "/api/auth/session") return Response.json({ user: { id: DEMO.userId, organizationId: DEMO.id, role: "admin" } })
      expect(init.headers).toMatchObject({ cookie: "authjs.session-token=PRIVATE_SESSION" })
      expect(init.method).toBe("GET")
      if (changeDuringRead) snapshot.settings.push({ key: "attendanceBranchQrEnabled", value: false })
      return Response.json({ success: true, data: fixture.paths[path] })
    }) as typeof fetch
    expect(await exerciseSurfaceDemo(db, "PRIVATE_PASSWORD", phoneFacts(), fetcher)).toEqual(surfaceDemoEvidence())
    expect(order.filter(item => item === "SET TRANSACTION READ ONLY")).toHaveLength(2)
    expect(calls.slice(3)).toEqual(Object.keys(fixture.paths))
    changeDuringRead = true
    // A newly stored false flag is safe in isolation but still a concurrent
    // configuration change; it cannot be accepted as an unchanged baseline.
    const failure = await exerciseSurfaceDemo(db, "PRIVATE_PASSWORD", phoneFacts(), fetcher).then(() => null, safeRequestFailure)
    expect(failure).toEqual({ version: 1, status: "FAIL", code: "VERIFICATION_FAILED", phase: "SURFACE_DATABASE" })
  })
})
