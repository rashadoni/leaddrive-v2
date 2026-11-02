/**
 * A task given in the panel reaches the agent (owner, 2026-10-20: «я создал
 * задачу для агента… должно было придти всплывающее окно как задача в
 * приложение, а его не было»). Until then POST /api/v1/mtm/tasks wrote the task
 * and nothing else: no bell line, no push.
 *
 * Read off the tables after the real handlers ran on a real Postgres: which
 * agent got a line, in which language, with which words — and that a task the
 * agent wrote for himself, or one the server refused, tells nobody. The same
 * for «Дать задачу» on the manager's phone (POST /mobile/manager/tasks): the
 * panel's task, due at 18:00 of the chosen day, never doubled by a resend,
 * never given outside the manager's team. The push
 * itself is pinned in lib-mtm-task-assigned-notify.test.ts; here Firebase is
 * not configured, so nothing leaves the test.
 *
 * Set MTM_TASK_NOTICE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_TASK_NOTICE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM task notice database gate»), where
 * `MTM_TASK_NOTICE_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_TASK_NOTICE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_TASK_NOTICE_DB_GATE === "required") {
  throw new Error("MTM_TASK_NOTICE_TEST_DATABASE_URL is required by the MTM task notice database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_TASK_NOTICE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_task_notice_${process.pid}`
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
const ORG = "org-task-notice"
const BASE = "http://localhost:3000/api/v1/mtm"

const MANAGER = "agent-notice-manager"
const ELVIN = "agent-notice-elvin"
const AYSEL = "agent-notice-aysel"
const OTHER_TEAM = "agent-notice-other-team"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/** The schema as `db push` can build it on a plain Postgres: without the two pgvector columns nothing here reads. */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-task-notice-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** Tomorrow at 18:00 in Baku, the organization's timezone (no MTM settings row: the default). */
function tomorrowEveningInBaku(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const tomorrow = new Date(`${today}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return `${tomorrow.toISOString().slice(0, 10)}T18:00:00+04:00`
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("a task given in the panel, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let createTask!: typeof import("@/app/api/v1/mtm/tasks/route").POST
  let updateTask!: typeof import("@/app/api/v1/mtm/tasks/[id]/route").PUT
  let giveTask!: typeof import("@/app/api/v1/mtm/mobile/manager/tasks/route").POST
  let reportLanguage!: typeof import("@/app/api/v1/mtm/mobile/language/route").PUT
  let phoneBell!: typeof import("@/app/api/v1/mtm/mobile/notifications/route").GET
  let taskId = ""
  let taskVersion = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    createTask = (await import("@/app/api/v1/mtm/tasks/route")).POST
    updateTask = (await import("@/app/api/v1/mtm/tasks/[id]/route")).PUT
    giveTask = (await import("@/app/api/v1/mtm/mobile/manager/tasks/route")).POST
    reportLanguage = (await import("@/app/api/v1/mtm/mobile/language/route")).PUT
    phoneBell = (await import("@/app/api/v1/mtm/mobile/notifications/route")).GET

    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: ORG, slug: ORG, modules: { mtm: true, "route-field": true } } })
      await prisma.user.create({ data: { id: "user-notice-manager", organizationId: ORG, email: "manager@example.test", name: "Manager", passwordHash: "-", role: "member" } })
      await prisma.user.create({ data: { id: "user-notice-elvin", organizationId: ORG, email: "elvin@example.test", name: "Elvin", passwordHash: "-", role: "member", preferredLanguage: "ru" } })
      await prisma.mtmTeam.create({ data: { id: "team-notice-mine", organizationId: ORG, name: "Mine" } })
      await prisma.mtmTeam.create({ data: { id: "team-notice-other", organizationId: ORG, name: "Other" } })
      await prisma.mtmAgent.createMany({
        data: [
          { id: MANAGER, organizationId: ORG, name: "Team Manager", role: "SUPERVISOR", teamId: "team-notice-mine", userId: "user-notice-manager" },
          { id: ELVIN, organizationId: ORG, name: "Elvin", teamId: "team-notice-mine", userId: "user-notice-elvin" },
          // No CRM login: the line is in Azerbaijani.
          { id: AYSEL, organizationId: ORG, name: "Aysel", teamId: "team-notice-mine" },
          { id: OTHER_TEAM, organizationId: ORG, name: "Someone else's", teamId: "team-notice-other" },
        ],
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  function browserOf(userId: string) {
    caller.current = null
    browser.current = { orgId: ORG, userId, role: "member", email: `${userId}@example.test`, name: userId, principalType: "session" }
  }

  async function call(handler: (req: NextRequest, ctx?: never) => Promise<Response>, url: string, method: string, body: unknown, ctx?: unknown) {
    const response = await (handler as (req: NextRequest, ctx?: unknown) => Promise<Response>)(new NextRequest(url, {
      method,
      headers: caller.current ? { Authorization: "Bearer mobile", "content-type": "application/json" } : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    }), ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the handler's JSON, read field by field below
    return { status: response.status, body: await response.json() as Record<string, any> }
  }

  async function notices() {
    return bypass(() => prisma.mtmNotification.findMany({
      where: { organizationId: ORG },
      orderBy: { createdAt: "asc" },
      select: { agentId: true, type: true, title: true, body: true, metadata: true },
    }))
  }

  it("puts the manager's task in the agent's bell, in her language, with its deadline", async () => {
    browserOf("user-notice-manager")
    const created = await call(createTask, `${BASE}/tasks`, "POST", {
      agentId: AYSEL,
      title: "Take the signed  contract",
      dueDate: tomorrowEveningInBaku(),
    })
    expect(created.status).toBe(201)
    taskId = created.body.data.id
    taskVersion = created.body.data.version

    expect(await notices()).toEqual([{
      agentId: AYSEL,
      type: "task",
      title: "Team Manager sizə yeni tapşırıq verdi",
      body: "Take the signed contract · son müddət: sabah 18:00",
      // No `taskId`: the app reads that key as «task returned» (see task-assigned-notify.ts).
      metadata: { domain: "task", event: "task_assigned", assignedTaskId: taskId, giverAgentId: MANAGER },
    }])
  })

  it("tells the agent a task was handed to, as a new task, in his language", async () => {
    browserOf("user-notice-manager")
    const moved = await call(updateTask, `${BASE}/tasks/${taskId}`, "PUT", { agentId: ELVIN, expectedVersion: taskVersion }, { params: Promise.resolve({ id: taskId }) })
    expect(moved.status).toBe(200)

    const rows = await notices()
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      agentId: ELVIN,
      type: "task",
      title: "Новая задача от Team Manager",
      body: "Take the signed contract · срок завтра до 18:00",
      metadata: { domain: "task", event: "task_assigned", assignedTaskId: taskId, giverAgentId: MANAGER },
    })
  })

  it("tells nobody of a task the agent wrote for himself, or of one the server refused", async () => {
    browserOf("user-notice-elvin")
    const own = await call(createTask, `${BASE}/tasks`, "POST", { agentId: ELVIN, title: "Call the clinic back" })
    expect(own.status).toBe(201)

    browserOf("user-notice-manager")
    const outside = await call(createTask, `${BASE}/tasks`, "POST", { agentId: OTHER_TEAM, title: "Not in my team" })
    expect(outside.status).toBe(403)

    expect(await notices()).toHaveLength(2)
  })

  function phoneOf(agentId: string, role: string, name: string, tenantCapabilities = { routeField: true, workforceHrm: true }) {
    browser.current = null
    caller.current = {
      orgId: ORG,
      agentId,
      userId: "",
      role,
      email: `${agentId}@example.test`,
      name,
      tenantCapabilities,
    }
  }

  async function tasksOf(agentId: string) {
    return bypass(() => prisma.mtmTask.findMany({
      where: { organizationId: ORG, agentId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, dueDate: true, status: true, events: { select: { type: true, evidence: true } } },
    }))
  }

  it("lets the manager give a task from his phone: the panel's task, due tomorrow at 18:00, and the agent told", async () => {
    phoneOf(MANAGER, "SUPERVISOR", "Team Manager")
    const given = await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId: AYSEL, title: "Bring the samples", due: "tomorrow" })
    expect(given.status).toBe(201)
    expect(given.body.data.agent).toEqual({ id: AYSEL, name: "Aysel" })
    // Firebase is not configured here, so no phone can be reached.
    expect(given.body.data.pushReady).toBe(false)

    const [task] = (await tasksOf(AYSEL)).filter((row) => row.title === "Bring the samples")
    expect(task.status).toBe("PENDING")
    expect(task.dueDate?.toISOString()).toBe(new Date(tomorrowEveningInBaku()).toISOString())
    expect(task.events).toEqual([{ type: "CREATED", evidence: expect.objectContaining({ actorAgentId: MANAGER, actorRole: "SUPERVISOR", channel: "mobile" }) }])

    const rows = await notices()
    expect(rows.at(-1)).toEqual({
      agentId: AYSEL,
      type: "task",
      title: "Team Manager sizə yeni tapşırıq verdi",
      body: "Bring the samples · son müddət: sabah 18:00",
      metadata: { domain: "task", event: "task_assigned", assignedTaskId: task.id, giverAgentId: MANAGER },
    })
  })

  it("answers a resend with the same task instead of a second one", async () => {
    phoneOf(MANAGER, "SUPERVISOR", "Team Manager")
    const before = (await tasksOf(AYSEL)).length
    const noticesBefore = (await notices()).length
    const again = await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId: AYSEL, title: "Bring the samples", due: "tomorrow" })
    expect(again.status).toBe(200)
    expect((await tasksOf(AYSEL)).length).toBe(before)
    expect((await notices()).length).toBe(noticesBefore)
  })

  it("gives no task to someone outside the team, to himself, by an agent, or for a day gone by", async () => {
    const before = await bypass(() => prisma.mtmTask.count({ where: { organizationId: ORG } }))
    const noticesBefore = (await notices()).length

    phoneOf(MANAGER, "SUPERVISOR", "Team Manager")
    for (const agentId of [OTHER_TEAM, MANAGER, "no-such-card"]) {
      const refused = await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId, title: "Nope", due: "today" })
      expect({ agentId, status: refused.status, code: refused.body.code }).toEqual({ agentId, status: 403, code: "MTM_TASK_SCOPE_DENIED" })
    }
    const past = await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId: AYSEL, title: "Too late", due: "2020-01-01" })
    expect(past.status).toBe(400)

    phoneOf(ELVIN, "AGENT", "Elvin")
    const byAgent = await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId: AYSEL, title: "Nope", due: "today" })
    expect(byAgent.status).toBe(403)

    expect(await bypass(() => prisma.mtmTask.count({ where: { organizationId: ORG } }))).toBe(before)
    expect((await notices()).length).toBe(noticesBefore)
  })

  it("shows the task line in the bell of a tenant with Route & Field and no HRM, as on Zeytun's phones", async () => {
    // Owner's phone, 2026-10-31: the push «Togrul sizə yeni tapşırıq verdi»
    // came, the bell stayed empty — the line was cut by its `domain: "task"`.
    for (const tenantCapabilities of [{ routeField: true, workforceHrm: false }, { routeField: true, workforceHrm: true }]) {
      phoneOf(AYSEL, "AGENT", "Aysel", tenantCapabilities)
      const bell = await call(phoneBell, `${BASE}/mobile/notifications`, "GET", undefined)
      expect(bell.status).toBe(200)
      const lines = (bell.body.data.items as Array<{ body: string | null; metadata: { event?: string } }>)
        .filter((row) => row.metadata.event === "task_assigned")
        .map((row) => row.body)
      expect({ tenantCapabilities, lines }).toEqual({
        tenantCapabilities,
        lines: ["Bring the samples · son müddət: sabah 18:00", "Take the signed contract · son müddət: sabah 18:00"],
      })
      expect(bell.body.data.unread).toBeGreaterThanOrEqual(2)
    }
    // An HRM-only tenant has no Route & Field tasks to show.
    phoneOf(AYSEL, "AGENT", "Aysel", { routeField: false, workforceHrm: true })
    const hrmOnly = await call(phoneBell, `${BASE}/mobile/notifications`, "GET", undefined)
    expect(hrmOnly.body.data.items).toEqual([])
  })

  it("writes the task line in the language the agent's app shows, even with no CRM login (owner, 2026-10-31)", async () => {
    // Aysel has no CRM login: until her app speaks, her lines are Azerbaijani.
    phoneOf(AYSEL, "AGENT", "Aysel")
    const refused = await call(reportLanguage, `${BASE}/mobile/language`, "PUT", { language: "de" })
    expect(refused.status).toBe(400)
    const reported = await call(reportLanguage, `${BASE}/mobile/language`, "PUT", { language: "ru-RU" })
    expect(reported).toEqual({ status: 200, body: { success: true, data: { language: "ru" } } })
    expect(await bypass(() => prisma.mtmAgent.findUnique({ where: { id: AYSEL }, select: { appLanguage: true } }))).toEqual({ appLanguage: "ru" })

    phoneOf(MANAGER, "SUPERVISOR", "Team Manager")
    const given = await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId: AYSEL, title: "Call the pharmacy", due: "tomorrow" })
    expect(given.status).toBe(201)
    expect((await notices()).at(-1)).toEqual(expect.objectContaining({
      agentId: AYSEL,
      title: "Новая задача от Team Manager",
      body: "Call the pharmacy · срок завтра до 18:00",
    }))

    // The app comes first: Elvin's CRM login says Russian, his app says English.
    phoneOf(ELVIN, "AGENT", "Elvin")
    expect((await call(reportLanguage, `${BASE}/mobile/language`, "PUT", { language: "en" })).status).toBe(200)
    phoneOf(MANAGER, "SUPERVISOR", "Team Manager")
    expect((await call(giveTask, `${BASE}/mobile/manager/tasks`, "POST", { agentId: ELVIN, title: "Bring the leaflets", due: "none" })).status).toBe(201)
    expect((await notices()).at(-1)).toEqual(expect.objectContaining({ agentId: ELVIN, title: "New task from Team Manager" }))
  })
})
