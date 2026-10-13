/** Dispatch-only, fixed fictional tenant acceptance through normal mobile and
 * CRM HTTP authentication. Database writes only provision an unused fixture
 * mobile credential; requests and decisions go through production APIs. */
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import { APP, DEMO, DEMO_AGENTS, assertContext, assertOwnedOrganization, authenticatedDemoSession,
  credential, databaseUrlFromEnv, readOnlyDemo, readRootFile, safeFailure } from "./mtm-attendance-demo-verification"

export const REQUEST_DEMO = Object.freeze({
  clientRequestId: "ae5db3f8-10ea-47a0-91d3-727845145b71",
  email: "employee-a@mtm-attendance-demo.example.invalid", from: "2026-10-07", to: "2026-10-08",
  reason: "Fictional stage 2 attendance acceptance", note: "Fictional stage 2 approval",
})
const fail = (): never => { throw new Error("VERIFICATION_FAILED") }
const REQUEST_PHASES = ["CONTEXT", "PUBLIC_REVISION", "DATABASE", "FIXTURE_BEFORE", "CREDENTIAL", "PREPARE_CREDENTIAL", "MOBILE_CREDENTIAL", "REQUEST_BEFORE",
  "WEB_LOGIN", "MOBILE_LOGIN", "REPORT_BEFORE", "SUBMISSION", "SUBMISSION_REPLAY", "REVIEW_QUEUE", "REVIEW_BELL", "REVIEW_PANEL", "DECISION", "DECISION_REPLAY",
  "REVIEW_PANEL_AFTER", "EMPLOYEE_REQUESTS", "EMPLOYEE_REPLY", "REPORT_AFTER", "HISTORY", "REQUEST_AFTER", "FIXTURE_AFTER", "FINAL_REVISION"] as const
type RequestPhase = typeof REQUEST_PHASES[number]
class RequestVerificationError extends Error {
  constructor(readonly phase: RequestPhase) { super("VERIFICATION_FAILED") }
}
function phaseFailure(error: unknown, phase: RequestPhase): RequestVerificationError {
  return error instanceof RequestVerificationError ? error : new RequestVerificationError(phase)
}
/** A code-owned stage only. Never serialize an exception, URL, HTTP body or credential. */
export function safeRequestFailure(error: unknown) {
  return { ...safeFailure(new Error("unknown")), ...(error instanceof RequestVerificationError ? { phase: error.phase } : {}) }
}

type Db = Pick<PrismaClient, "$transaction">
export function assertRequestContext(sha: string, deployed: string, now = new Date()) {
  assertContext("read-only-check", sha, deployed, now)
  if (now.getTime() < Date.parse("2026-10-09T00:00:00+04:00")) fail()
}
const requestBody = () => ({ clientRequestId: REQUEST_DEMO.clientRequestId, kind: "ANNUAL_LEAVE", unit: "DAYS",
  startDate: REQUEST_DEMO.from, endDate: REQUEST_DEMO.to, reason: REQUEST_DEMO.reason })
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function data(value: unknown) { const body = record(value); if (body.success !== true) return fail(); return record(body.data) }
function items(value: unknown) { if (!Array.isArray(value)) return fail(); return value.map(record) }

/** Only fill the two null credential fields of the one immutable fixture ID.
 * A different email, linked CRM identity or existing password is never replaced. */
