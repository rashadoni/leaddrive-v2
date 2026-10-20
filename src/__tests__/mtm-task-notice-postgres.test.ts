/**
 * A task given in the panel reaches the agent (owner, 2026-10-20: «я создал
 * задачу для агента… должно было придти всплывающее окно как задача в
 * приложение, а его не было»). Until then POST /api/v1/mtm/tasks wrote the task
 * and nothing else: no bell line, no push.
 *
 * Read off the tables after the real handlers ran on a real Postgres: which
 * agent got a line, in which language, with which words — and that a task the
 * agent wrote for himself, or one the server refused, tells nobody. The push
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

/** Who sits at the browser. */
const browser = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => null)
  mock.getMobileAuth.mockImplementation(() => null)
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
    browser.current = { orgId: ORG, userId, role: "member", email: `${userId}@example.test`, name: userId, principalType: "session" }
  }

  async function call(handler: (req: NextRequest, ctx?: never) => Promise<Response>, url: string, method: string, body: unknown, ctx?: unknown) {
    const response = await (handler as (req: NextRequest, ctx?: unknown) => Promise<Response>)(new NextRequest(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
})
