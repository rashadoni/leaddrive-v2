/**
 * «Ночью ИИ принял обращения, утром рассказал» on a real Postgres, connected as
 * an application role without BYPASSRLS, the tables under the standard tenant
 * policy. The real station route and the real voice tool; only the model's
 * answer, the module list and the network are stubbed.
 *
 *  - The switch on the VoIP page is off: nothing is created.
 *  - On: a new caller the AI really talked to becomes a lead, once. A replayed
 *    result, a second call and two calls at the same moment do not make another.
 *  - The pharmacy line and demo calls never become leads.
 *  - A named employee gets a task only when the name fits exactly one person.
 *  - «Что я пропустил?» counts from the database, inside the caller's rights.
 *
 * Set AI_CALL_FOLLOW_UP_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   AI_CALL_FOLLOW_UP_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («AI call follow-up database gate»), where
 * `AI_CALL_FOLLOW_UP_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.AI_CALL_FOLLOW_UP_TEST_DATABASE_URL
if (!adminUrl && process.env.AI_CALL_FOLLOW_UP_DB_GATE === "required") {
  throw new Error("AI_CALL_FOLLOW_UP_TEST_DATABASE_URL is required by the AI call follow-up database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.AI_CALL_FOLLOW_UP_TEST_DATABASE_URL
  if (!admin) return null
  const name = `ai_call_follow_up_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "ai-call-follow-up-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.FANUM_VOICE_RUNTIME_TOKEN = "ai-call-follow-up-runtime"
  return { name, role, adminDb: db.toString() }
})

const stubs = vi.hoisted(() => ({
  modules: { voip: true, omnichannel: true, booking: true, sales: true, crm: true, ai: true } as Record<string, boolean>,
  answer: {} as Record<string, unknown>,
  modelCalls: 0,
  failPartyMatch: false,
}))

vi.mock("@/lib/calls/party-match", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calls/party-match")>()
  return {
    ...real,
    matchCallParty: vi.fn(async (...args: Parameters<typeof real.matchCallParty>) => {
      if (stubs.failPartyMatch) {
        stubs.failPartyMatch = false
        throw new Error("transient database failure")
      }
      return real.matchCallParty(...args)
    }),
  }
})

vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-auth")>(),
  getOrgModuleContext: vi.fn(async () => ({ plan: "enterprise", addons: ["ai", "voip"], modules: { ...stubs.modules } })),
}))
vi.mock("@/lib/ai/gateway/access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/gateway/access")>(),
  aiKeyOrRefusal: vi.fn(async () => ({ apiKey: "test-key", journal: () => {} })),
  isAiUnavailable: vi.fn(() => false),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = [
  "call_logs", "call_events", "leads", "contacts", "tasks", "notifications", "channel_configs",
  "channel_messages", "social_conversations", "web_chat_sessions", "web_chat_messages",
  "bookings", "booking_pages", "business_hours",
]

const ORG = "org-acf"
const OTHER = "org-acf-other"
const ADMIN = "user-acf-admin"
const SABINA = "user-acf-sabina"
const LEYLA_A = "user-acf-leyla-a"
const LEYLA_B = "user-acf-leyla-b"
const OFF = "user-acf-off"
const VIEWER = "user-acf-viewer"
const OTHER_ADMIN = "user-acf-other-admin"
const VOIP = "cfg-acf-voip"
const HIDDEN_VOIP = "cfg-acf-hidden"
const OTHER_VOIP = "cfg-acf-other"
const CONTACT = "contact-acf"
const PAGE = "page-acf"

const NEW_NUMBER = "+994501112233"
const SECOND_NUMBER = "+994501112244"
const CONTACT_NUMBER = "+994507778899"

const REAL_TURNS = [
  { role: "agent" as const, text: "Salam! Sizə necə kömək edə bilərəm?" },
  { role: "customer" as const, text: "Salam, sizin qiymətləri öyrənmək istəyirəm" },
]

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ai-call-follow-up-schema-")), "schema.prisma")
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

function modelSays(fields: Record<string, unknown> = {}) {
  stubs.answer = {
    summary: "Müştəri qiymətlər barədə soruşdu.",
    sentiment: "neutral",
    sentimentScore: 0.5,
    topics: ["qiymət"],
    disposition: "other",
    nextStep: null,
    nextStepDueHint: null,
    callOutcome: "qualified",
    requestedEmployeeName: null,
    callerName: null,
    ...fields,
  }
}

;(scratch ? describe : describe.skip)("AI call follow-up on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let route!: typeof import("@/app/api/internal/voice-agent/call-result/route")
  let followUp!: typeof import("@/lib/voice-agent/inbound-call-follow-up")
  let voice!: typeof import("@/lib/ai/voice/execute-read-tool")
  let createdDb = false
  let createdRole = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture rows, asserted field by field
  const bypass = (fn: () => Promise<any>): Promise<any> => rls.runWithRlsBypass(fn) as Promise<any>

  async function setSwitch(on: boolean, configId = VOIP) {
    await bypass(async () => {
      const row = await prisma.channelConfig.findFirstOrThrow({ where: { id: configId } })
      await prisma.channelConfig.update({
        where: { id: configId },
        data: { settings: { ...(row.settings as Record<string, unknown>), aiCallLeadsEnabled: on } },
      })
    })
  }

  async function inboundCall(fromNumber: string, extra: Record<string, unknown> = {}) {
    const callId = randomUUID()
    const row = await bypass(() => prisma.callLog.create({
      data: {
        organizationId: ORG,
        callSid: callId,
        providerCallId: callId,
        direction: "inbound",
        fromNumber,
        toNumber: "+994121110000",
        status: "completed",
        provider: "asterisk",
        callMode: "ai",
        wasAnswered: true,
        channelConfigId: VOIP,
        ...extra,
      },
      select: { id: true },
    }))
    return { callId, id: row.id }
  }

  const deliver = (callId: string, turns: Array<{ role: "agent" | "customer"; text: string }> = REAL_TURNS) => route.POST(
    new NextRequest("http://localhost:3000/api/internal/voice-agent/call-result", {
      method: "POST",
      headers: { authorization: "Bearer ai-call-follow-up-runtime", "content-type": "application/json" },
      body: JSON.stringify({ callId, durationSeconds: 42, providerOutcome: "connected", turns }),
    }),
  )

  const leads = (organizationId = ORG) => bypass(() => prisma.lead.findMany({ where: { organizationId } }))
  const tasks = () => bypass(() => prisma.task.findMany({ where: { organizationId: ORG } }))
  const notifications = (userId: string) => bypass(() => prisma.notification.findMany({ where: { organizationId: ORG, userId } }))
  const call = (id: string) => bypass(() => prisma.callLog.findFirstOrThrow({ where: { id } }))

  const askVoice = (auth: { orgId?: string; userId: string; role: string; hiddenChannelConfigIds?: string[] }) => {
    const orgId = auth.orgId ?? ORG
    return rls.runWithTenant(orgId, () => voice.executeVoiceReadTool({
      toolName: "get_missed_summary",
      filter: {},
      auth: { orgId, principalType: "session", ...auth },
    }))
  }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'ai-call-follow-up-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (!String(url).startsWith("https://api.openai.com/")) throw new Error(`unexpected network call: ${String(url)}`)
      stubs.modelCalls += 1
      return new Response(JSON.stringify({ model: "test-model", usage: {}, output_text: JSON.stringify(stubs.answer) }), { status: 200 })
    }))

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    route = await import("@/app/api/internal/voice-agent/call-result/route")
    followUp = await import("@/lib/voice-agent/inbound-call-follow-up")
    voice = await import("@/lib/ai/voice/execute-read-tool")

    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id } })
      const people: Array<[string, string, string, string, Record<string, unknown>?]> = [
        [ADMIN, ORG, "admin", "Rəşad Əliyev"],
        [SABINA, ORG, "manager", "Sabina Quliyeva"],
        [LEYLA_A, ORG, "sales", "Leyla Məmmədova"],
        [LEYLA_B, ORG, "sales", "Leyla Həsənova"],
        [OFF, ORG, "sales", "Nigar Kərimova", { isActive: false }],
        [VIEWER, ORG, "viewer", "Orxan Baxışov"],
        [OTHER_ADMIN, OTHER, "admin", "Tural Başqa"],
      ]
      for (const [id, organizationId, role, name, extra] of people) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@example.test`, name, role, passwordHash: "x", ...extra } })
      }
      const settings = { provider: "asterisk", voiceAgentEnabled: true, inboundAnswerMode: "ai" }
      await prisma.channelConfig.createMany({
        data: [
          { id: VOIP, organizationId: ORG, channelType: "voip", configName: "Line", isActive: true, settings },
          { id: HIDDEN_VOIP, organizationId: ORG, channelType: "voip", configName: "Hidden", isActive: false, settings },
          { id: OTHER_VOIP, organizationId: OTHER, channelType: "voip", configName: "Other", isActive: true, settings: { ...settings, aiCallLeadsEnabled: true } },
        ],
      })
      await prisma.contact.create({ data: { id: CONTACT, organizationId: ORG, fullName: "Tural Əhmədov", phone: CONTACT_NUMBER } })
      await prisma.bookingPage.create({ data: { id: PAGE, organizationId: ORG, slug: "acf-page", title: "Görüş", weekly: {} } })
    })
  }, 300_000)

  afterEach(async () => {
    await bypass(async () => {
      await prisma.notification.deleteMany({})
      await prisma.task.deleteMany({})
      await prisma.callEvent.deleteMany({})
      await prisma.callLog.deleteMany({})
      await prisma.lead.deleteMany({})
      await prisma.channelMessage.deleteMany({})
      await prisma.socialConversation.deleteMany({})
      await prisma.webChatMessage.deleteMany({})
      await prisma.webChatSession.deleteMany({})
      await prisma.booking.deleteMany({})
      await prisma.businessHours.deleteMany({})
      await prisma.leadAssignmentRule.deleteMany({})
    })
    await setSwitch(false)
    Object.assign(stubs.modules, { voip: true, omnichannel: true, booking: true })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  it("keeps the tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await bypass(() => prisma.$queryRaw<Array<{ relname: string; forced: boolean }>>`
      SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY(${RLS_TABLES}) ORDER BY relname`)
    expect(tables).toEqual([...RLS_TABLES].sort().map((relname) => ({ relname, forced: true })))
  })

  it("creates nothing while the switch is off, and still records the call's result", async () => {
    modelSays({ callOutcome: "needs_human", requestedEmployeeName: "Sabina" })
    const { callId, id } = await inboundCall(NEW_NUMBER)
    expect((await deliver(callId)).status).toBe(200)

    expect(await leads()).toHaveLength(0)
    expect(await tasks()).toHaveLength(0)
    expect(await notifications(SABINA)).toHaveLength(0)
    const stored = await call(id)
    expect(stored.leadId).toBeNull()
    expect(stored.insights).toMatchObject({
      outcome: "needs_human",
      requestedEmployee: { spokenName: "Sabina", userId: SABINA, match: "matched" },
    })
  })

  it("makes a new caller a lead with the phone, the source and what was said", async () => {
    await setSwitch(true)
    modelSays({ callerName: "Murad" })
    const { callId, id } = await inboundCall(NEW_NUMBER)
    expect((await deliver(callId)).status).toBe(200)

    const [lead] = await leads()
    expect(lead).toMatchObject({
      contactName: "Murad",
      phone: NEW_NUMBER,
      source: "inbound_call",
      status: "new",
      interest: "qiymət",
    })
    expect(lead.notes).toContain("Müştəri qiymətlər barədə soruşdu.")
    expect((await call(id)).leadId).toBe(lead.id)
    // A good fit with nobody named is a lead, not a task for anybody.
    expect(await tasks()).toHaveLength(0)
  })

  it("does not make a second lead on a replayed result or a re-run", async () => {
    await setSwitch(true)
    modelSays({ callOutcome: "needs_human" })
    const { callId, id } = await inboundCall(NEW_NUMBER)
    await deliver(callId)
    const modelCallsAfterFirst = stubs.modelCalls
    expect((await deliver(callId)).status).toBe(200)
    await rls.runWithTenant(ORG, () => followUp.recordInboundCallFollowUp({ organizationId: ORG, callLogId: id, turns: REAL_TURNS }))

    expect(await leads()).toHaveLength(1)
    expect(await tasks()).toHaveLength(1)
    expect(await notifications(ADMIN)).toHaveLength(1)
    // A replay must not pay for a second analysis either.
    expect(stubs.modelCalls).toBe(modelCallsAfterFirst)
  })

  it("does not bring back a task somebody deleted", async () => {
    await setSwitch(true)
    modelSays({ callOutcome: "needs_human" })
    const { callId, id } = await inboundCall(NEW_NUMBER)
    await deliver(callId)
    const [task] = await tasks()
    await bypass(() => prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } }))

    await rls.runWithTenant(ORG, () => followUp.recordInboundCallFollowUp({ organizationId: ORG, callLogId: id, turns: REAL_TURNS }))
    const rows = await bypass(() => prisma.task.findMany({ where: { id: task.id, deletedAt: { not: null } } }))
    expect(rows).toHaveLength(1)
    expect(await notifications(ADMIN)).toHaveLength(1)
  })

  it("puts a repeat call on the same lead", async () => {
    await setSwitch(true)
    modelSays()
    const first = await inboundCall(NEW_NUMBER)
    await deliver(first.callId)
    // The second call rang after the lead existed, but matched nothing at ringing in this fixture.
    const second = await inboundCall(NEW_NUMBER)
    await deliver(second.callId)

    const rows = await leads()
    expect(rows).toHaveLength(1)
    expect((await call(second.id)).leadId).toBe(rows[0].id)
  })

  it("makes one lead when two calls from a new number end at the same moment", async () => {
    await setSwitch(true)
    modelSays()
    const [a, b] = await Promise.all([inboundCall(SECOND_NUMBER), inboundCall(SECOND_NUMBER)])
    const results = await Promise.all([deliver(a.callId), deliver(b.callId)])
    expect(results.map((res) => res.status)).toEqual([200, 200])

    const rows = await leads()
    expect(rows).toHaveLength(1)
    expect((await call(a.id)).leadId).toBe(rows[0].id)
    expect((await call(b.id)).leadId).toBe(rows[0].id)
  })

  it("puts a known contact's call on the contact and makes no lead", async () => {
    await setSwitch(true)
    modelSays()
    const { callId, id } = await inboundCall(CONTACT_NUMBER)
    await deliver(callId)
    expect(await leads()).toHaveLength(0)
    expect((await call(id)).contactId).toBe(CONTACT)
  })

  it("never matches another organization's lead with the same number", async () => {
    await setSwitch(true)
    modelSays()
    await bypass(() => prisma.lead.create({ data: { id: "lead-acf-foreign", organizationId: OTHER, contactName: "Foreign", phone: NEW_NUMBER } }))
    const { callId, id } = await inboundCall(NEW_NUMBER)
    await deliver(callId)

    const [own] = await leads()
    expect(own.id).not.toBe("lead-acf-foreign")
    expect((await call(id)).leadId).toBe(own.id)
    const foreign = await leads(OTHER)
    expect(foreign.map((lead: { id: string }) => lead.id)).toEqual(["lead-acf-foreign"])
  })

  it.each([
    ["a pharmacy-line call", { pharmacyInboundPreview: { version: 1, grantId: "grant-1", providerCallId: "other" } }],
    ["a pharmacy-line callback", { pharmacyWaitlistCallback: { version: 1 } }],
    ["a demo call", { via: "demo_center" }],
  ])("never makes a lead from %s", async (_name, consentAudit) => {
    await setSwitch(true)
    modelSays({ callOutcome: "needs_human", requestedEmployeeName: "Sabina" })
    const { callId, id } = await inboundCall(NEW_NUMBER, { consentAudit })
    await deliver(callId)
    const result = await rls.runWithTenant(ORG, () => followUp.recordInboundCallFollowUp({ organizationId: ORG, callLogId: id, turns: REAL_TURNS }))

    expect(result).toEqual({ status: "skipped", reason: "excluded" })
    expect(await leads()).toHaveLength(0)
    expect(await tasks()).toHaveLength(0)
  })

  it("does not count a real pharmacy-line call at all: the route stops before the analysis", async () => {
    await setSwitch(true)
    modelSays()
    const callId = randomUUID()
    const before = stubs.modelCalls
    const { id } = await inboundCall(NEW_NUMBER, {
      callSid: callId,
      providerCallId: callId,
      consentAudit: { pharmacyInboundPreview: { version: 1, grantId: "grant-1", providerCallId: callId } },
    })
    const res = await deliver(callId)
    expect((await res.json()).analysisStatus).toBe("test_preview")
    expect(stubs.modelCalls).toBe(before)
    expect((await call(id)).leadId).toBeNull()
    expect(await leads()).toHaveLength(0)
  })

  it("never makes a lead from a call we placed ourselves", async () => {
    await setSwitch(true)
    modelSays({ callOutcome: "needs_human" })
    const { id } = await inboundCall(NEW_NUMBER, { direction: "outbound" })
    const result = await rls.runWithTenant(ORG, () => followUp.recordInboundCallFollowUp({ organizationId: ORG, callLogId: id, turns: REAL_TURNS }))
    expect(result).toEqual({ status: "skipped", reason: "not-found" })
    expect(await leads()).toHaveLength(0)
  })

  it("does not chase an open line: «алло» and a lone «да» are not an enquiry", async () => {
    await setSwitch(true)
    modelSays()
    const { callId } = await inboundCall(NEW_NUMBER)
    await deliver(callId, [
      { role: "agent", text: "Salam!" },
      { role: "customer", text: "Алло, алло" },
      { role: "customer", text: "да" },
    ])
    expect(await leads()).toHaveLength(0)
  })

  it("gives the task to the one person the caller named, in another alphabet", async () => {
    await setSwitch(true)
    modelSays({ callOutcome: "needs_human", requestedEmployeeName: "Сабина ханум" })
    const { callId } = await inboundCall(NEW_NUMBER)
    await deliver(callId)

    const [task] = await tasks()
    expect(task.assignedTo).toBe(SABINA)
    expect(task.title).toContain("sizi soruşub")
    expect(await notifications(SABINA)).toHaveLength(1)
  })

  it("does not guess between two people with the name: the responsible person gets it", async () => {
    await setSwitch(true)
    modelSays({ requestedEmployeeName: "Leyla" })
    const { callId, id } = await inboundCall(NEW_NUMBER)
    await deliver(callId)

    const [task] = await tasks()
    expect(task.assignedTo).toBe(ADMIN)
    expect(task.description).toContain("Leyla")
    expect(await notifications(LEYLA_A)).toHaveLength(0)
    expect(await notifications(LEYLA_B)).toHaveLength(0)
    expect((await call(id)).insights).toMatchObject({ requestedEmployee: { match: "ambiguous", userId: null } })
  })

  it.each([
    ["a name nobody has", "Fərid"],
    ["someone who no longer works here", "Nigar"],
    ["a person in another organization", "Tural"],
  ])("sends the task to the responsible person for %s", async (_name, spoken) => {
    await setSwitch(true)
    modelSays({ requestedEmployeeName: spoken })
    const { callId, id } = await inboundCall(NEW_NUMBER)
    await deliver(callId)

    const [task] = await tasks()
    expect(task.assignedTo).toBe(ADMIN)
    expect((await call(id)).insights).toMatchObject({ requestedEmployee: { match: "not_found", userId: null } })
  })

  it("keeps a call that did not fit on record without giving anyone work", async () => {
    await setSwitch(true)
    modelSays({ callOutcome: "not_qualified" })
    const { callId } = await inboundCall(NEW_NUMBER)
    await deliver(callId)

    const [lead] = await leads()
    expect(lead.status).toBe("lost")
    expect(await tasks()).toHaveLength(0)
    expect(await notifications(ADMIN)).toHaveLength(0)
  })

  it("tells a person when a customer comes back to a closed lead, and leaves it closed", async () => {
    await setSwitch(true)
    modelSays({ callOutcome: "not_qualified" })
    await deliver((await inboundCall(NEW_NUMBER)).callId)
    modelSays({ callOutcome: "qualified" })
    await deliver((await inboundCall(NEW_NUMBER)).callId)

    const [lead] = await leads()
    expect(lead.status).toBe("lost")
    const rows = await tasks()
    expect(rows).toHaveLength(1)
    expect(rows[0].assignedTo).toBe(ADMIN)
  })

  it("passes the caller's interest to the organization's assignment rules", async () => {
    await setSwitch(true)
    modelSays({ topics: ["kredit şərtləri"] })
    await bypass(() => prisma.leadAssignmentRule.create({
      data: {
        organizationId: ORG,
        name: "Kredit",
        method: "condition",
        conditions: [{ field: "interest", operator: "contains", value: "kredit" }],
        assignees: [SABINA],
      },
    }))
    await deliver((await inboundCall(NEW_NUMBER)).callId)
    const [lead] = await leads()
    expect(lead.assignedTo).toBe(SABINA)
    expect(await notifications(SABINA)).toHaveLength(1)
  })

  it("asks the station to retry a failed lead, without paying for the analysis twice", async () => {
    await setSwitch(true)
    modelSays()
    const { callId, id } = await inboundCall(NEW_NUMBER)
    stubs.failPartyMatch = true
    const before = stubs.modelCalls
    expect((await deliver(callId)).status).toBe(503)
    expect(await leads()).toHaveLength(0)

    expect((await deliver(callId)).status).toBe(200)
    const [lead] = await leads()
    expect((await call(id)).leadId).toBe(lead.id)
    expect(stubs.modelCalls).toBe(before + 1)
  })

  describe("a call handed to a person", () => {
    it("gives nobody a task when a manager took the call, and keeps the lead", async () => {
      await setSwitch(true)
      modelSays({ callOutcome: "needs_human", requestedEmployeeName: "Sabina" })
      const { callId } = await inboundCall(NEW_NUMBER, { handoffState: "connected", callMode: "human" })
      await deliver(callId)
      expect(await leads()).toHaveLength(1)
      expect(await tasks()).toHaveLength(0)
      expect(await notifications(SABINA)).toHaveLength(0)
    })

    it("waits while the transfer is open, then files the task if the call ended untaken", async () => {
      await setSwitch(true)
      modelSays({ callOutcome: "needs_human" })
      const { callId, id } = await inboundCall(NEW_NUMBER, { handoffState: "requested" })
      await deliver(callId)
      expect(await leads()).toHaveLength(1)
      expect(await tasks()).toHaveLength(0)

      await bypass(() => prisma.callLog.update({ where: { id }, data: { endedAt: new Date() } }))
      await rls.runWithTenant(ORG, () => followUp.settleHandedOffCall(ORG, callId))
      const rows = await tasks()
      expect(rows).toHaveLength(1)
      expect(rows[0].assignedTo).toBe(ADMIN)
    })

    it("files nothing at the end of a call a manager took", async () => {
      await setSwitch(true)
      modelSays({ callOutcome: "needs_human" })
      const { callId, id } = await inboundCall(NEW_NUMBER, { handoffState: "requested" })
      await deliver(callId)
      await bypass(() => prisma.callLog.update({ where: { id }, data: { handoffState: "connected", callMode: "human", endedAt: new Date() } }))
      await rls.runWithTenant(ORG, () => followUp.settleHandedOffCall(ORG, callId))
      expect(await tasks()).toHaveLength(0)
    })

    it("files the task when nobody answered and the call came back to the AI", async () => {
      await setSwitch(true)
      modelSays({ callOutcome: "needs_human" })
      const { callId, id } = await inboundCall(NEW_NUMBER, { handoffState: "requested" })
      await deliver(callId)
      await bypass(() => prisma.callLog.update({ where: { id }, data: { handoffState: "returned", callMode: "ai" } }))
      const before = stubs.modelCalls
      const res = await deliver(callId, [
        { role: "agent", text: "Menecer cavab vermədi, sizə özüm kömək edim." },
        { role: "customer", text: "hə" },
      ])
      expect(res.status).toBe(200)
      expect(await tasks()).toHaveLength(1)
      expect(stubs.modelCalls).toBe(before)
      expect((await call(id)).transcription).toContain("qiymətləri")
    })
  })

  describe("«что я пропустил?»", () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)

    async function storedCall(input: { outcome?: string; requested?: Record<string, unknown>; at?: Date; extra?: Record<string, unknown> }) {
      const callId = randomUUID()
      await bypass(() => prisma.callLog.create({
        data: {
          organizationId: ORG,
          callSid: callId,
          providerCallId: callId,
          direction: "inbound",
          fromNumber: NEW_NUMBER,
          toNumber: "+994121110000",
          status: "completed",
          provider: "asterisk",
          callMode: "ai",
          wasAnswered: true,
          conversationOutcome: "customer_spoke",
          channelConfigId: VOIP,
          createdAt: input.at ?? hoursAgo(2),
          insights: {
            version: 1,
            summary: "x",
            ...(input.outcome ? { outcome: input.outcome } : {}),
            ...(input.requested ? { requestedEmployee: input.requested } : {}),
          },
          ...input.extra,
        },
      }))
    }

    async function chat(id: string, input: { aiReply?: boolean; customerWrote?: boolean; qualifiedAt?: Date; metadata?: Record<string, unknown> }) {
      await bypass(async () => {
        await prisma.socialConversation.create({
          data: {
            id,
            organizationId: ORG,
            platform: "whatsapp",
            externalId: id,
            metadata: input.qualifiedAt
              ? { qualificationLeadId: "lead-x", qualifiedAt: input.qualifiedAt.toISOString() }
              : {},
          },
        })
        if (input.customerWrote !== false) {
          await prisma.channelMessage.create({
            data: { organizationId: ORG, conversationId: id, direction: "inbound", from: id, to: "biz", body: "qiymət?", createdAt: hoursAgo(3) },
          })
        }
        if (input.aiReply !== false) {
          await prisma.channelMessage.create({
            data: { organizationId: ORG, conversationId: id, direction: "outbound", from: "biz", to: id, body: "cavab", createdAt: hoursAgo(3), metadata: { aiAutoReply: true, ...input.metadata } },
          })
        }
      })
    }

    async function booking(source: string, status = "confirmed", hostUserId = ADMIN) {
      await bypass(() => prisma.booking.create({
        data: {
          organizationId: ORG, bookingPageId: PAGE, hostUserId, startsAt: hoursAgo(-20), endsAt: hoursAgo(-19),
          name: "Müştəri", phone: NEW_NUMBER, status, source, cancelTokenHash: randomUUID(),
          // Explicit: the database's own clock can stamp a row a moment after the period's end.
          createdAt: hoursAgo(1),
        },
      }))
    }

    it("adds the night up from the database and states the period", async () => {
      await storedCall({ outcome: "qualified" })
      await storedCall({ outcome: "qualified" })
      await storedCall({ outcome: "not_qualified" })
      await storedCall({ outcome: "needs_human", requested: { spokenName: "Rəşad", userId: ADMIN, match: "matched" } })
      await storedCall({}) // analysed before the verdict existed
      await storedCall({ outcome: "qualified", at: hoursAgo(20) }) // before the period
      await chat("conv-acf-1", { qualifiedAt: hoursAgo(3) })
      await chat("conv-acf-2", {})
      await chat("conv-acf-reminder", { customerWrote: false }) // an AI reminder nobody answered
      await chat("conv-acf-human", { aiReply: false })
      await chat("conv-acf-demo", { metadata: { sentVia: "demo_ai" } })
      await booking("whatsapp")
      await booking("whatsapp", "cancelled")
      await booking("public_link")

      const out = await askVoice({ userId: ADMIN, role: "admin" })
      const data = (out.body as { data: Record<string, any> }).data
      expect(data.period.basis).toBe("last_16_hours")
      expect(data.period.fromLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      expect(data.calls).toEqual({ handled: 5, qualified: 2, notQualified: 1, needsHuman: 1, noVerdict: 1 })
      expect(data.chats).toEqual({ handled: 2, qualified: 1 })
      expect(data.handled).toBe(7)
      expect(data.booked).toBe(1)
      expect(data.unavailable).toEqual([])
    })

    it("names who asked for the person asking, and only for them", async () => {
      await storedCall({ outcome: "needs_human", requested: { spokenName: "Sabina", userId: SABINA, match: "matched" } })
      await storedCall({ outcome: "needs_human", requested: { spokenName: "Rəşad", userId: ADMIN, match: "matched" } })
      await storedCall({ outcome: "needs_human", requested: { spokenName: "Leyla", userId: null, match: "ambiguous" } })

      const forSabina = (await askVoice({ userId: SABINA, role: "manager" })).body as { data: Record<string, any> }
      expect(forSabina.data.askedForYou.count).toBe(1)
      const forAdmin = (await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }
      expect(forAdmin.data.askedForYou.count).toBe(1)
    })

    it("does not count the pharmacy line or demo calls", async () => {
      await storedCall({ outcome: "qualified" })
      await storedCall({ outcome: "qualified", extra: { consentAudit: { pharmacyInboundPreview: { version: 1, grantId: "g", providerCallId: "p" } } } })
      await storedCall({ outcome: "qualified", extra: { consentAudit: { pharmacyWaitlistCallback: { version: 1 } } } })
      await storedCall({ outcome: "qualified", extra: { consentAudit: { via: "demo_center" } } })

      const data = ((await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(data.calls.handled).toBe(1)
    })

    it("does not read another organization's night", async () => {
      await storedCall({ outcome: "qualified" })
      const data = ((await askVoice({ orgId: OTHER, userId: OTHER_ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(data.calls.handled).toBe(0)
      expect(data.handled).toBe(0)
    })

    it("says what this person cannot see instead of saying zero", async () => {
      await storedCall({ outcome: "qualified" })
      await chat("conv-acf-1", {})
      stubs.modules.voip = false
      const noVoip = ((await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(noVoip.calls).toBeNull()
      expect(noVoip.askedForYou).toBeNull()
      expect(noVoip.unavailable).toContain("calls")
      expect(noVoip.handled).toBe(1)

      stubs.modules.voip = true
      stubs.modules.booking = false
      const noBooking = ((await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(noBooking.booked).toBeNull()
      expect(noBooking.unavailable).toContain("bookings")
    })

    it("does not tell someone below manager that the AI took zero calls", async () => {
      await storedCall({ outcome: "qualified" })
      await chat("conv-acf-1", {})
      const data = ((await askVoice({ userId: LEYLA_A, role: "sales" })).body as { data: Record<string, any> }).data
      expect(data.calls).toBeNull()
      expect(data.askedForYou).toBeNull()
      expect(data.unavailable).toContain("calls")
    })

    it("counts the AI's website replies, not the greeting or an escalation notice", async () => {
      await bypass(async () => {
        for (const id of ["web-acf-ai", "web-acf-greeting"]) {
          await prisma.webChatSession.create({ data: { id, organizationId: ORG } })
          await prisma.webChatMessage.create({ data: { organizationId: ORG, sessionId: id, fromRole: "visitor", text: "salam", createdAt: hoursAgo(3) } })
        }
        await prisma.webChatMessage.create({ data: { organizationId: ORG, sessionId: "web-acf-ai", fromRole: "bot", text: "cavab", createdAt: hoursAgo(3), metadata: { aiGenerated: true } } })
        await prisma.webChatMessage.create({ data: { organizationId: ORG, sessionId: "web-acf-greeting", fromRole: "bot", text: "Xoş gəlmisiniz", createdAt: hoursAgo(3) } })
      })
      const data = ((await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(data.chats.handled).toBe(1)
    })

    it("says whose meetings the booked figure covers", async () => {
      await booking("whatsapp", "confirmed", ADMIN)
      await booking("whatsapp", "confirmed", SABINA)
      const admin = ((await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(admin).toMatchObject({ booked: 2, bookedScope: "all_hosts" })
      const manager = ((await askVoice({ userId: SABINA, role: "manager" })).body as { data: Record<string, any> }).data
      expect(manager).toMatchObject({ booked: 1, bookedScope: "own_and_granted" })
    })

    it("answers with an access refusal when neither calls nor chats are visible", async () => {
      await storedCall({ outcome: "qualified" })
      stubs.modules.voip = false
      stubs.modules.omnichannel = false
      const out = await askVoice({ userId: ADMIN, role: "admin" })
      expect(out.body).toEqual({ data: { error: "ACCESS_SCOPE_UNAVAILABLE" } })
    })

    it("leaves out calls on a number hidden from this person", async () => {
      await storedCall({ outcome: "qualified" })
      await storedCall({ outcome: "qualified", extra: { channelConfigId: HIDDEN_VOIP } })
      const data = ((await askVoice({ userId: SABINA, role: "manager", hiddenChannelConfigIds: [HIDDEN_VOIP] })).body as { data: Record<string, any> }).data
      expect(data.calls.handled).toBe(1)
    })

    it("counts from the end of the last working day when the organization has hours", async () => {
      const schedule = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { enabled: true, intervals: [{ start: "00:00", end: "00:01" }] }]))
      await bypass(() => prisma.businessHours.create({ data: { organizationId: ORG, channelType: "all", timezone: "Asia/Baku", schedule } }))
      const data = ((await askVoice({ userId: ADMIN, role: "admin" })).body as { data: Record<string, any> }).data
      expect(data.period.basis).toBe("business_hours")
      expect(data.period.timezone).toBe("Asia/Baku")
      expect(data.period.fromLocal).toMatch(/ 00:01$/)
    })
  })
})
