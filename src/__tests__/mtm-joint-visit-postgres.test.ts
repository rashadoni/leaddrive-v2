/**
 * Joint visit — a manager in the field with one agent, the agent's «yes,
 * together» at check-in, the manager's rating — read off the tables after the
 * real handlers ran on a real Postgres (owner, 2026-10-20).
 *
 * What is asked is what the tables hold, refused requests included: a mocked
 * Prisma answers the scope and session queries with whatever the test hands
 * it, so it cannot show that a manager reaches no agent outside his team, that
 * an agent's «yes» without the manager's session writes nothing, that a
 * rating never reaches the rated agent («агент оценку не видит»), or that a
 * rating keeps the questions it was given against when the company edits its
 * list (owner, 2026-10-21) — and that one company's list is not another's.
 *
 * The stand-ins: who is calling (the mobile token, the web session) and the
 * tenant's plan, nothing else.
 *
 * Set MTM_JOINT_VISIT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   MTM_JOINT_VISIT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM joint visit database gate»), where
 * `MTM_JOINT_VISIT_DB_GATE=required` turns a missing URL into a failure so the
 * gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS } from "@/lib/mtm/visit-evaluation-questions"

const adminUrl = process.env.MTM_JOINT_VISIT_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_JOINT_VISIT_DB_GATE === "required") {
  throw new Error("MTM_JOINT_VISIT_TEST_DATABASE_URL is required by the MTM joint visit database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_JOINT_VISIT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_joint_visit_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

/** Whose phone is calling; null means the request comes from a browser. */
const caller = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
/** Who sits at the browser. */
const browser = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => caller.current)
  // Synchronous, like the real one: it only reads the token and picks the branch.
  mock.getMobileAuth.mockImplementation(() => caller.current)
  return mock
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => browser.current?.orgId ?? null),
  getSession: vi.fn(async () => browser.current),
  requireAuth: vi.fn(async () => browser.current ?? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
// The tenant's plan is not what is under test.
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-joint-visit"
const OTHER_ORG = "org-joint-elsewhere"
const BASE = "http://localhost:3000/api/v1/mtm"

// The manager's team: two agents; an agent of another team; one who left; a
// card of another company.
const MANAGER = "agent-joint-manager"
const ELVIN = "agent-joint-elvin"
const AYSEL = "agent-joint-aysel"
const OTHER_TEAM = "agent-joint-other-team"
const LEFT = "agent-joint-left"
const OTHER_COMPANY = "agent-joint-other-company"
const CUSTOMER = "customer-joint"
const ABROAD_MANAGER = "agent-joint-abroad-manager"
const ORIGINAL_IDS = ["PREPARATION", "RAPPORT", "NEEDS", "PRESENTATION", "OBJECTIONS", "CLOSING"]
// Planned joint visits (2026-10-30): a client of Elvin's he has not put on his
// route, and one that is not his at all.
const EXTRA_CLIENT = "customer-joint-extra"
const NOT_HIS = "customer-joint-not-his"
const ROUTE = "route-joint-elvin-today"
const STOP = "point-joint-elvin-central"
const CUSTOMER_AT = { latitude: 40.4093, longitude: 49.8671 }

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-joint-visit-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/**
 * `db push` cannot express a partial index or a CHECK. The one open session
 * per manager and the scores' shape are what decide whether a write is
 * accepted, so they are lifted from the migration that made them.
 */
function jointVisitConstraints(): string[] {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261024090000_mtm_joint_visits/migration.sql"), "utf8")
  const statements = [
    sql.match(/CREATE UNIQUE INDEX "mtm_joint_field_sessions_one_open_per_manager"[^;]*;/)?.[0],
    `ALTER TABLE "mtm_joint_field_sessions" ADD CONSTRAINT "mtm_joint_field_sessions_two_people_check" CHECK ("managerAgentId" <> "agentId");`,
    `ALTER TABLE "mtm_visit_evaluations" ADD CONSTRAINT "mtm_visit_evaluations_scores_check" CHECK (jsonb_typeof("scores") = 'object');`,
  ]
  if (statements.some((statement) => !statement) || !sql.includes(`CHECK ("managerAgentId" <> "agentId")`) || !sql.includes(`CHECK (jsonb_typeof("scores") = 'object')`)) {
    throw new Error("joint visit constraints not found in their migration")
  }
  // A rating's own list of questions is a list (20261116090000).
  const questions = readFileSync(path.join(ROOT, "prisma/migrations/20261116090000_mtm_visit_evaluation_questions/migration.sql"), "utf8")
    .match(/ALTER TABLE "mtm_visit_evaluations"\s+ADD CONSTRAINT "mtm_visit_evaluations_questions_check"[^;]*;/)?.[0]
  if (!questions) throw new Error("the questions constraint was not found in its migration")
  statements.push(questions)
  // Planned joint visits (2026-10-30): one live plan per manager and stop.
  const plans = readFileSync(path.join(ROOT, "prisma/migrations/20261114090000_mtm_joint_visit_plans/migration.sql"), "utf8")
  const onePerStop = plans.match(/CREATE UNIQUE INDEX "mtm_joint_visit_plans_one_live_per_stop"[^;]*;/)?.[0]
  if (!onePerStop) throw new Error("joint visit plan constraints not found in their migration")
  return [...statements as string[], onePerStop]
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("joint visit on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let joint!: typeof import("@/app/api/v1/mtm/mobile/manager/joint-visit/route")
  let endJoint!: typeof import("@/app/api/v1/mtm/mobile/manager/joint-visit/end/route").POST
  let evaluate!: typeof import("@/app/api/v1/mtm/mobile/manager/visits/[id]/evaluation/route").PUT
  let agentJoint!: typeof import("@/app/api/v1/mtm/mobile/joint-visit/route").GET
  let syncPush!: typeof import("@/app/api/v1/mtm/mobile/sync/push/route").POST
  let review!: typeof import("@/app/api/v1/mtm/visits/[id]/review/route").GET
  let visitList!: typeof import("@/app/api/v1/mtm/visits/route").GET
  let agentRatings!: typeof import("@/app/api/v1/mtm/agents/[id]/evaluations/route").GET
  let settingsRoute!: typeof import("@/app/api/v1/mtm/settings/route")
  let plans!: typeof import("@/app/api/v1/mtm/mobile/manager/joint-visit/plans/route")
  let cancelPlan!: typeof import("@/app/api/v1/mtm/mobile/manager/joint-visit/plans/[id]/route").DELETE
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    for (const statement of jointVisitConstraints()) {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, statement)
    }
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    joint = await import("@/app/api/v1/mtm/mobile/manager/joint-visit/route")
    endJoint = (await import("@/app/api/v1/mtm/mobile/manager/joint-visit/end/route")).POST
    evaluate = (await import("@/app/api/v1/mtm/mobile/manager/visits/[id]/evaluation/route")).PUT
    agentJoint = (await import("@/app/api/v1/mtm/mobile/joint-visit/route")).GET
    syncPush = (await import("@/app/api/v1/mtm/mobile/sync/push/route")).POST
    review = (await import("@/app/api/v1/mtm/visits/[id]/review/route")).GET
    visitList = (await import("@/app/api/v1/mtm/visits/route")).GET
    agentRatings = (await import("@/app/api/v1/mtm/agents/[id]/evaluations/route")).GET
    settingsRoute = await import("@/app/api/v1/mtm/settings/route")
    plans = await import("@/app/api/v1/mtm/mobile/manager/joint-visit/plans/route")
    cancelPlan = (await import("@/app/api/v1/mtm/mobile/manager/joint-visit/plans/[id]/route")).DELETE

    await bypass(async () => {
      for (const id of [ORG, OTHER_ORG]) {
        await prisma.organization.create({ data: { id, name: id, slug: id, modules: { mtm: true, "route-field": true } } })
      }
      for (const [id, email] of [["user-joint-manager", "manager@example.test"], ["user-joint-elvin", "elvin@example.test"]]) {
        await prisma.user.create({ data: { id, organizationId: ORG, email, name: id, passwordHash: "-", role: "member" } })
      }
      await prisma.mtmTeam.create({ data: { id: "team-joint-mine", organizationId: ORG, name: "Mine" } })
      await prisma.mtmTeam.create({ data: { id: "team-joint-other", organizationId: ORG, name: "Other" } })
      await prisma.mtmTeam.create({ data: { id: "team-joint-abroad", organizationId: OTHER_ORG, name: "Abroad" } })
      await prisma.mtmAgent.createMany({
        data: [
          { id: MANAGER, organizationId: ORG, name: "Team Manager", role: "SUPERVISOR", teamId: "team-joint-mine", userId: "user-joint-manager" },
          { id: ELVIN, organizationId: ORG, name: "Elvin", teamId: "team-joint-mine", userId: "user-joint-elvin" },
          { id: AYSEL, organizationId: ORG, name: "Aysel", teamId: "team-joint-mine" },
          { id: LEFT, organizationId: ORG, name: "Left the company", teamId: "team-joint-mine", status: "INACTIVE" },
          { id: OTHER_TEAM, organizationId: ORG, name: "Someone else's", teamId: "team-joint-other" },
          { id: OTHER_COMPANY, organizationId: OTHER_ORG, name: "Another company", teamId: "team-joint-abroad" },
        ],
      })
      await prisma.mtmCustomer.create({
        data: { id: CUSTOMER, organizationId: ORG, name: "Central Clinic", ...CUSTOMER_AT, geofenceRadius: 300 },
      })
      for (const agentId of [ELVIN, AYSEL]) {
        await prisma.mtmCustomerAgentAssignment.create({
          data: { organizationId: ORG, customerId: CUSTOMER, agentId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
        })
      }
      await prisma.mtmCustomer.createMany({
        data: [
          { id: EXTRA_CLIENT, organizationId: ORG, name: "Extra Pharmacy", ...CUSTOMER_AT, geofenceRadius: 300 },
          { id: NOT_HIS, organizationId: ORG, name: "Somebody Else's Pharmacy", ...CUSTOMER_AT, geofenceRadius: 300 },
        ],
      })
      await prisma.mtmCustomerAgentAssignment.create({
        data: { organizationId: ORG, customerId: EXTRA_CLIENT, agentId: ELVIN, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
      })
      await prisma.mtmCustomerAgentAssignment.create({
        data: { organizationId: ORG, customerId: NOT_HIS, agentId: OTHER_TEAM, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => phoneOf(MANAGER, "SUPERVISOR"))

  function phoneOf(agentId: string, role: string) {
    browser.current = null
    caller.current = {
      orgId: ORG,
      agentId,
      userId: "",
      role,
      email: `${agentId}@example.test`,
      name: agentId === MANAGER ? "Team Manager" : "Field agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
  }

  function browserOf(userId: string, role = "member", orgId = ORG) {
    caller.current = null
    browser.current = { orgId, userId, role, email: `${userId}@example.test`, name: userId, principalType: "session" }
  }

  async function call(handler: (req: NextRequest, ctx?: never) => Promise<Response>, url: string, method = "GET", body?: unknown, ctx?: unknown) {
    const response = await (handler as (req: NextRequest, ctx?: unknown) => Promise<Response>)(new NextRequest(url, {
      method,
      headers: caller.current
        ? { Authorization: "Bearer mobile", "content-type": "application/json" }
        : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the handler's JSON, read field by field below
    return { status: response.status, body: await response.json() as Record<string, any> }
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  type SessionRow = { id: string; organizationId: string; managerAgentId: string; agentId: string; endedAt: Date | null }

  async function sessions(): Promise<SessionRow[]> {
    return bypass(() => prisma.mtmJointFieldSession.findMany({ orderBy: { startedAt: "asc" } }))
  }

  /** «Я приехал — начать визит», as the phone's outbox sends it. */
  async function checkIn(agentId: string, extra: Record<string, unknown> = {}) {
    phoneOf(agentId, "AGENT")
    const id = `visit-joint-${++sequence}`
    const result = await call(syncPush, `${BASE}/mobile/sync/push`, "POST", {
      operations: [{
        operationId: `op-joint-${sequence}`,
        entity: "visits",
        op: "create",
        clientTimestamp: Date.now(),
        data: {
          id,
          customerId: CUSTOMER,
          status: "CHECKED_IN",
          checkInAt: new Date().toISOString(),
          checkInLat: CUSTOMER_AT.latitude,
          checkInLng: CUSTOMER_AT.longitude,
          ...extra,
        },
      }],
    })
    expect(result.status).toBe(200)
    const op = result.body.results[0]
    // Close it right away: one open visit per agent is the server's rule.
    await bypass(() => prisma.mtmVisit.updateMany({ where: { id }, data: { status: "CHECKED_OUT", checkOutAt: new Date() } }))
    return { id, op }
  }

  it("lets the manager accompany only an active agent of his own team", async () => {
    for (const agentId of [OTHER_TEAM, LEFT, OTHER_COMPANY, MANAGER, "no-such-card"]) {
      const refused = await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId })
      expect({ agentId, status: refused.status, code: refused.body.code })
        .toEqual({ agentId, status: 403, code: "MTM_JOINT_VISIT_AGENT_FORBIDDEN" })
    }
    expect(await sessions()).toEqual([])

    phoneOf(ELVIN, "AGENT")
    const byAgent = await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId: AYSEL })
    expect(byAgent.status).toBe(403)
    expect(await sessions()).toEqual([])
  })

  it("opens one session, and a second press opens no second one", async () => {
    const started = await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId: ELVIN })
    expect(started.status).toBe(201)
    expect(started.body.data.session.agent).toEqual({ id: ELVIN, name: "Elvin" })
    const again = await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId: ELVIN })
    expect(again.status).toBe(200)
    const rows = await sessions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ organizationId: ORG, managerAgentId: MANAGER, agentId: ELVIN, endedAt: null })

    // The agent is told once, in his bell, by the manager's name and in his language (Azerbaijani without a login).
    const notices = await bypass(() => prisma.mtmNotification.findMany({
      where: { organizationId: ORG },
      select: { agentId: true, title: true, body: true, metadata: true },
    }))
    expect(notices).toEqual([{
      agentId: ELVIN,
      title: "Team Manager bu gün sizinlə birgə vizitdədir",
      body: "Vizitə başlayanda «Bəli, rəhbərlə birgə» seçin — onda rəhbər vizitinizi qiymətləndirə biləcək.",
      metadata: { domain: "route", event: "joint_visit_session", jointSessionId: rows[0].id, managerAgentId: MANAGER },
    }])
  })

  it("tells the accompanied agent who is with him, and nobody else", async () => {
    phoneOf(ELVIN, "AGENT")
    const elvin = await call(agentJoint, `${BASE}/mobile/joint-visit`)
    expect(elvin.status).toBe(200)
    expect(elvin.body.data.managers.map((manager: { id: string; name: string }) => [manager.id, manager.name]))
      .toEqual([[MANAGER, "Team Manager"]])

    phoneOf(AYSEL, "AGENT")
    const aysel = await call(agentJoint, `${BASE}/mobile/joint-visit`)
    expect(aysel.body.data.managers).toEqual([])
  })

  it("makes a visit joint only on the agent's «yes» backed by the manager's session", async () => {
    const together = await checkIn(ELVIN, { jointManagerId: MANAGER })
    expect(together.op.status).toBe("ok")
    expect(together.op.serverData.joint).toEqual({ managerId: MANAGER, accepted: true })

    const alone = await checkIn(ELVIN)
    expect(alone.op.status).toBe("ok")

    // Aysel says «yes», but the manager is with Elvin: her visit is made, and stays hers alone.
    const unbacked = await checkIn(AYSEL, { jointManagerId: MANAGER })
    expect(unbacked.op.status).toBe("ok")
    expect(unbacked.op.serverData.joint).toEqual({ managerId: MANAGER, accepted: false })

    const session = (await sessions())[0]
    const participants = await bypass(() => prisma.mtmVisitParticipant.findMany({
      where: { visitId: { in: [together.id, alone.id, unbacked.id] } },
      select: { visitId: true, agentId: true, role: true, jointSessionId: true },
    }))
    expect(participants).toEqual([{ visitId: together.id, agentId: MANAGER, role: "OBSERVER", jointSessionId: session.id }])
  })

  it("rates only a visit the agent marked as joint, and keeps one rating per manager", async () => {
    const together = await checkIn(ELVIN, { jointManagerId: MANAGER })
    const unbacked = await checkIn(AYSEL, { jointManagerId: MANAGER })
    phoneOf(MANAGER, "SUPERVISOR")

    const state = await call(joint.GET, `${BASE}/mobile/manager/joint-visit`)
    expect(state.status).toBe(200)
    const listed = new Map<string, Record<string, unknown>>(
      state.body.data.visits.map((visit: Record<string, unknown>) => [visit.id as string, visit]),
    )
    expect(listed.get(together.id)).toMatchObject({ joint: true, canEvaluate: true, evaluation: null })
    expect(listed.has(unbacked.id)).toBe(false)

    const refused = await call(evaluate, `${BASE}/mobile/manager/visits/${unbacked.id}/evaluation`, "PUT", { scores: { PREPARATION: 4 } }, params(unbacked.id))
    expect([refused.status, refused.body.code]).toEqual([404, "MTM_VISIT_EVALUATION_NOT_JOINT"])

    for (const bad of [{ scores: {} }, { scores: { PREPARATION: 6 } }, { scores: { PREPARATION: 0 } }, { scores: { NEEDS: 3.5 } }]) {
      const invalid = await call(evaluate, `${BASE}/mobile/manager/visits/${together.id}/evaluation`, "PUT", bad, params(together.id))
      expect({ bad, status: invalid.status }).toEqual({ bad, status: 400 })
    }
    // A point the company does not ask is refused, with its list as it is.
    const unknown = await call(evaluate, `${BASE}/mobile/manager/visits/${together.id}/evaluation`, "PUT", { scores: { CHARM: 5, NEEDS: 3 } }, params(together.id))
    expect([unknown.status, unknown.body.code]).toEqual([409, "MTM_VISIT_EVALUATION_QUESTIONS_CHANGED"])
    expect(unknown.body.data.questions.map((question: { id: string }) => question.id))
      .toEqual(["PREPARATION", "RAPPORT", "NEEDS", "PRESENTATION", "OBJECTIONS", "CLOSING"])
    expect(await bypass(() => prisma.mtmVisitEvaluation.count({ where: { visitId: together.id } }))).toBe(0)

    const first = await call(evaluate, `${BASE}/mobile/manager/visits/${together.id}/evaluation`, "PUT", {
      scores: { PREPARATION: 4, RAPPORT: 5, NEEDS: 3 },
      comment: "Good conversation. Ask more before presenting.",
    }, params(together.id))
    expect(first.status).toBe(200)
    expect(first.body.data.evaluation).toMatchObject({ scores: { PREPARATION: 4, RAPPORT: 5, NEEDS: 3 }, average: 4 })

    const second = await call(evaluate, `${BASE}/mobile/manager/visits/${together.id}/evaluation`, "PUT", {
      scores: { PREPARATION: 5, CLOSING: 4 },
      comment: null,
    }, params(together.id))
    expect(second.status).toBe(200)

    const rows = await bypass(() => prisma.mtmVisitEvaluation.findMany({
      where: { organizationId: ORG },
      select: { visitId: true, agentId: true, evaluatorAgentId: true, scores: true, comment: true },
    }))
    expect(rows).toEqual([{ visitId: together.id, agentId: ELVIN, evaluatorAgentId: MANAGER, scores: { PREPARATION: 5, CLOSING: 4 }, comment: null }])

    // The agent cannot rate, not even himself.
    phoneOf(ELVIN, "AGENT")
    const byAgent = await call(evaluate, `${BASE}/mobile/manager/visits/${together.id}/evaluation`, "PUT", { scores: { PREPARATION: 5 } }, params(together.id))
    expect(byAgent.status).toBe(403)
    expect(await bypass(() => prisma.mtmVisitEvaluation.count())).toBe(1)
  })

  it("closes the rating at the end of the day after the visit", async () => {
    const session = (await sessions())[0]
    const old = new Date(Date.now() - 3 * 24 * 60 * 60_000)
    await bypass(async () => {
      await prisma.mtmVisit.create({
        data: { id: "visit-joint-old", organizationId: ORG, agentId: ELVIN, customerId: CUSTOMER, status: "CHECKED_OUT", checkInAt: old, checkOutAt: old },
      })
      await prisma.mtmVisitParticipant.create({
        data: { organizationId: ORG, visitId: "visit-joint-old", agentId: MANAGER, role: "OBSERVER", joinedAt: old, jointSessionId: session.id },
      })
    })
    const late = await call(evaluate, `${BASE}/mobile/manager/visits/visit-joint-old/evaluation`, "PUT", { scores: { PREPARATION: 3 } }, params("visit-joint-old"))
    expect([late.status, late.body.code]).toEqual([409, "MTM_VISIT_EVALUATION_CLOSED"])
    expect(await bypass(() => prisma.mtmVisitEvaluation.count({ where: { visitId: "visit-joint-old" } }))).toBe(0)
  })

  it("shows the rating to the manager in the office and never to the rated agent", async () => {
    const rated = (await bypass(() => prisma.mtmVisitEvaluation.findFirst({ select: { visitId: true } })))!.visitId

    browserOf("user-joint-manager")
    const managerView = await call(review, `${BASE}/visits/${rated}/review`, "GET", undefined, params(rated))
    expect(managerView.status).toBe(200)
    expect(managerView.body.data.visit.jointVisit.manager).toEqual({ id: MANAGER, name: "Team Manager" })
    expect(managerView.body.data.visit.jointVisit.evaluations).toHaveLength(1)
    expect(managerView.body.data.visit.jointVisit.evaluations[0]).toMatchObject({ scores: { PREPARATION: 5, CLOSING: 4 }, average: 4.5 })

    const list = await call(visitList, `${BASE}/visits?range=all`)
    expect(list.status).toBe(200)
    const marked = list.body.data.visits.filter((visit: { joint: boolean }) => visit.joint).map((visit: { id: string }) => visit.id)
    expect(marked).toContain(rated)

    const ratings = await call(agentRatings, `${BASE}/agents/${ELVIN}/evaluations`, "GET", undefined, params(ELVIN))
    expect(ratings.status).toBe(200)
    expect(ratings.body.data).toMatchObject({ evaluated: 1, average: 4.5 })
    expect(ratings.body.data.recent[0]).toMatchObject({ visitId: rated, average: 4.5, evaluator: { id: MANAGER } })

    browserOf("user-joint-elvin")
    const agentView = await call(review, `${BASE}/visits/${rated}/review`, "GET", undefined, params(rated))
    expect(agentView.status).toBe(200)
    expect(agentView.body.data.visit.jointVisit.evaluations).toEqual([])
    expect(JSON.stringify(agentView.body)).not.toContain("Ask more before presenting")
    const ownRatings = await call(agentRatings, `${BASE}/agents/${ELVIN}/evaluations`, "GET", undefined, params(ELVIN))
    expect([ownRatings.status, ownRatings.body.code]).toEqual([403, "MTM_VISIT_EVALUATIONS_FORBIDDEN"])

    phoneOf(ELVIN, "AGENT")
    const fromPhone = await call(agentRatings, `${BASE}/agents/${ELVIN}/evaluations`, "GET", undefined, params(ELVIN))
    expect(fromPhone.status).toBe(403)
    const agentJointView = await call(agentJoint, `${BASE}/mobile/joint-visit`)
    expect(JSON.stringify(agentJointView.body)).not.toMatch(/scores|PREPARATION|evaluation/)
  })

  it("ends the session: the agent is no longer asked, and a later «yes» writes nothing", async () => {
    const ended = await call(endJoint, `${BASE}/mobile/manager/joint-visit/end`, "POST")
    expect(ended.status).toBe(200)
    expect(ended.body.data.session).toBeNull()
    expect((await sessions()).every((row) => row.endedAt !== null)).toBe(true)

    phoneOf(ELVIN, "AGENT")
    const asked = await call(agentJoint, `${BASE}/mobile/joint-visit`)
    expect(asked.body.data.managers).toEqual([])

    // Clock slack: a check-in queued just before the end still counts; one
    // well after it does not.
    const after = await checkIn(ELVIN, { jointManagerId: MANAGER, checkInAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    expect(after.op.serverData.joint).toEqual({ managerId: MANAGER, accepted: false })
    expect(await bypass(() => prisma.mtmVisitParticipant.count({ where: { visitId: after.id } }))).toBe(0)
  })

  it("starting with another agent closes the session with the first", async () => {
    phoneOf(MANAGER, "SUPERVISOR")
    await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId: ELVIN })
    const switched = await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId: AYSEL })
    expect(switched.status).toBe(201)
    expect(switched.body.data.session.agent.id).toBe(AYSEL)
    const open = (await sessions()).filter((row) => row.endedAt === null)
    expect(open.map((row) => row.agentId)).toEqual([AYSEL])
    // Each new session tells its agent; nobody else is written to.
    const told = await bypass(() => prisma.mtmNotification.findMany({ where: { organizationId: ORG }, select: { agentId: true } }))
    expect(told.map((row: { agentId: string }) => row.agentId).sort()).toEqual([AYSEL, ELVIN, ELVIN].sort())
  })

  // ── Planned joint visits (owner, 2026-10-30) ───────────────────────────

  /** The organization's today, as the server reckons it. */
  async function today(): Promise<string> {
    phoneOf(MANAGER, "SUPERVISOR")
    const state = await call(joint.GET, `${BASE}/mobile/manager/joint-visit`)
    return state.body.data.today as string
  }

  async function routeRow() {
    return bypass(() => prisma.mtmRoute.findUniqueOrThrow({
      where: { id: ROUTE },
      select: { version: true, publishedVersion: true, totalPoints: true, points: { select: { id: true, customerId: true, deletedAt: true }, orderBy: { orderIndex: "asc" } } },
    }))
  }

  async function livePlans() {
    return bypass(() => prisma.mtmJointVisitPlan.findMany({
      where: { organizationId: ORG, cancelledAt: null },
      // One save writes its plans in one transaction, with one timestamp.
      orderBy: [{ createdAt: "asc" }, { source: "asc" }],
      select: { id: true, managerAgentId: true, agentId: true, routePointId: true, customerId: true, source: true, visitId: true },
    }))
  }

  it("plans a stop of the agent's route and an extra client, and tells the agent where", async () => {
    const day = await today()
    await bypass(async () => {
      await prisma.mtmRoute.create({
        data: {
          id: ROUTE,
          organizationId: ORG,
          agentId: ELVIN,
          date: new Date(`${day}T00:00:00.000Z`),
          status: "IN_PROGRESS",
          startedAt: new Date(),
          version: 1,
          publishedVersion: 1,
          totalPoints: 1,
          points: { create: { id: STOP, organizationId: ORG, customerId: CUSTOMER, orderIndex: 0 } },
        },
      })
    })
    await bypass(() => prisma.mtmNotification.deleteMany({ where: { organizationId: ORG } }))

    phoneOf(MANAGER, "SUPERVISOR")
    const before = await call(plans.GET, `${BASE}/mobile/manager/joint-visit/plans?agentId=${ELVIN}&date=${day}`)
    expect(before.status).toBe(200)
    expect(before.body.data.route.stops.map((stop: Record<string, unknown>) => [stop.id, stop.canJoin, stop.myPlanId]))
      .toEqual([[STOP, true, null]])

    const saved = await call(plans.POST, `${BASE}/mobile/manager/joint-visit/plans`, "POST", {
      agentId: ELVIN,
      date: day,
      routePointIds: [STOP],
      extras: [{ customerId: EXTRA_CLIENT }],
    })
    expect(saved.status).toBe(201)
    expect(saved.body.data.created).toHaveLength(2)

    // The extra client is on Elvin's route now, and the route moved on so his phone hears of it.
    const route = await routeRow()
    expect(route).toMatchObject({ version: 2, publishedVersion: 2, totalPoints: 2 })
    expect(route.points.map((point: { customerId: string }) => point.customerId)).toEqual([CUSTOMER, EXTRA_CLIENT])
    const extraStop = route.points[1].id

    expect((await livePlans()).map((plan: Record<string, unknown>) => [plan.managerAgentId, plan.agentId, plan.routePointId, plan.source]))
      .toEqual([[MANAGER, ELVIN, STOP, "ROUTE"], [MANAGER, ELVIN, extraStop, "EXTRA"]])

    // The manager's screen lists where they go together.
    expect(saved.body.data.plans.map((plan: Record<string, unknown>) => [plan.date, (plan.customer as { name: string }).name, plan.stopStatus]))
      .toEqual([[day, "Central Clinic", "PENDING"], [day, "Extra Pharmacy", "PENDING"]])

    // Elvin is told once: the bell names the clients, the day and the manager.
    const notices = await bypass(() => prisma.mtmNotification.findMany({ where: { organizationId: ORG }, select: { agentId: true, title: true, body: true, metadata: true } }))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ agentId: ELVIN, title: "Team Manager bu gün sizinlə birgə vizitə gedəcək" })
    expect(notices[0].body).toContain("Central Clinic, Extra Pharmacy")
    expect(notices[0].metadata).toMatchObject({ event: "joint_visit_planned", date: day, managerAgentId: MANAGER })

    // His phone learns which stops; Aysel's learns nothing.
    phoneOf(ELVIN, "AGENT")
    const elvin = await call(agentJoint, `${BASE}/mobile/joint-visit`)
    expect(elvin.body.data.plans.map((plan: Record<string, unknown>) => [plan.routePointId, (plan.manager as { id: string }).id]))
      .toEqual([[STOP, MANAGER], [extraStop, MANAGER]])
    phoneOf(AYSEL, "AGENT")
    expect((await call(agentJoint, `${BASE}/mobile/joint-visit`)).body.data.plans).toEqual([])

    // Planned again: nothing new, nobody told twice.
    phoneOf(MANAGER, "SUPERVISOR")
    const again = await call(plans.POST, `${BASE}/mobile/manager/joint-visit/plans`, "POST", { agentId: ELVIN, date: day, routePointIds: [STOP, extraStop] })
    expect(again.status).toBe(200)
    expect(again.body.data.created).toEqual([])
    expect(await livePlans()).toHaveLength(2)
    expect(await bypass(() => prisma.mtmNotification.count({ where: { organizationId: ORG } }))).toBe(1)
  })

  it("refuses an agent outside the team, a client that is not the agent's, and a day out of reach — writing nothing", async () => {
    const day = await today()
    const before = await routeRow()
    const cases: Array<[unknown, number, string]> = [
      [{ agentId: OTHER_TEAM, date: day, extras: [{ customerId: NOT_HIS }] }, 403, "MTM_JOINT_VISIT_AGENT_FORBIDDEN"],
      [{ agentId: ELVIN, date: day, extras: [{ customerId: NOT_HIS }] }, 409, "MTM_JOINT_PLAN_CLIENT_UNAVAILABLE"],
      [{ agentId: ELVIN, date: day, routePointIds: ["no-such-stop"] }, 409, "MTM_JOINT_PLAN_STOP_UNAVAILABLE"],
      [{ agentId: ELVIN, date: "2020-01-01", routePointIds: [STOP] }, 400, "MTM_JOINT_PLAN_DAY_INVALID"],
      [{ agentId: ELVIN, date: day }, 400, "MTM_JOINT_PLAN_INVALID"],
    ]
    for (const [body, status, code] of cases) {
      const refused = await call(plans.POST, `${BASE}/mobile/manager/joint-visit/plans`, "POST", body)
      expect({ body, status: refused.status, code: refused.body.code }).toEqual({ body, status, code })
    }
    phoneOf(ELVIN, "AGENT")
    const byAgent = await call(plans.POST, `${BASE}/mobile/manager/joint-visit/plans`, "POST", { agentId: AYSEL, date: day, extras: [{ customerId: CUSTOMER }] })
    expect(byAgent.status).toBe(403)

    expect(await routeRow()).toEqual(before)
    expect(await livePlans()).toHaveLength(2)
  })

  it("makes the visit at a planned stop joint on the agent's «yes», with no session open", async () => {
    phoneOf(MANAGER, "SUPERVISOR")
    await call(endJoint, `${BASE}/mobile/manager/joint-visit/end`, "POST")
    expect((await sessions()).filter((row) => row.endedAt === null)).toEqual([])

    const visit = await checkIn(ELVIN, { routeId: ROUTE, routePointId: STOP, jointManagerId: MANAGER })
    expect(visit.op.status).toBe("ok")
    expect(visit.op.serverData.joint).toEqual({ managerId: MANAGER, accepted: true })

    const participant = await bypass(() => prisma.mtmVisitParticipant.findFirstOrThrow({
      where: { visitId: visit.id },
      select: { agentId: true, role: true, jointSession: { select: { managerAgentId: true, agentId: true, endedAt: true } } },
    }))
    // Backed by the planned day: a closed session, never the manager's open one.
    expect(participant).toMatchObject({ agentId: MANAGER, role: "OBSERVER", jointSession: { managerAgentId: MANAGER, agentId: ELVIN } })
    expect(participant.jointSession!.endedAt).not.toBeNull()
    expect((await livePlans()).find((plan: { routePointId: string | null }) => plan.routePointId === STOP)!.visitId).toBe(visit.id)

    // The manager sees it as done together, and may rate it.
    phoneOf(MANAGER, "SUPERVISOR")
    const state = await call(joint.GET, `${BASE}/mobile/manager/joint-visit`)
    expect(state.body.data.session).toBeNull()
    const planned = state.body.data.plans.find((plan: { routePointId: string }) => plan.routePointId === STOP)
    expect(planned.visit).toMatchObject({ id: visit.id, joint: true })
    expect(state.body.data.visits.find((row: { id: string }) => row.id === visit.id)).toMatchObject({ joint: true, canEvaluate: true })
    const rated = await call(evaluate, `${BASE}/mobile/manager/visits/${visit.id}/evaluation`, "PUT", { scores: { NEEDS: 4 } }, params(visit.id))
    expect(rated.status).toBe(200)

    // Elvin's own view still holds no rating.
    phoneOf(ELVIN, "AGENT")
    expect(JSON.stringify((await call(agentJoint, `${BASE}/mobile/joint-visit`)).body)).not.toMatch(/scores|NEEDS|evaluation/)
  })

  it("takes back a planned visit: the extra client leaves the route, a visit made stays", async () => {
    const day = await today()
    await bypass(() => prisma.mtmNotification.deleteMany({ where: { organizationId: ORG } }))
    const [made, extra] = await livePlans()

    phoneOf(MANAGER, "SUPERVISOR")
    const tooLate = await call(cancelPlan, `${BASE}/mobile/manager/joint-visit/plans/${made.id}`, "DELETE", undefined, params(made.id))
    expect([tooLate.status, tooLate.body.code]).toEqual([409, "MTM_JOINT_PLAN_ALREADY_VISITED"])

    phoneOf(ELVIN, "AGENT")
    const byAgent = await call(cancelPlan, `${BASE}/mobile/manager/joint-visit/plans/${extra.id}`, "DELETE", undefined, params(extra.id))
    expect(byAgent.status).toBe(403)

    phoneOf(MANAGER, "SUPERVISOR")
    const before = await routeRow()
    const cancelled = await call(cancelPlan, `${BASE}/mobile/manager/joint-visit/plans/${extra.id}`, "DELETE", undefined, params(extra.id))
    expect(cancelled.status).toBe(200)
    expect((await livePlans()).map((plan: { id: string }) => plan.id)).toEqual([made.id])
    const route = await routeRow()
    expect(route).toMatchObject({ version: before.version + 1, publishedVersion: before.version + 1, totalPoints: 1 })
    expect(route.points.find((point: { id: string }) => point.id === extra.routePointId)!.deletedAt).not.toBeNull()

    const notices = await bypass(() => prisma.mtmNotification.findMany({ where: { organizationId: ORG }, select: { agentId: true, title: true, metadata: true } }))
    expect(notices).toEqual([{
      agentId: ELVIN,
      title: "Team Manager bu gün birgə viziti ləğv etdi",
      metadata: { domain: "route", event: "joint_visit_cancelled", date: day, jointVisitPlanIds: [extra.id], managerAgentId: MANAGER },
    }])

    const again = await call(cancelPlan, `${BASE}/mobile/manager/joint-visit/plans/${extra.id}`, "DELETE", undefined, params(extra.id))
    expect(again.status).toBe(404)
  })

  it("an extra client on a day the agent has no route starts a published route, and taking it back removes it", async () => {
    // Live check 2026-10-30: the route this created was a draft, and the agent's
    // phone said «waiting for approval» — he could not start the joint visit.
    const base = Date.parse(`${await today()}T00:00:00.000Z`)
    const shift = (days: number) => new Date(base + days * 86_400_000).toISOString().slice(0, 10)
    const day = shift(1)

    phoneOf(MANAGER, "SUPERVISOR")
    const saved = await call(plans.POST, `${BASE}/mobile/manager/joint-visit/plans`, "POST", { agentId: AYSEL, date: day, extras: [{ customerId: CUSTOMER }] })
    expect(saved.status).toBe(201)
    const routes = () => bypass(() => prisma.mtmRoute.findMany({
      where: { organizationId: ORG, agentId: AYSEL },
      select: { id: true, status: true, version: true, publishedVersion: true, publishedAt: true, deletedAt: true, totalPoints: true,
        assignments: { select: { agentId: true, role: true } } },
    }))
    const [route] = await routes()
    expect(route).toMatchObject({ status: "PLANNED", totalPoints: 1, deletedAt: null, assignments: [{ agentId: AYSEL, role: "PRIMARY" }] })
    expect(route.publishedVersion).toBe(route.version)
    expect(route.publishedAt).not.toBeNull()

    const [plan] = (await livePlans()).filter((row: { agentId: string }) => row.agentId === AYSEL)
    const cancelled = await call(cancelPlan, `${BASE}/mobile/manager/joint-visit/plans/${plan.id}`, "DELETE", undefined, params(plan.id))
    expect(cancelled.status).toBe(200)
    expect((await routes())[0].deletedAt).not.toBeNull()

    // A route Aysel was put on by someone else is hers to plan on too — her app reads it so.
    const later = shift(2)
    await bypass(() => prisma.mtmRoute.create({
      data: {
        id: "route-joint-elvin-with-aysel",
        organizationId: ORG,
        agentId: ELVIN,
        date: new Date(`${later}T00:00:00.000Z`),
        status: "PLANNED",
        publishedVersion: 1,
        totalPoints: 1,
        assignments: { create: { organizationId: ORG, agentId: AYSEL, role: "PARTICIPANT" } },
        points: { create: { id: "point-joint-shared", organizationId: ORG, customerId: CUSTOMER, orderIndex: 0 } },
      },
    }))
    const shared = await call(plans.GET, `${BASE}/mobile/manager/joint-visit/plans?agentId=${AYSEL}&date=${later}`)
    expect(shared.body.data.route.stops.map((stop: { id: string }) => stop.id)).toEqual(["point-joint-shared"])
  })

  type Question = { id: string; labels: { az: string; ru: string; en: string } }
  const ids = (questions: Question[]) => questions.map((question) => question.id)
  const original = (id: string) => MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS.find((question) => question.id === id)!
  const SAMPLES = "q-samples"

  async function storedQuestions(visitId: string): Promise<unknown> {
    return (await bypass(() => prisma.mtmVisitEvaluation.findFirst({ where: { visitId }, select: { questions: true } })))?.questions
  }

  async function reviewOf(visitId: string) {
    browserOf("user-joint-manager")
    const view = await call(review, `${BASE}/visits/${visitId}/review`, "GET", undefined, params(visitId))
    expect(view.status).toBe(200)
    return view.body.data.visit.jointVisit.evaluations[0] as { questions: Question[]; scores: Record<string, number>; average: number | null }
  }

  async function saveQuestions(questions: unknown) {
    browserOf("user-joint-manager", "admin")
    return call(settingsRoute.PUT, `${BASE}/settings`, "PUT", { visitEvaluationQuestions: questions })
  }

  it("rates by the company's own list, and every rating keeps the questions it was given against", async () => {
    // The rating given above was given against the six everybody had, and says so.
    const earlier = (await bypass(() => prisma.mtmVisitEvaluation.findFirst({ where: { organizationId: ORG }, select: { visitId: true } })))!.visitId
    expect(ids(await storedQuestions(earlier) as Question[])).toEqual(ORIGINAL_IDS)

    phoneOf(MANAGER, "SUPERVISOR")
    expect((await call(joint.POST, `${BASE}/mobile/manager/joint-visit`, "POST", { agentId: ELVIN })).status).toBe(201)
    // A rating from before the lists: no list of its own, and a score for a
    // question the company is about to delete.
    const legacy = await checkIn(ELVIN, { jointManagerId: MANAGER, checkInAt: new Date(Date.now() - 60_000).toISOString() })
    expect(legacy.op.serverData.joint).toEqual({ managerId: MANAGER, accepted: true })
    await bypass(() => prisma.mtmVisitEvaluation.create({
      data: { organizationId: ORG, visitId: legacy.id, agentId: ELVIN, evaluatorAgentId: MANAGER, scores: { OBJECTIONS: 3, PREPARATION: 2 } },
    }))
    const fresh = await checkIn(ELVIN, { jointManagerId: MANAGER })

    // A list that does not read is refused and changes nothing.
    for (const bad of [[], [{ id: "A", labels: { ru: "x" } }, { id: "A", labels: { ru: "y" } }], [{ id: "B", labels: { ru: "" } }], [{ id: "C", labels: { ru: "x".repeat(81) } }]]) {
      const refused = await saveQuestions(bad)
      expect({ bad, status: refused.status, code: refused.body.code }).toEqual({ bad, status: 400, code: "MTM_VISIT_EVALUATION_QUESTIONS_INVALID" })
    }
    expect(await bypass(() => prisma.mtmSetting.count({ where: { organizationId: ORG, key: "visitEvaluationQuestions" } }))).toBe(0)

    // The company renames the first question, deletes OBJECTIONS and adds one,
    // written in Russian only.
    const renamed = { id: "PREPARATION", labels: { az: "Hazırlıq və materiallar", ru: "Подготовка: план визита и материалы", en: "Preparation and materials" } }
    const v2 = [renamed, original("RAPPORT"), original("NEEDS"), original("PRESENTATION"), original("CLOSING"), { id: SAMPLES, labels: { az: "", ru: "Работа с образцами", en: "" } }]
    expect((await saveQuestions(v2)).status).toBe(200)
    const samples = { id: SAMPLES, labels: { az: "Работа с образцами", ru: "Работа с образцами", en: "Работа с образцами" } }
    const v2Stored = [...v2.slice(0, 5), samples]
    const settings = await call(settingsRoute.GET, `${BASE}/settings`)
    expect(settings.body.data.visitEvaluationQuestions).toEqual(v2Stored)

    // The manager's phone asks that list, in that order.
    phoneOf(MANAGER, "SUPERVISOR")
    const state = await call(joint.GET, `${BASE}/mobile/manager/joint-visit`)
    expect(state.body.data.questions).toEqual(v2Stored)
    expect(state.body.data.criteria).toEqual(ids(v2Stored))
    type Listed = { id: string; evaluation: { questions: Question[]; scores: Record<string, number>; average: number | null } }
    const listed = new Map<string, Listed>(state.body.data.visits.map((visit: Listed) => [visit.id, visit]))
    // …and shows the old rating by the questions it was given against.
    expect(ids(listed.get(legacy.id)!.evaluation.questions)).toEqual(ORIGINAL_IDS)
    expect(listed.get(legacy.id)!.evaluation).toMatchObject({ scores: { OBJECTIONS: 3, PREPARATION: 2 }, average: 2.5 })

    // A deleted question is refused for a new rating, and nothing is written.
    const deleted = await call(evaluate, `${BASE}/mobile/manager/visits/${fresh.id}/evaluation`, "PUT", { scores: { OBJECTIONS: 4, RAPPORT: 5 } }, params(fresh.id))
    expect([deleted.status, deleted.body.code]).toEqual([409, "MTM_VISIT_EVALUATION_QUESTIONS_CHANGED"])
    expect(deleted.body.data.questions).toEqual(v2Stored)
    expect(await bypass(() => prisma.mtmVisitEvaluation.count({ where: { visitId: fresh.id } }))).toBe(0)

    const rated = await call(evaluate, `${BASE}/mobile/manager/visits/${fresh.id}/evaluation`, "PUT", { scores: { [SAMPLES]: 4, PREPARATION: 5 } }, params(fresh.id))
    expect(rated.status).toBe(200)
    expect(rated.body.data.evaluation).toMatchObject({ scores: { [SAMPLES]: 4, PREPARATION: 5 }, average: 4.5, questions: v2Stored })
    expect(await storedQuestions(fresh.id)).toEqual(v2Stored)

    // The list changes again: the new question renamed, PREPARATION deleted.
    const v3 = [original("RAPPORT"), original("NEEDS"), original("PRESENTATION"), original("CLOSING"), { id: SAMPLES, labels: { az: "Nümunələr", ru: "Образцы и памятки", en: "Samples" } }]
    expect((await saveQuestions(v3)).status).toBe(200)

    // No rating moved: each is read off its own list, in its own words.
    expect(await storedQuestions(fresh.id)).toEqual(v2Stored)
    const freshView = await reviewOf(fresh.id)
    expect(freshView).toMatchObject({ questions: v2Stored, scores: { [SAMPLES]: 4, PREPARATION: 5 }, average: 4.5 })
    const legacyView = await reviewOf(legacy.id)
    expect(legacyView.questions).toEqual(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)
    expect(legacyView.questions[0].labels.ru).toBe("Подготовка к визиту")
    expect(legacyView).toMatchObject({ scores: { OBJECTIONS: 3, PREPARATION: 2 }, average: 2.5 })
    expect((await reviewOf(earlier)).questions).toEqual(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)

    // The agent's page: today's questions in today's words, then the deleted
    // ones still rated in the period, in the words of their latest rating.
    browserOf("user-joint-manager")
    const ratings = await call(agentRatings, `${BASE}/agents/${ELVIN}/evaluations`, "GET", undefined, params(ELVIN))
    expect(ratings.status).toBe(200)
    const lines = ratings.body.data.criteria as Array<{ key: string; labels: Question["labels"]; asked: boolean; count: number; average: number | null }>
    expect(lines.map((line) => [line.key, line.asked])).toEqual([
      ["RAPPORT", true], ["NEEDS", true], ["PRESENTATION", true], ["CLOSING", true], [SAMPLES, true],
      ["PREPARATION", false], ["OBJECTIONS", false],
    ])
    const line = (key: string) => lines.find((candidate) => candidate.key === key)!
    expect(line(SAMPLES)).toMatchObject({ labels: v3[4].labels, count: 1, average: 4 })
    expect(line("PREPARATION")).toMatchObject({ labels: renamed.labels, count: 3, average: 4 })
    expect(line("OBJECTIONS")).toMatchObject({ labels: original("OBJECTIONS").labels, count: 1, average: 3 })
  })

  it("keeps one company's questions out of another's", async () => {
    // The other company never edited its list: it sees the six, not this one's.
    browserOf("user-abroad", "admin", OTHER_ORG)
    const theirs = await call(settingsRoute.GET, `${BASE}/settings`)
    expect(ids(theirs.body.data.visitEvaluationQuestions)).toEqual(ORIGINAL_IDS)

    const now = new Date()
    await bypass(async () => {
      await prisma.mtmAgent.create({ data: { id: ABROAD_MANAGER, organizationId: OTHER_ORG, name: "Abroad Manager", role: "SUPERVISOR", teamId: "team-joint-abroad" } })
      await prisma.mtmCustomer.create({ data: { id: "customer-joint-abroad", organizationId: OTHER_ORG, name: "Abroad Clinic", ...CUSTOMER_AT } })
      const session = await prisma.mtmJointFieldSession.create({ data: { organizationId: OTHER_ORG, managerAgentId: ABROAD_MANAGER, agentId: OTHER_COMPANY, startedAt: now } })
      await prisma.mtmVisit.create({
        data: { id: "visit-joint-abroad", organizationId: OTHER_ORG, agentId: OTHER_COMPANY, customerId: "customer-joint-abroad", status: "CHECKED_OUT", checkInAt: now, checkOutAt: now },
      })
      await prisma.mtmVisitParticipant.create({
        data: { organizationId: OTHER_ORG, visitId: "visit-joint-abroad", agentId: ABROAD_MANAGER, role: "OBSERVER", joinedAt: now, jointSessionId: session.id },
      })
    })
    browser.current = null
    caller.current = {
      orgId: OTHER_ORG,
      agentId: ABROAD_MANAGER,
      userId: "",
      role: "SUPERVISOR",
      email: "abroad@example.test",
      name: "Abroad Manager",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
    const state = await call(joint.GET, `${BASE}/mobile/manager/joint-visit`)
    expect(state.status).toBe(200)
    expect(ids(state.body.data.questions)).toEqual(ORIGINAL_IDS)
    expect(JSON.stringify(state.body)).not.toMatch(/q-samples|образцами|Образцы/)

    const foreign = await call(evaluate, `${BASE}/mobile/manager/visits/visit-joint-abroad/evaluation`, "PUT", { scores: { [SAMPLES]: 4 } }, params("visit-joint-abroad"))
    expect([foreign.status, foreign.body.code]).toEqual([409, "MTM_VISIT_EVALUATION_QUESTIONS_CHANGED"])
    expect(ids(foreign.body.data.questions)).toEqual(ORIGINAL_IDS)

    const own = await call(evaluate, `${BASE}/mobile/manager/visits/visit-joint-abroad/evaluation`, "PUT", { scores: { OBJECTIONS: 4 } }, params("visit-joint-abroad"))
    expect(own.status).toBe(200)
    expect(ids(await storedQuestions("visit-joint-abroad") as Question[])).toEqual(ORIGINAL_IDS)
  })
})
