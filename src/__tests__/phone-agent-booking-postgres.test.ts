/**
 * The AI books an appointment on a phone call, against a real Postgres.
 *
 * Owner, 2026-11-22 («Давай» on the plan): a clinic or a salon sells what its
 * competitors do — the caller says «запишите меня завтра на 11», and the
 * appointment is in «Встречи» when the call ends. The station asks the CRM for
 * the call's session and then for each tool the model calls; both arrive here
 * exactly as the station sends them, through the real route, with FORCE RLS
 * and a role that cannot bypass it.
 *
 * Proved on rows, not on the shape of a call:
 *  - the session names only this organization's services, never one that asks
 *    for a deposit, and leaves the call's own record on the call;
 *  - a booking is one confirmed meeting of this organization, on the number the
 *    caller rang from, marked as booked by phone;
 *  - the same request again — the station's retry, the model asking twice, the
 *    name spelt differently, two requests at once — is the same meeting;
 *  - a second caller is told the time is taken and offered others;
 *  - a call of another organization books only in its own, and the database
 *    itself refuses a tool that is pointed at another tenant's service;
 *  - a cancel reaches only a meeting on the caller's own number;
 *  - a call without the switch, an ended call, a station that does not name
 *    the capability and the pharmacy line's own channel get nothing of this;
 *  - the call's Live and speech spend is written once, however often the
 *    station repeats the result;
 *  - one person is one card: a caller the CRM already holds is not filed as a
 *    new lead, and the lead of the call and the lead of the meeting are the
 *    same lead whichever of the two is written first.
 *
 * Set PHONE_AGENT_BOOKING_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55521:5432 postgres:16
 *   PHONE_AGENT_BOOKING_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55521/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy, where PHONE_AGENT_BOOKING_DB_GATE=required turns a missing URL into
 * a failure.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { geminiSpeechMinuteUsd } from "@/lib/ai/gateway/pricing"

const adminUrl = process.env.PHONE_AGENT_BOOKING_TEST_DATABASE_URL
if (!adminUrl && process.env.PHONE_AGENT_BOOKING_DB_GATE === "required") {
  throw new Error("PHONE_AGENT_BOOKING_TEST_DATABASE_URL is required by the phone agent booking database gate")
}

const TOKEN = "phone-agent-booking-runtime-token-0123456789"

const scratch = vi.hoisted(() => {
  const admin = process.env.PHONE_AGENT_BOOKING_TEST_DATABASE_URL
  if (!admin) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted above the imports
  const fs = require("node:fs") as typeof import("node:fs"), os = require("node:os") as typeof import("node:os"), nodePath = require("node:path") as typeof import("node:path")
  const name = `phone_agent_booking_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "phone-agent-booking-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "phone-agent-booking-test-secret"
  process.env.FANUM_VOICE_RUNTIME_TOKEN = "phone-agent-booking-runtime-token-0123456789"
  // Where the pharmacy line's grant is on a host: a private directory, the line switched off.
  const directory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "phone-agent-line-"))
  fs.chmodSync(directory, 0o700)
  process.env.ZEYTUN_INBOUND_PILOT_FILE = nodePath.join(directory, "inbound-grant.json")
  fs.writeFileSync(process.env.ZEYTUN_INBOUND_PILOT_FILE, JSON.stringify({ enabled: false }), { mode: 0o600 })
  delete process.env.VOICE_AGENT_ORGANIZATION_ID
  return { name, role, adminDb: db.toString(), grantFile: process.env.ZEYTUN_INBOUND_PILOT_FILE, grantDirectory: directory }
})

const stubs = vi.hoisted(() => ({ analyses: 0 }))
// The after-call analysis is OpenAI's; its key and its network are not this suite's. Everything
// else of the AI gateway is real: the spend rows below are written by journalPlatformAiCall itself.
vi.mock("@/lib/ai/gateway/access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/gateway/access")>(),
  aiKeyOrRefusal: vi.fn(async () => ({ apiKey: "test-key", journal: () => {} })),
  isAiUnavailable: vi.fn(() => false),
}))
// A booking tells its host: nothing of that leaves this machine.
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ ok: true, success: true }), renderTemplate: (value: string) => value }))
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  deliverNotificationPush: async () => undefined,
}))
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-auth")>(),
  getOrgModuleContext: vi.fn(async () => ({ plan: "enterprise", addons: ["ai", "voip"], modules: { voip: true, sales: true, booking: true, crm: true } })),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = [
  "call_logs", "call_events", "channel_configs", "bookings", "booking_pages", "booking_secrets", "booking_offers",
  "booking_host_schedules", "booking_resources", "booking_reminders", "ai_usage", "tenant_ai_credentials", "leads", "contacts", "tasks", "notifications",
]

const CLINIC = "org-pab-clinic"
const SALON = "org-pab-salon"
const QUIET = "org-pab-quiet"
const CLINIC_VOIP = "cfg-pab-clinic"
const SALON_VOIP = "cfg-pab-salon"
const QUIET_VOIP = "cfg-pab-quiet"
const DENTIST = "page-pab-dentist"
const CARDIO = "page-pab-cardio"
const DEPOSIT = "page-pab-deposit"
const ULTRASOUND = "page-pab-usm"
const HAIRCUT = "page-pab-haircut"
const QUIET_PAGE = "page-pab-quiet"

const ELVIN = "+994501112233"
const AYSEL = "+994552223344"

const ALWAYS_OPEN = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [{ start: "09:00", end: "18:00" }]]))
const bakuDate = (daysAhead: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date(Date.now() + daysAhead * 86_400_000))
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
/** A Baku clock time on a Baku date as the instant it is (Baku is UTC+4, no DST). */
const bakuInstant = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`)

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "phone-agent-booking-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

function tenantPolicy(table: string): string {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "${table}"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`
}

