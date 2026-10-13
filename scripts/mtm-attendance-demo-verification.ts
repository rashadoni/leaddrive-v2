/**
 * Dispatch-only attendance acceptance fixture. The workflow bundles this file
 * with the production pause parser and streams it over pinned SSH. No session,
 * password, database URL or raw exception is ever returned to the runner.
 * prepare-and-check inserts only the marker-owned fictional tenant; checking
 * uses a READ ONLY transaction. Normal login may update this fixture's login
 * counters. Neither mode is a general tenant seeder or production diagnostic.
 */
import fs from "node:fs"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { Prisma, PrismaClient } from "@prisma/client"
import { mtmWorkdayPauses } from "../src/lib/mtm/workday-pauses"

export const DEMO = Object.freeze({
  id: "mtm-attendance-demo-v1", slug: "mtm-attendance-demo",
  marker: "mtm-attendance-1.14:8dcdd466-036b-48d1-b579-655dcf462604:v1",
  userId: "mtm-attendance-demo-admin-v1", email: "admin@mtm-attendance-demo.example.invalid",
  from: "2026-10-05", to: "2026-10-06", origin: "https://app.leaddrivecrm.org",
})
export const APP = "/opt/leaddrive-v2/.next/standalone"
const STATE = "/var/lib/leaddrive-mtm-attendance-demo"
const MODES = ["prepare-and-check", "read-only-check"] as const
export type DemoMode = typeof MODES[number]
type Db = Pick<PrismaClient, "$transaction">
type Tx = Prisma.TransactionClient
function fail(code: string): never { throw new Error(code) }
const at = (day: string, clock: string) => new Date(`${day}T${clock}:00.000+04:00`)
export const DEMO_AGENTS = ["mtm-attendance-demo-agent-a-v1", "mtm-attendance-demo-agent-b-v1"] as const
export const DEMO_WORKDAYS = [
  { id: "mtm-attendance-demo-day-a1-v1", agentId: DEMO_AGENTS[0], date: DEMO.from,
    events: [["START", "09:21"], ["PAUSE", "12:00"], ["RESUME", "12:30"], ["FINISH", "17:30"]], paused: 1800 },
  { id: "mtm-attendance-demo-day-a2-v1", agentId: DEMO_AGENTS[0], date: DEMO.to,
    events: [["START", "09:00"], ["PAUSE", "12:00"], ["RESUME", "12:15"], ["PAUSE", "15:00"], ["RESUME", "15:05"], ["FINISH", "18:00"]], paused: 1200 },
  { id: "mtm-attendance-demo-day-b2-v1", agentId: DEMO_AGENTS[1], date: DEMO.to,
    events: [["START", "09:10"], ["FINISH", "18:00"]], paused: 0 },
] as const

export function assertContext(mode: string, sha: string, deployed: string, now = new Date()): asserts mode is DemoMode {
  if (!MODES.includes(mode as DemoMode) || !/^[a-f0-9]{40}$/.test(sha) || deployed.trim() !== sha) fail("REVISION_OR_MODE_INVALID")
  if (!Number.isFinite(now.getTime()) || now < at("2026-10-07", "00:00")) fail("PERIOD_NOT_COMPLETE")
}

export function assertOwnedOrganization(org: { id: string; slug: string; settings: unknown } | null) {
  if (!org || org.id !== DEMO.id || org.slug !== DEMO.slug || typeof org.settings !== "object"
    || org.settings === null || (org.settings as Record<string, unknown>).attendanceDemoOwner !== DEMO.marker) fail("TENANT_NOT_OWNED")
}

async function ownedOrganization(tx: Tx) {
  // Organization is a global directory; only the two fixed identifiers may be looked up.
  const matches = await tx.organization.findMany({ where: { OR: [{ id: DEMO.id }, { slug: DEMO.slug }] },
    select: { id: true, slug: true, settings: true }, take: 2 })
  if (matches.length > 1) fail("TENANT_NOT_OWNED")
  if (matches.length) assertOwnedOrganization(matches[0])
  return matches[0] ?? null
}

