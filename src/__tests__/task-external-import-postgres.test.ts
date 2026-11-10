/**
 * Another tool's tasks brought onto a board, against a real Postgres
 * (2026-11-06: Zeytun's marketing board moved over from Bordio, 1772 tasks).
 * Read off the tables after the real route handler:
 *
 *  - a dry run writes nothing and names the e-mails nobody in the organization
 *    has; a real run with such e-mails is refused unless told to go anyway;
 *  - deadline, assignee, co-assignees, author, comments, checklist, brand and
 *    task type land where the CRM keeps them, finished tasks in the Done lane
 *    with their own finishing date;
 *  - nobody is notified — not by a bell, not by e-mail;
 *  - a second run updates the same tasks instead of adding copies;
 *  - the task list pages through a board past 200 tasks without losing or
 *    repeating a card, even when every card has the same position and date.
 *
 * Set TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55502:5432 postgres:16
 *   TASK_EXTERNAL_IMPORT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55502/postgres
 * Without it the suite is skipped. CI runs it in `static-checks`, where
 * TASK_EXTERNAL_IMPORT_DB_GATE=required turns a missing URL into a failure.
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
  const name = `task_external_import_${process.pid}`
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
const mail = vi.hoisted(() => ({ sent: [] as unknown[] }))
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (...args: unknown[]) => { mail.sent.push(args); return { success: true } },
}))

const ROOT = process.cwd()
const ORG = "org-import"
const OTHER_ORG = "org-import-other"
const BOARD = "div-marketing"
const DEPARTMENT = "div-department"
const SECTION = "div-section-zeytun"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const STAGES = ["backlog", "todo", "in_progress", "testing", "review", "done"]

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "task-external-import-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const request = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const onBoard = (id: string) => ({ params: Promise.resolve({ id }) })

// Two tasks as the Bordio export writes them: one open and handed to two
// people, one finished with a comment from somebody who never got a CRM login.
const OPEN = {
  externalId: "bordio-open-1",
  externalKey: "ZEY-12",
  title: "14.11.2026 Ümumdünya Diabet Günü",
  description: "Post + story\nhər iki kanal",
  status: "todo",
  priority: "critical",
  type: { label: "DIGITAL MARKETING", color: "#2E7D32" },
  brand: "Zeytun",
  dueDate: "2026-11-13T20:00:00.000Z",
  createdAt: "2026-10-30T09:15:00.000Z",
  assigneeEmails: ["Gulu.Alakbarova@zeytunpharma.az", "aytan.mushkurova@zeytunpharma.az"],
  creatorEmail: "nazrin.shirinova@zeytunpharma.az",
  checklist: [{ title: "Dizayn", completed: true }, { title: "Mətn", completed: false }],
  comments: [{ authorEmail: "nazrin.shirinova@zeytunpharma.az", authorName: "Nazrin SHIRINOVA", createdAt: "2026-10-31T10:00:00.000Z", text: "Diabet loqosu ilə" }],
}
const DONE = {
  externalId: "bordio-done-1",
  externalKey: "PHA-700",
  title: "Insert Jurnal Noyabr",
  status: "done",
  priority: null,
  type: { label: "TRADITIONAL MARKETING" },
  brand: "Pharmastore",
  createdAt: "2026-10-27T08:24:36.114Z",
  completedAt: "2026-11-05T12:25:59.825Z",
  assigneeEmails: ["aytan.mushkurova@zeytunpharma.az"],
  comments: [{ authorEmail: "former.member@zeytunpharma.az", authorName: "Keçmiş İşçi", createdAt: "2026-11-05T05:36:29.659Z", text: "Faylı göndərdim" }],
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("tasks brought over from another tool, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let importRoute!: typeof import("@/app/api/v1/divisions/[id]/import-external/route").POST
  let listRoute!: typeof import("@/app/api/v1/tasks/route").GET
  let daysRoute!: typeof import("@/app/api/v1/tasks/import-external/planned-days/route").POST

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    importRoute = (await import("@/app/api/v1/divisions/[id]/import-external/route")).POST
    listRoute = (await import("@/app/api/v1/tasks/route")).GET
    daysRoute = (await import("@/app/api/v1/tasks/import-external/planned-days/route")).POST
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "zeytun"], [OTHER_ORG, "other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, tasks: true } } })
      }
      const people: Array<[string, string, string, string, boolean]> = [
        ["admin", ORG, "admin@zeytun.test", "admin", true],
        ["gullu", ORG, "gulu.alakbarova@zeytunpharma.az", "manager", true],
        ["aytan", ORG, "aytan.mushkurova@zeytunpharma.az", "viewer", true],
        ["nazrin", ORG, "nazrin.shirinova@zeytunpharma.az", "viewer", true],
        ["viewer", ORG, "viewer@zeytun.test", "manager", true],
        // Same e-mail in another organization: never matched here.
        ["stranger", OTHER_ORG, "former.member@zeytunpharma.az", "admin", true],
      ]
      for (const [id, organizationId, email, role, isActive] of people) {
        await prisma.user.create({ data: { id, organizationId, email, name: id, passwordHash: "-", role, isActive } })
      }
      await prisma.taskType.create({ data: { organizationId: ORG, name: "task", displayName: "Task" } })
      await prisma.division.create({ data: { id: BOARD, organizationId: ORG, key: "MARKETING", name: "Ümumi Marketinq" } })
      await prisma.division.create({ data: { id: DEPARTMENT, organizationId: ORG, key: "DEPT", name: "Department", isDepartment: true } })
      await prisma.boardColumn.createMany({
        data: STAGES.map((stage, sortOrder) => ({ organizationId: ORG, divisionId: BOARD, key: `col_${stage}`, label: stage, sortOrder, mapsToStatus: stage })),
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    mail.sent = []
    session.current = { user: { id: "admin", organizationId: ORG, role: "admin", email: "admin@zeytun.test", name: "Admin" } }
  })

  const send = async (body: unknown, board = BOARD) => {
    const res = await importRoute(request("POST", `/api/v1/divisions/${board}/import-external`, body), onBoard(board))
    return { status: res.status, body: await res.json() }
  }
  const boardTasks = () => bypass(() => prisma.task.findMany({
    where: { organizationId: ORG, divisionId: BOARD },
    include: { collaborators: true, comments: { orderBy: { createdAt: "asc" } }, checklist: { orderBy: { sortOrder: "asc" } }, activities: { orderBy: { createdAt: "asc" } } },
    orderBy: { taskKey: "asc" },
  }))

  it("a dry run writes nothing and names the e-mail nobody here has", async () => {
    const res = await send({ source: "bordio", dryRun: true, tasks: [OPEN, DONE] })

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data).toEqual({
      dryRun: true,
      created: 2,
      updated: 0,
      moved: 0,
      unmatchedEmails: { "former.member@zeytunpharma.az": 1 },
      newTaskTypes: ["digital_marketing", "traditional_marketing"],
      newBrands: ["Zeytun", "Pharmastore"],
    })
    expect(await boardTasks()).toEqual([])
    expect(await bypass(() => prisma.taskType.count({ where: { organizationId: ORG } }))).toBe(1)
  })

  it("refuses a real run while somebody is missing, and lets only an admin import", async () => {
    const refused = await send({ source: "bordio", tasks: [OPEN, DONE] })
    session.current = { user: { id: "viewer", organizationId: ORG, role: "manager", email: "viewer@zeytun.test", name: "M" } }
    const manager = await send({ source: "bordio", allowUnmatched: true, tasks: [OPEN] })
    session.current = { user: { id: "admin", organizationId: ORG, role: "admin", email: "admin@zeytun.test", name: "Admin" } }
    const department = await send({ source: "bordio", allowUnmatched: true, tasks: [OPEN] }, DEPARTMENT)

    expect([refused.status, refused.body.detail]).toEqual([422, { unmatchedEmails: { "former.member@zeytunpharma.az": 1 } }])
    expect(manager.status).toBe(403)
    expect(department.status).toBe(400)
    expect(await boardTasks()).toEqual([])
  })

  it("puts deadline, people, comments, checklist, brand and type where the CRM keeps them — and tells nobody", async () => {
    const res = await send({ source: "bordio", allowUnmatched: true, tasks: [OPEN, DONE] })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect([res.body.data.created, res.body.data.updated]).toEqual([2, 0])

    const [open, done] = await boardTasks()
    expect({
      key: open.taskKey, title: open.title, description: open.description, status: open.status, lane: open.boardColumnKey,
      priority: open.priority, type: open.type, due: open.dueDate?.toISOString(), created: open.createdAt.toISOString(),
      assignee: open.assignedTo, author: open.createdBy, brand: open.customFields, origin: [open.externalSource, open.externalId],
      collaborators: open.collaborators.map((c) => c.userId),
      checklist: open.checklist.map((c) => [c.title, c.completed]),
      comments: open.comments.map((c) => [c.userId, c.content, c.createdAt.toISOString()]),
    }).toEqual({
      key: "MARKETING-1", title: OPEN.title, description: OPEN.description, status: "todo", lane: "col_todo",
      priority: "critical", type: "digital_marketing", due: OPEN.dueDate, created: OPEN.createdAt,
      assignee: "gullu", author: "nazrin", brand: { brand: "Zeytun" }, origin: ["bordio", "bordio-open-1"],
      collaborators: ["aytan"],
      checklist: [["Dizayn", true], ["Mətn", false]],
      comments: [["nazrin", "Diabet loqosu ilə", "2026-10-31T10:00:00.000Z"]],
    })
    expect({
      key: done.taskKey, status: done.status, lane: done.boardColumnKey, completed: done.completedAt?.toISOString(),
      priority: done.priority, assignee: done.assignedTo, author: done.createdBy,
      comments: done.comments.map((c) => [c.userId, c.content]),
      history: done.activities.map((a) => [a.action, a.newValue, a.createdAt.toISOString()]),
    }).toEqual({
      key: "MARKETING-2", status: "done", lane: "col_done", completed: DONE.completedAt,
      priority: "medium", assignee: "aytan", author: "admin",
      // The other organization's user with that e-mail is not this author.
      comments: [[null, "Keçmiş İşçi: Faylı göndərdim"]],
      history: [["created", "todo", DONE.createdAt], ["status_changed", "done", DONE.completedAt]],
    })

    const config = await bypass(async () => ({
      types: (await prisma.taskType.findMany({ where: { organizationId: ORG }, orderBy: { sortOrder: "asc" } })).map((t) => [t.name, t.displayName, t.isActive]),
      brand: await prisma.customField.findFirst({ where: { organizationId: ORG, entityType: "task", fieldName: "brand" }, select: { fieldType: true, options: true } }),
      notifications: await prisma.notification.count({ where: { organizationId: ORG } }),
    }))
    expect(config).toEqual({
      types: [["task", "Task", true], ["digital_marketing", "DIGITAL MARKETING", true], ["traditional_marketing", "TRADITIONAL MARKETING", true]],
      brand: { fieldType: "select", options: ["Zeytun", "Pharmastore"] },
      notifications: 0,
    })
    expect(mail.sent).toEqual([])
  })

  it("a second run updates the same tasks, without copies and without repeating comments", async () => {
    const reopened = { ...DONE, status: "in_progress", completedAt: null, assigneeEmails: ["gulu.alakbarova@zeytunpharma.az"] }
    const moved = { ...OPEN, dueDate: "2026-11-14T20:00:00.000Z", assigneeEmails: ["aytan.mushkurova@zeytunpharma.az"], brand: "Noreva - Buccotherm" }
    const res = await send({ source: "bordio", allowUnmatched: true, tasks: [moved, reopened] })

    expect([res.status, res.body.data.created, res.body.data.updated]).toEqual([200, 0, 2])
    const [open, done] = await boardTasks()
    expect([open.taskKey, open.dueDate?.toISOString(), open.assignedTo, open.collaborators.length, open.comments.length, open.checklist.length, open.customFields])
      .toEqual(["MARKETING-1", moved.dueDate, "aytan", 0, 1, 2, { brand: "Noreva - Buccotherm" }])
    expect([done.taskKey, done.status, done.boardColumnKey, done.completedAt, done.assignedTo, done.comments.length])
      .toEqual(["MARKETING-2", "in_progress", "col_in_progress", null, "gullu", 1])
    const brand = await bypass(() => prisma.customField.findFirst({ where: { organizationId: ORG, fieldName: "brand" }, select: { options: true } }))
    expect(brand?.options).toEqual(["Zeytun", "Pharmastore", "Noreva - Buccotherm"])
  })

  // Owner, 2026-11-06: Bordio's projects became boards of their own after the
  // first run had put every task on one board.
  it("moves a task to another board only when asked, with its history and a key of the new board", async () => {
    await bypass(async () => {
      await prisma.division.create({ data: { id: SECTION, organizationId: ORG, key: "DZEY", name: "Zeytun", parentDivisionId: DEPARTMENT } })
      await prisma.boardColumn.createMany({
        data: [["todo", "New task"], ["in_progress", "In progress"], ["done", "Completed"]].map(([stage, label], sortOrder) => (
          { organizationId: ORG, divisionId: SECTION, key: `sec_${stage}`, label, sortOrder, mapsToStatus: stage })),
      })
    })
    const before = (await boardTasks()).find((task) => task.externalId === OPEN.externalId)!

    const refused = await send({ source: "bordio", allowUnmatched: true, tasks: [OPEN] }, SECTION)
    expect([refused.status, refused.body.error]).toEqual([409, `Task ${OPEN.externalId} was already imported onto another board`])

    const dry = await send({ source: "bordio", allowUnmatched: true, relocate: true, dryRun: true, tasks: [OPEN] }, SECTION)
    expect([dry.body.data.created, dry.body.data.updated, dry.body.data.moved]).toEqual([0, 1, 1])
    expect((await boardTasks()).some((task) => task.id === before.id)).toBe(true)

    const moved = await send({ source: "bordio", allowUnmatched: true, relocate: true, tasks: [OPEN] }, SECTION)
    expect([moved.status, moved.body.data.moved]).toEqual([200, 1])
    const task = await bypass(() => prisma.task.findFirstOrThrow({
      where: { id: before.id },
      include: { comments: true, checklist: true, activities: { orderBy: { createdAt: "asc" } } },
    }))
    expect({
      board: task.divisionId, key: task.taskKey, lane: task.boardColumnKey, comments: task.comments.length, checklist: task.checklist.length,
      last: task.activities.filter((a) => a.action === "board_changed").map((a) => [a.oldValue, a.newValue, (a.metadata as { previousTaskKey?: string }).previousTaskKey]),
    }).toEqual({
      board: SECTION, key: "DZEY-1", lane: "sec_todo", comments: 1, checklist: 2,
      last: [["Ümumi Marketinq", "Zeytun", before.taskKey]],
    })
    expect((await boardTasks()).some((t) => t.id === before.id)).toBe(false)

    // Running the same batch again is a plain update on the new board.
    const again = await send({ source: "bordio", allowUnmatched: true, relocate: true, tasks: [OPEN] }, SECTION)
    expect([again.body.data.updated, again.body.data.moved]).toEqual([1, 0])
    const still = await bypass(() => prisma.task.findFirstOrThrow({ where: { id: before.id }, select: { taskKey: true } }))
    expect(still.taskKey).toBe("DZEY-1")
  })

  it("carries the other tool's calendar day into «Başlama tarixi» — that field only, quietly, by the day in Baku", async () => {
    const sendDays = async (body: unknown) => {
      const res = await daysRoute(request("POST", "/api/v1/tasks/import-external/planned-days", body), { params: Promise.resolve({}) })
      return { status: res.status, body: await res.json() }
    }
    const read = () => bypass(() => prisma.task.findMany({
      where: { organizationId: ORG, externalId: { in: [OPEN.externalId, DONE.externalId] } },
      select: { externalId: true, startDate: true, title: true, status: true, dueDate: true, updatedAt: true, _count: { select: { activities: true } } },
      orderBy: { externalId: "asc" },
    }))
    // As the first import left it: Bordio's hidden «start», written as 00:00Z.
    await bypass(() => prisma.task.updateMany({ where: { organizationId: ORG, externalId: OPEN.externalId }, data: { startDate: new Date("2026-11-04T00:00:00.000Z") } }))
    await bypass(() => prisma.task.updateMany({ where: { organizationId: ORG, externalId: DONE.externalId }, data: { startDate: new Date("2026-11-02T00:00:00.000Z") } }))
    const before = await read()

    const body = { source: "bordio", timeZone: "Asia/Baku", days: [
      { externalId: OPEN.externalId, day: "2026-11-06" }, // the calendar shows it on Friday
      { externalId: DONE.externalId, day: "2026-11-02" }, // same day already — left as it is
      { externalId: "bordio-never-imported", day: "2026-11-05" },
    ] }
    const dry = await sendDays({ ...body, dryRun: true })
    expect(dry.status, JSON.stringify(dry.body)).toBe(200)
    expect(dry.body.data).toEqual({ dryRun: true, matched: 2, changed: 1, cleared: 0, missing: ["bordio-never-imported"], missingCount: 1 })
    expect(await read()).toEqual(before)

    session.current = { user: { id: "viewer", organizationId: ORG, role: "manager", email: "viewer@zeytun.test", name: "M" } }
    expect((await sendDays(body)).status).toBe(403)
    session.current = { user: { id: "admin", organizationId: ORG, role: "admin", email: "admin@zeytun.test", name: "Admin" } }

    const run = await sendDays(body)
    expect(run.status, JSON.stringify(run.body)).toBe(200)
    const after = await read()
    const open = after.find((task) => task.externalId === OPEN.externalId)!
    const done = after.find((task) => task.externalId === DONE.externalId)!
    expect(open.startDate?.toISOString()).toBe("2026-11-05T20:00:00.000Z") // midnight of 6 Nov in Baku
    expect(done.startDate?.toISOString()).toBe("2026-11-02T00:00:00.000Z")
    // Nothing else moved and no history line was written.
    const was = before.find((task) => task.externalId === OPEN.externalId)!
    expect([open.title, open.status, open.dueDate, open._count.activities]).toEqual([was.title, was.status, was.dueDate, was._count.activities])

    // No day in the other tool's calendar: the waiting list.
    const clear = await sendDays({ source: "bordio", timeZone: "Asia/Baku", days: [{ externalId: OPEN.externalId, day: null }] })
    expect(clear.body.data).toMatchObject({ changed: 1, cleared: 1 })
    expect((await read()).find((task) => task.externalId === OPEN.externalId)!.startDate).toBeNull()
    expect(mail.sent).toEqual([])
    expect(await bypass(() => prisma.notification.count({ where: { organizationId: ORG } }))).toBe(0)
  })

  it("the list hands out a board past 200 tasks page by page, every card exactly once", async () => {
    // Same position, no deadline, same instant: only the id tells them apart.
    const at = new Date("2026-01-01T00:00:00.000Z")
    await bypass(() => prisma.task.createMany({
      data: Array.from({ length: 450 }, (_, i) => ({
        organizationId: ORG, divisionId: BOARD, title: `bulk ${i}`, status: "done", boardPosition: 0, createdAt: at,
      })),
    }))
    const total = await bypass(() => prisma.task.count({ where: { organizationId: ORG, divisionId: BOARD } }))

    const seen: string[] = []
    for (let offset = 0; offset < total; offset += 200) {
      const res = await listRoute(request("GET", `/api/v1/tasks?divisionId=${BOARD}&limit=200&offset=${offset}`))
      const body = await res.json()
      expect(body.data.total).toBe(total)
      seen.push(...body.data.tasks.map((task: { id: string }) => task.id))
    }
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
  })
})
