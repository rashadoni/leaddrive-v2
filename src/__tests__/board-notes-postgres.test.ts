/**
 * «Qeydlər» — a board's notes (owner, 2026-11-06: Bordio's Notes tool) against
 * a real Postgres, through the real route handlers:
 *
 *  - an admin, a member of the board and a member of its department read and
 *    write; a member whose department grant is denied on this board, and
 *    someone with no grant, get 404 — the board does not exist for them;
 *  - a member who may view but not edit reads and is refused a write (403);
 *  - a note of another board or organization cannot be reached by id;
 *  - the table ships under FORCE ROW LEVEL SECURITY with the tenant policy.
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
  const name = `board_notes_${process.pid}`
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
const ORG = "org-notes"
const OTHER_ORG = "org-notes-other"
const DEPARTMENT = "div-digital"
const BOARD = "div-digital-zeytun"
const OTHER_BOARD = "div-traditional-zeytun"
const FOREIGN_BOARD = "div-foreign"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "board-notes-schema-"))
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
const onNote = (id: string, noteId: string) => ({ params: Promise.resolve({ id, noteId }) })

const FULL = { canView: true, canEdit: true, canCreateTask: true, canComment: true, canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true, canMoveToReview: true, canMoveBack: true }
const VIEW_ONLY = { ...FULL, canEdit: false, canCreateTask: false, canComment: false, canMoveToTodo: false, canMoveToInProgress: false, canMoveToTesting: false, canMoveToReview: false, canMoveBack: false }
const DENY = { ...VIEW_ONLY, canView: false }

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("board notes on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let list!: typeof import("@/app/api/v1/divisions/[id]/notes/route")
  let one!: typeof import("@/app/api/v1/divisions/[id]/notes/[noteId]/route")

  const as = (id: string, role: string, organizationId = ORG) => {
    session.current = { user: { id, organizationId, role, email: `${id}@notes.test`, name: id } }
  }
  const call = async (res: Response | Promise<Response>) => { const r = await res; return { status: r.status, body: await r.json() } }
  const readNotes = (board = BOARD) => call(list.GET(request("GET", `/api/v1/divisions/${board}/notes`), onBoard(board)))
  const addNote = (body: unknown, board = BOARD) => call(list.POST(request("POST", `/api/v1/divisions/${board}/notes`, body), onBoard(board)))
  const editNote = (noteId: string, body: unknown, board = BOARD) => call(one.PATCH(request("PATCH", `/api/v1/divisions/${board}/notes/${noteId}`, body), onNote(board, noteId)))
  const dropNote = (noteId: string, board = BOARD) => call(one.DELETE(request("DELETE", `/api/v1/divisions/${board}/notes/${noteId}`), onNote(board, noteId)))

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    list = await import("@/app/api/v1/divisions/[id]/notes/route")
    one = await import("@/app/api/v1/divisions/[id]/notes/[noteId]/route")
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "notes"], [OTHER_ORG, "notes-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, tasks: true } } })
      }
      for (const [id, organizationId, role] of [
        ["admin", ORG, "admin"], ["member", ORG, "sales"], ["dept-member", ORG, "sales"], ["denied", ORG, "sales"],
        ["viewer", ORG, "sales"], ["stranger", ORG, "sales"], ["outsider", OTHER_ORG, "admin"],
      ]) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@notes.test`, name: id, passwordHash: "-", role, isActive: true } })
      }
      await prisma.division.create({ data: { id: DEPARTMENT, organizationId: ORG, key: "DIG", name: "Digital Marketing", isDepartment: true } })
      await prisma.division.create({ data: { id: BOARD, organizationId: ORG, key: "DZEY", name: "Zeytun", parentDivisionId: DEPARTMENT } })
      await prisma.division.create({ data: { id: OTHER_BOARD, organizationId: ORG, key: "TZEY", name: "Zeytun" } })
      await prisma.division.create({ data: { id: FOREIGN_BOARD, organizationId: OTHER_ORG, key: "FOR", name: "Foreign" } })
      await prisma.boardPermission.createMany({ data: [
        { organizationId: ORG, userId: "member", divisionId: BOARD, ...FULL },
        { organizationId: ORG, userId: "dept-member", divisionId: DEPARTMENT, ...FULL },
        { organizationId: ORG, userId: "denied", divisionId: DEPARTMENT, ...FULL },
        { organizationId: ORG, userId: "denied", divisionId: BOARD, ...DENY },
        { organizationId: ORG, userId: "viewer", divisionId: BOARD, ...VIEW_ONLY },
      ] })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => as("admin", "admin"))

  it("lets the board's people write and read, newest change first, with the author", async () => {
    const first = await addNote({ title: "Brief", content: "Diabet kampaniyası" })
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    as("member", "sales")
    const second = await addNote({ title: "Post plan" })
    as("dept-member", "sales")
    const edited = await editNote(first.body.data.id, { content: "Diabet kampaniyası — noyabr" })
    expect(edited.status).toBe(200)

    const read = await readNotes()
    expect(read.status).toBe(200)
    expect(read.body.data.canWrite).toBe(true)
    expect(read.body.data.notes.map((n: { title: string; content: string; createdBy: { name: string } }) => [n.title, n.content, n.createdBy?.name]))
      .toEqual([["Brief", "Diabet kampaniyası — noyabr", "admin"], ["Post plan", "", "member"]])
    expect(second.status).toBe(201)
  })

  it("hides the board from someone without access and from a denied department member", async () => {
    for (const [id] of [["stranger"], ["denied"]]) {
      as(id, "sales")
      expect((await readNotes()).status).toBe(404)
      expect((await addNote({ title: "x" })).status).toBe(404)
    }
  })

  it("lets a view-only member read but not write", async () => {
    as("viewer", "sales")
    const read = await readNotes()
    expect([read.status, read.body.data.canWrite, read.body.data.notes.length]).toEqual([200, false, 2])
    const noteId = read.body.data.notes[0].id
    expect((await addNote({ title: "x" })).status).toBe(403)
    expect((await editNote(noteId, { title: "y" })).status).toBe(403)
    expect((await dropNote(noteId)).status).toBe(403)
  })

  it("does not reach a note through another board or another organization", async () => {
    const noteId = (await readNotes()).body.data.notes[0].id
    expect((await editNote(noteId, { title: "moved" }, OTHER_BOARD)).status).toBe(404)
    as("outsider", "admin", OTHER_ORG)
    expect((await readNotes()).status).toBe(404)
    expect((await dropNote(noteId)).status).toBe(404)
    as("admin", "admin")
    expect((await readNotes()).body.data.notes.map((n: { title: string }) => n.title)).toContain("Brief")
  })

  it("refuses an empty title and deletes a note for good", async () => {
    expect((await addNote({ title: "  " })).status).toBe(400)
    const before = (await readNotes()).body.data.notes
    expect((await dropNote(before[1].id)).status).toBe(200)
    expect((await readNotes()).body.data.notes.map((n: { id: string }) => n.id)).toEqual([before[0].id])
  })
})

describe("board notes migration", () => {
  it("ships the table under FORCE ROW LEVEL SECURITY with the tenant policy", () => {
    const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261128100000_board_notes/migration.sql"), "utf8")
    expect(sql).toContain('ALTER TABLE "board_notes" ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE "board_notes" FORCE ROW LEVEL SECURITY')
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON "board_notes"\s+USING \("organizationId" = current_setting\('app\.org_id', true\)/)
  })
})