/** No updates, upserts, deletes, trigger changes or writes to another tenant. */
export async function prepareDemo(db: Db, passwordHash: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO.marker}))`
    if (await ownedOrganization(tx)) return false
    await tx.organization.create({ data: { id: DEMO.id, slug: DEMO.slug, name: "MTM Attendance Demo (fictional)",
      plan: "enterprise", addons: ["mtm"], modules: { mtm: true, "route-field": true }, features: ["mtm", "route-field"],
      settings: { attendanceDemoOwner: DEMO.marker }, provisionedBy: DEMO.marker } })
    await tx.user.create({ data: { id: DEMO.userId, organizationId: DEMO.id, email: DEMO.email,
      name: "Demo administrator", passwordHash, role: "admin", hiddenModules: [],
      totpEnabled: false, smsAuthEnabled: false, require2fa: false, phone: null, verifiedPhone: null } })
    await tx.mtmSetting.createMany({ data: [
      { organizationId: DEMO.id, key: "attendanceEnabled", value: true },
      { organizationId: DEMO.id, key: "timezone", value: "Asia/Baku" },
    ] })
    await tx.mtmAgent.createMany({ data: DEMO_AGENTS.map((id, i) => ({ id, organizationId: DEMO.id,
      name: `Demo employee ${i === 0 ? "A" : "B"}`, role: "AGENT" as const })) })
    // Final immutable fixtures, inserted with every real database trigger enabled.
    // The CI PostgreSQL gate inserts this exact function, then proves both
    // completed-workday rewrites and event rewrites are rejected by those triggers.
    for (const day of DEMO_WORKDAYS) {
      await tx.mtmAgentWorkday.create({ data: { id: day.id, organizationId: DEMO.id, agentId: day.agentId,
        workDate: new Date(`${day.date}T00:00:00Z`), status: "COMPLETED", startedAt: at(day.date, day.events[0][1]),
        completedAt: at(day.date, day.events.at(-1)![1]), totalPausedSeconds: day.paused } })
      await tx.mtmAgentWorkdayEvent.createMany({ data: day.events.map(([type, clock], i) => ({
        id: `${day.id}-event-${i}`, clientEventId: `${day.id}-event-${i}`, organizationId: DEMO.id,
        agentId: day.agentId, workdayId: day.id, type, occurredAt: at(day.date, clock),
        claimedAt: at(day.date, clock), capturedAt: at(day.date, clock), appliedAt: at(day.date, clock),
        serverReceivedAt: new Date(at(day.date, clock).getTime() + 1000), schemaVersion: 1,
      })) })
    }
    return true
  }, { isolationLevel: "Serializable", timeout: 15_000 })
}

/** The first statement prohibits writes at PostgreSQL, even if a caller regresses. */
export async function readOnlyDemo(db: Db) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, true)`
    const owned = await ownedOrganization(tx)
    assertOwnedOrganization(owned)
    const state = await tx.$queryRaw<Array<{ readOnly: string; orgId: string; bypass: string | null }>>`
      SELECT current_setting('transaction_read_only') AS "readOnly", current_setting('app.org_id') AS "orgId",
        current_setting('app.rls_bypass', true) AS bypass`
    if (state[0]?.readOnly !== "on" || state[0]?.orgId !== DEMO.id || state[0]?.bypass === "on") fail("READ_ONLY_SCOPE_INVALID")
    const users = await tx.user.findMany({ where: { organizationId: DEMO.id }, select: {
      id: true, email: true, role: true, passwordHash: true, isActive: true, hiddenModules: true,
      totpEnabled: true, smsAuthEnabled: true, require2fa: true, phone: true, verifiedPhone: true, anonymizedAt: true,
    }, take: 2 })
    if (users.length !== 1 || users[0].id !== DEMO.userId || users[0].email !== DEMO.email || users[0].role !== "admin"
      || !users[0].isActive || users[0].hiddenModules.length || users[0].totpEnabled || users[0].smsAuthEnabled
      || users[0].require2fa || users[0].phone || users[0].verifiedPhone || users[0].anonymizedAt) fail("FIXTURE_CHANGED")
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: DEMO.id }, select: { id: true, role: true, status: true, teamId: true }, orderBy: { id: "asc" }, take: 3 })
    if (agents.length !== 2 || agents.some((agent, i) => agent.id !== DEMO_AGENTS[i] || agent.role !== "AGENT" || agent.status !== "ACTIVE" || agent.teamId)) fail("FIXTURE_CHANGED")
    const settings = await tx.mtmSetting.findMany({ where: { organizationId: DEMO.id }, select: { key: true, value: true } })
    if (settings.find((s) => s.key === "attendanceEnabled")?.value !== true || settings.find((s) => s.key === "timezone")?.value !== "Asia/Baku") fail("FIXTURE_CHANGED")
    if (await tx.mtmAttendanceRule.count({ where: { organizationId: DEMO.id } })
      || await tx.mtmWorkCalendarDay.count({ where: { organizationId: DEMO.id } })) fail("FIXTURE_CHANGED")
    const workdays = await tx.mtmAgentWorkday.findMany({ where: { organizationId: DEMO.id }, select: {
      id: true, agentId: true, workDate: true, status: true, startedAt: true, completedAt: true, totalPausedSeconds: true,
      events: { where: { organizationId: DEMO.id, agentId: { in: [...DEMO_AGENTS] } },
        select: { id: true, type: true, occurredAt: true, appliedAt: true, claimedAt: true, serverReceivedAt: true }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
    }, orderBy: { id: "asc" }, take: 4 })
    if (workdays.length !== 3) fail("FIXTURE_CHANGED")
    for (const day of workdays) {
      const fixture = DEMO_WORKDAYS.find((row) => row.id === day.id)
      if (!fixture || day.agentId !== fixture.agentId || day.workDate.toISOString().slice(0, 10) !== fixture.date
        || day.status !== "COMPLETED" || day.totalPausedSeconds !== fixture.paused
        || day.startedAt.getTime() !== at(fixture.date, fixture.events[0][1]).getTime()
        || day.completedAt?.getTime() !== at(fixture.date, fixture.events.at(-1)![1]).getTime()
        || day.events.length !== fixture.events.length || day.events.some((event, i) => event.id !== `${day.id}-event-${i}`
          || event.type !== fixture.events[i][0] || event.occurredAt.getTime() !== at(fixture.date, fixture.events[i][1]).getTime())) fail("FIXTURE_CHANGED")
    }
    const triggers = await tx.$queryRaw<Array<{ name: string }>>`SELECT tgname AS name FROM pg_trigger
      WHERE tgrelid IN ('mtm_agent_workdays'::regclass, 'mtm_agent_workday_events'::regclass)
      AND tgname IN ('workforce_completed_workday_guard', 'workforce_workday_events_append_only') AND tgenabled IN ('O', 'A')`
    if (triggers.length !== 2) fail("IMMUTABLE_GUARDS_MISSING")
    return { workdays, passwordHash: users[0].passwordHash }
  }, { isolationLevel: "RepeatableRead", timeout: 15_000 })
}

