/**
 * Saving client categories, and filling a category field on a contact, against
 * a real Postgres.
 *
 * Why this exists: on 2026-10-02 the category editor shipped with every unit
 * test green and could not save once on prod. The transaction opened with
 * `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``; that function returns
 * `void`, Prisma cannot deserialize it, and the request died with P2010 before
 * touching a table. The tests mock Prisma, and a mock answers any raw query.
 * The same call had been copied from routes that had themselves never run.
 *
 * Here the real handlers run over a scratch database built from the real
 * schema, with the dictionary table's CHECK and one-active-version index taken
 * from its migration. Only the session and the tenant's plan are stubbed.
 *
 * The task handlers at the bottom took their lock the same way (some thirty
 * call sites did; `advisory-lock-uses-execute-raw.test.ts` keeps the pattern
 * from returning). They are here because fixing the lock is not the same as
 * the action working: behind it sits raw SQL that had never met a database.
 *
 * Set MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM client categories database gate»), where
 * `MTM_CONTACT_CATEGORIES_DB_GATE=required` turns a missing URL into a failure
 * so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_CONTACT_CATEGORIES_DB_GATE === "required") {
  throw new Error("MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL is required by the MTM client categories database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_CONTACT_CATEGORIES_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_contact_categories_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(async () => ({
    orgId: "org-categories",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
// The tenant's plan is not what is under test.
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))

const ROOT = process.cwd()
const ORG = "org-categories"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * `db push` builds tables from schema.prisma, which cannot express a CHECK or
 * a partial index. Those two are what decide whether a saved version is
 * accepted, so they are lifted from the migration that created them.
 */
function dictionaryConstraints(): string[] {
  const sql = readFileSync(
    path.join(ROOT, "prisma/migrations/20260808160000_mtm_contact_dictionaries/migration.sql"),
    "utf8",
  )
  const oneActive = sql.match(/CREATE UNIQUE INDEX "mtm_contact_dict_one_active_kind_key"[\s\S]*?;/)
  const signature = sql.match(/ALTER TABLE "mtm_contact_dictionaries"\s+ADD CONSTRAINT "mtm_contact_dict_signature_check"[\s\S]*?\);/)
  if (!oneActive || !signature) throw new Error("dictionary constraints not found in their migration")
  return [oneActive[0], signature[0]]
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the deploy's database service is plain
 * `postgres:16` without that extension (the pull-request one has it), and the
 * first version of this gate stopped every deploy by asking for it. Nothing
 * here reads those columns, so they are left out of the scratch schema.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-contact-categories-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/**
 * One task per idempotency key is a partial unique index; schema.prisma only
 * declares the plain one.
 */
function taskSourceKeyIndex(): string {
  const sql = readFileSync(
    path.join(ROOT, "prisma/migrations/20260713170000_mtm_visit_next_action_idempotency/migration.sql"),
    "utf8",
  )
  const index = sql.match(/CREATE UNIQUE INDEX "mtm_tasks_org_source_key_unique"[\s\S]*?;/)
  if (!index) throw new Error("task sourceKey index not found in its migration")
  return index[0]
}

