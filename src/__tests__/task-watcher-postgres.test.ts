/**
 * The person who follows every task on the boards (src/lib/tasks/task-watcher.ts)
 * against a real Postgres, through the real route handlers.
 *
 * Zeytun, 2026-11-27. Nazrin: «tag olunmasam belə hamısı mənə gələ bilməz?
 * Default?»; Sabina: «tapşırığı verənin ayrı-ayrı olması lazımdır». Owner: «Да, делай».
 *
 *  - only the admin names (and clears) the watcher; a person of another
 *    organization or one who left is refused;
 *  - named, she follows every open board task at once — not the finished ones,
 *    not a CRM task off the boards, not another organization's;
 *  - she follows each new board task and hears it was made, unless she made it
 *    or it is hers to do; «Tapşırığı verən» stays what the maker picked;
 *  - a message on the task reaches her, and so does its close — unless she
 *    closed it herself;
 *  - a watcher who left follows nothing new; cleared, nobody does.
 *
 * Runs in the same database gate as the task import (TASK_EXTERNAL_IMPORT_*).
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL
if (!adminUrl && process.env.TASK_EXTERNAL_IMPORT_DB_GATE === "required") {
  throw new Error("TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL is required by the task import database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `task_watcher_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const ORG = "org-watcher"
const OTHER_ORG = "org-watcher-other"
const BOARD = "div-watcher"
const OTHER_BOARD = "div-watcher-other"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "task-watcher-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const request = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const FULL = { canView: true, canEdit: true, canCreateTask: true, canComment: true, canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true, canMoveToReview: true, canMoveBack: true }

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("the watcher of every board task on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let route!: typeof import("@/app/api/v1/tasks/watcher/route")
  let tasks!: typeof import("@/app/api/v1/tasks/route")
  let task!: typeof import("@/app/api/v1/tasks/[id]/route")
  let comments!: typeof import("@/app/api/v1/tasks/[id]/comments/route")

  const as = (id: string, role: string, organizationId = ORG) => {
    session.current = { user: { id, organizationId, role, email: `${id}@watcher.test`, name: id } }
  }
  const call = async (res: Response | Promise<Response>) => { const r = await res; return { status: r.status, body: await r.json() } }
  const params = (id: string) => ({ params: Promise.resolve({ id }) })
  const readWatcher = () => call(route.GET(request("GET", "/api/v1/tasks/watcher")))
  const setWatcher = (userId: unknown) => call(route.PUT(request("PUT", "/api/v1/tasks/watcher", { userId })))
  const followers = async (taskId: string) => (await bypass(() => prisma.taskFollower.findMany({ where: { taskId }, select: { userId: true } })))
    .map((f: { userId: string }) => f.userId).sort()
  const makeTask = async (extra: Record<string, unknown> = {}) => {
    const res = await call(tasks.POST(request("POST", "/api/v1/tasks", { title: "Pharmastore 446 banner", divisionId: BOARD, status: "backlog", ...extra })))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    return res.body.data.id as string
  }
  // Notifications go out after the answer; wait for the row (or prove there is none).
  const noticesFor = (userId: string, taskId: string) => bypass(() => prisma.notification.findMany({
    where: { userId, entityType: "task", entityId: taskId },
    select: { title: true, message: true, type: true },
    orderBy: { createdAt: "asc" },
  }))
  const settle = () => new Promise((r) => setTimeout(r, 300))
  const seedTask = (id: string, data: Record<string, unknown>) => bypass(() => prisma.task.create({
    data: { id, organizationId: ORG, title: id, status: "pending", priority: "medium", type: "task", createdBy: "rashida", ...data },
  }))

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    route = await import("@/app/api/v1/tasks/watcher/route")
    tasks = await import("@/app/api/v1/tasks/route")
    task = await import("@/app/api/v1/tasks/[id]/route")
    comments = await import("@/app/api/v1/tasks/[id]/comments/route")
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "watcher"], [OTHER_ORG, "watcher-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, tasks: true } } })
      }
      for (const [id, organizationId, role, isActive] of [
        ["nazrin", ORG, "admin", true], ["owner", ORG, "admin", true], ["sabina", ORG, "manager", true],
        ["rashida", ORG, "sales", true], ["aytan", ORG, "sales", true],
        ["gone", ORG, "sales", false], ["outsider", OTHER_ORG, "admin", true],
      ] as const) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@watcher.test`, name: id, passwordHash: "-", role, isActive, preferredLanguage: "az" } })
      }
      await prisma.division.create({ data: { id: BOARD, organizationId: ORG, key: "PS", name: "Pharmastore" } })
      await prisma.division.create({ data: { id: OTHER_BOARD, organizationId: OTHER_ORG, key: "OT", name: "Other" } })
      for (const userId of ["rashida", "aytan"]) {
        await prisma.boardPermission.create({ data: { organizationId: ORG, userId, divisionId: BOARD, ...FULL } })
      }
    })
    // Tasks already running before anybody is named.
    await seedTask("open-1", { divisionId: BOARD, status: "in_progress" })
    await seedTask("open-2", { divisionId: BOARD, status: "backlog" })
    await seedTask("done-1", { divisionId: BOARD, status: "done" })
    await seedTask("cancelled-1", { divisionId: BOARD, status: "cancelled" })
    await seedTask("deleted-1", { divisionId: BOARD, deletedAt: new Date() })
    await seedTask("crm-1", { divisionId: null })
    await bypass(() => prisma.task.create({ data: { id: "other-org-1", organizationId: OTHER_ORG, title: "x", status: "pending", priority: "medium", type: "task", divisionId: OTHER_BOARD } }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => as("nazrin", "admin"))

  it("only the admin names the watcher; a stranger or a person who left is refused", async () => {
    expect((await readWatcher()).body.data).toEqual({ watcher: null, canManage: true })
    as("rashida", "sales")
    expect((await readWatcher()).body.data).toEqual({ watcher: null, canManage: false })
    expect((await setWatcher("rashida")).status).toBe(403)
    as("sabina", "manager")
    expect((await setWatcher("sabina")).status).toBe(403)
    as("nazrin", "admin")
    expect((await setWatcher("outsider")).status).toBe(400)
    expect((await setWatcher("gone")).status).toBe(400)
    expect((await setWatcher(42)).status).toBe(400)
    // Nothing was followed by the refusals.
    expect(await bypass(() => prisma.taskFollower.count())).toBe(0)
  })

  it("named, she follows every open board task at once — nothing finished, off the boards or elsewhere", async () => {
    const set = await setWatcher("nazrin")
    expect(set.status, JSON.stringify(set.body)).toBe(200)
    expect(set.body.data).toMatchObject({ watcher: { id: "nazrin", name: "nazrin" }, followed: 2 })
    for (const id of ["open-1", "open-2"]) expect(await followers(id)).toEqual(["nazrin"])
    for (const id of ["done-1", "cancelled-1", "deleted-1", "crm-1", "other-org-1"]) expect(await followers(id)).toEqual([])
    as("rashida", "sales")
    expect((await readWatcher()).body.data.watcher).toEqual({ id: "nazrin", name: "nazrin" })
    as("outsider", "admin", OTHER_ORG)
    expect((await readWatcher()).body.data.watcher).toBeNull()
    // Naming her again adds nothing twice.
    as("nazrin", "admin")
    expect((await setWatcher("nazrin")).body.data.followed).toBe(0)
  })

  it("a new board task: she follows it and hears of it; its «Tapşırığı verən» is the maker's pick", async () => {
    // The SMM gives the designer a task and names herself «Tapşırığı verən».
    as("rashida", "sales")
    const id = await makeTask({ assignedTo: "aytan", reporterId: "rashida" })
    const row = await bypass(() => prisma.task.findUniqueOrThrow({ where: { id }, select: { reporterId: true } }))
    expect(row.reporterId).toBe("rashida")
    expect(await followers(id)).toEqual(["nazrin", "rashida"])
    await settle()
    const notices = await noticesFor("nazrin", id)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ title: "Yeni tapşırıq" })
    expect(notices[0].message).toContain("Pharmastore 446 banner")

    // Left out, the reporter is nobody — there is no default any more.
    const plain = await makeTask({ assignedTo: "aytan" })
    expect((await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: plain }, select: { reporterId: true } }))).reporterId).toBeNull()
    expect(await followers(plain)).toEqual(["nazrin"])
  })

  it("no notice of a new task she made herself, or that is hers to do; a CRM task is not followed", async () => {
    const own = await makeTask({ assignedTo: "aytan" })
    as("rashida", "sales")
    const hers = await makeTask({ assignedTo: "nazrin" })
    const crm = await call(tasks.POST(request("POST", "/api/v1/tasks", { title: "Zəng et", assignedTo: "rashida" })))
    expect(crm.status, JSON.stringify(crm.body)).toBe(201)
    await settle()
    expect(await noticesFor("nazrin", own)).toEqual([])
    // Hers to do: the usual assignee notice, once — not a second one as the watcher.
    expect(await noticesFor("nazrin", hers)).toHaveLength(1)
    expect(await followers(crm.body.data.id)).toEqual([])
  })

  it("a message on any open task reaches her, and so does its close — not a close of her own", async () => {
    as("rashida", "sales")
    const sent = await call(comments.POST(request("POST", "/api/v1/tasks/open-1/comments", { content: "Maket hazırdır" }), params("open-1")))
    expect(sent.status, JSON.stringify(sent.body)).toBe(201)
    await settle()
    expect((await noticesFor("nazrin", "open-1")).map((n: { title: string }) => n.title)).toEqual(["rashida: open-1"])

    as("owner", "admin")
    const closed = await call(task.PATCH(request("PATCH", "/api/v1/tasks/open-1", { status: "done" }), params("open-1")))
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    await settle()
    const after = await noticesFor("nazrin", "open-1")
    expect(after).toHaveLength(2)
    expect(after[1].type).toBe("success")

    as("nazrin", "admin")
    expect((await call(task.PATCH(request("PATCH", "/api/v1/tasks/open-2", { status: "done" }), params("open-2")))).status).toBe(200)
    await settle()
    expect(await noticesFor("nazrin", "open-2")).toEqual([])
  })

  it("a watcher who left follows nothing new; cleared, nobody does", async () => {
    await bypass(() => prisma.user.update({ where: { id: "nazrin" }, data: { isActive: false } }))
    as("rashida", "sales")
    expect(await followers(await makeTask())).toEqual([])
    expect((await readWatcher()).body.data.watcher).toBeNull()
    await bypass(() => prisma.user.update({ where: { id: "nazrin" }, data: { isActive: true } }))

    as("owner", "admin")
    expect((await setWatcher(null)).status).toBe(200)
    as("rashida", "sales")
    expect(await followers(await makeTask())).toEqual([])
    const org = await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: ORG }, select: { settings: true } }))
    expect(org.settings).not.toHaveProperty("taskWatcherId")
  })
})