type Snapshot = Awaited<ReturnType<typeof readOnlyDemo>>
type NumericRow = { employeeId: string; date: string; kind: string; workedSeconds: number; pausedSeconds: number; lateSeconds: number; earlyLeaveSeconds: number }
/** Independent arithmetic, with the single shared ledger-to-pause parser. */
export function expectedRows(snapshot: Pick<Snapshot, "workdays">): NumericRow[] {
  return DEMO_AGENTS.flatMap((employeeId) => [DEMO.from, DEMO.to].map((date) => {
    const day = snapshot.workdays.find((d) => d.agentId === employeeId && d.workDate.toISOString().slice(0, 10) === date)
    const row = { employeeId, date, kind: "ABSENT", workedSeconds: 0, pausedSeconds: 0, lateSeconds: 0, earlyLeaveSeconds: 0 }
    if (!day) return row
    if (!day.completedAt) fail("FIXTURE_CHANGED")
    const pauses = mtmWorkdayPauses(day.events)
    if (pauses.some((pause) => !pause.to)) fail("FIXTURE_CHANGED")
    const pausedSeconds = pauses.reduce((total, pause) => total + (pause.to!.getTime() - pause.from.getTime()) / 1000, 0)
    if (pausedSeconds !== day.totalPausedSeconds) fail("PAUSE_PARITY_FAILED")
    const late = (day.startedAt.getTime() - at(date, "09:00").getTime()) / 1000
    return { ...row, kind: "WORKED", pausedSeconds,
      workedSeconds: (day.completedAt.getTime() - day.startedAt.getTime()) / 1000 - pausedSeconds,
      lateSeconds: late > 600 ? late : 0,
      earlyLeaveSeconds: Math.max(0, (at(date, "18:00").getTime() - day.completedAt.getTime()) / 1000) }
  }))
}