export async function prepareRequestDemo(db: Db, passwordHash: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO.marker}))`
    assertOwnedOrganization(await tx.organization.findUnique({ where: { id: DEMO.id }, select: { id: true, slug: true, settings: true } }))
    const agent = await tx.mtmAgent.findFirst({ where: { organizationId: DEMO.id, id: DEMO_AGENTS[0] },
      select: { email: true, passwordHash: true, userId: true, role: true, status: true } })
    if (!agent || agent.role !== "AGENT" || agent.status !== "ACTIVE" || agent.userId) return fail()
    if (agent.email === REQUEST_DEMO.email && agent.passwordHash) return false
    if (agent.email !== null || agent.passwordHash !== null) return fail()
    const saved = await tx.mtmAgent.updateMany({ where: { organizationId: DEMO.id, id: DEMO_AGENTS[0], email: null, passwordHash: null, userId: null },
      data: { email: REQUEST_DEMO.email, passwordHash } })
    if (saved.count !== 1) return fail()
    return true
  }, { isolationLevel: "Serializable", timeout: 15_000 })
}

/** Read-only independent database evidence, with no request/document payload in
 * the returned artifact. Unexpected fixture state aborts rather than repairs. */
export async function readRequestDemo(db: Db) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, true)`
    assertOwnedOrganization(await tx.organization.findUnique({ where: { id: DEMO.id }, select: { id: true, slug: true, settings: true } }))
    const rows = await tx.mtmHrmRequest.findMany({ where: { organizationId: DEMO.id, agentId: DEMO_AGENTS[0],
      startDate: { lte: new Date(REQUEST_DEMO.to) }, endDate: { gte: new Date(REQUEST_DEMO.from) } }, take: 2,
      select: { id: true, clientRequestId: true, status: true, reason: true, startDate: true, endDate: true,
        attendanceDetails: true, decidedAt: true, decidedByUserId: true, decisionNote: true } })
    if (rows.length > 1) return fail()
    const row = rows[0]
    if (!row) return { status: "NONE" as const, requestId: null, submittedAudits: 0, decidedAudits: 0, reviewerBells: 0, employeeReplies: 0 }
    const detail = record(row.attendanceDetails)
    if (row.clientRequestId !== REQUEST_DEMO.clientRequestId || row.reason !== REQUEST_DEMO.reason
      || row.startDate.toISOString().slice(0, 10) !== REQUEST_DEMO.from || row.endDate.toISOString().slice(0, 10) !== REQUEST_DEMO.to
      || detail.kind !== "ANNUAL_LEAVE" || detail.unit !== "DAYS" || detail.timezone !== "Asia/Baku"
      || !Array.isArray(detail.attachmentIds) || detail.attachmentIds.length || !["PENDING", "APPROVED"].includes(row.status)) return fail()
    if (row.status === "APPROVED" && (row.decidedByUserId !== DEMO.userId || !row.decidedAt || row.decisionNote !== REQUEST_DEMO.note)) return fail()
    const submittedAudits = await tx.mtmAuditLog.count({ where: { organizationId: DEMO.id, entityId: row.id, action: "MTM_ATTENDANCE_REQUEST_SUBMITTED" } })
    const decidedAudits = await tx.mtmAuditLog.count({ where: { organizationId: DEMO.id, entityId: row.id, action: "MTM_ATTENDANCE_REQUEST_DECIDED" } })
    const reviewerBells = await tx.notification.count({ where: { organizationId: DEMO.id, userId: DEMO.userId, entityType: "mtm_attendance_request", entityId: row.id } })
    const employeeReplies = await tx.mtmNotification.count({ where: { organizationId: DEMO.id, agentId: DEMO_AGENTS[0], metadata: { path: ["attendanceRequestId"], equals: row.id } } })
    if (submittedAudits !== 1 || reviewerBells !== 1 || decidedAudits !== (row.status === "APPROVED" ? 1 : 0) || employeeReplies !== decidedAudits) return fail()
    return { status: row.status as "PENDING" | "APPROVED", requestId: row.id, submittedAudits, decidedAudits, reviewerBells, employeeReplies }
  }, { isolationLevel: "RepeatableRead", timeout: 15_000 })
}

export function verifyRequestReport(value: unknown, approved: boolean) {
  const report = record(value), rows = items(report.rows), totals = record(report.totals)
  if (rows.length !== 2 || rows.some((row, i) => row.employeeId !== DEMO_AGENTS[0] || row.date !== [REQUEST_DEMO.from, REQUEST_DEMO.to][i]
    || row.workedSeconds !== 0 || row.pausedSeconds !== 0 || row.kind !== (approved ? "APPROVED_REQUEST" : "ABSENT")
    || (approved && record(row.dayKind).key !== "ANNUAL_LEAVE"))) return fail()
  if (totals.rowCount !== 2 || totals.absentCount !== (approved ? 0 : 2) || totals.workedSeconds !== 0
    || totals.annualLeaveDays !== (approved ? 2 : 0)) return fail()
  return { rowCount: 2, absentCount: approved ? 0 : 2, annualLeaveDays: approved ? 2 : 0, workedSeconds: 0 }
}