function send(method: "POST" | "PUT", url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function put(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("client categories on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    for (const statement of [...dictionaryConstraints(), taskSourceKeyIndex()]) {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, statement)
    }
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    await bypass(() => prisma.organization.create({ data: { id: ORG, name: "Zeytun Pharma", slug: "categories-test" } }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  it("saves a patient-count field for doctors, then a second edit on top of it", async () => {
    const { GET, PUT } = await import("@/app/api/v1/mtm/contact-categories/route")
    const { contactCategoriesForSave, defaultContactCategories } = await import("@/lib/mtm/contact-category-editor")

    const categories = defaultContactCategories()
    categories[0].fields = [{ key: "", order: 0, type: "NUMBER", required: false, labels: { ru: "", az: "Xəstə sayı", en: "" } }]
    const first = await PUT(put("/api/v1/mtm/contact-categories", {
      expectedDictionaryId: null,
      categories: contactCategoriesForSave(categories, "az"),
    }))
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({ success: true, data: { version: 1, changed: true } })
    expect(first.status).toBe(200)

    categories[0].fields[0].key = "xeste_sayi"
    categories.push({ code: "", order: 0, labels: { ru: "", az: "Tibb bacısı", en: "" }, fields: [] })
    const second = await PUT(put("/api/v1/mtm/contact-categories", {
      expectedDictionaryId: firstBody.data.dictionaryId,
      categories: contactCategoriesForSave(categories, "az"),
    }))
    expect(await second.json()).toMatchObject({ success: true, data: { version: 2, changed: true } })

    const rows = await bypass(() => prisma.mtmContactDictionary.findMany({
      where: { organizationId: ORG, kind: "CLIENT_TYPE" },
      orderBy: { version: "asc" },
      select: { version: true, status: true, retiredAt: true },
    }))
    expect(rows.map((row: { version: number; status: string }) => [row.version, row.status])).toEqual([[1, "RETIRED"], [2, "ACTIVE"]])
    expect(rows[0].retiredAt).toBeInstanceOf(Date)

    const read = await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/contact-categories"))).json()
    expect(read.data.categories.map((category: { code: string }) => category.code))
      .toEqual(["DOCTOR", "PHARMACIST", "OTHER", "TIBB_BACISI"])
    expect(read.data.categories[0].fields[0]).toMatchObject({ key: "xeste_sayi", type: "NUMBER" })
    const audit = await bypass(() => prisma.mtmAuditLog.count({ where: { organizationId: ORG, action: "CONTACT_CATEGORIES_SAVED" } }))
    expect(audit).toBe(2)
  })

  it("stores the patient count on a doctor who existed before the field did", async () => {
    const { PUT } = await import("@/app/api/v1/mtm/contacts/[id]/dictionary-assignments/route")
    const { contactDictionaryAssignmentStateHash } = await import("@/lib/mtm/contact-dictionary-assignment")
    const contact = await bypass(() => prisma.mtmContact.create({
      data: { organizationId: ORG, firstName: "Leyla", lastName: "Əliyeva", displayName: "Əliyeva Leyla", type: "DOCTOR" },
      select: { id: true },
    }))
    const active = await bypass(() => prisma.mtmContactDictionary.findFirstOrThrow({
      where: { organizationId: ORG, kind: "CLIENT_TYPE", status: "ACTIVE" },
      select: { id: true },
    }))

    const response = await PUT(put(`/api/v1/mtm/contacts/${contact.id}/dictionary-assignments`, {
      expectedStateHash: contactDictionaryAssignmentStateHash([]),
      // No reason: this is what the card sends when a manager just fills it in.
      clientType: { dictionaryId: active.id, code: "DOCTOR", values: { xeste_sayi: 120 } },
      psychotype: null,
      productCategories: null,
      brandCategories: null,
    }), { params: Promise.resolve({ id: contact.id }) })
    expect(await response.json()).toMatchObject({ success: true, data: { created: 1 } })

    const stored = await bypass(() => prisma.mtmContact.findUniqueOrThrow({
      where: { id: contact.id },
      select: { type: true, categoryData: true, dictionaryAssignments: { select: { kind: true, entryCode: true, effectiveTo: true } } },
    }))
    expect(stored).toMatchObject({
      type: "DOCTOR",
      categoryData: { xeste_sayi: 120 },
      dictionaryAssignments: [{ kind: "CLIENT_TYPE", entryCode: "DOCTOR", effectiveTo: null }],
    })
  })

  describe("task actions behind the same lock", () => {
    const AGENT_USER = "field-user"
    const params = (id: string) => ({ params: Promise.resolve({ id }) })
    let agentId!: string

    /** The next request is made by the field employee, not by the administrator. */
    async function asAssignee() {
      const { requireAuth } = await import("@/lib/api-auth")
      vi.mocked(requireAuth).mockResolvedValueOnce({
        orgId: ORG,
        userId: AGENT_USER,
        role: "member",
        email: "anar@example.com",
        name: "Anar",
      } as never)
    }

    beforeAll(async () => {
      await bypass(async () => {
        await prisma.user.create({
          data: { id: AGENT_USER, organizationId: ORG, email: "anar@example.com", name: "Anar", passwordHash: "-", role: "member" },
        })
        agentId = (await prisma.mtmAgent.create({
          data: { organizationId: ORG, name: "Anar", userId: AGENT_USER },
          select: { id: true },
        })).id
      })
    })

    it("duplicates a task to another date, and a repeated request returns the same copy", async () => {
      const { POST } = await import("@/app/api/v1/mtm/tasks/[id]/duplicate/route")
      const source = await bypass(() => prisma.mtmTask.create({
        data: { organizationId: ORG, agentId, title: "Həkimə zəng", dueDate: new Date("2026-10-05T09:00:00.000Z") },
        select: { id: true },
      }))
      const body = { targetDueDate: "2026-10-12T09:00:00.000Z", idempotencyKey: "duplicate-to-next-week", expectedVersion: 1 }

      const first = await POST(send("POST", `/api/v1/mtm/tasks/${source.id}/duplicate`, body), params(source.id))
      const firstBody = await first.json()
      expect(firstBody).toMatchObject({ success: true, data: { title: "Həkimə zəng", status: "PENDING", idempotent: false } })
      expect(first.status).toBe(201)

      const again = await POST(send("POST", `/api/v1/mtm/tasks/${source.id}/duplicate`, body), params(source.id))
      expect(await again.json()).toMatchObject({ success: true, data: { id: firstBody.data.id, idempotent: true } })

      const copies = await bypass(() => prisma.mtmTask.findMany({
        where: { organizationId: ORG, copiedFromId: source.id },
        select: { id: true, dueDate: true, events: { select: { type: true } } },
      }))
      expect(copies).toEqual([
        { id: firstBody.data.id, dueDate: new Date("2026-10-12T09:00:00.000Z"), events: [{ type: "COPIED" }] },
      ])
    })

    it("adds a comment to a task", async () => {
      const { POST } = await import("@/app/api/v1/mtm/tasks/[id]/events/route")
      const task = await bypass(() => prisma.mtmTask.create({
        data: { organizationId: ORG, agentId, title: "Aptekə baş çək" },
        select: { id: true },
      }))

      const response = await POST(
        send("POST", `/api/v1/mtm/tasks/${task.id}/events`, { clientEventId: "comment-0001", comment: "Sabah 10:00-da" }),
        params(task.id),
      )
      expect(await response.json()).toMatchObject({ success: true, data: { type: "COMMENTED", comment: "Sabah 10:00-da", idempotent: false } })
      expect(response.status).toBe(201)

      const stored = await bypass(() => prisma.mtmTaskEvent.findMany({
        where: { organizationId: ORG, taskId: task.id },
        select: { type: true, comment: true, clientEventId: true },
      }))
      expect(stored).toEqual([{ type: "COMMENTED", comment: "Sabah 10:00-da", clientEventId: "comment-0001" }])
    })

    it("creates the next occurrence when a repeating task is completed, twice in a row", async () => {
      const { PUT } = await import("@/app/api/v1/mtm/tasks/[id]/route")
      const root = await bypass(() => prisma.mtmTask.create({
        data: {
          organizationId: ORG,
          agentId,
          title: "Həftəlik hesabat",
          dueDate: new Date("2026-10-05T09:00:00.000Z"),
          recurrenceRule: "WEEKLY",
          recurrenceInterval: 1,
          recurrenceTimezone: "Asia/Baku",
        },
        select: { id: true },
      }))

      await asAssignee()
      const first = await PUT(
        send("PUT", `/api/v1/mtm/tasks/${root.id}`, { status: "COMPLETED", result: "Göndərildi", expectedVersion: 1 }),
        params(root.id),
      )
      expect(await first.json()).toMatchObject({ success: true })
      expect(first.status).toBe(200)

      const series = () => bypass(() => prisma.mtmTask.findMany({
        where: { organizationId: ORG, recurrenceParentId: root.id },
        orderBy: { dueDate: "asc" },
        select: { id: true, status: true, dueDate: true, version: true },
      }))
      const afterFirst = await series()
      expect(afterFirst.map((task: { status: string; dueDate: Date }) => [task.status, task.dueDate.toISOString()]))
        .toEqual([["PENDING", "2026-10-12T09:00:00.000Z"]])

      // The second completion starts from a generated task, so the series root
      // is read back with raw SQL before the next date is computed.
      await asAssignee()
      const second = await PUT(
        send("PUT", `/api/v1/mtm/tasks/${afterFirst[0].id}`, { status: "COMPLETED", result: "Göndərildi", expectedVersion: afterFirst[0].version }),
        params(afterFirst[0].id),
      )
      expect(await second.json()).toMatchObject({ success: true })
      expect((await series()).map((task: { status: string; dueDate: Date }) => [task.status, task.dueDate.toISOString()]))
        .toEqual([["COMPLETED", "2026-10-12T09:00:00.000Z"], ["PENDING", "2026-10-19T09:00:00.000Z"]])
    })
  })
})