export function verifyParity(snapshot: Pick<Snapshot, "workdays">, report: unknown) {
  const expected = expectedRows(snapshot)
  const value = report as { from?: string; to?: string; rows?: Array<Record<string, unknown>>; totals?: Record<string, unknown> }
  if (!value || value.from !== DEMO.from || value.to !== DEMO.to || !Array.isArray(value.rows) || value.rows.length !== expected.length) fail("REPORT_PARITY_FAILED")
  const keys = new Set<string>()
  for (const row of value.rows) {
    const key = `${row.employeeId}/${row.date}`
    if (keys.has(key)) fail("REPORT_PARITY_FAILED")
    keys.add(key)
    const match = expected.find((item) => item.employeeId === row.employeeId && item.date === row.date)
    if (!match || Object.entries(match).some(([field, entry]) => row[field] !== entry)
      || row.expectedWorkSeconds !== 28800 || row.ruleId !== "mtm-default-v1" || row.timezone !== "Asia/Baku"
      || row.factsState !== (match.kind === "WORKED" ? "VALID" : "NONE")) fail("REPORT_PARITY_FAILED")
    const day = snapshot.workdays.find((d) => d.agentId === row.employeeId && d.workDate.toISOString().slice(0, 10) === row.date)
    const events = row.events as Array<Record<string, unknown>>
    if (!Array.isArray(events) || events.length !== (day?.events.length ?? 0)
      || events.some((event, i) => event.type !== day!.events[i].type || event.occurredAt !== day!.events[i].occurredAt.toISOString()
        || event.claimedAt !== day!.events[i].claimedAt?.toISOString() || event.serverReceivedAt !== day!.events[i].serverReceivedAt?.toISOString())) fail("JOURNAL_PARITY_FAILED")
  }
  const sum = (field: "workedSeconds" | "pausedSeconds" | "lateSeconds" | "earlyLeaveSeconds") => expected.reduce((n, row) => n + row[field], 0)
  const totals = { rowCount: 4, employeeCount: 2, arrivedCount: 3, absentCount: 1, lateCount: 1, earlyLeaveCount: 1,
    missingFinishCount: 0, invalidFactsCount: 0, unknownWorkedCount: 0, unknownPausedCount: 0, isComplete: true,
    workedSeconds: sum("workedSeconds"), pausedSeconds: sum("pausedSeconds"), lateSeconds: sum("lateSeconds"), earlyLeaveSeconds: sum("earlyLeaveSeconds") }
  if (!value.totals || Object.entries(totals).some(([key, v]) => value.totals![key] !== v)) fail("TOTALS_PARITY_FAILED")
  // Never return the API response, names, credentials, or unrecognised fields.
  return { rows: expected, totals, matches: { rows: true, journal: true, pauses: true, totals: true } }
}