export async function exerciseRequestDemo(password: string, initial: Awaited<ReturnType<typeof readRequestDemo>>, fetcher: typeof fetch = fetch) {
  let token = ""
  let phase: RequestPhase = "WEB_LOGIN"
  const session = await authenticatedDemoSession(password, fetcher).catch(error => { throw phaseFailure(error, phase) })
  const requestPath = "/api/v1/mtm/mobile/attendance/requests"
  const reportPath = `/api/v1/mtm/attendance/report?from=${REQUEST_DEMO.from}&to=${REQUEST_DEMO.to}&form=ALL&employeeId=${DEMO_AGENTS[0]}`
  async function mobile(path: string, body?: unknown) {
    if (![requestPath, "/api/v1/mtm/mobile/auth", "/api/v1/mtm/mobile/notifications"].includes(path)) return fail()
    const response = await fetcher(`${DEMO.origin}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (![200, 201].includes(response.status)) return fail()
    const text = await response.text(); if (Buffer.byteLength(text) > 256_000) return fail()
    return data(JSON.parse(text))
  }
  try {
    phase = "MOBILE_LOGIN"
    const auth = await mobile("/api/v1/mtm/mobile/auth", { email: REQUEST_DEMO.email, password, organizationSlug: DEMO.slug })
    const agent = record(auth.agent)
    if (agent.id !== DEMO_AGENTS[0] || agent.organizationId !== DEMO.id || agent.role !== "AGENT" || typeof auth.token !== "string" || !auth.token) return fail()
    token = auth.token
    const transitioned = initial.status !== "APPROVED"
    phase = "REPORT_BEFORE"
    if (transitioned) verifyRequestReport(data(await session.request(reportPath)), false)
    phase = "SUBMISSION"
    const submitted = await mobile(requestPath, requestBody()), request = record(submitted.request)
    if (typeof request.id !== "string" || !/^[a-f0-9-]{36}$/.test(request.id) || request.status !== (transitioned ? "PENDING" : "APPROVED")) return fail()
    if (initial.requestId && initial.requestId !== request.id) return fail()
    phase = "SUBMISSION_REPLAY"
    const replay = await mobile(requestPath, requestBody())
    if (replay.idempotent !== true || record(replay.request).id !== request.id) return fail()
    phase = "REVIEW_QUEUE"
    const queue = data(await session.request(`/api/v1/mtm/attendance/requests?status=${transitioned ? "PENDING" : "APPROVED"}`))
    if (!items(queue.items).some(row => row.id === request.id && row.agentId === DEMO_AGENTS[0])) return fail()
    phase = "REVIEW_BELL"
    const bells = data(await session.request("/api/v1/notifications"))
    if (!items(bells.notifications).some(row => row.entityType === "mtm_attendance_request" && row.entityId === request.id)) return fail()
    if (transitioned) {
      phase = "REVIEW_PANEL"
      const attention = data(await session.request("/api/v1/mtm/week/attention"))
      if (!items(attention.items).some(row => row.kind === "attendanceRequests" && row.count === 1)) return fail()
    }
    const decide = () => session.request(`/api/v1/mtm/attendance/requests/${request.id}/decision`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "APPROVED", version: request.version, note: REQUEST_DEMO.note }) })
    phase = "DECISION"
    const decided = data(await decide())
    if (record(decided.request).id !== request.id || record(decided.request).status !== "APPROVED") return fail()
    phase = "DECISION_REPLAY"
    const repeated = data(await decide())
    if (repeated.idempotent !== true || record(repeated.request).id !== request.id) return fail()
    phase = "REVIEW_PANEL_AFTER"
    const afterAttention = data(await session.request("/api/v1/mtm/week/attention"))
    if (items(afterAttention.items).some(row => row.kind === "attendanceRequests" && row.count !== 0)) return fail()
    phase = "EMPLOYEE_REQUESTS"
    const own = await mobile(requestPath)
    if (!items(own.items).some(row => row.id === request.id && row.status === "APPROVED" && row.decisionNote === REQUEST_DEMO.note)) return fail()
    phase = "EMPLOYEE_REPLY"
    const inbox = await mobile("/api/v1/mtm/mobile/notifications")
    if (!items(inbox.items).some(row => record(row.metadata).attendanceRequestId === request.id && record(row.metadata).status === "APPROVED")) return fail()
    phase = "REPORT_AFTER"
    const report = verifyRequestReport(data(await session.request(reportPath)), true)
    phase = "HISTORY"
    const history = data(await session.request(`/api/v1/mtm/attendance/decisions?from=${REQUEST_DEMO.from}&to=${REQUEST_DEMO.to}&status=APPROVED`))
    if (!items(history.items).some(row => row.id === request.id && row.employeeId === DEMO_AGENTS[0] && row.source === "EMPLOYEE" && record(row.decision).at)) return fail()
    return { transitioned, report }
  } catch (error) { throw phaseFailure(error, phase) }
  finally { token = ""; session.close() }
}

export async function runRequestProduction(sha: string) {
  let phase: RequestPhase = "CONTEXT"
  try {
    assertRequestContext(sha, readRootFile(`${APP}/.deploy-sha`, 128))
    if (process.getuid?.() !== 0) return fail()
    phase = "PUBLIC_REVISION"
    const response = await fetch(`${DEMO.origin}/api/v1/public/build-info`, { redirect: "error", signal: AbortSignal.timeout(10_000) })
    if (!response.ok || (await response.json()).artifactSha !== sha) return fail()
    phase = "DATABASE"
    process.env.DATABASE_URL = databaseUrlFromEnv(readRootFile("/etc/leaddrive/app.env", 65536))
    const requireApp = createRequire(`${APP}/package.json`)
    const bcrypt = requireApp("bcryptjs") as typeof import("bcryptjs")
    const { makeScriptPrisma } = await import(pathToFileURL(`${APP}/scripts/_rls.mjs`).href)
    const db: PrismaClient = await makeScriptPrisma({ orgId: DEMO.id })
    try {
      phase = "FIXTURE_BEFORE"
      const before = await readOnlyDemo(db)
      phase = "CREDENTIAL"
      const password = credential("read-only-check")
      if (!await bcrypt.compare(password, before.passwordHash)) return fail()
      phase = "PREPARE_CREDENTIAL"
      await prepareRequestDemo(db, await bcrypt.hash(password, 12))
      phase = "MOBILE_CREDENTIAL"
      const hash = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
        return tx.mtmAgent.findFirst({ where: { organizationId: DEMO.id, id: DEMO_AGENTS[0], email: REQUEST_DEMO.email, userId: null }, select: { passwordHash: true } })
      })
      if (!hash?.passwordHash || !await bcrypt.compare(password, hash.passwordHash)) return fail()
      phase = "REQUEST_BEFORE"
      const initial = await readRequestDemo(db)
      const result = await exerciseRequestDemo(password, initial)
      phase = "REQUEST_AFTER"
      const final = await readRequestDemo(db)
      phase = "FIXTURE_AFTER"
      const after = await readOnlyDemo(db)
      if (final.status !== "APPROVED" || JSON.stringify(before.workdays) !== JSON.stringify(after.workdays)) return fail()
      phase = "FINAL_REVISION"
      assertRequestContext(sha, readRootFile(`${APP}/.deploy-sha`, 128))
      return { version: 1, status: "PASS", artifactSha: sha, tenant: DEMO.slug, period: { from: REQUEST_DEMO.from, to: REQUEST_DEMO.to },
        loginMethods: ["credentials", "mobile-credentials"], readOnlyComparison: true, physicalPhone: "NOT_RUN", transitioned: result.transitioned,
        checks: { submission: true, replay: true, reviewerQueue: true, reviewerBell: true, reviewerPanel: true, decision: true, employeeReply: true, report: true, history: true, phoneFactsUnchanged: true },
        counts: { submittedAudits: final.submittedAudits, decidedAudits: final.decidedAudits, reviewerBells: final.reviewerBells, employeeReplies: final.employeeReplies }, report: result.report }
    } finally { await db.$disconnect() }
  } catch (error) { throw phaseFailure(error, phase) }
  finally { delete process.env.DATABASE_URL }
}

export function validateRequestEvidence(value: unknown) {
  const row = record(value)
  if (row.status === "FAIL") {
    if (row.phase !== undefined && !REQUEST_PHASES.includes(row.phase as RequestPhase)) return fail()
    const expected = { ...safeFailure(new Error("unknown")), ...(row.phase === undefined ? {} : { phase: row.phase }) }
    if (JSON.stringify(row) !== JSON.stringify(expected)) return fail()
    return row
  }
  const expected = { version: 1, status: "PASS", artifactSha: row.artifactSha, tenant: DEMO.slug,
    period: { from: REQUEST_DEMO.from, to: REQUEST_DEMO.to }, loginMethods: ["credentials", "mobile-credentials"],
    readOnlyComparison: true, physicalPhone: "NOT_RUN", transitioned: row.transitioned,
    checks: { submission: true, replay: true, reviewerQueue: true, reviewerBell: true, reviewerPanel: true, decision: true, employeeReply: true, report: true, history: true, phoneFactsUnchanged: true },
    counts: { submittedAudits: 1, decidedAudits: 1, reviewerBells: 1, employeeReplies: 1 },
    report: { rowCount: 2, absentCount: 0, annualLeaveDays: 2, workedSeconds: 0 } }
  if (!/^[a-f0-9]{40}$/.test(String(row.artifactSha)) || typeof row.transitioned !== "boolean" || JSON.stringify(row) !== JSON.stringify(expected)) return fail()
  return row
}
if (process.argv[2] === "--run-requests") {
  void runRequestProduction(process.argv[3]).then(result => { process.stdout.write(JSON.stringify(validateRequestEvidence(result)) + "\n") }).catch(error => {
    process.stdout.write(JSON.stringify(safeRequestFailure(error)) + "\n"); process.exitCode = 1
  })
} else if (process.argv[2] === "--validate-requests") {
  let input = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", chunk => { input += chunk; if (input.length > 16_384) process.exit(1) })
  process.stdin.on("end", () => { try { process.stdout.write(JSON.stringify(validateRequestEvidence(JSON.parse(input))) + "\n") } catch { process.exitCode = 1 } })
}
