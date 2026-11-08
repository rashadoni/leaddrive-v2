/**
 * The Bordio-style task card (owner, 2026-11-07) against a real Postgres,
 * through the real route handlers:
 *
 *  - a message with an @-mention: the author and the mentioned follow the
 *    task, the mentioned is told «mentioned», a follower «comment», the
 *    author nobody; someone off the board cannot read or write it (404);
 *  - subtasks carry an assignee and a deadline; ticking one off stamps it and
 *    writes «subtask closed» into the time line;
 *  - start date, reporter, tags, due date and priority changes land and show
 *    in the time line; a new assignee and a reporter start following;
 *  - a timer starts, a second one elsewhere stops the first, and time can be
 *    written by hand; the database itself refuses two running timers;
 *  - the import adds the other tool's subtask people and dates, reporter,
 *    followers and history to tasks already brought over, without doubling.
 *  - `detailsOnly` writes the other tool's time records onto a task already
 *    brought over and leaves the task as people have since changed it; a
 *    re-run adds nothing, a task not brought over is refused.
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
  const name = `task_card_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
const notified = vi.hoisted(() => ({ list: [] as Array<{ userId?: string; kind?: string; title: string }> }))
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  createNotification: async (input: { userId?: string; kind?: string; title: string }) => { notified.list.push({ userId: input.userId, kind: input.kind, title: input.title }); return null },
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const ORG = "org-card"
const BOARD = "div-card"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "task-card-schema-"))
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

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("Bordio-style task card on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let comments!: typeof import("@/app/api/v1/tasks/[id]/comments/route")
  let feed!: typeof import("@/app/api/v1/tasks/[id]/feed/route")
  let followers!: typeof import("@/app/api/v1/tasks/[id]/followers/route")
  let checklist!: typeof import("@/app/api/v1/tasks/[id]/checklist/route")
  let time!: typeof import("@/app/api/v1/tasks/[id]/time/route")
  let taskRoute!: typeof import("@/app/api/v1/tasks/[id]/route")
  let importRoute!: typeof import("@/app/api/v1/divisions/[id]/import-external/route").POST

  const as = (id: string, role: string) => {
    session.current = { user: { id, organizationId: ORG, role, email: `${id}@card.test`, name: id } }
  }
  const call = async (res: Response | Promise<Response>) => { const r = await res; return { status: r.status, body: await r.json() } }
  const onTask = (id: string) => ({ params: Promise.resolve({ id }) })
  const readFeed = (task = "task-1") => call(feed.GET(request("GET", `/api/v1/tasks/${task}/feed`), onTask(task)))

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    // The one-running-timer rule lives in the migration, not in schema.prisma.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env,
      'CREATE UNIQUE INDEX "task_time_entries_one_running_timer" ON "task_time_entries"("userId") WHERE "endedAt" IS NULL')
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    comments = await import("@/app/api/v1/tasks/[id]/comments/route")
    feed = await import("@/app/api/v1/tasks/[id]/feed/route")
    followers = await import("@/app/api/v1/tasks/[id]/followers/route")
    checklist = await import("@/app/api/v1/tasks/[id]/checklist/route")
    time = await import("@/app/api/v1/tasks/[id]/time/route")
    taskRoute = await import("@/app/api/v1/tasks/[id]/route")
    importRoute = (await import("@/app/api/v1/divisions/[id]/import-external/route")).POST
    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "card", slug: "card", modules: { crm: true, tasks: true } } })
      for (const [id, role] of [["admin", "admin"], ["sabina", "sales"], ["nazrin", "sales"], ["aytan", "sales"], ["outsider", "sales"]]) {
        await prisma.user.create({ data: { id, organizationId: ORG, email: `${id}@card.test`, name: id, passwordHash: "-", role, isActive: true } })
      }
      await prisma.taskType.create({ data: { organizationId: ORG, name: "task", displayName: "Task" } })
      await prisma.division.create({ data: { id: BOARD, organizationId: ORG, key: "CARD", name: "Card board" } })
      const full = { canView: true, canEdit: true, canCreateTask: true, canComment: true, canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true, canMoveToReview: true, canMoveBack: true }
      for (const userId of ["sabina", "nazrin", "aytan"]) await prisma.boardPermission.create({ data: { organizationId: ORG, userId, divisionId: BOARD, ...full } })
      await prisma.boardColumn.createMany({ data: [["todo", 0], ["in_progress", 1], ["done", 2]].map(([stage, sortOrder]) => ({ organizationId: ORG, divisionId: BOARD, key: `c_${stage}`, label: String(stage), mapsToStatus: String(stage), sortOrder: Number(sortOrder) })) })
      await prisma.task.create({ data: { id: "task-1", organizationId: ORG, divisionId: BOARD, taskKey: "CARD-1", title: "Vebsayt reklamları", status: "in_progress", createdBy: "sabina", assignedTo: "sabina" } })
      await prisma.taskFollower.create({ data: { organizationId: ORG, taskId: "task-1", userId: "aytan" } })
    })
  }, 600_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => { notified.list = []; as("admin", "admin") })

  it("a message with an @-mention: followers and the mentioned are told, the author is not, and both follow", async () => {
    as("sabina", "sales")
    const res = await call(comments.POST(request("POST", "/api/v1/tasks/task-1/comments", { content: "@nazrin bax", mentions: ["nazrin", "outsider-not-a-user"] }), onTask("task-1")))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.mentions).toEqual(["nazrin"])
    expect(notified.list.map((n) => [n.userId, n.kind]).sort()).toEqual([["aytan", "task.comment"], ["nazrin", "task.mentioned"]])

    const view = await readFeed()
    expect(view.body.data.followers.map((f: { id: string }) => f.id).sort()).toEqual(["aytan", "nazrin", "sabina"])
    expect(view.body.data.following).toBe(true)
    expect(view.body.data.items.at(-1)).toMatchObject({ kind: "message", text: "@nazrin bax", user: { id: "sabina" } })

    as("outsider", "sales")
    expect((await readFeed()).status).toBe(404)
    expect((await call(comments.POST(request("POST", "/api/v1/tasks/task-1/comments", { content: "x" }), onTask("task-1")))).status).toBe(404)
  })

  it("follows and unfollows oneself", async () => {
    as("outsider", "sales")
    expect((await call(followers.POST(request("POST", "/api/v1/tasks/task-1/followers", {}), onTask("task-1")))).status).toBe(404)
    as("aytan", "sales")
    expect((await call(followers.DELETE(request("DELETE", "/api/v1/tasks/task-1/followers"), onTask("task-1")))).status).toBe(200)
    expect((await readFeed()).body.data.following).toBe(false)
    expect((await call(followers.POST(request("POST", "/api/v1/tasks/task-1/followers", {}), onTask("task-1")))).status).toBe(200)
    expect((await readFeed()).body.data.following).toBe(true)
  })

  it("subtasks carry an assignee and a deadline; closing one is stamped and shows in the time line", async () => {
    const made = await call(checklist.POST(request("POST", "/api/v1/tasks/task-1/checklist", { title: "ga4 quraşdırılması", assignedTo: "sabina", dueDate: "2026-11-12T19:59:59.000Z" }), onTask("task-1")))
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    expect([made.body.data.assignee?.name, made.body.data.dueDate]).toEqual(["sabina", "2026-11-12T19:59:59.000Z"])
    expect((await call(checklist.POST(request("POST", "/api/v1/tasks/task-1/checklist", { title: "x", assignedTo: "nobody" }), onTask("task-1")))).status).toBe(400)

    const done = await call(checklist.PATCH(request("PATCH", "/api/v1/tasks/task-1/checklist", { id: made.body.data.id, completed: true }), onTask("task-1")))
    expect(done.body.data.completedAt).toBeTruthy()
    const events = (await readFeed()).body.data.items.filter((i: { kind: string }) => i.kind === "event")
    expect(events.at(-1)).toMatchObject({ action: "subtask_completed", newValue: "ga4 quraşdırılması", user: { id: "admin" } })
  })

  it("start date, reporter, tags, due date and priority land, show in the time line, and the reporter follows", async () => {
    const patch = await call(taskRoute.PATCH(request("PATCH", "/api/v1/tasks/task-1", {
      startDate: "2025-12-02T00:00:00.000Z", reporterId: "nazrin", tags: ["meta", " meta ", "ga4"], dueDate: "2026-12-04T19:59:59.000Z", priority: "critical",
    }), onTask("task-1")))
    expect(patch.status, JSON.stringify(patch.body)).toBe(200)
    const task = await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: "task-1" }, select: { startDate: true, reporterId: true, tags: true } }))
    expect([task.startDate?.toISOString(), task.reporterId, task.tags]).toEqual(["2025-12-02T00:00:00.000Z", "nazrin", ["meta", "ga4"]])
    const actions = (await readFeed()).body.data.items.filter((i: { kind: string }) => i.kind === "event").map((i: { action: string; newValue: string }) => [i.action, i.newValue])
    expect(actions).toEqual(expect.arrayContaining([
      ["start_date_changed", "2025-12-02T00:00:00.000Z"], ["reporter_changed", "nazrin"], ["due_date_changed", "2026-12-04T19:59:59.000Z"], ["priority_changed", "critical"],
    ]))
    const read = await call(taskRoute.GET(request("GET", "/api/v1/tasks/task-1"), onTask("task-1")))
    expect(read.body.data.reporter?.name).toBe("nazrin")
    expect((await call(taskRoute.PATCH(request("PATCH", "/api/v1/tasks/task-1", { reporterId: "nobody" }), onTask("task-1")))).status).toBe(400)
  })

  it("a timer runs on one task at a time, time can be written by hand, and the database refuses two running timers", async () => {
    await bypass(() => prisma.task.create({ data: { id: "task-2", organizationId: ORG, divisionId: BOARD, taskKey: "CARD-2", title: "İkinci", status: "todo" } }))
    as("sabina", "sales")
    const post = (task: string, body: unknown) => call(time.POST(request("POST", `/api/v1/tasks/${task}/time`, body), onTask(task)))
    expect((await post("task-1", { action: "start" })).body.data.running).toBeTruthy()
    const second = await post("task-2", { action: "start" })
    expect(second.body.data.running).toBeTruthy()
    const first = await call(time.GET(request("GET", "/api/v1/tasks/task-1/time"), onTask("task-1")))
    expect([first.body.data.running, first.body.data.entries[0].endedAt !== null]).toEqual([null, true])

    const logged = await post("task-1", { action: "log", minutes: 90, note: "GA4" })
    expect(logged.body.data.totalMinutes).toBeGreaterThanOrEqual(90)
    expect((await post("task-1", { action: "log", minutes: 0 })).status).toBe(400)

    await expect(bypass(() => prisma.taskTimeEntry.create({ data: { organizationId: ORG, taskId: "task-1", userId: "sabina", source: "timer", startedAt: new Date() } })))
      .rejects.toThrow()
  })

  it("the import adds subtask people and dates, reporter, followers and history to a task already brought over — once", async () => {
    const base = {
      externalId: "bordio-pha-95", title: "Vebsayta yönləndirməli reklamlar", status: "in_progress", createdAt: "2025-12-02T10:33:15.785Z",
      assigneeEmails: ["sabina@card.test"], creatorEmail: "sabina@card.test",
      checklist: [{ title: "pixel quraşdırılması", completed: true }], comments: [],
    }
    const first = await call(importRoute(request("POST", `/api/v1/divisions/${BOARD}/import-external`, { source: "bordio", tasks: [base] }), onTask(BOARD)))
    expect(first.status, JSON.stringify(first.body)).toBe(200)

    const detailed = {
      ...base,
      reporterEmail: "nazrin@card.test", startDate: "2025-12-02T00:00:00.000Z", followerEmails: ["aytan@card.test"], tags: ["meta"], estimatedMinutes: 90,
      checklist: [
        { title: "pixel quraşdırılması", completed: true, assigneeEmail: "sabina@card.test", completedAt: "2026-11-03T15:04:00.000Z" },
        { title: "ga4 quraşdırılması", completed: false, assigneeEmail: "sabina@card.test", dueDate: "2026-11-12T19:59:59.000Z" },
      ],
      events: [{ externalId: "ev-1", at: "2026-03-05T15:18:00.000Z", actorEmail: "sabina@card.test", actorName: "Sabina Hasanova", text: "changed the task's due date to 12 Mar 2026" }],
    }
    for (let run = 0; run < 2; run += 1) {
      const res = await call(importRoute(request("POST", `/api/v1/divisions/${BOARD}/import-external`, { source: "bordio", refreshDetails: true, tasks: [detailed] }), onTask(BOARD)))
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    }
    const task = await bypass(() => prisma.task.findFirstOrThrow({
      where: { organizationId: ORG, externalId: "bordio-pha-95" },
      include: { checklist: { orderBy: { sortOrder: "asc" } }, followers: true, activities: { where: { action: "external_event" } } },
    }))
    expect({
      reporter: task.reporterId, start: task.startDate?.toISOString(), tags: task.tags, estimate: Number(task.estimatedHours),
      subtasks: task.checklist.map((c) => [c.title, c.assignedTo, c.dueDate?.toISOString() ?? null, c.completedAt?.toISOString() ?? null]),
      followers: task.followers.map((f) => f.userId), events: task.activities.map((a) => [a.userId, (a.metadata as { text: string }).text]),
    }).toEqual({
      reporter: "nazrin", start: "2025-12-02T00:00:00.000Z", tags: ["meta"], estimate: 1.5,
      subtasks: [["pixel quraşdırılması", "sabina", null, "2026-11-03T15:04:00.000Z"], ["ga4 quraşdırılması", "sabina", "2026-11-12T19:59:59.000Z", null]],
      followers: ["aytan"], events: [["sabina", "changed the task's due date to 12 Mar 2026"]],
    })
  })

  it("detailsOnly brings the other tool's time onto a task already here, leaves the task alone, and adds nothing on a re-run", async () => {
    const stale = {
      externalId: "bordio-pha-95", title: "Vebsayta yönləndirməli reklamlar", status: "todo", createdAt: "2025-12-02T10:33:15.785Z",
      assigneeEmails: ["nazrin@card.test"], checklist: [], comments: [],
      timeEntries: [
        { userEmail: "sabina@card.test", startedAt: "2025-11-04T00:00:00.000Z", minutes: 171, source: "timer" },
        { userEmail: "sabina@card.test", startedAt: "2025-11-04T00:00:00.000Z", minutes: 171, source: "timer" },
        { userEmail: "aytan@card.test", startedAt: "2026-02-24T00:00:00.000Z", minutes: 45 },
      ],
    }
    const send = (body: unknown) => call(importRoute(request("POST", `/api/v1/divisions/${BOARD}/import-external`, body), onTask(BOARD)))
    const id = (await bypass(() => prisma.task.findFirstOrThrow({ where: { organizationId: ORG, externalId: "bordio-pha-95" }, select: { id: true } }))).id
    await bypass(() => prisma.task.update({ where: { id }, data: { title: "Renamed in the CRM", status: "done", completedAt: new Date("2026-11-08T08:00:00.000Z") } }))
    const before = await bypass(() => prisma.taskTimeEntry.count({ where: { organizationId: ORG, taskId: id } }))

    const missing = await send({ source: "bordio", detailsOnly: true, tasks: [{ ...stale, externalId: "never-brought" }] })
    expect([missing.status, missing.body.error]).toEqual([409, "Task never-brought was not brought over yet"])
    const dry = await send({ source: "bordio", detailsOnly: true, dryRun: true, tasks: [stale] })
    expect([dry.status, dry.body.data.created, dry.body.data.updated, dry.body.data.newTaskTypes]).toEqual([200, 0, 1, []])
    for (let run = 0; run < 2; run += 1) {
      const res = await send({ source: "bordio", detailsOnly: true, tasks: [stale] })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    }

    const task = await bypass(() => prisma.task.findFirstOrThrow({
      where: { id },
      select: { title: true, status: true, assignedTo: true, timeEntries: { where: { minutes: { in: [171, 45] } }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] } },
    }))
    expect({
      title: task.title, status: task.status, assignee: task.assignedTo,
      entries: task.timeEntries.map((e) => [e.userId, e.source, e.startedAt.toISOString(), e.endedAt?.toISOString(), e.minutes]),
    }).toEqual({
      title: "Renamed in the CRM", status: "done", assignee: "sabina",
      entries: [
        ["sabina", "timer", "2025-11-04T00:00:00.000Z", "2025-11-04T00:00:00.000Z", 171],
        ["sabina", "timer", "2025-11-04T00:00:00.000Z", "2025-11-04T00:00:00.000Z", 171],
        ["aytan", "manual", "2026-02-24T00:00:00.000Z", "2026-02-24T00:00:00.000Z", 45],
      ],
    })
    expect(await bypass(() => prisma.taskTimeEntry.count({ where: { organizationId: ORG, taskId: id } }))).toBe(before + 3)
    const summary = await call(time.GET(request("GET", `/api/v1/tasks/${id}/time`), onTask(id)))
    expect([summary.body.data.totalMinutes >= 387, summary.body.data.running]).toEqual([true, null])
  })
})