/** In-memory cookie jar; fixed-origin requests, no redirect or credential logging. */
export async function authenticatedDemoSession(password: string, fetcher: typeof fetch = fetch) {
  const cookies = new Map<string, string>()
  async function request(path: string, init: RequestInit = {}) {
    if (!path.startsWith("/api/") || path.startsWith("//")) fail("HTTP_SCOPE_INVALID")
    const response = await fetcher(`${DEMO.origin}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { ...init.headers, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]; const index = pair.indexOf("=")
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    if (response.status !== 200) fail("HTTP_FAILED")
    const text = await response.text()
    if (Buffer.byteLength(text) > 256_000) fail("HTTP_FAILED")
    try { return JSON.parse(text) } catch { return fail("HTTP_FAILED") }
  }
  try {
    const csrf = await request("/api/auth/csrf")
    if (typeof csrf.csrfToken !== "string" || !/^[a-f0-9]{64}$/.test(csrf.csrfToken)) fail("LOGIN_FAILED")
    const result = await request("/api/auth/callback/credentials", { method: "POST", headers: {
      "content-type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1",
    }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: DEMO.email, password,
      organizationSlug: DEMO.slug, callbackUrl: `${DEMO.origin}/ru/mtm/attendance` }) })
    const target = new URL(result.url)
    if (target.origin !== DEMO.origin || target.searchParams.has("error") || ![...cookies.keys()].some((key) => /authjs\.session-token(?:\.\d+)?$/.test(key))) fail("LOGIN_FAILED")
    const session = await request("/api/auth/session")
    if (session?.user?.id !== DEMO.userId || session.user.organizationId !== DEMO.id || session.user.role !== "admin"
      || session.user.needs2fa || session.user.needsSetup2fa) fail("LOGIN_FAILED")
    return { request, close: () => cookies.clear() }
  } catch (error) { cookies.clear(); throw error }
}

export async function authenticatedReport(password: string, fetcher: typeof fetch = fetch) {
  const session = await authenticatedDemoSession(password, fetcher)
  try {
    const report = await session.request(`/api/v1/mtm/attendance/report?from=${DEMO.from}&to=${DEMO.to}&form=ALL`)
    if (report.success !== true) fail("REPORT_UNAVAILABLE")
    return report.data
  } finally { session.close() }
}

export function readRootFile(file: string, limit: number, privateFile = false): string {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.uid !== 0 || (privateFile ? (stat.mode & 0o777) !== 0o600 : (stat.mode & 0o022) !== 0) || stat.size > limit) fail("LOCAL_FILE_UNSAFE")
    return fs.readFileSync(fd, "utf8")
  } finally { fs.closeSync(fd) }
}

export function databaseUrlFromEnv(text: string): string {
  const entries = [...text.matchAll(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/gm)]
  if (entries.length !== 1) fail("APP_ENV_INVALID")
  let value = entries[0][1]
  if (/^["']/.test(value)) {
    if (value.at(-1) !== value[0]) fail("APP_ENV_INVALID")
    value = value.slice(1, -1)
  }
  const url = new URL(value)
  if (!["postgres:", "postgresql:"].includes(url.protocol) || /[\r\n\0]/.test(value)) fail("APP_ENV_INVALID")
  return value
}

export function credential(mode: DemoMode): string {
  if (mode === "prepare-and-check" && !fs.existsSync(STATE)) fs.mkdirSync(STATE, { mode: 0o700 })
  const directory = fs.lstatSync(STATE)
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o777) !== 0o700) fail("LOCAL_FILE_UNSAFE")
  const file = `${STATE}/credential.json`
  if (mode === "prepare-and-check" && !fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ marker: DEMO.marker, password: randomBytes(48).toString("base64url") }), { flag: "wx", mode: 0o600 })
  }
  const saved = JSON.parse(readRootFile(file, 1024, true))
  if (saved.marker !== DEMO.marker || typeof saved.password !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(saved.password)) fail("LOCAL_FILE_UNSAFE")
  return saved.password
}

const ERROR_CODES = new Set(["REVISION_OR_MODE_INVALID", "PERIOD_NOT_COMPLETE", "TENANT_NOT_OWNED", "READ_ONLY_SCOPE_INVALID",
  "FIXTURE_CHANGED", "IMMUTABLE_GUARDS_MISSING", "PAUSE_PARITY_FAILED", "REPORT_PARITY_FAILED", "JOURNAL_PARITY_FAILED",
  "TOTALS_PARITY_FAILED", "HTTP_FAILED", "HTTP_SCOPE_INVALID", "LOGIN_FAILED", "REPORT_UNAVAILABLE", "LOCAL_FILE_UNSAFE",
  "APP_ENV_INVALID", "CREDENTIAL_MISMATCH", "VERIFICATION_FAILED"])
export function safeFailure(error: unknown) {
  return { version: 1, status: "FAIL", code: error instanceof Error && ERROR_CODES.has(error.message) ? error.message : "VERIFICATION_FAILED" }
}

export async function runProduction(mode: string, sha: string) {
  assertContext(mode, sha, readRootFile(`${APP}/.deploy-sha`, 128))
  if (process.getuid?.() !== 0) fail("LOCAL_FILE_UNSAFE")
  const response = await fetch(`${DEMO.origin}/api/v1/public/build-info`, { redirect: "error", signal: AbortSignal.timeout(10_000) })
  if (!response.ok || (await response.json()).artifactSha !== sha) fail("REVISION_OR_MODE_INVALID")
  process.env.DATABASE_URL = databaseUrlFromEnv(readRootFile("/etc/leaddrive/app.env", 65536))
  const requireApp = createRequire(`${APP}/package.json`)
  const bcrypt = requireApp("bcryptjs") as typeof import("bcryptjs")
  const { makeScriptPrisma } = await import(pathToFileURL(`${APP}/scripts/_rls.mjs`).href)
  const db: PrismaClient = await makeScriptPrisma({ orgId: DEMO.id })
  try {
    // Check ownership before creating a credential or making any tenant write.
    const existing = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      return ownedOrganization(tx)
    })
    if (!existing && mode === "read-only-check") fail("TENANT_NOT_OWNED")
    if (existing && !fs.existsSync(`${STATE}/credential.json`)) fail("CREDENTIAL_MISMATCH")
    const password = credential(mode)
    const created = mode === "prepare-and-check" ? await prepareDemo(db, await bcrypt.hash(password, 12)) : false
    const snapshot = await readOnlyDemo(db)
    if (!await bcrypt.compare(password, snapshot.passwordHash)) fail("CREDENTIAL_MISMATCH")
    const report = await authenticatedReport(password)
    const parity = verifyParity(snapshot, report)
    // A concurrent edit is a failed acceptance, never silently a new baseline.
    const after = await readOnlyDemo(db)
    const beforeBytes = Buffer.from(JSON.stringify(snapshot.workdays)); const afterBytes = Buffer.from(JSON.stringify(after.workdays))
    if (beforeBytes.length !== afterBytes.length || !timingSafeEqual(beforeBytes, afterBytes)) fail("FIXTURE_CHANGED")
    assertContext(mode, sha, readRootFile(`${APP}/.deploy-sha`, 128))
    return { version: 1, status: "PASS", mode, artifactSha: sha, tenant: DEMO.slug, created,
      period: { from: DEMO.from, to: DEMO.to }, readOnlyComparison: true, loginMethod: "credentials", ...parity }
  } finally { await db.$disconnect(); delete process.env.DATABASE_URL }
}

// Strict output allowlist: reject rather than redact unexpected structures.
export function validateEvidence(value: unknown) {
  const record = value as Record<string, unknown>
  if (!record || typeof record !== "object") fail("OUTPUT_INVALID")
  if (record.status === "FAIL") {
    if (Object.keys(record).sort().join() !== "code,status,version" || record.version !== 1 || !ERROR_CODES.has(String(record.code))) fail("OUTPUT_INVALID")
    return record
  }
  const allowed = ["version", "status", "mode", "artifactSha", "tenant", "created", "period", "readOnlyComparison", "loginMethod", "rows", "totals", "matches"]
  if (Object.keys(record).sort().join() !== allowed.sort().join() || record.version !== 1 || record.status !== "PASS"
    || !MODES.includes(record.mode as DemoMode) || !/^[a-f0-9]{40}$/.test(String(record.artifactSha)) || record.tenant !== DEMO.slug
    || typeof record.created !== "boolean" || record.readOnlyComparison !== true || record.loginMethod !== "credentials"
    || JSON.stringify(record.period) !== JSON.stringify({ from: DEMO.from, to: DEMO.to })) fail("OUTPUT_INVALID")
  const expected = { rows: [
    { employeeId: DEMO_AGENTS[0], date: DEMO.from, kind: "WORKED", workedSeconds: 27540, pausedSeconds: 1800, lateSeconds: 1260, earlyLeaveSeconds: 1800 },
    { employeeId: DEMO_AGENTS[0], date: DEMO.to, kind: "WORKED", workedSeconds: 31200, pausedSeconds: 1200, lateSeconds: 0, earlyLeaveSeconds: 0 },
    { employeeId: DEMO_AGENTS[1], date: DEMO.from, kind: "ABSENT", workedSeconds: 0, pausedSeconds: 0, lateSeconds: 0, earlyLeaveSeconds: 0 },
    { employeeId: DEMO_AGENTS[1], date: DEMO.to, kind: "WORKED", workedSeconds: 31800, pausedSeconds: 0, lateSeconds: 0, earlyLeaveSeconds: 0 },
  ], totals: { rowCount: 4, employeeCount: 2, arrivedCount: 3, absentCount: 1, lateCount: 1, earlyLeaveCount: 1,
    missingFinishCount: 0, invalidFactsCount: 0, unknownWorkedCount: 0, unknownPausedCount: 0, isComplete: true,
    workedSeconds: 90540, pausedSeconds: 3000, lateSeconds: 1260, earlyLeaveSeconds: 1800 },
  matches: { rows: true, journal: true, pauses: true, totals: true } }
  if (JSON.stringify({ rows: record.rows, totals: record.totals, matches: record.matches }) !== JSON.stringify(expected)) fail("OUTPUT_INVALID")
  return record
}

if (process.argv[2] === "--run") {
  void runProduction(process.argv[3], process.argv[4]).then((result) => {
    process.stdout.write(JSON.stringify(validateEvidence(result)) + "\n")
  }).catch((error: unknown) => { process.stdout.write(JSON.stringify(safeFailure(error)) + "\n"); process.exitCode = 1 })
} else if (process.argv[2] === "--validate-output") {
  try { process.stdout.write(JSON.stringify(validateEvidence(JSON.parse(fs.readFileSync(0, "utf8")))) + "\n") }
  catch { process.stderr.write("Invalid demo evidence; raw output withheld\n"); process.exitCode = 1 }
}
