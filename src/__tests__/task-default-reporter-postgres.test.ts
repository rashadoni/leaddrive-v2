/**
 * «Tapşırığı verən» on every new task (src/lib/tasks/default-reporter.ts)
 * against a real Postgres, through the real route handlers.
 *
 * Nazrin, Zeytun, 2026-11-18: «men default butun tasklarda reporter olum… her
 * defe meni secmesinler»; owner, 2026-11-19: «у админа на всех задачах».
 *
 *  - the admin sets (and clears) the organization's default reporter; a
 *    manager or an employee does not; a person of another organization or one
 *    who left is refused;
 *  - a task made without naming a reporter gets the default, and the default
 *    follows it — a message on the task reaches her;
 *  - a maker who picks somebody else, or «nobody», keeps that choice;
 *  - a default reporter who left is put on nothing;
 *  - every organization reads its own default only.
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
  const name = `task_default_reporter_${process.pid}`
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
const ORG = "org-reporter"
const OTHER_ORG = "org-reporter-other"
const BOARD = "div-reporter"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "task-default-reporter-schema-"))
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

pgDescribe("the default reporter of new tasks on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let route!: typeof import("@/app/api/v1/tasks/default-reporter/route")
  let tasks!: typeof import("@/app/api/v1/tasks/route")

  const as = (id: string, role: string, organizationId = ORG) => {
    session.current = { user: { id, organizationId, role, email: `${id}@reporter.test`, name: id } }
  }
  const call = async (res: Response | Promise<Response>) => { const r = await res; return { status: r.status, body: await r.json() } }
  const readDefault = () => call(route.GET(request("GET", "/api/v1/tasks/default-reporter")))
  const setDefault = (reporterId: unknown) => call(route.PUT(request("PUT", "/api/v1/tasks/default-reporter", { reporterId })))
  const makeTask = async (extra: Record<string, unknown> = {}) => {
    const res = await call(tasks.POST(request("POST", "/api/v1/tasks", { title: "Pharmastore 446 banner", divisionId: BOARD, status: "backlog", ...extra })))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const id = res.body.data.id as string
    return bypass(() => prisma.task.findUniqueOrThrow({
      where: { id },
      select: { reporterId: true, followers: { select: { userId: true } } },
    }))
  }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    route = await import("@/app/api/v1/tasks/default-reporter/route")
    tasks = await import("@/app/api/v1/tasks/route")
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "reporter"], [OTHER_ORG, "reporter-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, tasks: true } } })
      }
      for (const [id, organizationId, role, isActive] of [
        ["nazrin", ORG, "admin", true], ["sabina", ORG, "manager", true], ["rashida", ORG, "sales", true],
        ["gone", ORG, "sales", false], ["outsider", OTHER_ORG, "admin", true],
      ] as const) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@reporter.test`, name: id, passwordHash: "-", role, isActive } })
      }
      await prisma.division.create({ data: { id: BOARD, organizationId: ORG, key: "PS", name: "Pharmastore" } })
      await prisma.boardPermission.create({ data: { organizationId: ORG, userId: "rashida", divisionId: BOARD, ...FULL } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => as("nazrin", "admin"))

  it("nobody is the default until the admin names one; a manager and an employee cannot", async () => {
    expect((await readDefault()).body.data).toEqual({ reporter: null, canManage: true })
    as("rashida", "sales")
    expect((await readDefault()).body.data).toEqual({ reporter: null, canManage: false })
    expect((await setDefault("rashida")).status).toBe(403)
    as("sabina", "manager")
    expect((await setDefault("sabina")).status).toBe(403)
    as("nazrin", "admin")
    expect((await setDefault("outsider")).status).toBe(400)
    expect((await setDefault("gone")).status).toBe(400)
    expect((await setDefault(42)).status).toBe(400)
    const set = await setDefault("nazrin")
    expect(set.status, JSON.stringify(set.body)).toBe(200)
    as("rashida", "sales")
    expect((await readDefault()).body.data.reporter).toEqual({ id: "nazrin", name: "nazrin" })
    // Another organization has its own (none).
    as("outsider", "admin", OTHER_ORG)
    expect((await readDefault()).body.data.reporter).toBeNull()
  })

  it("a task its maker opens for herself gets the default reporter, who follows it", async () => {
    as("rashida", "sales")
    const task = await makeTask({ assignedTo: "rashida" })
    expect(task.reporterId).toBe("nazrin")
    expect(task.followers.map((f: { userId: string }) => f.userId)).toEqual(["nazrin"])
  })

  it("a maker's own pick stands: somebody else, or nobody", async () => {
    as("rashida", "sales")
    const other = await makeTask({ reporterId: "sabina" })
    expect(other.reporterId).toBe("sabina")
    expect(other.followers.map((f: { userId: string }) => f.userId)).toEqual(["sabina"])
    const none = await makeTask({ reporterId: null })
    expect(none.reporterId).toBeNull()
    expect(none.followers).toEqual([])
    const res = await call(tasks.POST(request("POST", "/api/v1/tasks", { title: "x", divisionId: BOARD, status: "backlog", reporterId: "outsider" })))
    expect(res.status).toBe(400)
  })

  it("a default reporter who left is put on nothing; cleared, the default is nobody", async () => {
    await bypass(() => prisma.user.update({ where: { id: "nazrin" }, data: { isActive: false } }))
    as("rashida", "sales")
    expect((await makeTask()).reporterId).toBeNull()
    expect((await readDefault()).body.data.reporter).toBeNull()
    await bypass(() => prisma.user.update({ where: { id: "nazrin" }, data: { isActive: true } }))

    as("nazrin", "admin")
    expect((await setDefault(null)).status).toBe(200)
    as("rashida", "sales")
    expect((await makeTask()).reporterId).toBeNull()
    const org = await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: ORG }, select: { settings: true } }))
    expect(org.settings).not.toHaveProperty("taskDefaultReporterId")
  })
})
