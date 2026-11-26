/**
 * An agent plans and goes on his own, and his manager reads what he did (owner,
 * 2026-11-23: «пусть все без подтверждения менеджера могли маршрут создавать и
 * даже если вне очереди идут куда то… НО чтоб менеджеру приходило уведомление
 * детальное»).
 *
 * Read off the tables after the real handlers ran on a real Postgres: who was
 * told, in which language, with which clients, and that a resend, a refused
 * publish, the next stop of the route and an old offline visit tell nobody.
 *
 * Set MTM_AGENT_ACTIVITY_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   MTM_AGENT_ACTIVITY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy, where `MTM_AGENT_ACTIVITY_DB_GATE=required` makes a missing URL a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_AGENT_ACTIVITY_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_AGENT_ACTIVITY_DB_GATE === "required") {
  throw new Error("MTM_AGENT_ACTIVITY_TEST_DATABASE_URL is required by the MTM agent activity database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_AGENT_ACTIVITY_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_agent_activity_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const caller = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => caller.current)
  mock.getMobileAuth.mockImplementation(() => caller.current)
  return mock
})
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
  getTenantCapabilityAccess: async () => ({ allowed: true }),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-agent-activity"
const BASE = "http://localhost:3000/api/v1/mtm/mobile"

const BOSS = "cagentactivityboss0001"
const MID = "cagentactivitymid00001"
const FREE_AGENT = "cagentactivityfree0001"
const WALKER = "cagentactivitywalk0001"
const GATED_AGENT = "cagentactivitygate0001"
const CLINIC_A = "cagentactivityclinica1"
const CLINIC_B = "cagentactivityclinicb1"
const CLINIC_C = "cagentactivityclinicc1"
const CLINIC_D = "cagentactivityclinicd1"
const AT = { latitude: 40.4093, longitude: 49.8671 }

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-agent-activity-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

function bakuDay(offset = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const day = new Date(`${today}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + offset)
  return day.toISOString().slice(0, 10)
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("what a manager reads about his agent, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let routeCommand!: typeof import("@/app/api/v1/mtm/mobile/route-commands/route").POST
  let syncPush!: typeof import("@/app/api/v1/mtm/mobile/sync/push/route").POST
  let bell!: typeof import("@/app/api/v1/mtm/mobile/notifications/route").GET
  let drain!: typeof import("@/lib/mtm/route-notification-outbox").drainMtmRouteNotificationOutbox
  let routeId = ""
  let routeVersion = 0
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE);`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    routeCommand = (await import("@/app/api/v1/mtm/mobile/route-commands/route")).POST
    syncPush = (await import("@/app/api/v1/mtm/mobile/sync/push/route")).POST
    bell = (await import("@/app/api/v1/mtm/mobile/notifications/route")).GET
    drain = (await import("@/lib/mtm/route-notification-outbox")).drainMtmRouteNotificationOutbox

    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: ORG, slug: ORG, modules: { mtm: true, "route-field": true } } })
      await prisma.mtmAgent.create({ data: { id: BOSS, organizationId: ORG, name: "Saida", role: "MANAGER", phone: "+994500000001", appLanguage: "ru" } })
      // A manager whose card has no way in: the notice must also reach the one above.
      await prisma.mtmAgent.create({ data: { id: MID, organizationId: ORG, name: "Elvin", role: "MANAGER", managerId: BOSS } })
      await prisma.mtmAgent.createMany({
        data: [
          { id: FREE_AGENT, organizationId: ORG, name: "Aqil", managerId: MID, canSelfPublishRoutes: true },
          { id: WALKER, organizationId: ORG, name: "Kənan", managerId: BOSS, canSelfPublishRoutes: true },
          { id: GATED_AGENT, organizationId: ORG, name: "Qurban", managerId: BOSS, canSelfPublishRoutes: false },
        ],
      })
      const clinics: Array<[string, string, string]> = [
        [CLINIC_A, "Clinic Alpha", "Nizami 1"],
        [CLINIC_B, "Clinic Beta", "Nizami 2"],
        [CLINIC_C, "Clinic Gamma", "Nizami 3"],
        [CLINIC_D, "Clinic Delta", "Nizami 4"],
      ]
      for (const [id, name, address] of clinics) {
        await prisma.mtmCustomer.create({ data: { id, organizationId: ORG, name, address, ...AT, geofenceRadius: 300 } })
        for (const agentId of [FREE_AGENT, WALKER, GATED_AGENT]) {
          await prisma.mtmCustomerAgentAssignment.create({
            data: { organizationId: ORG, customerId: id, agentId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
          })
        }
      }
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  function phoneOf(agentId: string, role = "AGENT") {
    caller.current = {
      orgId: ORG,
      agentId,
      userId: "",
      role,
      email: `${agentId}@example.test`,
      name: agentId,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    }
  }

  async function call(handler: (req: NextRequest, ctx?: never) => Promise<Response>, url: string, method: string, body?: unknown) {
    const response = await (handler as (req: NextRequest, ctx?: unknown) => Promise<Response>)(new NextRequest(url, {
      method,
      headers: { Authorization: "Bearer mobile", "content-type": "application/json", "x-field-device-id": "rf-device-activity" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the handler's JSON, read field by field below
    return { status: response.status, body: await response.json() as Record<string, any> }
  }

  const command = (body: unknown) => call(routeCommand, `${BASE}/route-commands`, "POST", body)

  /** The manager notices queued so far, oldest first. */
  async function queued() {
    const rows = await bypass(() => prisma.mtmRouteNotificationOutbox.findMany({
      where: { organizationId: ORG },
      orderBy: { createdAt: "asc" },
      select: { agentId: true, title: true, body: true, metadata: true },
    }))
    return rows.filter((row) => String((row.metadata as Record<string, unknown>)?.event ?? "").startsWith("agent_"))
  }

  async function checkIn(agentId: string, customerId: string, extra: Record<string, unknown> = {}) {
    phoneOf(agentId)
    const id = `cagentactivityvisit${String(++sequence).padStart(3, "0")}`
    const result = await call(syncPush, `${BASE}/sync/push`, "POST", {
      operations: [{
        operationId: `op-activity-${sequence}`,
        entity: "visits",
        op: "create",
        clientTimestamp: Date.now(),
        data: {
          id,
          customerId,
          status: "CHECKED_IN",
          checkInAt: new Date().toISOString(),
          checkInLat: AT.latitude,
          checkInLng: AT.longitude,
          ...extra,
        },
      }],
    })
    expect(result.status).toBe(200)
    expect(result.body.results[0]).toMatchObject({ status: "ok" })
    // One open visit per agent is the server's rule.
    await bypass(() => prisma.mtmVisit.updateMany({ where: { id }, data: { status: "CHECKED_OUT", checkOutAt: new Date() } }))
    return id
  }

  it("tells the manager, and the one above a manager who cannot sign in, which clients the new route has", async () => {
    phoneOf(FREE_AGENT)
    const draft = await command({
      operationId: "activity-route-create",
      command: "CREATE_DRAFT",
      payload: { date: bakuDay(1), points: [{ customerId: CLINIC_A }, { customerId: CLINIC_B }] },
    })
    expect(draft.status).toBe(201)
    routeId = draft.body.data.id
    routeVersion = draft.body.data.version
    // A draft is the agent still thinking.
    expect(await queued()).toEqual([])

    const publishBody = {
      operationId: "activity-route-publish",
      command: "PUBLISH",
      routeId,
      payload: { expectedVersion: routeVersion },
    }
    const published = await command(publishBody)
    expect(published.status).toBe(200)
    routeVersion = published.body.data.version

    const rows = await queued()
    expect(rows.map((row) => row.agentId).sort()).toEqual([BOSS, MID].sort())
    const forMid = rows.find((row) => row.agentId === MID)!
    const forBoss = rows.find((row) => row.agentId === BOSS)!
    expect(forMid.title).toMatch(/^Aqil: .* üçün yeni marşrut$/)
    expect(forMid.body).toBe("2 vizit: Clinic Alpha; Clinic Beta")
    expect(forBoss.title).toMatch(/^Aqil: новый маршрут на /)
    expect(forBoss.body).toBe("2 визита: Clinic Alpha; Clinic Beta")

    // The push never names a client: it can light up a locked phone.
    const meta = forBoss.metadata as Record<string, unknown>
    expect(meta.pushBody).toBe("2 визита. Список в приложении.")

    // A resend of the same command is the same event.
    const again = await command(publishBody)
    expect(again.status).toBe(200)
    expect(await queued()).toHaveLength(2)
  })

  it("says what changed when the agent edits a published route", async () => {
    phoneOf(FREE_AGENT)
    const changed = await command({
      operationId: "activity-route-change",
      command: "UPDATE_PUBLISHED",
      routeId,
      payload: { expectedVersion: routeVersion, points: [{ customerId: CLINIC_A }, { customerId: CLINIC_C }] },
    })
    expect(changed.status).toBe(200)

    const rows = (await queued()).filter((row) => (row.metadata as Record<string, unknown>).event === "agent_route_updated")
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.agentId === MID)!.body)
      .toBe("İndi 2 vizit. Əlavə: Clinic Gamma. Çıxarılıb: Clinic Beta.")
  })

  it("tells nobody of a publish the server refused", async () => {
    const before = (await queued()).length
    phoneOf(GATED_AGENT)
    const draft = await command({
      operationId: "activity-gated-create",
      command: "CREATE_DRAFT",
      payload: { date: bakuDay(2), points: [{ customerId: CLINIC_A }] },
    })
    expect(draft.status).toBe(201)
    const refused = await command({
      operationId: "activity-gated-publish",
      command: "PUBLISH",
      routeId: draft.body.data.id,
      payload: { expectedVersion: draft.body.data.version },
    })
    expect(refused.status).toBe(403)
    expect(await queued()).toHaveLength(before)
  })

  it("tells the manager where the agent went off the route", async () => {
    const before = (await queued()).length
    const visitId = await checkIn(WALKER, CLINIC_D)
    const rows = (await queued()).slice(before)
    expect(rows).toHaveLength(1)
    expect(rows[0].agentId).toBe(BOSS)
    expect(rows[0].title).toBe("Kənan: визит вне маршрута")
    expect(rows[0].body).toMatch(/^Clinic Delta · Nizami 4 · \d{2}:\d{2}$/)
    const meta = rows[0].metadata as Record<string, unknown>
    expect(meta).toMatchObject({ domain: "route", event: "agent_visit_off_route", activityVisitId: visitId, subjectAgentId: WALKER })
    expect(String(meta.pushBody)).not.toContain("Clinic")
    // The app reads these keys as the reader's own route, visit or zone alert.
    for (const key of ["routeId", "visitId", "customerId", "distanceMeters", "requestId", "taskId"]) {
      expect(meta).not.toHaveProperty(key)
    }
  })

  it("is quiet on the next stop and speaks when the agent jumps the queue", async () => {
    const route = await bypass(() => prisma.mtmRoute.create({
      data: {
        organizationId: ORG,
        agentId: WALKER,
        date: new Date(`${bakuDay()}T00:00:00.000Z`),
        status: "IN_PROGRESS",
        totalPoints: 3,
        points: {
          create: [
            { organizationId: ORG, customerId: CLINIC_A, orderIndex: 0 },
            { organizationId: ORG, customerId: CLINIC_B, orderIndex: 1 },
            { organizationId: ORG, customerId: CLINIC_C, orderIndex: 2 },
          ],
        },
      },
      include: { points: { orderBy: { orderIndex: "asc" } } },
    }))
    const before = (await queued()).length

    await checkIn(WALKER, CLINIC_A, { routeId: route.id, routePointId: route.points[0].id })
    await bypass(() => prisma.mtmRoutePoint.update({ where: { id: route.points[0].id }, data: { status: "VISITED" } }))
    expect(await queued()).toHaveLength(before)

    await checkIn(WALKER, CLINIC_C, { routeId: route.id, routePointId: route.points[2].id })
    const rows = (await queued()).slice(before)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Kənan: визит вне очереди")
    expect(rows[0].body).toMatch(/^Clinic Gamma · Nizami 3 · \d{2}:\d{2}\. По очереди был: Clinic Beta$/)
  })

  it("does not wake the manager with a visit from a phone that was offline for days", async () => {
    const before = (await queued()).length
    await checkIn(WALKER, CLINIC_B, { checkInAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() })
    expect(await queued()).toHaveLength(before)
  })

  it("adds a second save of the same day to the agent's draft instead of starting another", async () => {
    // Zeytun, 2026-11-26: two saves made without network both reached the
    // server as CREATE_DRAFT, and the planner refused a day with two drafts.
    phoneOf(GATED_AGENT)
    const day = bakuDay(3)
    const first = await command({
      operationId: "activity-offline-first",
      command: "CREATE_DRAFT",
      payload: { date: day, points: [{ customerId: CLINIC_A }, { customerId: CLINIC_B }] },
    })
    expect(first.status).toBe(201)
    const second = await command({
      operationId: "activity-offline-second",
      command: "CREATE_DRAFT",
      payload: { date: day, points: [{ customerId: CLINIC_B }, { customerId: CLINIC_C }] },
    })
    expect(second.status).toBe(200)
    expect(second.body.data).toMatchObject({ id: first.body.data.id, status: "DRAFT", version: 2 })

    const drafts = await bypass(() => prisma.mtmRoute.findMany({
      where: { organizationId: ORG, agentId: GATED_AGENT, date: new Date(`${day}T00:00:00.000Z`), deletedAt: null },
      include: { points: { where: { deletedAt: null }, orderBy: { orderIndex: "asc" }, select: { customerId: true } } },
    }))
    expect(drafts).toHaveLength(1)
    expect(drafts[0].points.map((point) => point.customerId)).toEqual([CLINIC_A, CLINIC_B, CLINIC_C])
    expect(drafts[0].totalPoints).toBe(3)

    // The same command again changes nothing; a save naming only known clients changes nothing.
    const replay = await command({
      operationId: "activity-offline-second",
      command: "CREATE_DRAFT",
      payload: { date: day, points: [{ customerId: CLINIC_B }, { customerId: CLINIC_C }] },
    })
    expect(replay.body.data).toMatchObject({ id: first.body.data.id, version: 2 })
    const known = await command({
      operationId: "activity-offline-third",
      command: "CREATE_DRAFT",
      payload: { date: day, points: [{ customerId: CLINIC_A }] },
    })
    expect(known.status).toBe(200)
    expect(known.body.data).toMatchObject({ id: first.body.data.id, version: 2 })

    // Another day is another draft.
    const nextDay = await command({
      operationId: "activity-offline-next-day",
      command: "CREATE_DRAFT",
      payload: { date: bakuDay(4), points: [{ customerId: CLINIC_A }] },
    })
    expect(nextDay.status).toBe(201)
    expect(nextDay.body.data.id).not.toBe(first.body.data.id)
  })

  it("answers a second publish of the same version as done, not as an error", async () => {
    // The phone publishes a save that went out offline, and the planner that
    // saved it may publish it too (Zeytun, 2026-11-26).
    phoneOf(FREE_AGENT)
    const draft = await command({
      operationId: "activity-twice-create",
      command: "CREATE_DRAFT",
      payload: { date: bakuDay(5), points: [{ customerId: CLINIC_D }] },
    })
    expect(draft.status).toBe(201)
    const publish = (operationId: string) => command({
      operationId,
      command: "PUBLISH",
      routeId: draft.body.data.id,
      payload: { expectedVersion: draft.body.data.version },
    })
    const first = await publish("activity-twice-publish-1")
    expect(first.status).toBe(200)
    const second = await publish("activity-twice-publish-2")
    expect(second.status).toBe(200)
    expect(second.body.data).toMatchObject({ id: draft.body.data.id, status: "PLANNED", version: first.body.data.version })

    // An older version is still a conflict: the route moved on since.
    const stale = await command({
      operationId: "activity-twice-publish-3",
      command: "PUBLISH",
      routeId: draft.body.data.id,
      payload: { expectedVersion: draft.body.data.version - 1 || 99 },
    })
    expect(stale.status).toBe(409)
  })

  it("lands in the manager's bell with the server's own words", async () => {
    await bypass(() => drain({ organizationId: ORG, limit: 100 }))
    phoneOf(BOSS, "MANAGER")
    const inbox = await call(bell, `${BASE}/notifications`, "GET")
    expect(inbox.status).toBe(200)
    const items = inbox.body.data.items as Array<{ title: string; body: string }>
    expect(items.some((item) => item.title === "Kənan: визит вне маршрута" && item.body.startsWith("Clinic Delta"))).toBe(true)
    expect(items.some((item) => item.body === "2 визита: Clinic Alpha; Clinic Beta")).toBe(true)
  })
})