/** What the station bridge makes of a CRM session: its own open() and tools(). */
function stationOpens(answer: unknown): { ok: boolean; tools: string[] } {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bridge", "scripts/pbx/fanum-zeytun-inbound.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
answer = json.load(sys.stdin)
bridge = module.ZeytunInboundBridge("https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config", "t" * 48,
    "aaaaaaaa-1111-4111-8111-111111111111", lambda body: answer, lambda: 100)
try:
    bridge.open()
    print(json.dumps({"ok": True, "tools": [d["name"] for group in bridge.tools() for d in group["functionDeclarations"]]}))
except module.ZeytunPilotUnavailable:
    print(json.dumps({"ok": False, "tools": []}))
`
  return JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(answer), encoding: "utf8" }))
}

;(scratch ? describe : describe.skip)("the AI books an appointment on a phone call (real Postgres)", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let station!: typeof import("@/app/api/internal/voice-agent/pharmacy-inbound/route")
  let result!: typeof import("@/app/api/internal/voice-agent/call-result/route")
  let tools!: typeof import("@/lib/voice-agent/phone-agent/booking-tools")
  let effects!: typeof import("@/lib/booking/effect-worker")
  let createdDb = false
  let createdRole = false
  let nextCallId = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture rows, asserted field by field
  const bypass = (fn: () => Promise<any>): Promise<any> => rls.runWithRlsBypass(fn) as Promise<any>

  const voip = (extra: Record<string, unknown> = {}) => ({ provider: "asterisk", voiceAgentEnabled: true, inboundAnswerMode: "ai",
    phoneBookingEnabled: true, voiceAgentPrompt: "Sən qeydiyyat operatorusan.", voiceAgentInboundGreeting: "Qeydiyyat, salam! Buyurun.", ...extra })

  /** A call the AI has answered, as the lifecycle route leaves it. */
  async function liveCall(organizationId: string, channelConfigId: string, fromNumber: string, extra: Record<string, unknown> = {}) {
    const callId = randomUUID()
    const row = await bypass(() => prisma.callLog.create({
      data: { organizationId, callSid: callId, providerCallId: callId, direction: "inbound", fromNumber, toNumber: "+994121110000",
        status: "in-progress", provider: "asterisk", callMode: "ai", wasAnswered: true, channelConfigId, ...extra },
      select: { id: true },
    }))
    return { callId, id: row.id as string }
  }

  /** One request of the station, as its bridge sends it. */
  async function ask(body: Record<string, unknown>, headers: Record<string, string> = { "x-voice-agent-caps": "tools-1" }) {
    const response = await station.POST(new NextRequest("http://localhost:3000/api/internal/voice-agent/pharmacy-inbound", {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    }))
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  const openSession = (callId: string) => ask({ action: "session", callId })
  async function tool(callId: string, name: string, args: Record<string, unknown>) {
    nextCallId += 1
    const answer = await ask({ action: "tool", callId, name, args, id: `function-call-${nextCallId}` })
    return { status: answer.status, result: (answer.body.result ?? answer.body) as Record<string, unknown> }
  }

  const bookings = (organizationId: string) => bypass(() => prisma.booking.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }))
  const callRow = (id: string) => bypass(() => prisma.callLog.findFirstOrThrow({ where: { id } }))
  const spend = (organizationId: string) => bypass(() => prisma.aiUsage.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }))

  /** A call with its session open: the usual start of every test below. */
  async function answeredCall(organizationId = CLINIC, channelConfigId = CLINIC_VOIP, fromNumber = ELVIN) {
    const call = await liveCall(organizationId, channelConfigId, fromNumber)
    const session = await openSession(call.callId)
    expect(session.body, JSON.stringify(session.body)).toMatchObject({ enabled: true, variant: "agent_tools" })
    return { ...call, session: session.body }
  }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'phone-agent-booking-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, `ALTER TABLE "event_aggregate_heads" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`)
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (!String(url).startsWith("https://api.openai.com/")) throw new Error(`unexpected network call: ${String(url)}`)
      stubs.analyses += 1
      return new Response(JSON.stringify({ model: "test-model", usage: {}, output_text: JSON.stringify({
        summary: "Pasiyent qəbula yazıldı.", sentiment: "neutral", sentimentScore: 0.5, topics: ["qəbul"], disposition: "other",
        nextStep: null, nextStepDueHint: null, callOutcome: "qualified", requestedEmployeeName: null, callerName: null }) }), { status: 200 })
    }))

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    station = await import("@/app/api/internal/voice-agent/pharmacy-inbound/route")
    result = await import("@/app/api/internal/voice-agent/call-result/route")
    tools = await import("@/lib/voice-agent/phone-agent/booking-tools")
    effects = await import("@/lib/booking/effect-worker")

    await bypass(async () => {
      for (const id of [CLINIC, SALON, QUIET]) {
        await prisma.organization.create({ data: { id, name: id, slug: id, modules: { crm: true, sales: true, booking: true }, settings: { timezone: "Asia/Baku" } } })
        await prisma.user.create({ data: { id: `admin-${id}`, organizationId: id, email: `admin@${id}.test`, name: `Həkim ${id}`, passwordHash: "-", role: "admin" } })
      }
      await prisma.channelConfig.createMany({ data: [
        { id: CLINIC_VOIP, organizationId: CLINIC, channelType: "voip", configName: "Clinic", isActive: true, settings: voip() },
        { id: SALON_VOIP, organizationId: SALON, channelType: "voip", configName: "Salon", isActive: true, settings: voip() },
        // The same agent, the switch never turned on.
        { id: QUIET_VOIP, organizationId: QUIET, channelType: "voip", configName: "Quiet", isActive: true, settings: voip({ phoneBookingEnabled: false }) },
      ] })
      const page = (id: string, organizationId: string, title: string, extra: Record<string, unknown> = {}) => prisma.bookingPage.create({ data: {
        id, organizationId, slug: id, title, durationMinutes: 30, minNoticeMinutes: 60, maxDaysAhead: 30,
        hostIds: [`admin-${organizationId}`], weekly: ALWAYS_OPEN, price: 30, priceCurrency: "AZN", ...extra } })
      await page(DENTIST, CLINIC, "Stomatoloq müayinəsi")
      await page(CARDIO, CLINIC, "Kardioloq", { price: 50 })
      await page(DEPOSIT, CLINIC, "Əməliyyat", { depositAmount: 20 })
      // Given on one weekday only: the weekday of the day after tomorrow.
      await page(ULTRASOUND, CLINIC, "USM", { price: 45, weekly: Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) =>
        [day, day === String(new Date(`${bakuDate(2)}T12:00:00Z`).getUTCDay()) ? [{ start: "09:00", end: "18:00" }] : []])) })
      await page(HAIRCUT, SALON, "Saç kəsimi")
      await page(QUIET_PAGE, QUIET, "Konsultasiya")
    })
  }, 300_000)

  afterEach(async () => {
    writeFileSync(scratch!.grantFile, JSON.stringify({ enabled: false }), { mode: 0o600 })
    await bypass(async () => {
      await prisma.effectAttempt.deleteMany({})
      await prisma.effectOutbox.deleteMany({})
      await prisma.bookingSecret.deleteMany({})
      await prisma.booking.deleteMany({})
      await prisma.aiUsage.deleteMany({})
      await prisma.notification.deleteMany({})
      await prisma.task.deleteMany({})
      await prisma.callEvent.deleteMany({})
      await prisma.callLog.deleteMany({})
      await prisma.lead.deleteMany({})
      await prisma.contact.deleteMany({})
      await prisma.channelConfig.update({ where: { id: CLINIC_VOIP }, data: { settings: voip() } })
    })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
    if (scratch) rmSync(scratch.grantDirectory, { recursive: true, force: true })
  }, 60_000)

  it("keeps the tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await bypass(() => prisma.$queryRaw<Array<{ relname: string; forced: boolean }>>`
      SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY(${RLS_TABLES}) ORDER BY relname`)
    expect(tables).toEqual([...RLS_TABLES].sort().map((relname) => ({ relname, forced: true })))
  })

  it("gives the call its organization's rules, the line's voice and the tools of its own services", async () => {
    const call = await answeredCall()
    const session = call.session as { prompt: string; opening: string; speech: { voice: string }; tools: Array<{ name: string; parameters: { properties: { service?: { enum: string[] } } } }> }
    expect(session.opening).toBe("Qeydiyyat, salam! Buyurun.")
    expect(session.speech.voice).toBe("Sulafat")
    expect(session.tools.map((item) => item.name)).toEqual(["find_free_times", "book_appointment", "cancel_appointment"])
    // The clinic's three bookable services: not the one that asks for a deposit, not the salon's.
    expect(session.tools[1].parameters.properties.service?.enum).toEqual(["s1", "s2", "s3"])
    expect(session.prompt).toContain("Sən qeydiyyat operatorusan.")
    expect(session.prompt).toContain("s1: Stomatoloq müayinəsi, 30 min, 30 AZN; s2: Kardioloq, 30 min, 50 AZN; s3: USM, 30 min, 45 AZN.")
    expect(session.prompt).not.toContain("Əməliyyat")
    expect(session.prompt).not.toContain("Saç kəsimi")
    // The call's own record, and the station takes the session as it is.
    expect((await callRow(call.id)).consentAudit).toEqual({ phoneAgent: { version: 1, providerCallId: call.callId,
      services: [{ code: "s1", pageId: DENTIST }, { code: "s2", pageId: CARDIO }, { code: "s3", pageId: ULTRASOUND }] } })
    expect(stationOpens(session)).toEqual({ ok: true, tools: ["find_free_times", "book_appointment", "cancel_appointment"] })
  })

  it("books the time the caller named: one meeting of this organization, on the caller's number, marked as phone", async () => {
    const call = await answeredCall()
    const date = bakuDate(1)
    const answer = await tool(call.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Elvin Məmmədov" })
    // The answer names the day, and everything this caller now holds: what the model sums up from.
    expect(answer.result).toEqual({ status: "booked", date, weekday: weekday(date), time: "11:00", all: [{ service: "s1", date, time: "11:00" }] })
    const rows = await bookings(CLINIC)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ organizationId: CLINIC, bookingPageId: DENTIST, hostUserId: `admin-${CLINIC}`, name: "Elvin Məmmədov",
      phone: ELVIN, status: "confirmed", source: "phone" })
    expect(rows[0].startsAt.toISOString()).toBe(bakuInstant(date, "11:00").toISOString())
    expect(rows[0].endsAt.getTime() - rows[0].startsAt.getTime()).toBe(30 * 60_000)
    expect(await bookings(SALON)).toEqual([])
  })

  it("lists every free time of a day as the public page offers them, without the times just booked", async () => {
    const call = await answeredCall()
    const date = bakuDate(1)
    // Whole, as ranges: 09:00, 09:30 … 17:30. A sample of them once made the model call a free time taken.
    expect((await tool(call.callId, "find_free_times", { service: "s1", date })).result)
      .toEqual({ date, weekday: weekday(date), every: 30, free: ["09:00-17:30"] })
    await tool(call.callId, "book_appointment", { service: "s1", date, time: "09:00", name: "Elvin" })
    await tool(call.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Elvin" })
    await tool(call.callId, "book_appointment", { service: "s1", date, time: "17:00", name: "Elvin" })
    expect((await tool(call.callId, "find_free_times", { service: "s1", date })).result)
      .toEqual({ date, weekday: weekday(date), every: 30, free: ["09:30-10:30", "11:30-16:30", "17:30"] })
    // The clinic's other service is the same master's: the hours he is taken are taken there too.
    expect((await tool(call.callId, "find_free_times", { service: "s2", date })).result.free).toEqual(["09:30-10:30", "11:30-16:30", "17:30"])
    // A day with nothing (beyond the service's horizon) names a day that has something.
    const far = await tool(call.callId, "find_free_times", { service: "s1", date: bakuDate(90) })
    expect(far.result).toMatchObject({ free: [], next: { every: 30 } })
  })

  it("makes the same request again the same meeting, never a second row", async () => {
    const call = await answeredCall()
    const date = bakuDate(2)
    const args = { service: "s2", date, time: "14:00", name: "Sevda Məmmədova" }
    expect((await tool(call.callId, "book_appointment", args)).result.status).toBe("booked")
    // The station's retry or the model asking again: a new function-call id, the same words.
    expect((await tool(call.callId, "book_appointment", args)).result).toMatchObject({ status: "booked", date, time: "14:00" })
    // The model corrected the spelling of the name.
    expect((await tool(call.callId, "book_appointment", { ...args, name: "Sevda Mammadova" })).result.status).toBe("booked")
    const rows = await bookings(CLINIC)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ bookingPageId: CARDIO, name: "Sevda Məmmədova", phone: ELVIN })
  })

  it("books once when the same request arrives twice at the same moment", async () => {
    const call = await answeredCall()
    const args = { service: "s1", date: bakuDate(3), time: "10:00", name: "Elvin" }
    const answers = await Promise.all([tool(call.callId, "book_appointment", args), tool(call.callId, "book_appointment", args)])
    expect(answers.map((answer) => answer.result.status)).toEqual(["booked", "booked"])
    expect(await bookings(CLINIC)).toHaveLength(1)
  })

  it("tells a second caller the time is taken and offers the nearest free ones", async () => {
    const first = await answeredCall()
    const date = bakuDate(1)
    await tool(first.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Elvin" })
    const second = await answeredCall(CLINIC, CLINIC_VOIP, AYSEL)
    const answer = await tool(second.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Aysel" })
    expect(answer.result).toMatchObject({ status: "taken", date })
    expect(answer.result.times).toEqual(["10:30", "11:30", "12:00"])
    const rows = await bookings(CLINIC)
    expect(rows).toHaveLength(1)
    expect(rows[0].phone).toBe(ELVIN)
    // The offered time is real: she takes it.
    expect((await tool(second.callId, "book_appointment", { service: "s1", date, time: "11:30", name: "Aysel" })).result.status).toBe("booked")
    expect((await bookings(CLINIC)).map((row: { phone: string }) => row.phone)).toEqual([ELVIN, AYSEL])
  })

  it("names the nearest day with free times when the service is not given on the day asked for", async () => {
    const call = await answeredCall()
    const asked = bakuDate(1), given = bakuDate(2)
    const booking = await tool(call.callId, "book_appointment", { service: "s3", date: asked, time: "11:00", name: "Elvin" })
    expect(booking.result).toEqual({ status: "taken", date: asked, times: [],
      next: { date: given, weekday: weekday(given), every: 30, free: ["09:00-17:30"] } })
    expect(await bookings(CLINIC)).toEqual([])
    const lookup = await tool(call.callId, "find_free_times", { service: "s3", date: asked })
    expect(lookup.result).toEqual({ date: asked, free: [], next: { date: given, weekday: weekday(given), every: 30, free: ["09:00-17:30"] } })
    // The day it named is real: its first time books.
    expect((await tool(call.callId, "book_appointment", { service: "s3", date: given, time: "09:00", name: "Elvin" })).result.status).toBe("booked")
  })

  it("refuses a time outside the service's hours instead of booking near it", async () => {
    const call = await answeredCall()
    const answer = await tool(call.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "22:00", name: "Elvin" })
    expect(answer.result.status).toBe("taken")
    expect(await bookings(CLINIC)).toEqual([])
    for (const args of [{ service: "s9", date: bakuDate(1), time: "11:00", name: "Elvin" }, { service: "s1", date: "tomorrow", time: "11:00", name: "Elvin" },
      { service: "s1", date: bakuDate(1), time: "11", name: "Elvin" }, { service: "s1", date: bakuDate(1), time: "11:00", name: " " }]) {
      expect((await tool(call.callId, "book_appointment", args)).result, JSON.stringify(args)).toEqual({ status: "invalid_request" })
    }
    expect(await bookings(CLINIC)).toEqual([])
  })

  it("keeps a call of another organization in its own: its services, its meetings", async () => {
    const clinic = await answeredCall()
    const salon = await answeredCall(SALON, SALON_VOIP, AYSEL)
    const session = salon.session as { prompt: string; tools: Array<{ parameters: { properties: { service?: { enum: string[] } } } }> }
    expect(session.tools[1].parameters.properties.service?.enum).toEqual(["s1"])
    expect(session.prompt).toContain("s1: Saç kəsimi")
    expect(session.prompt).not.toContain("Stomatoloq")
    const date = bakuDate(1)
    // "s1" is each call's own first service: the same word books a haircut here and a dentist there.
    expect((await tool(salon.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Aysel" })).result.status).toBe("booked")
    expect((await tool(clinic.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Elvin" })).result.status).toBe("booked")
    // The clinic's other services do not exist for the salon's call.
    expect((await tool(salon.callId, "book_appointment", { service: "s2", date, time: "12:00", name: "Aysel" })).result).toEqual({ status: "invalid_request" })
    expect((await bookings(SALON)).map((row: { bookingPageId: string; phone: string }) => [row.bookingPageId, row.phone])).toEqual([[HAIRCUT, AYSEL]])
    expect((await bookings(CLINIC)).map((row: { bookingPageId: string; phone: string }) => [row.bookingPageId, row.phone])).toEqual([[DENTIST, ELVIN]])
  })

  it("is refused by the database itself when a tool is pointed at another tenant's service", async () => {
    const date = bakuDate(1)
    const context = { callLogId: "call-row", callerNumber: AYSEL, services: [{ code: "s1", pageId: DENTIST }], now: new Date() }
    const args = { service: "s1", date, time: "11:00", name: "Aysel" }
    // The salon's scope with the clinic's page id in its record: the page is not the salon's.
    const honest = await rls.runWithTenant(SALON, () => tools.runBookingTool({ ...context, organizationId: SALON }, "book_appointment", args))
    expect(honest.status).not.toBe("booked")
    // The same with the tool claiming to be the clinic while the connection is the salon's: RLS shows it nothing.
    const lying = await rls.runWithTenant(SALON, () => tools.runBookingTool({ ...context, organizationId: CLINIC }, "book_appointment", args).catch(() => ({ status: "refused" })))
    expect(lying.status).not.toBe("booked")
    const seen = await rls.runWithTenant(SALON, () => tools.runBookingTool({ ...context, organizationId: CLINIC }, "find_free_times", { service: "s1", date }).catch(() => ({ status: "refused" })))
    expect((seen as Record<string, unknown>).times ?? []).toEqual([])
    expect(await bookings(CLINIC)).toEqual([])
    expect(await bookings(SALON)).toEqual([])
  })

  it("cancels only a meeting on the caller's own number", async () => {
    const elvin = await answeredCall()
    const date = bakuDate(1)
    await tool(elvin.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Elvin" })
    // Another caller names that day: nothing of hers is there.
    const aysel = await answeredCall(CLINIC, CLINIC_VOIP, AYSEL)
    expect((await tool(aysel.callId, "cancel_appointment", { date, time: "11:00" })).result).toEqual({ status: "none" })
    expect((await bookings(CLINIC))[0].status).toBe("confirmed")
    // Elvin calls back later (a new call, the same number, written by the station without the plus).
    const later = await answeredCall(CLINIC, CLINIC_VOIP, "994501112233")
    expect((await tool(later.callId, "cancel_appointment", { date: bakuDate(5) })).result).toEqual({ status: "none" })
    expect((await tool(later.callId, "cancel_appointment", { date })).result).toEqual({ status: "cancelled", date, time: "11:00", all: [] })
    const rows = await bookings(CLINIC)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("cancelled")
    // The hour is free again, for anyone.
    expect((await tool(aysel.callId, "book_appointment", { service: "s1", date, time: "11:00", name: "Aysel" })).result.status).toBe("booked")
  })

  it("asks which one when the caller has two meetings that day", async () => {
    const call = await answeredCall()
    const date = bakuDate(4)
    await tool(call.callId, "book_appointment", { service: "s2", date, time: "15:00", name: "Elvin" })
    // Booked second, earlier in the day: the answer lists both, soonest first.
    const second = await tool(call.callId, "book_appointment", { service: "s1", date, time: "10:00", name: "Elvin" })
    const both = [{ service: "s1", date, time: "10:00" }, { service: "s2", date, time: "15:00" }]
    expect(second.result.all).toEqual(both)
    const several = await tool(call.callId, "cancel_appointment", { date })
    expect(several.result).toEqual({ status: "several", appointments: both })
    expect((await bookings(CLINIC)).map((row: { status: string }) => row.status)).toEqual(["confirmed", "confirmed"])
    expect((await tool(call.callId, "cancel_appointment", { date, time: "15:00" })).result)
      .toEqual({ status: "cancelled", date, time: "15:00", all: [both[0]] })
    expect((await bookings(CLINIC)).map((row: { status: string; bookingPageId: string }) => [row.bookingPageId, row.status]))
      .toEqual([[CARDIO, "cancelled"], [DENTIST, "confirmed"]])
  })

  it("counts a meeting the caller booked on the public page as theirs, however the number was typed there", async () => {
    const { createStoredBooking } = await import("@/lib/booking/create")
    const date = bakuDate(3)
    const online = await rls.runWithTenant(CLINIC, () => createStoredBooking(CLINIC, CARDIO, { idempotencyKey: "public-page-booking-key-1", recoverySecret: "s".repeat(40),
      startsAt: bakuInstant(date, "12:00").toISOString(), name: "Elvin", phone: "050 111 22 33" }, new Date()))
    expect(online.ok).toBe(true)
    const call = await answeredCall()
    const answer = await tool(call.callId, "book_appointment", { service: "s1", date, time: "16:00", name: "Elvin" })
    expect(answer.result.all).toEqual([{ service: "s2", date, time: "12:00" }, { service: "s1", date, time: "16:00" }])
    // Another caller's answer has nothing of his.
    const other = await answeredCall(CLINIC, CLINIC_VOIP, AYSEL)
    expect((await tool(other.callId, "book_appointment", { service: "s1", date, time: "09:00", name: "Aysel" })).result.all)
      .toEqual([{ service: "s1", date, time: "09:00" }])
  })

  it("asks a caller with a hidden number for one, and books on the number they say", async () => {
    const call = await answeredCall(CLINIC, CLINIC_VOIP, "anonymous")
    const date = bakuDate(1)
    const args = { service: "s1", date, time: "16:00", name: "Nigar" }
    expect((await tool(call.callId, "book_appointment", args)).result).toEqual({ status: "need_phone" })
    expect(await bookings(CLINIC)).toEqual([])
    // A dictated number books, and proves nothing about whose other appointments are on it: only this one comes back.
    await bypass(async () => {
      const { createStoredBooking } = await import("@/lib/booking/create")
      await rls.runWithTenant(CLINIC, () => createStoredBooking(CLINIC, CARDIO, { idempotencyKey: "public-page-booking-key-2", recoverySecret: "s".repeat(40),
        startsAt: bakuInstant(bakuDate(2), "12:00").toISOString(), name: "Başqa pasiyent", phone: "+994507778899" }, new Date()))
    })
    expect((await tool(call.callId, "book_appointment", { ...args, phone: "050 777 88 99" })).result)
      .toMatchObject({ status: "booked", all: [{ service: "s1", date, time: "16:00" }] })
    expect((await bookings(CLINIC)).map((row: { phone: string }) => row.phone)).toEqual(["+994507778899", "+994507778899"])
    // Nothing identifies this caller: a cancel is the administrator's.
    expect((await tool(call.callId, "cancel_appointment", { date })).result).toEqual({ status: "none" })
  })

  it("does not let a dictated number replace the one the caller rang from", async () => {
    const call = await answeredCall()
    await tool(call.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "12:00", name: "Elvin", phone: AYSEL })
    expect((await bookings(CLINIC))[0].phone).toBe(ELVIN)
  })

  it("leaves a call whose channel has no switch exactly as it was: no session of the agent, no tool", async () => {
    const call = await liveCall(QUIET, QUIET_VOIP, ELVIN)
    // The pharmacy line is off on this host: its handler answers "not mine", as before this agent existed.
    expect(await openSession(call.callId)).toEqual({ status: 200, body: { enabled: false } })
    expect((await callRow(call.id)).consentAudit).toBeNull()
    const answer = await tool(call.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "11:00", name: "Elvin" })
    expect(answer.status).toBe(403)
    expect(await bookings(QUIET)).toEqual([])
  })

  it("says nothing of itself to a station that does not name the capability", async () => {
    const call = await liveCall(CLINIC, CLINIC_VOIP, ELVIN)
    expect(await ask({ action: "session", callId: call.callId }, {})).toEqual({ status: 200, body: { enabled: false } })
    expect((await callRow(call.id)).consentAudit).toBeNull()
    // And its "tool" is an action the line's handler has never known.
    expect((await ask({ action: "tool", callId: call.callId, name: "book_appointment", args: {}, id: "x" }, {})).status).toBe(400)
  })

  it("passes a long phrase of the line through the real route whole, even when the request does not say its length", async () => {
    const text = JSON.stringify({ action: "utterance", callId: randomUUID(), seq: 1, audio: Buffer.alloc(240_000, 7).toString("base64") })
    const bytes = new TextEncoder().encode(text)
    const request = new NextRequest("http://localhost:3000/api/internal/voice-agent/pharmacy-inbound", {
      method: "POST", duplex: "half",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-voice-agent-caps": "tools-1" },
      body: new ReadableStream({ start(controller) {
        for (let at = 0; at < bytes.length; at += 8192) controller.enqueue(bytes.subarray(at, at + 8192))
        controller.close()
      } }),
    } as ConstructorParameters<typeof NextRequest>[1])
    const answer = await Promise.race([station.POST(request), new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 5_000))])
    expect(answer).not.toBe("hung")
    // The line is off here, so its handler refuses the phrase: having read all of it. A cut body would be a 400.
    expect((answer as Response).status).toBe(403)
  })

  it("runs no tool for a call that never got the agent's session, or that is over", async () => {
    const args = { service: "s1", date: bakuDate(1), time: "11:00", name: "Elvin" }
    const unopened = await liveCall(CLINIC, CLINIC_VOIP, ELVIN)
    expect((await tool(unopened.callId, "book_appointment", args)).status).toBe(403)
    const ended = await answeredCall()
    await bypass(() => prisma.callLog.update({ where: { id: ended.id }, data: { status: "completed", endedAt: new Date() } }))
    expect((await tool(ended.callId, "book_appointment", args)).status).toBe(403)
    expect((await tool(randomUUID(), "book_appointment", args)).status).toBe(403)
    expect(await bookings(CLINIC)).toEqual([])
  })

  it("never takes the pharmacy line's own channel, and serves the clinic beside it", async () => {
    const grant = { version: 1, enabled: true, purpose: "zeytun_line", id: randomUUID(), organizationId: SALON, channelConfigId: SALON_VOIP,
      issuedAt: new Date(Date.now() - 60_000).toISOString(), approvalReference: "phone-agent-test",
      approvedSource: { organizationId: SALON, scopeKey: "a".repeat(64) }, orderOrganizationId: SALON }
    writeFileSync(scratch!.grantFile, JSON.stringify(grant), { mode: 0o600 })
    // The line's channel has the switch on by mistake: its calls stay the line's.
    const line = await liveCall(SALON, SALON_VOIP, AYSEL)
    const refused = await openSession(line.callId)
    expect(refused.body.variant).toBeUndefined()
    expect(refused.body.enabled).toBe(false)
    expect((await callRow(line.id)).consentAudit ?? {}).not.toHaveProperty("phoneAgent")
    expect((await tool(line.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "11:00", name: "Aysel" })).status).toBe(403)
    expect(await bookings(SALON)).toEqual([])
    // The clinic, another organization on the same station, is the agent's.
    const clinic = await answeredCall()
    expect((await tool(clinic.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "11:00", name: "Elvin" })).result.status).toBe("booked")
  })

  it("writes the call's Live and speech spend once, however often the station repeats the result", async () => {
    const call = await answeredCall()
    await bypass(() => prisma.callLog.update({ where: { id: call.id }, data: { status: "completed", endedAt: new Date(), duration: 125 } }))
    const usage = { live: { model: "gemini-3.8-live", textIn: 60_000, audioIn: 12_000, textOut: 1_500, audioOut: 1_800, turns: 11 },
      tts: { model: "gemini-3.8-flash-tts", requests: 14, chars: 900, audioSeconds: 48 } }
    const deliver = () => result.POST(new NextRequest("http://localhost:3000/api/internal/voice-agent/call-result", {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ callId: call.callId, durationSeconds: 125, providerOutcome: "connected", usage, turns: [
        { role: "agent", text: "Qeydiyyat, salam! Buyurun." }, { role: "customer", text: "Sabah saat on birə stomatoloqa yazın." },
        { role: "agent", text: "Sabah saat on birə yazdım." }] }),
    }))
    const first = await deliver()
    expect(first.status).toBe(200)
    // An ordinary customer call: analysed like any other, not the pharmacy line's "test preview".
    expect((await first.json()).analysisStatus).not.toBe("test_preview")
    await expect.poll(async () => (await spend(CLINIC)).length, { timeout: 5_000 }).toBe(2)
    expect((await deliver()).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const rows = await spend(CLINIC)
    expect(rows.map((row: { feature: string; provider: string; keySource: string }) => [row.feature, row.provider, row.keySource]))
      .toEqual([["phone-agent", "gemini", "platform"], ["phone-agent", "gemini", "platform"]])
    const live = rows.find((row: { model: string }) => row.model === "gemini-3.8-live")
    expect(live).toMatchObject({ inputTokens: 72_000, outputTokens: 3_300 })
    // 60,000 × 0.75 + 12,000 × 3 + 1,500 × 4.5 + 1,800 × 12 per million.
    expect(live.costUsd).toBeCloseTo(0.10935, 6)
    const speech = rows.find((row: { model: string }) => row.model === "gemini-3.8-flash-tts")
    // 48 seconds of speech at the price of the day it was produced: $0.0135 a minute through 2026,
    // $0.027 from 2027 (the two prices and their date are pinned in lib-voice-call-spend.test.ts).
    expect(speech.costUsd).toBeCloseTo(48 / 60 * geminiSpeechMinuteUsd(new Date()), 9)
    // Both were counted by the station: neither is an estimate.
    expect(rows.map((row: { estimated: boolean }) => row.estimated)).toEqual([false, false])
    expect(await spend(SALON)).toEqual([])
  })

  /** The booking's own follow-up (its lead, its host's task), as the effects cron runs it. */
  const drain = async (organizationId: string) => { for (let pass = 0; pass < 6; pass += 1) await rls.runWithTenant(organizationId, () => effects.drainBookingEffects(organizationId, 20)) }
  const leads = (organizationId: string) => bypass(() => prisma.lead.findMany({ where: { organizationId } }))
  const endCall = (call: { callId: string; id: string }) => bypass(() => prisma.callLog.update({ where: { id: call.id }, data: { status: "completed", endedAt: new Date(), duration: 90 } }))
    .then(() => result.POST(new NextRequest("http://localhost:3000/api/internal/voice-agent/call-result", {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ callId: call.callId, durationSeconds: 90, providerOutcome: "connected", turns: [
        { role: "agent", text: "Qeydiyyat, salam! Buyurun." }, { role: "customer", text: "Sabah saat on birə stomatoloqa yazın, adım Elvindir." },
        { role: "agent", text: "Sabah saat on birə yazdım." }] }),
    })))

  it("links the meeting to a caller the CRM already holds instead of filing a new lead", async () => {
    await bypass(() => prisma.contact.create({ data: { id: "contact-pab-elvin", organizationId: CLINIC, fullName: "Elvin Məmmədov", phone: ELVIN } }))
    const call = await answeredCall()
    await tool(call.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "11:00", name: "Elvin" })
    await drain(CLINIC)
    const [meeting] = await bookings(CLINIC)
    expect(meeting).toMatchObject({ contactId: "contact-pab-elvin", leadId: null })
    expect(await leads(CLINIC)).toEqual([])
    // The host still gets the visit as a task, on the contact's card.
    const [task] = await bypass(() => prisma.task.findMany({ where: { organizationId: CLINIC } }))
    expect(task).toMatchObject({ id: meeting.taskId, relatedType: "contact", relatedId: "contact-pab-elvin", assignedTo: `admin-${CLINIC}` })
  })

  it("keeps one lead for one new caller when the call's result arrives before the meeting's own follow-up", async () => {
    await bypass(() => prisma.channelConfig.update({ where: { id: CLINIC_VOIP }, data: { settings: voip({ aiCallLeadsEnabled: true }) } }))
    const call = await answeredCall()
    await tool(call.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "11:00", name: "Elvin" })
    expect((await endCall(call)).status).toBe(200)
    const fromCall = await leads(CLINIC)
    expect(fromCall).toHaveLength(1)
    await drain(CLINIC)
    expect(await leads(CLINIC)).toHaveLength(1)
    expect((await bookings(CLINIC))[0].leadId).toBe(fromCall[0].id)
    expect((await callRow(call.id)).leadId).toBe(fromCall[0].id)
  })

  it("keeps one lead for one new caller when the meeting's follow-up runs before the call ends", async () => {
    await bypass(() => prisma.channelConfig.update({ where: { id: CLINIC_VOIP }, data: { settings: voip({ aiCallLeadsEnabled: true }) } }))
    const call = await answeredCall()
    await tool(call.callId, "book_appointment", { service: "s1", date: bakuDate(1), time: "11:00", name: "Elvin" })
    await drain(CLINIC)
    const fromMeeting = await leads(CLINIC)
    expect(fromMeeting).toHaveLength(1)
    expect(fromMeeting[0]).toMatchObject({ phone: ELVIN, source: `booking:${DENTIST}` })
    expect((await endCall(call)).status).toBe(200)
    expect(await leads(CLINIC)).toHaveLength(1)
    expect((await callRow(call.id)).leadId).toBe(fromMeeting[0].id)
  })

  describe("an organization with its own Gemini key (owner, 2026-11-23)", () => {
    // «По умолчанию мой ключ; если клиент говорит „я сам буду платить“ — заменять на его.»
    // The real station route and the real key store; Google's token endpoint is the one stand-in.
    const OWN_KEY = "own-gemini-key-of-the-clinic-000000001" // gitleaks:allow — not a key
    const LIVE_TOKEN = "auth_tokens/3f1c9a7e5b2d4c6f8a0b1c2d3e4f5a6b7c8d9e0f"
    const NEW_CAPS = "tools-1, live-token-1"
    let minted: Array<{ key: string | null; body: Record<string, unknown> }> = []
    let credentials!: typeof import("@/lib/ai/gateway/credentials")
    let restoreFetch = () => {}

    /** A session request as the station's own client sends it: the length stated. */
    const stationAsks = (callId: string, caps: string) => {
      const body = JSON.stringify({ action: "session", callId })
      return ask({ action: "session", callId }, { "x-voice-agent-caps": caps, "content-length": String(Buffer.byteLength(body)) })
    }

    beforeAll(async () => {
      credentials = await import("@/lib/ai/gateway/credentials")
    })
    beforeEach(async () => {
      minted = []
      const stub = vi.mocked(globalThis.fetch)
      const before = stub.getMockImplementation()
      stub.mockImplementation(async (url, init) => {
        if (String(url) !== "https://generativelanguage.googleapis.com/v1beta/auth_tokens") return before!(url, init)
        minted.push({ key: new Headers(init?.headers).get("x-goog-api-key"), body: JSON.parse(String(init?.body)) })
        return new Response(JSON.stringify({ name: LIVE_TOKEN }), { status: 200 })
      })
      restoreFetch = () => { stub.mockImplementation(before!) }
      await credentials.saveTenantAiCredential({ orgId: CLINIC, provider: "gemini", secret: OWN_KEY })
      await credentials.saveTenantAiCredential({ orgId: QUIET, provider: "gemini", secret: OWN_KEY })
      credentials.forgetTenantAiAccess()
    })
    afterEach(async () => {
      restoreFetch()
      await bypass(() => prisma.tenantAiCredential.deleteMany({}))
      credentials.forgetTenantAiAccess()
    })

    it("gets its call's session with a Live token of that key, minted with the key and never showing it", async () => {
      const call = await liveCall(CLINIC, CLINIC_VOIP, ELVIN)
      const session = await stationAsks(call.callId, NEW_CAPS)
      expect(session.status).toBe(200)
      expect(session.body).toMatchObject({ enabled: true, variant: "agent_tools", liveToken: LIVE_TOKEN })
      expect(JSON.stringify(session.body)).not.toContain(OWN_KEY)
      // The key was read from the organization's own, sealed, row; the token is locked to no setup.
      expect(minted.map((mint) => mint.key)).toEqual([OWN_KEY])
      expect(Object.keys(minted[0].body).sort()).toEqual(["expireTime", "newSessionExpireTime", "uses"])
      const [stored] = await bypass(() => prisma.$queryRaw<Array<{ secret: string }>>`SELECT secret FROM tenant_ai_credentials WHERE "organizationId" = ${CLINIC}`)
      expect(stored.secret).not.toContain(OWN_KEY)
    })

    it("gets the token for a call the agent does not serve too: it runs the ordinary way, on its own key", async () => {
      const call = await liveCall(QUIET, QUIET_VOIP, ELVIN)
      const session = await stationAsks(call.callId, NEW_CAPS)
      expect(session.body).toEqual({ enabled: false, liveToken: LIVE_TOKEN })
    })

    it("an organization without a key of its own, and a station that cannot use a token, get the session as it always was", async () => {
      const salon = await liveCall(SALON, SALON_VOIP, ELVIN)
      const onPlatform = await stationAsks(salon.callId, NEW_CAPS)
      expect(onPlatform.body).toMatchObject({ enabled: true, variant: "agent_tools" })
      expect(onPlatform.body).not.toHaveProperty("liveToken")
      // The core installed before this compares {"enabled": false} whole: it must get exactly that.
      const clinic = await liveCall(CLINIC, CLINIC_VOIP, ELVIN)
      expect((await stationAsks(clinic.callId, "tools-1")).body).not.toHaveProperty("liveToken")
      const quiet = await liveCall(QUIET, QUIET_VOIP, ELVIN)
      expect((await stationAsks(quiet.callId, "tools-1")).body).toEqual({ enabled: false })
      expect(minted).toEqual([])
    })

    it("has the conversation journaled as its own spend, and the speech as the platform's", async () => {
      const call = await answeredCall()
      await bypass(() => prisma.callLog.update({ where: { id: call.id }, data: { status: "completed", endedAt: new Date(), duration: 62 } }))
      const usage = { auth: "token", live: { model: "gemini-3.8-live", textIn: 48_434, audioIn: 5_156, otherIn: 4_484, textOut: 1_140, audioOut: 596, otherOut: 267, turns: 4 },
        tts: { model: "gemini-3.8-flash-tts", requests: 6, chars: 410, audioSeconds: 60 } }
      const response = await result.POST(new NextRequest("http://localhost:3000/api/internal/voice-agent/call-result", {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ callId: call.callId, durationSeconds: 62, providerOutcome: "connected", usage,
          turns: [{ role: "agent", text: "Qeydiyyat, salam! Buyurun." }, { role: "customer", text: "Sabah saat on birə yazın." }] }),
      }))
      expect(response.status).toBe(200)
      await expect.poll(async () => (await spend(CLINIC)).length, { timeout: 5_000 }).toBe(2)
      const rows = (await spend(CLINIC)).map((row: { feature: string; model: string; keySource: string; costUsd: number }) =>
        ({ feature: row.feature, model: row.model, keySource: row.keySource, costUsd: Math.round(row.costUsd * 1e5) / 1e5 }))
        .sort((a: { model: string }, b: { model: string }) => a.model.localeCompare(b.model))
      expect(rows).toEqual([
        { feature: "phone-agent", model: "gemini-3.8-flash-tts", keySource: "platform", costUsd: Math.round(geminiSpeechMinuteUsd(new Date()) * 1e5) / 1e5 },
        { feature: "phone-agent", model: "gemini-3.8-live", keySource: "tenant", costUsd: 0.06864 },
      ])
    })
  })

  it("writes no agent spend for a call the agent never served", async () => {
    const call = await liveCall(QUIET, QUIET_VOIP, ELVIN, { status: "completed", endedAt: new Date() })
    const response = await result.POST(new NextRequest("http://localhost:3000/api/internal/voice-agent/call-result", {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ callId: call.callId, durationSeconds: 60, providerOutcome: "connected", turns: [{ role: "agent", text: "Salam!" }] }),
    }))
    expect(response.status).toBe(200)
    await expect.poll(async () => (await spend(QUIET)).length, { timeout: 5_000 }).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Nothing in the agent's row: the agent's session was never given to this call. The call's
    // conversation is still paid for, and is journaled as any other AI call's — by its length,
    // marked as an estimate (owner, 2026-11-22; src/lib/voice-agent/call-spend.ts).
    const rows = await spend(QUIET)
    expect(rows.filter((row: { feature: string }) => row.feature === "phone-agent")).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ feature: "ai-call", provider: "gemini", model: "gemini-3.8-live", keySource: "platform",
      estimated: true, inputTokens: 0, outputTokens: 0 })
    // One minute of a call under two minutes.
    expect(rows[0].costUsd).toBeCloseTo(0.04, 9)
  })
})
