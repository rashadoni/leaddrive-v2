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
import { createHash } from "node:crypto"
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
    // A person at a browser, as requireAuth marks one: the live map gives an
    // employee's labels and colour to nobody else (an integration key comes
    // through the same wrapper as role «admin»).
    principalType: "session",
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

  // Owner, 2026-10-06: «может быть, что клиент привязан к нескольким агентам» —
  // and, asked what «Привязать» does to a client who already has an employee:
  // «добавлять агента». Until then attaching ENDED the current employee's
  // assignment: two of one agent's clients attached to another were taken away
  // from the first. The rules are effective-dated rows and relation filters,
  // which a mocked Prisma answers however it is told to — so they run here.
  describe("a client attached to several employees", () => {
    const today = new Date().toISOString().slice(0, 10)
    const ids = {} as Record<"seymur" | "rashad" | "leyla" | "aydin" | "vuqar" | "xalid", string>

    type Handler = (request: NextRequest) => Promise<Response>
    async function change(
      routes: { preview: Handler; execute: Handler },
      body: Record<string, unknown>,
      key: string,
    ) {
      const request = { reason: "Field ownership", ...body }
      const previewed = await (await routes.preview(send("POST", "/preview", request))).json()
      if (!previewed.data) throw new Error(`preview refused: ${JSON.stringify(previewed)}`)
      const preview = previewed.data
      const executed = await routes.execute(send("POST", "/execute", {
        ...request,
        previewToken: preview.previewToken,
        idempotencyKey: `several-employees-${key}`,
      }))
      return { preview, status: executed.status, result: await executed.json() }
    }
    async function assignments() {
      const { POST: preview } = await import("@/app/api/v1/mtm/contact-assignments/preview/route")
      const { POST: execute } = await import("@/app/api/v1/mtm/contact-assignments/route")
      return { preview: preview as Handler, execute: execute as Handler }
    }
    /** Who the client is attached to today, as the database has it: "name:ROLE", responsible first. */
    async function employeesOf(contactId: string): Promise<string[]> {
      const rows = await bypass(() => prisma.mtmContactAgentAssignment.findMany({
        where: { contactId, deletedAt: null, effectiveFrom: { lte: new Date(`${today}T00:00:00.000Z`) }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(`${today}T00:00:00.000Z`) } }] },
        select: { role: true, agent: { select: { name: true } } },
        orderBy: [{ role: "asc" }, { agent: { name: "asc" } }],
      }))
      return rows.map((row: { role: string; agent: { name: string } }) => `${row.agent.name}:${row.role}`)
    }
    /** Names the Clients list returns for a query, and the employees it shows per client. */
    async function listed(query: string): Promise<Record<string, string[]>> {
      const { GET } = await import("@/app/api/v1/mtm/contacts/route")
      const response = await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/contacts?status=ACTIVE&limit=200&${query}`))
      const body = await response.json() as { data: { contacts: Array<{ displayName: string; agentAssignments: Array<{ agent: { name: string } }> }> } }
      return Object.fromEntries(body.data.contacts
        .filter((contact) => contact.displayName.startsWith("Abbasov "))
        .map((contact) => [contact.displayName, contact.agentAssignments.map((assignment) => assignment.agent.name)]))
    }

    beforeAll(async () => {
      await bypass(async () => {
        for (const name of ["seymur", "rashad", "leyla"] as const) {
          ids[name] = (await prisma.mtmAgent.create({
            data: { organizationId: ORG, name: name[0].toUpperCase() + name.slice(1) },
            select: { id: true },
          })).id
        }
        for (const [key, firstName] of [["aydin", "Aydın"], ["vuqar", "Vüqar"], ["xalid", "Xalid"]] as const) {
          ids[key] = (await prisma.mtmContact.create({
            data: { organizationId: ORG, firstName, lastName: "Abbasov", displayName: `Abbasov ${firstName}`, type: "DOCTOR" },
            select: { id: true },
          })).id
        }
        // Seymur has Aydın and Xalid; nobody has Vüqar.
        for (const contactId of [ids.aydin, ids.xalid]) {
          await prisma.mtmContactAgentAssignment.create({
            data: { organizationId: ORG, contactId, agentId: ids.seymur, role: "PRIMARY", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
          })
        }
      })
    })

    it("adds a second employee to a client and takes nothing from the first", async () => {
      const body = { contactIds: [ids.aydin], mode: "ASSIGN", targetAgentId: ids.rashad, effectiveFrom: today }
      const { preview, status } = await change(await assignments(), body, "add-second")

      expect(preview.summary).toMatchObject({ selected: 1, assignable: 1, excluded: 0, additional: 1 })
      expect(status).toBe(200)
      expect(await employeesOf(ids.aydin)).toEqual(["Seymur:PRIMARY", "Rashad:SECONDARY"])

      // Both employees' lists hold the client, and each row names them both.
      expect(await listed(`ownerAgentId=${ids.seymur}`)).toEqual({ "Abbasov Aydın": ["Seymur", "Rashad"], "Abbasov Xalid": ["Seymur"] })
      expect(await listed(`ownerAgentId=${ids.rashad}`)).toEqual({ "Abbasov Aydın": ["Seymur", "Rashad"] })
      // The attach tab offers Rashad everyone he does not have yet — with or without an employee.
      expect(await listed(`notAgentId=${ids.rashad}`)).toEqual({ "Abbasov Vüqar": [], "Abbasov Xalid": ["Seymur"] })

      // The agents list resolves its tenant through getOrgId, not requireAuth.
      const { getOrgId } = await import("@/lib/api-auth")
      vi.mocked(getOrgId).mockResolvedValueOnce(ORG)
      const { GET } = await import("@/app/api/v1/mtm/agents/route")
      const agents = (await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/agents?limit=100"))).json()).data.agents as Array<{ name: string; clients: number | null }>
      const clients = Object.fromEntries(agents.map((agent) => [agent.name, agent.clients]))
      expect([clients.Seymur, clients.Rashad, clients.Leyla]).toEqual([2, 1, 0])
    })

    it("refuses to attach the same employee twice", async () => {
      const { preview } = await change(await assignments(), { contactIds: [ids.aydin], mode: "ASSIGN", targetAgentId: ids.rashad, effectiveFrom: today }, "add-twice")
      expect(preview.rows[0].issues).toEqual(["TARGET_ALREADY_ASSIGNED"])
      expect(await employeesOf(ids.aydin)).toEqual(["Seymur:PRIMARY", "Rashad:SECONDARY"])
    })

    it("makes the first employee of a client the responsible one", async () => {
      await change(await assignments(), { contactIds: [ids.vuqar], mode: "ASSIGN", targetAgentId: ids.leyla, effectiveFrom: today }, "first-employee")
      expect(await employeesOf(ids.vuqar)).toEqual(["Leyla:PRIMARY"])
    })

    // The route builder's «assign and add to the route» used to TRANSFER a
    // client of another employee to the route's employee.
    it("puts another employee's client into a route without taking the client away", async () => {
      const { PUT } = await import("@/app/api/v1/mtm/field-assignments/route")
      const attach = async (contactId: string, agentId: string) => {
        const response = await PUT(send("PUT", "/api/v1/mtm/field-assignments", {
          subjectType: "CONTACT", subjectId: contactId, agentId, keepOthers: true, effectiveFrom: today, reason: `Route builder: ${today}`,
        }))
        return response.status
      }
      const [taken, free] = await bypass(async () => {
        const created: string[] = []
        for (const [firstName, lastName] of [["Elçin", "Quliyev"], ["Fidan", "Rzayeva"]] as const) {
          created.push((await prisma.mtmContact.create({
            data: { organizationId: ORG, firstName, lastName, displayName: `${lastName} ${firstName}`, type: "DOCTOR" },
            select: { id: true },
          })).id)
        }
        await prisma.mtmContactAgentAssignment.create({
          data: { organizationId: ORG, contactId: created[0], agentId: ids.seymur, role: "PRIMARY", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
        })
        return created
      })

      expect(await attach(taken, ids.leyla)).toBe(200)
      expect(await employeesOf(taken)).toEqual(["Seymur:PRIMARY", "Leyla:SECONDARY"])
      // Asked twice — by a retry or a second route — it stays one attachment.
      expect(await attach(taken, ids.leyla)).toBe(200)
      expect(await employeesOf(taken)).toEqual(["Seymur:PRIMARY", "Leyla:SECONDARY"])
      // A client nobody has gets a responsible employee, as before.
      expect(await attach(free, ids.leyla)).toBe(200)
      expect(await employeesOf(free)).toEqual(["Leyla:PRIMARY"])
    })

    it("detaches one employee and leaves the other; the one who stays becomes responsible", async () => {
      const body = { contactIds: [ids.aydin], mode: "UNASSIGN", targetAgentId: null, sourceAgentId: ids.seymur, effectiveFrom: today }
      const { status } = await change(await assignments(), body, "detach-responsible")

      expect(status).toBe(200)
      expect(await employeesOf(ids.aydin)).toEqual(["Rashad:PRIMARY"])
      expect(await listed(`ownerAgentId=${ids.seymur}`)).toEqual({ "Abbasov Xalid": ["Seymur"] })
      // Nothing is deleted: the history keeps who had the client and until when.
      const history = await bypass(() => prisma.mtmContactAgentAssignment.count({ where: { contactId: ids.aydin } }))
      expect(history).toBe(3)
    })

    it("refuses to detach an employee the client is not attached to", async () => {
      const body = { contactIds: [ids.aydin], mode: "UNASSIGN", targetAgentId: null, sourceAgentId: ids.leyla, effectiveFrom: today }
      const { preview } = await change(await assignments(), body, "detach-stranger")
      expect(preview.rows[0].issues).toEqual(["SOURCE_NOT_ASSIGNED"])
      expect(await employeesOf(ids.aydin)).toEqual(["Rashad:PRIMARY"])
    })

    it("hands over the place of an employee who is not the responsible one", async () => {
      await change(await assignments(), { contactIds: [ids.xalid], mode: "ASSIGN", targetAgentId: ids.rashad, effectiveFrom: today }, "second-for-transfer")
      expect(await employeesOf(ids.xalid)).toEqual(["Seymur:PRIMARY", "Rashad:SECONDARY"])

      const { POST: preview } = await import("@/app/api/v1/mtm/contact-transfers/preview/route")
      const { POST: execute } = await import("@/app/api/v1/mtm/contact-transfers/route")
      const { status } = await change(
        { preview: preview as Handler, execute: execute as Handler },
        { contactIds: [ids.xalid], sourceAgentId: ids.rashad, targetAgentId: ids.leyla, effectiveFrom: today },
        "transfer-second",
      )

      expect(status).toBe(200)
      expect(await employeesOf(ids.xalid)).toEqual(["Seymur:PRIMARY", "Leyla:SECONDARY"])
    })

    it("detaches everyone when no employee is named, and the client is free again", async () => {
      const body = { contactIds: [ids.xalid], mode: "UNASSIGN", targetAgentId: null, effectiveFrom: today }
      await change(await assignments(), body, "detach-everyone")

      expect(await employeesOf(ids.xalid)).toEqual([])
      expect(Object.keys(await listed("assignmentState=UNASSIGNED"))).toEqual(["Abbasov Xalid"])
    })
  })

  // Prod, 2026-10-06, owner's screenshot of «Удалить агента»: «Invalid
  // `prisma.mtmAgent.deleteMany()` invocation: Foreign key constraint violated
  // on the constraint: `workforce_employee_team_memberships_agent_fkey`». Since
  // 2026-08-30 a trigger gives every new employee a team-membership row that
  // can be neither changed nor deleted, so nobody could be deleted at all. His
  // decision: an employee without work history can be; one with it cannot.
  // Triggers and cascades are what decide this, and a mocked Prisma has neither.
  describe("deleting an employee", () => {
    const params = (id: string) => ({ params: Promise.resolve({ id }) })

    /**
     * The handler is a privileged web operation: it wants a browser session —
     * marked as one, the way `getSession` marks it. The journal records an
     * actor only for a person at a browser, never for an integration key.
     */
    async function remove(agentId: string) {
      const { getSession } = await import("@/lib/api-auth")
      vi.mocked(getSession).mockResolvedValueOnce({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin", principalType: "session" } as never)
      const { DELETE } = await import("@/app/api/v1/mtm/agents/[id]/route")
      const response = await DELETE(new NextRequest(`http://localhost:3000/api/v1/mtm/agents/${agentId}`, { method: "DELETE" }), params(agentId))
      return { status: response.status, body: await response.json() }
    }
    const hire = (name: string) => bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name }, select: { id: true } }))
    const teamHistory = (agentId: string) => bypass(() => prisma.workforceEmployeeTeamMembership.count({ where: { agentId } }))

    beforeAll(async () => {
      const run = (sql: string) => prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, sql)
      const original = readFileSync(path.join(ROOT, "prisma/migrations/20260830130000_workforce_employee_team_membership_history/migration.sql"), "utf8")
      const follows = readFileSync(path.join(ROOT, "prisma/migrations/20261006120000_workforce_team_membership_follows_deleted_agent/migration.sql"), "utf8")

      // 1. Production as it stood. `db push` builds the key from schema.prisma
      //    under its own name and knows no triggers: put back the restricting
      //    key under the name production has, and the triggers of 2026-08-30.
      run(`DO $$ DECLARE existing text; BEGIN
        SELECT conname INTO existing FROM pg_constraint
        WHERE conrelid = '"workforce_employee_team_memberships"'::regclass AND confrelid = '"mtm_agents"'::regclass;
        EXECUTE format('ALTER TABLE "workforce_employee_team_memberships" DROP CONSTRAINT %I', existing);
      END $$;`)
      run(`ALTER TABLE "workforce_employee_team_memberships"
        ADD CONSTRAINT "workforce_employee_team_memberships_agent_fkey"
        FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;`)
      for (const pattern of [
        /CREATE OR REPLACE FUNCTION workforce_capture_employee_team_membership\(\)[\s\S]*?\$\$;/,
        /CREATE TRIGGER workforce_capture_employee_team_membership_after_change[\s\S]*?;/,
        /CREATE OR REPLACE FUNCTION workforce_reject_employee_team_membership_mutation\(\)[\s\S]*?\$\$;/,
        /CREATE TRIGGER workforce_employee_team_memberships_immutable[\s\S]*?;/,
      ]) {
        const statement = original.match(pattern)
        if (!statement) throw new Error(`not found in the 2026-08-30 migration: ${pattern}`)
        run(statement[0])
      }
      // That state is the bug: an employee nobody has ever worked with cannot be deleted.
      const stuck = await hire("Undeletable before the migration")
      await expect(bypass(() => prisma.mtmAgent.delete({ where: { id: stuck.id } }))).rejects.toThrow(/workforce_employee_team_memberships_agent_fkey|Foreign key/i)

      // 2. The migration, exactly as production will run it.
      run(follows)
    }, 120_000)

    it("deletes an employee who has not worked, with the team history the database wrote for them", async () => {
      const agent = await hire("Created by mistake")
      expect(await teamHistory(agent.id)).toBe(1)
      // Clients attached to them are an arrangement, not work history.
      const client = await bypass(() => prisma.mtmContact.create({
        data: { organizationId: ORG, firstName: "Kamran", lastName: "Hüseynov", displayName: "Hüseynov Kamran", type: "DOCTOR" },
        select: { id: true },
      }))
      await bypass(() => prisma.mtmContactAgentAssignment.create({
        data: { organizationId: ORG, contactId: client.id, agentId: agent.id, role: "PRIMARY", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
      }))

      const { status, body } = await remove(agent.id)

      expect([status, body]).toEqual([200, { success: true }])
      expect(await bypass(() => prisma.mtmAgent.count({ where: { id: agent.id } }))).toBe(0)
      expect(await teamHistory(agent.id)).toBe(0)
      expect(await bypass(() => prisma.mtmContactAgentAssignment.count({ where: { agentId: agent.id } }))).toBe(0)
      // The client is nobody's now, not gone.
      expect(await bypass(() => prisma.mtmContact.count({ where: { id: client.id } }))).toBe(1)
      // Who deleted whom stays in the journal. The row cannot point at the
      // employee — he is gone, and `agentId` is a foreign key — so it names him
      // by id and keeps his name: written with his id in `agentId`, Postgres
      // refused the insert and the handler answered 200 with no row at all.
      const journal = await bypass(() => prisma.mtmAuditLog.findMany({
        where: { organizationId: ORG, action: "AGENT_DELETE", entityId: agent.id },
        select: { agentId: true, actorUserId: true, entity: true, metadataKind: true, oldData: true },
      }))
      expect(journal).toEqual([{
        agentId: null,
        actorUserId: "admin-user",
        entity: "agent",
        metadataKind: "agent_delete",
        oldData: { id: agent.id, name: "Created by mistake", email: null, role: "AGENT" },
      }])
    })

    it("keeps an employee who has a visit, and says so instead of naming a constraint", async () => {
      const agent = await hire("Has been in the field")
      const visit = await bypass(async () => {
        const customer = await prisma.mtmCustomer.create({ data: { organizationId: ORG, name: "Mərkəzi Klinika" }, select: { id: true } })
        return prisma.mtmVisit.create({ data: { organizationId: ORG, agentId: agent.id, customerId: customer.id }, select: { id: true } })
      })

      const { status, body } = await remove(agent.id)

      expect(status).toBe(409)
      expect(body.code).toBe("MTM_AGENT_HAS_HISTORY")
      expect(body.data.kinds).toContain("MtmVisit.agentId")
      expect(JSON.stringify(body)).not.toMatch(/prisma|constraint|fkey/i)
      // Before this check the delete cascaded through the employee's visits.
      expect(await bypass(() => prisma.mtmAgent.count({ where: { id: agent.id } }))).toBe(1)
      expect(await bypass(() => prisma.mtmVisit.count({ where: { id: visit.id } }))).toBe(1)
      // A refused deletion is not journalled as one.
      expect(await bypass(() => prisma.mtmAuditLog.count({ where: { action: "AGENT_DELETE", entityId: agent.id } }))).toBe(0)
    })

    it("still refuses to rewrite or erase the team history of an employee who exists", async () => {
      const agent = await hire("Still employed")
      const erase = bypass(() => prisma.$executeRaw`DELETE FROM "workforce_employee_team_memberships" WHERE "agentId" = ${agent.id}`)
      await expect(erase).rejects.toThrow(/immutable/i)
      const rewrite = bypass(() => prisma.$executeRaw`UPDATE "workforce_employee_team_memberships" SET "source" = 'TAMPERED' WHERE "agentId" = ${agent.id}`)
      await expect(rewrite).rejects.toThrow(/immutable/i)
      expect(await teamHistory(agent.id)).toBe(1)
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

  // «Стоит N минут»: the current stop, kept with the latest position by every
  // GPS write. No CI step compares schema.prisma with the SQL of a migration,
  // and this scratch database is built by `db push` — so a column misspelled
  // in the migration would fail every GPS write on production with nothing
  // red beforehand. Here the four columns are taken away and put back by the
  // real migration file, and the real writer is driven through a day against
  // them.
  describe("the anchor of the current stop", () => {
    const AT = Date.parse("2026-10-09T08:00:00.000Z")
    const at = (minutes: number) => new Date(AT + minutes * 60_000)
    /** About this many metres north of the place. */
    const north = (meters: number) => 40.4 + meters / 111_195
    let agentId = ""
    type Point = { minutes: number; latitude?: number; isMoving?: boolean; speed?: number | null; accuracy?: number | null }
    async function gps(point: Point) {
      const { advanceMtmAgentLatestLocation } = await import("@/lib/mtm/mobile-location-latest")
      await bypass(() => prisma.$transaction((tx) => advanceMtmAgentLatestLocation(tx, {
        organizationId: ORG, agentId, sourceLocationId: null, payloadSha256: null,
        latitude: point.latitude ?? 40.4, longitude: 49.85, accuracy: point.accuracy === undefined ? 10 : point.accuracy,
        speed: point.speed === undefined ? 0 : point.speed, heading: null, altitude: null, battery: 80,
        isMoving: point.isMoving ?? false, recordedAt: at(point.minutes), receivedAt: at(point.minutes),
      })))
    }
    const row = () => bypass(() => prisma.mtmAgentLatestLocation.findUniqueOrThrow({
      where: { organizationId_agentId: { organizationId: ORG, agentId } },
      select: { latitude: true, recordedAt: true, stationarySince: true, stationaryLatitude: true, stationaryLongitude: true, stationaryConfirmedAt: true },
    }))

    beforeAll(async () => {
      const run = (sql: string) => prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, sql)
      // Production as it stood before the migration…
      run(`ALTER TABLE "mtm_agent_latest_locations" DROP COLUMN "stationarySince", DROP COLUMN "stationaryLatitude", DROP COLUMN "stationaryLongitude", DROP COLUMN "stationaryConfirmedAt";`)
      // …then the migration itself, the very file the deploy applies. Twice: it must be safe to re-run.
      const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261009200000_mtm_latest_location_stationary_anchor/migration.sql"), "utf8")
      run(migration)
      run(migration)
      agentId = (await bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Stationary Anchor" }, select: { id: true } }))).id
    }, 120_000)

    it("starts with the first still point and keeps that moment while he stands", async () => {
      await gps({ minutes: 0 })
      expect(await row()).toMatchObject({ stationarySince: at(0), stationaryLatitude: 40.4, stationaryLongitude: 49.85, stationaryConfirmedAt: at(0) })
      await gps({ minutes: 1, latitude: north(8) })
      await gps({ minutes: 2, latitude: north(-6) })
      const standing = await row()
      expect(standing.stationarySince).toEqual(at(0))
      // Each still point confirms the stop.
      expect(standing.stationaryConfirmedAt).toEqual(at(2))
      // The position itself goes on advancing.
      expect(standing.recordedAt).toEqual(at(2))
      expect(standing.latitude).toBeCloseTo(north(-6), 9)
      // The stop is measured from where it began, not from the last point.
      expect(standing.stationaryLatitude).toBe(40.4)
    })

    it("is cleared by a moving point and started again by the next stop", async () => {
      await gps({ minutes: 3, latitude: north(300), isMoving: true, speed: 9 })
      expect(await row()).toMatchObject({ stationarySince: null, stationaryLatitude: null, stationaryLongitude: null, stationaryConfirmedAt: null, recordedAt: at(3) })
      await gps({ minutes: 4, latitude: north(600) })
      await gps({ minutes: 5, latitude: north(600) })
      expect(await row()).toMatchObject({ stationarySince: at(4), stationaryLatitude: north(600) })
    })

    it("starts again sixty metres away, and after eleven minutes of silence", async () => {
      await gps({ minutes: 6, latitude: north(660) })
      expect(await row()).toMatchObject({ stationarySince: at(6), stationaryLatitude: north(660) })
      await gps({ minutes: 17, latitude: north(660) })
      expect((await row()).stationarySince).toEqual(at(17))
    })

    it("is left alone by a still coordinate too vague to trust, and by a point older than the row", async () => {
      await gps({ minutes: 18, latitude: north(5_000), accuracy: 300 })
      // The row advances — the map's own accuracy rule decides what it shows —; the stop is neither moved nor confirmed.
      expect(await row()).toMatchObject({ recordedAt: at(18), stationarySince: at(17), stationaryLatitude: north(660), stationaryConfirmedAt: at(17) })
      await gps({ minutes: 10, latitude: north(-900) })
      expect(await row()).toMatchObject({ recordedAt: at(18), stationarySince: at(17), stationaryConfirmedAt: at(17) })
    })

    it("two points arriving at once leave a row that tells the truth about one of them", async () => {
      await Promise.all([
        gps({ minutes: 19, latitude: north(660) }),
        gps({ minutes: 20, latitude: north(9_000), isMoving: true, speed: 12 }),
      ])
      const after = await row()
      expect(after.recordedAt).toEqual(at(20))
      // The moving point is the newest: whatever the order of arrival, nobody is «standing since» anything.
      expect(after).toMatchObject({ stationarySince: null, stationaryLatitude: null, stationaryLongitude: null })
    })

    it("vague points do not keep a stop alive: after a quarter of an hour of them it starts again", async () => {
      await gps({ minutes: 40 })
      expect((await row()).stationarySince).toEqual(at(40))
      // Every minute a coordinate, none of them worth trusting — one of them five kilometres away.
      for (let minutes = 41; minutes <= 55; minutes += 1) await gps({ minutes, accuracy: 300, latitude: minutes === 48 ? north(5_000) : 40.4 })
      expect(await row()).toMatchObject({ recordedAt: at(55), stationarySince: at(40), stationaryConfirmedAt: at(40) })
      // A good point at the very same place: the same place, but nobody knows about the fifteen minutes.
      await gps({ minutes: 56 })
      expect(await row()).toMatchObject({ stationarySince: at(56), stationaryConfirmedAt: at(56) })
    })

    it("a vague point that says he is moving ends the stop all the same", async () => {
      await gps({ minutes: 57 })
      expect((await row()).stationarySince).toEqual(at(56))
      await gps({ minutes: 58, accuracy: 300, isMoving: true, speed: 9 })
      expect(await row()).toMatchObject({ stationarySince: null, stationaryConfirmedAt: null, recordedAt: at(58) })
    })

    it("a stop that a build without the anchor rode over is not believed afterwards", async () => {
      await gps({ minutes: 60 })
      await gps({ minutes: 61 })
      expect((await row()).stationarySince).toEqual(at(60))
      // The release is rolled back: the older build advances the position and
      // its time for a day and knows nothing of the four columns.
      await bypass(() => prisma.mtmAgentLatestLocation.update({
        where: { organizationId_agentId: { organizationId: ORG, agentId } },
        data: { latitude: 40.4, longitude: 49.85, recordedAt: at(24 * 60 + 59) },
      }))
      // The release is back, and he stands at the same place a minute later.
      await gps({ minutes: 24 * 60 + 60 })
      expect(await row()).toMatchObject({ stationarySince: at(24 * 60 + 60), stationaryConfirmedAt: at(24 * 60 + 60) })
    })

    it("reaches the live map's list: «стоит с …» for the employee who stands", async () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      try {
        const DAY = 24 * 60
        vi.setSystemTime(at(2 * DAY + 31))
        const workDate = new Date("2026-10-11T00:00:00.000Z")
        await bypass(() => prisma.mtmAgentWorkday.create({
          data: { organizationId: ORG, agentId, workDate, status: "STARTED", startedAt: at(2 * DAY - 60) },
        }))
        // He stops at 08:21 and is still there at 08:30; each point is also a row of raw GPS, as an upload writes it.
        for (const minutes of [2 * DAY + 21, 2 * DAY + 24, 2 * DAY + 27, 2 * DAY + 30]) {
          await gps({ minutes, latitude: north(9_000) })
          await bypass(() => prisma.mtmAgentLocation.create({
            data: { organizationId: ORG, agentId, latitude: north(9_000), longitude: 49.85, accuracy: 10, speed: 0, isMoving: false, recordedAt: at(minutes) },
          }))
        }
        // An upload also marks the phone as heard from.
        await bypass(() => prisma.mtmAgent.update({ where: { id: agentId }, data: { isOnline: true, lastSeenAt: at(2 * DAY + 30) } }))
        const { GET } = await import("@/app/api/v1/mtm/locations/route")
        const response = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/locations"))
        const body = await response.json()
        expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200)
        const mine = body.data.agentLocations.find((entry: { agentId: string }) => entry.agentId === agentId)
        expect(mine).toMatchObject({ fieldStatus: "STOPPED", stationarySince: at(2 * DAY + 21).toISOString() })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // Labels and a personal map colour on an employee's card (owner, 2026-10-09:
  // «добей до 100 %»). A text array is the kind of column a mocked Prisma
  // proves nothing about: the default, the round trip and «has any of these»
  // are decided by Postgres. The two columns are taken away and put back by
  // the real migration file, then written and searched through the real routes.
  describe("labels and a map colour on an employee", () => {
    const params = (id: string) => ({ params: Promise.resolve({ id }) })
    const asWebAdmin = async () => {
      const { getSession } = await import("@/lib/api-auth")
      vi.mocked(getSession).mockResolvedValue({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
    }
    let labelled = ""
    let plain = ""

    beforeAll(async () => {
      const run = (sql: string) => prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, sql)
      // Production as it stood before the migration…
      run(`ALTER TABLE "mtm_agents" DROP COLUMN "tags", DROP COLUMN "mapColor";`)
      // …an employee hired by the build that knew neither column…
      run(`INSERT INTO "mtm_agents" ("id", "organizationId", "name", "updatedAt") VALUES ('agent-before-labels', '${ORG}', 'Hired Before Labels', now());`)
      // …then the migration itself, the very file the deploy applies. Twice: it must be safe to re-run.
      const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261010090000_mtm_agent_tags_map_color/migration.sql"), "utf8")
      run(migration)
      run(migration)
      labelled = (await bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Labelled Person" }, select: { id: true } }))).id
      plain = "agent-before-labels"
    }, 120_000)

    afterAll(async () => {
      const { getSession } = await import("@/lib/api-auth")
      vi.mocked(getSession).mockResolvedValue(null)
    })

    it("everybody starts with no labels and no colour — also the people hired before the columns existed", async () => {
      const rows = await bypass(() => prisma.mtmAgent.findMany({
        where: { id: { in: [labelled, plain] } }, orderBy: { name: "asc" }, select: { name: true, tags: true, mapColor: true },
      }))
      expect(rows).toEqual([
        { name: "Hired Before Labels", tags: [], mapColor: null },
        { name: "Labelled Person", tags: [], mapColor: null },
      ])
    })

    it("stores what the manager typed, tidied, and gives it back to the web — the array comes back as it went in", async () => {
      await asWebAdmin()
      const { GET, PUT } = await import("@/app/api/v1/mtm/agents/[id]/route")
      const saved = await PUT(put(`/api/v1/mtm/agents/${labelled}`, { tags: ["  стажёр ", "Север", "север", "VIP №1"], mapColor: "teal" }), params(labelled))
      const savedBody = await saved.json()
      expect(saved.status, JSON.stringify(savedBody).slice(0, 300)).toBe(200)
      const stored = await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: labelled }, select: { tags: true, mapColor: true, name: true } }))
      expect(stored).toEqual({ name: "Labelled Person", tags: ["стажёр", "Север", "VIP №1"], mapColor: "teal" })
      const read = await (await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/agents/${labelled}`), params(labelled))).json()
      expect(read.data).toMatchObject({ tags: ["стажёр", "Север", "VIP №1"], mapColor: "teal" })

      // A label that could start a spreadsheet formula is refused, and nothing is written.
      const refused = await PUT(put(`/api/v1/mtm/agents/${labelled}`, { tags: ["=cmd"] }), params(labelled))
      expect(refused.status).toBe(400)
      expect((await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: labelled }, select: { tags: true } }))).tags).toEqual(["стажёр", "Север", "VIP №1"])
      // Saving something else leaves the labels alone; an empty list takes them all off.
      await PUT(put(`/api/v1/mtm/agents/${labelled}`, { name: "Labelled Person" }), params(labelled))
      expect((await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: labelled }, select: { tags: true, mapColor: true } }))))
        .toEqual({ tags: ["стажёр", "Север", "VIP №1"], mapColor: "teal" })
    })

    it("the live map's list carries them, and its search finds an employee by a label as well as by name", async () => {
      await asWebAdmin()
      const { GET } = await import("@/app/api/v1/mtm/locations/route")
      const roster = async (query = "") => {
        const response = await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/locations${query}`))
        const body = await response.json()
        expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200)
        return body.data.agentLocations as Array<{ agentId: string; name: string; tags: string[]; mapColor: string | null }>
      }
      const everybody = await roster()
      expect(everybody.find((row) => row.agentId === labelled)).toMatchObject({ tags: ["стажёр", "Север", "VIP №1"], mapColor: "teal" })
      expect(everybody.find((row) => row.agentId === plain)).toMatchObject({ tags: [], mapColor: null })
      // By a part of a label, in any case; by a name as before; and a word that is neither finds nobody.
      expect((await roster(`?employee=${encodeURIComponent("СЕВ")}`)).map((row) => row.agentId)).toEqual([labelled])
      // From the middle of a label too: «a part» is not «the beginning».
      expect((await roster(`?employee=${encodeURIComponent("евер")}`)).map((row) => row.agentId)).toEqual([labelled])
      expect((await roster(`?employee=${encodeURIComponent("vip")}`)).map((row) => row.agentId)).toEqual([labelled])
      expect((await roster(`?employee=${encodeURIComponent("Before Labels")}`)).map((row) => row.agentId)).toEqual([plain])
      expect(await roster(`?employee=${encodeURIComponent("нет-такого")}`)).toEqual([])

      await bypass(() => prisma.mtmAgent.update({ where: { id: labelled }, data: { tags: [], mapColor: null } }))
      expect((await roster(`?employee=${encodeURIComponent("сев")}`)).map((row) => row.agentId)).toEqual([])
    })
  })

  // «Свои зоны» of the live map (owner, 2026-10-09: «бери почти всё, чего у
  // нас нет»): named areas a manager draws by hand. Two things about them are
  // decided by Postgres, and a mocked Prisma shows neither. The table accepts
  // a row by its own CHECK — one whole shape, a circle or an outline. And a
  // circle's empty outline has to reach the column as NULL: Prisma has two
  // nulls for a JSON column, and its «JSON null» is a value, which that CHECK
  // refuses on a circle — and it is the null the neighbouring routes write.
  // `db push` knows neither the CHECK nor the policy, so the table is replaced
  // by the very file the deploy applies, and the real routes write to it.
  //
  // Not shown here: the tenant policy. This connection is a superuser, which
  // no policy holds; the policy's text is kept by migration-mtm-map-zones.test.ts.
  describe("zones drawn on the live map", () => {
    const params = (id: string) => ({ params: Promise.resolve({ id }) })
    const zonesUrl = "/api/v1/mtm/locations/zones"
    const circle = { kind: "CIRCLE", centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 1500 }
    // An invented block of a hundredth of a degree a side.
    const outline = {
      kind: "POLYGON",
      polygon: { type: "Polygon", coordinates: [[[49.8, 40.4], [49.81, 40.4], [49.81, 40.41], [49.8, 40.41], [49.8, 40.4]]] },
    }
    let zoneId = ""

    beforeAll(() => {
      const run = (sql: string) => prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, sql)
      run(`DROP TABLE "mtm_map_zones";`)
      run(readFileSync(path.join(ROOT, "prisma/migrations/20261010120000_mtm_map_zones/migration.sql"), "utf8"))
    }, 120_000)

    it("keeps a circle and an outline drawn through the real routes, and lists them as they were drawn", async () => {
      const { GET, POST } = await import("@/app/api/v1/mtm/locations/zones/route")
      const drawnCircle = await POST(send("POST", zonesUrl, { name: "Центр", color: "teal", ...circle }))
      const circleBody = await drawnCircle.json()
      expect(drawnCircle.status, JSON.stringify(circleBody).slice(0, 300)).toBe(201)
      const drawnOutline = await POST(send("POST", zonesUrl, { name: "Северный участок", ...outline }))
      const outlineBody = await drawnOutline.json()
      expect(drawnOutline.status, JSON.stringify(outlineBody).slice(0, 300)).toBe(201)
      zoneId = circleBody.data.id

      // The answer to a drawing can be lost on its way back, and «Сохранить» is
      // pressed again: the same drawing from the same person a moment later is
      // the zone already kept — answered 200, not kept twice. Asked of Postgres
      // because the comparison is of what it hands back: an outline out of a
      // jsonb column (which reorders an object's keys), a moment of drawing out
      // of a timestamp column. The list and the count of rows below, and the
      // one MAP_ZONE_CREATE in the journal further down, are the proof that
      // nothing was written a second time.
      for (const [body, kept] of [
        [{ name: "Центр", color: "teal", ...circle }, circleBody.data],
        [{ name: "Северный участок", ...outline }, outlineBody.data],
      ] as const) {
        const again = await POST(send("POST", zonesUrl, body))
        const againBody = await again.json()
        expect(again.status, JSON.stringify(againBody).slice(0, 300)).toBe(200)
        expect(againBody.data).toEqual(kept)
      }

      const listed = await (await GET(new NextRequest(`http://localhost:3000${zonesUrl}`))).json()
      expect(listed.data.access).toEqual({ canWrite: true })
      const byName = Object.fromEntries((listed.data.zones as Array<{ name: string }>).map((zone) => [zone.name, zone]))
      expect(Object.keys(byName).sort()).toEqual(["Северный участок", "Центр"])
      expect(byName["Центр"]).toEqual({
        id: zoneId, name: "Центр", kind: "CIRCLE", color: "teal",
        centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 1500, polygon: null,
      })
      // The ring comes back pair for pair: [longitude, latitude], closed.
      expect(byName["Северный участок"]).toEqual({
        id: outlineBody.data.id, name: "Северный участок", kind: "POLYGON", color: null,
        centerLatitude: null, centerLongitude: null, radiusMeters: null, polygon: outline.polygon,
      })
      const rows = await bypass(() => prisma.mtmMapZone.findMany({ where: { organizationId: ORG }, select: { createdBy: true, deletedAt: true } }))
      expect(rows).toEqual([{ createdBy: "admin-user", deletedAt: null }, { createdBy: "admin-user", deletedAt: null }])
    })

    it("redraws a circle as an outline and back: each way the row passes the table's own shape rule", async () => {
      const { PUT } = await import("@/app/api/v1/mtm/locations/zones/[id]/route")
      const asOutline = await PUT(put(`${zonesUrl}/${zoneId}`, outline), params(zoneId))
      const outlineBody = await asOutline.json()
      expect(asOutline.status, JSON.stringify(outlineBody).slice(0, 300)).toBe(200)
      expect(outlineBody.data).toEqual({
        id: zoneId, name: "Центр", kind: "POLYGON", color: "teal",
        centerLatitude: null, centerLongitude: null, radiusMeters: null, polygon: outline.polygon,
      })
      const asCircle = await PUT(put(`${zonesUrl}/${zoneId}`, { name: "Центр города", ...circle, radiusMeters: 250 }), params(zoneId))
      const circleBody = await asCircle.json()
      expect(asCircle.status, JSON.stringify(circleBody).slice(0, 300)).toBe(200)
      expect(circleBody.data).toEqual({
        id: zoneId, name: "Центр города", kind: "CIRCLE", color: "teal",
        centerLatitude: 40.4, centerLongitude: 49.85, radiusMeters: 250, polygon: null,
      })
    })

    it("takes a zone off the map without deleting the row, and the journal says who did each thing", async () => {
      const { GET } = await import("@/app/api/v1/mtm/locations/zones/route")
      const { DELETE } = await import("@/app/api/v1/mtm/locations/zones/[id]/route")
      const removed = await DELETE(new NextRequest(`http://localhost:3000${zonesUrl}/${zoneId}`, { method: "DELETE" }), params(zoneId))
      expect(removed.status).toBe(200)
      const row = await bypass(() => prisma.mtmMapZone.findUniqueOrThrow({ where: { id: zoneId }, select: { name: true, deletedAt: true } }))
      expect(row.name).toBe("Центр города")
      expect(row.deletedAt).toBeInstanceOf(Date)
      const listed = await (await GET(new NextRequest(`http://localhost:3000${zonesUrl}`))).json()
      expect((listed.data.zones as Array<{ name: string }>).map((zone) => zone.name)).toEqual(["Северный участок"])

      const journal = await bypass(() => prisma.mtmAuditLog.findMany({
        where: { organizationId: ORG, entity: "map_zone", entityId: zoneId },
        select: { action: true, actorUserId: true },
      }))
      expect(journal.map((entry) => entry.action).sort()).toEqual(["MAP_ZONE_CREATE", "MAP_ZONE_DELETE", "MAP_ZONE_UPDATE", "MAP_ZONE_UPDATE"])
      expect(new Set(journal.map((entry) => entry.actorUserId))).toEqual(new Set(["admin-user"]))
    })

    it("the table itself refuses half a shape, whoever writes it", async () => {
      const insert = (id: string, values: string) => bypass(() => prisma.$executeRawUnsafe(
        `INSERT INTO "mtm_map_zones" ("id", "organizationId", "name", "kind", "centerLatitude", "centerLongitude", "radiusMeters", "polygon", "updatedAt")
         VALUES ('${id}', '${ORG}', ${values}, now())`,
      ))
      // A whole circle and a whole outline are accepted: what follows is
      // refused for its shape, not for a slip in the statement.
      await insert("raw-circle", `'Круг', 'CIRCLE', 40.4, 49.85, 500, NULL`)
      await insert("raw-outline", `'Участок', 'POLYGON', NULL, NULL, NULL, '{"type":"Polygon","coordinates":[]}'::jsonb`)

      const halves: Array<[string, string]> = [
        ["a circle without a radius", `'Круг', 'CIRCLE', 40.4, 49.85, NULL, NULL`],
        ["a circle without a centre", `'Круг', 'CIRCLE', NULL, NULL, 500, NULL`],
        ["a circle of a metre", `'Круг', 'CIRCLE', 40.4, 49.85, 1, NULL`],
        ["a circle off the globe", `'Круг', 'CIRCLE', 140.4, 49.85, 500, NULL`],
        // What Prisma.JsonNull writes: a value, not an empty column.
        ["a circle whose outline is a JSON null", `'Круг', 'CIRCLE', 40.4, 49.85, 500, 'null'::jsonb`],
        ["an outline that kept a radius", `'Участок', 'POLYGON', NULL, NULL, 500, '{"type":"Polygon"}'::jsonb`],
        ["an outline that is a list, not a polygon", `'Участок', 'POLYGON', NULL, NULL, NULL, '[]'::jsonb`],
        ["an outline with nothing in it", `'Участок', 'POLYGON', NULL, NULL, NULL, NULL`],
      ]
      for (const [index, [what, values]] of halves.entries()) {
        await expect(insert(`raw-refused-${index}`, values), what).rejects.toThrow(/mtm_map_zones_shape_check/)
      }
      await expect(insert("raw-square", `'Квадрат', 'SQUARE', NULL, NULL, NULL, NULL`)).rejects.toThrow(/mtm_map_zones_(kind|shape)_check/)
      await expect(insert("raw-nameless", `'   ', 'CIRCLE', 40.4, 49.85, 500, NULL`)).rejects.toThrow(/mtm_map_zones_name_check/)

      const kept = await bypass(() => prisma.mtmMapZone.findMany({ where: { id: { startsWith: "raw-" } }, orderBy: { id: "asc" }, select: { id: true } }))
      expect(kept.map((row) => row.id)).toEqual(["raw-circle", "raw-outline"])
    })
  })

  // «Ссылка на местоположение» (2026-10-10): a manager makes a link on the
  // live map, and whoever opens it, without signing in, sees where one
  // employee is now. Everything that keeps this from being a hole is decided
  // by Postgres, and a mocked Prisma shows none of it:
  //
  //   - the public page knows the token and nothing else, so the one lookup by
  //     hash runs with no organization, under `app.rls_bypass`. If the policy
  //     lacked that clause every link would be dead; if it were written
  //     loosely, a query with no context at all would read every
  //     organization's hashes;
  //   - one hash must lead to one row across ALL organizations;
  //   - the table's CHECKs are what stand between a slip in the code and a
  //     stored link, a link that never ends, a negative count;
  //   - a link has to leave with its employee, or he could never be deleted.
  //
  // `db push` knows neither the CHECKs nor the policy, so the table is
  // replaced by the very file the deploy applies, and the real routes write
  // to it.
  //
  // What the policy probes below do and do not prove. This suite's own
  // connection is a superuser, which no policy holds — so each probe steps
  // down, inside a transaction, to a role made here: NOSUPERUSER, NOBYPASSRLS,
  // with nothing but DML on this one table. For that role the policy is
  // really evaluated by Postgres: these are rows it does or does not get.
  // FORCE is a separate matter — it changes nothing for a role that does not
  // own the table. So one probe hands the table to that role (and rolls the
  // handover back): the owner, too, reads nothing without a context, and with
  // FORCE taken off he reads everything — which is what FORCE is there to stop.
  // What stays unproven here is a fact about production, not about this file:
  // that the application's own database role is neither a superuser nor
  // BYPASSRLS. A role that is either is held by no policy, forced or not.
  describe("links to an employee's position", () => {
    const params = (id: string) => ({ params: Promise.resolve({ id }) })
    const linksUrl = "/api/v1/mtm/locations/share-links"
    const TABLE = "mtm_location_share_links"
    const OTHER_ORG = "org-share-links-other"
    const OUTSIDER = `mtm_share_link_probe_${process.pid}`
    const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
    const run = (sql: string) => prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, sql)
    let shown = ""
    let elsewhere = ""
    let linkId = ""
    let token = ""

    /** A row written past the routes: only the table's own rules stand in its way. */
    const insertLink = (id: string, over: { organizationId?: string; agentId?: string; tokenHash?: string; createdAt?: string; expiresAt?: string; viewCount?: number } = {}) =>
      bypass(() => prisma.$executeRawUnsafe(
        `INSERT INTO "${TABLE}" ("id", "organizationId", "agentId", "tokenHash", "createdAt", "expiresAt", "viewCount")
         VALUES ('${id}', '${over.organizationId ?? ORG}', '${over.agentId ?? shown}', '${over.tokenHash ?? sha256(id)}',
                 ${over.createdAt ?? "now()"}, ${over.expiresAt ?? "now() + interval '1 hour'"}, ${over.viewCount ?? 0})`,
      ))

    /** As much of a transaction as the probes use: raw statements on its one connection. */
    interface RawTx {
      $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>
      $queryRawUnsafe: <T = unknown>(sql: string, ...values: unknown[]) => Promise<T>
      $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
    }
    class Undone extends Error {}
    /** Runs `work` in a transaction that is always rolled back, and hands back what it returned. */
    async function andUndo<T>(work: (tx: RawTx) => Promise<T>): Promise<T> {
      const kept: { result?: T } = {}
      try {
        await prisma.$transaction(async (tx) => {
          kept.result = await work(tx as unknown as RawTx)
          throw new Undone()
        })
      } catch (error) {
        if (!(error instanceof Undone)) throw error
      }
      return kept.result as T
    }
    /**
     * A statement as the role that no policy exempts, with exactly the given
     * settings and nothing else — raw SQL throughout, since a model call with
     * no organization is refused by the client before it reaches Postgres.
     */
    const asOutsider = <T>(settings: { orgId?: string; bypass?: string }, sql: string, ...values: unknown[]) =>
      andUndo(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${OUTSIDER}"`)
        if (settings.orgId !== undefined) await tx.$queryRaw`SELECT set_config('app.org_id', ${settings.orgId}, true)`
        if (settings.bypass !== undefined) await tx.$queryRaw`SELECT set_config('app.rls_bypass', ${settings.bypass}, true)`
        return tx.$queryRawUnsafe<T>(sql, ...values)
      })
    const found = async (settings: { orgId?: string; bypass?: string }, tokenHash: string) =>
      (await asOutsider<Array<{ organizationId: string }>>(settings, `SELECT "organizationId" FROM "${TABLE}" WHERE "tokenHash" = $1`, tokenHash))
        .map((row) => row.organizationId)

    /**
     * The organization's switch lives in `mtm_settings`, which `db push`
     * builds with no policy at all. A creation reads that row by a raw
     * statement inside its transaction; whether the statement runs inside the
     * organization's scope shows only against the table as production guards
     * it — so its flags and its policy are lifted from their migration.
     */
    function settingsTableGuard(): string {
      const sql = readFileSync(path.join(ROOT, "prisma/migrations/20260806120000_mtm_rls_coverage_completion/migration.sql"), "utf8")
      const guard = sql.match(/ALTER TABLE "mtm_settings" ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE "mtm_settings" FORCE ROW LEVEL SECURITY;[\s\S]*?CREATE POLICY tenant_isolation ON "mtm_settings"[\s\S]*?;/)
      if (!guard) throw new Error("the policy of mtm_settings was not found in its migration")
      return guard[0]
    }

    beforeAll(async () => {
      run(`DROP TABLE "${TABLE}";`)
      run(readFileSync(path.join(ROOT, "prisma/migrations/20261010150000_mtm_location_share_links/migration.sql"), "utf8"))
      run(settingsTableGuard())
      // Cluster-wide, unlike the scratch database: made once, removed below.
      run(`DO $$ BEGIN
             IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OUTSIDER}') THEN
               CREATE ROLE "${OUTSIDER}" NOLOGIN NOSUPERUSER NOBYPASSRLS;
             END IF;
           END $$;`)
      run(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${TABLE}" TO "${OUTSIDER}";`)
      await bypass(() => prisma.organization.create({ data: { id: OTHER_ORG, name: "Araz Logistics", slug: "share-links-other" } }))
      shown = (await bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Shown Courier" }, select: { id: true } }))).id
      elsewhere = (await bypass(() => prisma.mtmAgent.create({ data: { organizationId: OTHER_ORG, name: "Courier Elsewhere" }, select: { id: true } }))).id
    }, 120_000)

    afterAll(async () => {
      const { getSession } = await import("@/lib/api-auth")
      vi.mocked(getSession).mockResolvedValue(null)
      // The role outlives the scratch database unless what it was granted there is taken back first.
      run(`DO $$ BEGIN
             IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OUTSIDER}') THEN
               EXECUTE 'DROP OWNED BY "${OUTSIDER}"';
               EXECUTE 'DROP ROLE "${OUTSIDER}"';
             END IF;
           END $$;`)
    }, 60_000)

    it("is switched off for an organization that never touched the setting: the real route makes nothing until the real setting is saved", async () => {
      const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const refused = await POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_DISABLED" })
      expect(await bypass(() => prisma.mtmLocationShareLink.count())).toBe(0)

      // Switched on the way a person does it: the settings page's own save.
      const { PUT } = await import("@/app/api/v1/mtm/settings/route")
      const saved = await PUT(put("/api/v1/mtm/settings", { locationShareLinksEnabled: true }))
      expect(saved.status, JSON.stringify(await saved.clone().json()).slice(0, 300)).toBe(200)
      const { getMtmSettings } = await import("@/lib/mtm-settings")
      const { runWithTenant } = await import("@/lib/rls-context")
      expect((await runWithTenant(ORG, () => getMtmSettings(ORG))).locationShareLinksEnabled).toBe(true)
      // …for this organization, and for no other.
      expect((await runWithTenant(OTHER_ORG, () => getMtmSettings(OTHER_ORG))).locationShareLinksEnabled).toBe(false)
    })

    it("makes a link through the real route: the table keeps the SHA-256 of the token, and the list never gives either back", async () => {
      const { GET, POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const before = Date.now()
      const made = await POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))
      const body = await made.json()
      expect(made.status, JSON.stringify(body).slice(0, 300)).toBe(201)
      linkId = body.data.link.id
      token = new URL(body.data.url, "http://localhost").pathname.split("/").pop() ?? ""
      expect(token).toMatch(/^[a-f0-9]{64}$/)
      expect(body.data.url).toContain(`/share/location/${token}?lang=ru`)

      const row = await bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: linkId } }))
      expect(row).toMatchObject({
        organizationId: ORG, agentId: shown, tokenHash: sha256(token), createdBy: "admin-user",
        revokedAt: null, revokedBy: null, viewCount: 0, lastViewedAt: null,
      })
      // Found by the hash, as the public lookup will find it — and by nothing else in the row.
      expect((await bypass(() => prisma.mtmLocationShareLink.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true } })))?.id).toBe(linkId)
      expect(JSON.stringify(row)).not.toContain(token)
      // The moment the manager was told is the moment the table holds, an hour on at most (less only near the organization's midnight).
      expect(row.expiresAt.toISOString()).toBe(body.data.link.expiresAt)
      expect(row.expiresAt.getTime()).toBeGreaterThan(row.createdAt.getTime())
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(60 * 60 * 1000)
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before)

      const listed = await GET(new NextRequest(`http://localhost:3000${linksUrl}?agentId=${shown}`))
      const listedText = await listed.text()
      expect(listed.status, listedText.slice(0, 300)).toBe(200)
      expect(listedText).not.toContain(token)
      expect(listedText).not.toContain(sha256(token))
      expect(JSON.parse(listedText).data).toEqual({
        links: [{ ...body.data.link, createdByName: null }],
        access: { enabled: true, canWrite: true },
        // He has no shift yet: a link to him shows nothing at this moment.
        showsNow: false,
      })
      // The journal has the row, about the employee, and nothing that opens the link.
      const journal = await bypass(() => prisma.mtmAuditLog.findMany({ where: { organizationId: ORG, entity: "location_share_link", entityId: linkId } }))
      expect(journal.map((entry) => [entry.action, entry.agentId, entry.actorUserId])).toEqual([["LOCATION_SHARE_LINK_CREATE", shown, "admin-user"]])
      expect(JSON.stringify(journal)).not.toContain(token)
      expect(JSON.stringify(journal)).not.toContain(sha256(token))
    })

    it("is a table Postgres really guards: the flags are on, and the probe role is one no policy exempts", async () => {
      const [flags] = await bypass(() => prisma.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"${TABLE}"'::regclass`,
      ))
      expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      const [who] = await asOutsider<Array<{ name: string; rolsuper: boolean; rolbypassrls: boolean; owns: boolean }>>({}, `
        SELECT current_user::text AS name, r.rolsuper, r.rolbypassrls,
               (SELECT tableowner = current_user FROM pg_tables WHERE tablename = '${TABLE}') AS owns
        FROM pg_roles r WHERE r.rolname = current_user`)
      expect(who).toEqual({ name: OUTSIDER, rolsuper: false, rolbypassrls: false, owns: false })
      // And this suite's own connection is exactly what such a probe must not be.
      const [me] = await bypass(() => prisma.$queryRawUnsafe<Array<{ rolsuper: boolean }>>(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`))
      expect(me.rolsuper).toBe(true)
    })

    it("gives the lookup by token nothing without a context, nothing under another organization, and the row under the right one or under the bypass", async () => {
      const hash = sha256(token)
      // A link of the other organization as well, so that «nothing» below is the policy at work and not an empty table.
      await insertLink("theirs", { organizationId: OTHER_ORG, agentId: elsewhere })
      const theirs = sha256("theirs")

      // No setting at all: what a statement that lost its context gets.
      expect(await found({}, hash)).toEqual([])
      expect(await asOutsider({}, `SELECT count(*)::int AS n FROM "${TABLE}"`)).toEqual([{ n: 0 }])
      // Another organization's context.
      expect(await found({ orgId: OTHER_ORG }, hash)).toEqual([])
      expect(await found({ orgId: ORG }, theirs)).toEqual([])
      // An organization that does not exist, and an empty one.
      expect(await found({ orgId: "no-such-organization" }, hash)).toEqual([])
      expect(await found({ orgId: "" }, hash)).toEqual([])
      // The right organization: its own row and only its own rows.
      expect(await found({ orgId: ORG }, hash)).toEqual([ORG])
      expect(await asOutsider({ orgId: ORG }, `SELECT DISTINCT "organizationId" FROM "${TABLE}"`)).toEqual([{ organizationId: ORG }])
      expect(await found({ orgId: OTHER_ORG }, theirs)).toEqual([OTHER_ORG])
      // The bypass, with no organization named: how the public lookup finds whose link a token is.
      expect(await found({ bypass: "on" }, hash)).toEqual([ORG])
      expect(await found({ bypass: "on" }, theirs)).toEqual([OTHER_ORG])
      // It opens on the exact word and on nothing that merely looks like a yes.
      for (const notOn of ["off", "true", "ON", "1", ""]) expect(await found({ bypass: notOn }, hash), notOn).toEqual([])
    })

    it("lets nobody write into another organization, or change its rows, from inside his own", async () => {
      const values = (id: string, organizationId: string, agentId: string) =>
        `INSERT INTO "${TABLE}" ("id", "organizationId", "agentId", "tokenHash", "expiresAt")
         VALUES ('${id}', '${organizationId}', '${agentId}', '${sha256(id)}', now() + interval '1 hour')`
      // His own organization: accepted — so what follows is refused by the policy, not by a missing grant.
      expect(await asOutsider({ orgId: ORG }, `${values("probe-own", ORG, shown)} RETURNING "organizationId"`)).toEqual([{ organizationId: ORG }])
      await expect(asOutsider({ orgId: ORG }, values("probe-into-theirs", OTHER_ORG, elsewhere))).rejects.toThrow(/row-level security/)
      await expect(asOutsider({}, values("probe-no-context", ORG, shown))).rejects.toThrow(/row-level security/)
      // Revoking, counting a view, deleting: another organization's rows are not there to be touched.
      for (const statement of [
        `UPDATE "${TABLE}" SET "revokedAt" = now() WHERE "id" = 'theirs' RETURNING "id"`,
        `UPDATE "${TABLE}" SET "viewCount" = "viewCount" + 1 WHERE "tokenHash" = '${sha256("theirs")}' RETURNING "id"`,
        `DELETE FROM "${TABLE}" WHERE "id" = 'theirs' RETURNING "id"`,
      ]) {
        expect(await asOutsider({ orgId: ORG }, statement), statement).toEqual([])
        expect(await asOutsider({}, statement), statement).toEqual([])
      }
      // A row cannot be moved out of its organization either.
      await expect(asOutsider({ orgId: ORG }, `UPDATE "${TABLE}" SET "organizationId" = '${OTHER_ORG}', "agentId" = '${elsewhere}' WHERE "id" = '${linkId}'`))
        .rejects.toThrow(/row-level security/)
      // Every probe was rolled back: the two rows are as they were.
      const rows = await bypass(() => prisma.mtmLocationShareLink.findMany({ orderBy: { id: "asc" }, select: { id: true, organizationId: true, revokedAt: true, viewCount: true } }))
      expect(rows).toEqual([
        { id: linkId, organizationId: ORG, revokedAt: null, viewCount: 0 },
        { id: "theirs", organizationId: OTHER_ORG, revokedAt: null, viewCount: 0 },
      ].sort((left, right) => left.id.localeCompare(right.id)))
    })

    it("holds the table's owner to the policy too — that is what FORCE is for", async () => {
      const visible = (force: boolean, settings: { orgId?: string } = {}) => andUndo(async (tx) => {
        // Handed over for the length of this transaction only.
        await tx.$executeRawUnsafe(`ALTER TABLE "${TABLE}" OWNER TO "${OUTSIDER}"`)
        if (!force) await tx.$executeRawUnsafe(`ALTER TABLE "${TABLE}" NO FORCE ROW LEVEL SECURITY`)
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${OUTSIDER}"`)
        if (settings.orgId !== undefined) await tx.$queryRaw`SELECT set_config('app.org_id', ${settings.orgId}, true)`
        const [row] = await tx.$queryRawUnsafe<Array<{ n: number; owns: boolean }>>(
          `SELECT (SELECT count(*)::int FROM "${TABLE}") AS n,
                  (SELECT tableowner = current_user FROM pg_tables WHERE tablename = '${TABLE}') AS owns`,
        )
        return row
      })
      // As the migration leaves the table: the owner, with no context, reads nothing, and with one reads his organization's row.
      expect(await visible(true)).toEqual({ n: 0, owns: true })
      expect(await visible(true, { orgId: ORG })).toEqual({ n: 1, owns: true })
      // Without FORCE the same owner reads every organization's links with no context at all.
      expect(await visible(false)).toEqual({ n: 2, owns: true })
      // Nothing of the handover is left behind.
      const [after] = await bypass(() => prisma.$queryRawUnsafe<Array<{ owner: string; relforcerowsecurity: boolean }>>(
        `SELECT pg_get_userbyid(relowner)::text AS owner, relforcerowsecurity FROM pg_class WHERE oid = '"${TABLE}"'::regclass`,
      ))
      expect(after.owner).not.toBe(OUTSIDER)
      expect(after.relforcerowsecurity).toBe(true)
    })

    it("one hash is one row across every organization: the same hash under another organization is refused", async () => {
      // 23505 is Postgres's «unique violation», and it names the column that collided.
      const collision = /23505[\s\S]*"tokenHash"/
      await expect(insertLink("same-hash-elsewhere", { organizationId: OTHER_ORG, agentId: elsewhere, tokenHash: sha256(token) }))
        .rejects.toThrow(collision)
      await expect(insertLink("same-hash-here", { tokenHash: sha256(token) })).rejects.toThrow(collision)
      // Through the client as well: the model's own unique field.
      await expect(bypass(() => prisma.mtmLocationShareLink.create({
        data: { organizationId: OTHER_ORG, agentId: elsewhere, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) },
      }))).rejects.toMatchObject({ code: "P2002" })
      // The index that refuses is the one the migration made, on the hash alone.
      const indexes = await bypass(() => prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = '${TABLE}' AND indexname = '${TABLE}_tokenHash_key'`,
      ))
      expect(indexes).toEqual([{ indexdef: expect.stringMatching(/CREATE UNIQUE INDEX .* \("tokenHash"\)$/) }])
      expect(await bypass(() => prisma.mtmLocationShareLink.count({ where: { tokenHash: sha256(token) } }))).toBe(1)
    })

    it("the table itself refuses what is not a link, whoever writes it", async () => {
      // A whole row is accepted: what follows is refused for what it is, not for a slip in the statement.
      await insertLink("raw-whole")
      const refusals: Array<[string, Parameters<typeof insertLink>[1], RegExp]> = [
        ["a link itself where its hash belongs", { tokenHash: `https://app.example.test/share/location/${"a".repeat(64)}` }, /tokenHash_check/],
        ["a hash in capitals", { tokenHash: "A".repeat(64) }, /tokenHash_check/],
        ["a hash one character short", { tokenHash: "a".repeat(63) }, /tokenHash_check/],
        ["a hash with something after it", { tokenHash: `${"a".repeat(64)}x` }, /tokenHash_check/],
        ["no hash", { tokenHash: "" }, /tokenHash_check/],
        ["a link that ends the moment it begins", { createdAt: "'2026-10-10 08:00:00'", expiresAt: "'2026-10-10 08:00:00'" }, /expiresAt_check/],
        ["a link that ends before it begins", { expiresAt: "now() - interval '1 second'" }, /expiresAt_check/],
        ["fewer views than none", { viewCount: -1 }, /viewCount_check/],
        // The composite key: a link of this organization cannot show another organization's employee.
        ["an employee of another organization", { agentId: elsewhere }, /organizationId_agentId_fkey/],
        ["an employee who does not exist", { agentId: "nobody" }, /organizationId_agentId_fkey/],
      ]
      for (const [index, [what, over, constraint]] of refusals.entries()) {
        await expect(insertLink(`raw-refused-${index}`, over), what).rejects.toThrow(constraint)
      }
      const kept = await bypass(() => prisma.mtmLocationShareLink.findMany({ where: { id: { startsWith: "raw-" } }, select: { id: true } }))
      expect(kept.map((row) => row.id)).toEqual(["raw-whole"])
    })

    it("revokes through the real route by marking the row, once, and the journal says who did each thing", async () => {
      const { GET } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const { DELETE } = await import("@/app/api/v1/mtm/locations/share-links/[id]/route")
      const revoke = (id: string) => DELETE(new NextRequest(`http://localhost:3000${linksUrl}/${id}`, { method: "DELETE" }), params(id))
      // Another organization's link is not there for this administrator.
      expect((await revoke("theirs")).status).toBe(404)

      const revoked = await revoke(linkId)
      const body = await revoked.json()
      expect(revoked.status, JSON.stringify(body).slice(0, 300)).toBe(200)
      const row = await bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: linkId } }))
      expect(row.revokedAt).toBeInstanceOf(Date)
      expect(row.revokedAt?.toISOString()).toBe(body.data.revokedAt)
      expect(row).toMatchObject({ revokedBy: "admin-user", tokenHash: sha256(token) })
      // Done once.
      expect((await revoke(linkId)).status).toBe(404)
      expect((await bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: linkId } }))).revokedAt).toEqual(row.revokedAt)
      expect((await bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: "theirs" } }))).revokedAt).toBeNull()

      const listed = await (await GET(new NextRequest(`http://localhost:3000${linksUrl}?agentId=${shown}`))).json()
      // The revoked link stays on the card for the rest of the organization's
      // day (the list shows today's only — and this suite may run across a midnight).
      const { locationShareLinkTodayStartedAt } = await import("@/lib/mtm/location-share-link")
      const madeToday = row.createdAt.getTime() >= locationShareLinkTodayStartedAt(new Date(), "Asia/Baku").getTime()
      expect((listed.data.links as Array<{ id: string; alive: boolean }>).map((link) => [link.id, link.alive]))
        .toEqual(expect.arrayContaining([...(madeToday ? [[linkId, false]] : []), ["raw-whole", true]]))
      const journal = await bypass(() => prisma.mtmAuditLog.findMany({
        where: { organizationId: ORG, entity: "location_share_link", entityId: linkId },
        orderBy: { createdAt: "asc" },
        select: { action: true, agentId: true, actorUserId: true, metadataKind: true },
      }))
      expect(journal).toEqual([
        { action: "LOCATION_SHARE_LINK_CREATE", agentId: shown, actorUserId: "admin-user", metadataKind: "location_share_link" },
        { action: "LOCATION_SHARE_LINK_REVOKE", agentId: shown, actorUserId: "admin-user", metadataKind: "location_share_link" },
      ])
    })

    it("leaves with its employee: an employee who only ever had links is deleted through the real route, and his links are gone", async () => {
      const { getSession } = await import("@/lib/api-auth")
      vi.mocked(getSession).mockResolvedValue({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
      const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const { DELETE } = await import("@/app/api/v1/mtm/agents/[id]/route")
      const leaving = (await bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Hired By Mistake" }, select: { id: true } }))).id
      for (const duration of ["1h", "day"]) {
        expect((await POST(send("POST", linksUrl, { agentId: leaving, duration }))).status).toBe(201)
      }
      const linksOf = (agentId: string) => bypass(() => prisma.mtmLocationShareLink.count({ where: { agentId } }))
      expect(await linksOf(leaving)).toBe(2)
      const others = await linksOf(shown)

      const deleted = await DELETE(new NextRequest(`http://localhost:3000/api/v1/mtm/agents/${leaving}`, { method: "DELETE" }), params(leaving))
      const body = await deleted.json()
      // Not 409 MTM_AGENT_HAS_HISTORY: a link is an arrangement about him, not his work.
      expect(deleted.status, JSON.stringify(body).slice(0, 300)).toBe(200)
      expect(await bypass(() => prisma.mtmAgent.count({ where: { id: leaving } }))).toBe(0)
      expect(await linksOf(leaving)).toBe(0)
      // His, and nobody else's.
      expect(await linksOf(shown)).toBe(others)
      expect(await linksOf(elsewhere)).toBe(1)
    })

    // ─── No more than five, also for requests that arrive together ────────
    //
    // The route counts his working links and then makes one more. With those
    // two as separate statements, requests arriving together each counted
    // four before any had made the fifth: 8 to 12 of 12 were let in. They now
    // take turns behind a lock per employee — which only a real Postgres can
    // show: a mock answers `pg_advisory_xact_lock` whatever it is asked.
    it("holds an employee to five working links when the sixth, seventh… arrive at the same instant: exactly one more is made", async () => {
      const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const { resetRateLimit } = await import("@/lib/rate-limit")
      const { LOCATION_SHARE_LINK_ALIVE_LIMIT } = await import("@/lib/mtm/location-share-link")
      const working = (agentId: string) => bypass(() => prisma.mtmLocationShareLink.count({ where: { agentId, revokedAt: null, expiresAt: { gt: new Date() } } }))
      const TOGETHER = 12
      // The connections the burst will run on exist before it starts: a pool
      // that opens them one by one would line the requests up by itself.
      // (`$executeRaw`: pg_sleep returns void too.)
      await Promise.all(Array.from({ length: TOGETHER }, () => bypass(() => prisma.$executeRawUnsafe(`SELECT pg_sleep(0.05)`))))

      // Twice over, each time for an employee with no links of his own yet.
      for (const name of ["Busy Courier", "Busier Courier"]) {
        // A person's own allowance of changes a minute is not what is being measured here.
        resetRateLimit(`mtm-location-share-links-write:${ORG}:admin-user`)
        const busy = (await bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name }, select: { id: true } }))).id
        for (let made = 1; made < LOCATION_SHARE_LINK_ALIVE_LIMIT; made += 1) {
          expect((await POST(send("POST", linksUrl, { agentId: busy, duration: "1h" }))).status, `${name}: link ${made}`).toBe(201)
        }
        expect(await working(busy)).toBe(LOCATION_SHARE_LINK_ALIVE_LIMIT - 1)

        const answers = await Promise.all(Array.from({ length: TOGETHER }, async () => {
          const response = await POST(send("POST", linksUrl, { agentId: busy, duration: "1h" }))
          return { status: response.status, body: await response.json() }
        }))
        const statuses = answers.map((answer) => answer.status).sort()
        expect(statuses, name).toEqual([201, ...Array.from({ length: TOGETHER - 1 }, () => 409)])
        for (const refused of answers.filter((answer) => answer.status === 409)) {
          expect(refused.body).toMatchObject({ code: "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED", limit: LOCATION_SHARE_LINK_ALIVE_LIMIT })
        }
        expect(await working(busy), name).toBe(LOCATION_SHARE_LINK_ALIVE_LIMIT)
        // One token was handed out for one row: nobody holds a link the table does not know.
        const made = answers.find((answer) => answer.status === 201)!
        const madeToken = new URL(made.body.data.url, "http://localhost").pathname.split("/").pop() ?? ""
        expect((await bypass(() => prisma.mtmLocationShareLink.findUnique({ where: { tokenHash: sha256(madeToken) }, select: { id: true } })))?.id).toBe(made.body.data.link.id)
        // The journal has one row per link that exists, and none for a refusal.
        expect(await bypass(() => prisma.mtmAuditLog.count({ where: { organizationId: ORG, agentId: busy, action: "LOCATION_SHARE_LINK_CREATE" } })))
          .toBe(LOCATION_SHARE_LINK_ALIVE_LIMIT)
      }
      // Another employee's lock is another lock: his colleague's five do not stand in his way.
      resetRateLimit(`mtm-location-share-links-write:${ORG}:admin-user`)
      expect((await POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))).status).toBe(201)
    }, 120_000)

    // ─── What a stranger with the link is told ────────────────────────────
    //
    // The real handler of GET /api/v1/public/location-share/[token], over the
    // same table and the real rows of a shift, its journal and of GPS —
    // nothing mocked but the clock, which is held so that «fifteen minutes
    // old» and «five minutes since the last look» are exact and the run does
    // not depend on the hour it happens at.
    const HOUR = 60 * 60 * 1000
    const MINUTE = 60 * 1000
    const SECOND = 1000
    // Noon in Baku — the organization's zone as it ships.
    const NOON = new Date("2026-10-12T08:00:00.000Z")
    const after = (ms: number) => new Date(NOON.getTime() + ms)
    const GONE = { status: 404, body: { success: false, state: "GONE" } }
    const POINT = { latitude: 40.3777, longitude: 49.892 }
    let watched = ""
    let watchedToken = ""
    let shift = ""

    async function at<T>(moment: Date, work: () => Promise<T>): Promise<T> {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(moment)
      try {
        return await work()
      } finally {
        vi.useRealTimers()
      }
    }
    /** A link opened as its recipient opens it: no session, only the address. */
    async function openLink(from = "203.0.113.50", token = watchedToken) {
      const { GET } = await import("@/app/api/v1/public/location-share/[token]/route")
      const response = await GET(
        new NextRequest(`http://localhost:3000/api/v1/public/location-share/${token}`, { headers: { "x-real-ip": from } }),
        { params: Promise.resolve({ token }) },
      )
      return { status: response.status, body: await response.json() }
    }
    const openings = () => bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({
      where: { id: watched },
      select: { viewCount: true, lastViewedAt: true },
    }))
    const setShift = (data: { status: "STARTED" | "PAUSED" | "COMPLETED"; pausedAt?: Date | null; completedAt?: Date | null }) =>
      bypass(() => prisma.mtmAgentWorkday.updateMany({ where: { organizationId: ORG, agentId: shown }, data }))
    /** An entry of his shift's journal, as the phone's «перерыв» and «продолжить» leave it. */
    const journal = (type: "PAUSE" | "RESUME", occurredAt: Date) =>
      bypass(() => prisma.mtmAgentWorkdayEvent.create({ data: { organizationId: ORG, agentId: shown, workdayId: shift, type, occurredAt, appliedAt: occurredAt } }))
    const report = (recordedAt: Date, where: { latitude: number; longitude: number }) =>
      bypass(() => prisma.mtmAgentLocation.create({ data: { organizationId: ORG, agentId: shown, ...where, accuracy: 9, recordedAt } }))

    /**
     * Runs `work` with this suite's own connections switched to the role no
     * policy exempts. The suite connects as a superuser, and Postgres holds a
     * superuser to no policy — so a statement that ran outside its
     * organization's scope would pass everywhere else in this file.
     */
    async function underNoExemption<T>(work: () => Promise<T>): Promise<T> {
      run(`GRANT SELECT ON "mtm_agents", "organizations", "mtm_agent_workdays", "mtm_agent_workday_events", "mtm_agent_locations" TO "${OUTSIDER}";
           GRANT SELECT, INSERT, UPDATE ON "mtm_settings", "mtm_audit_logs" TO "${OUTSIDER}";`)
      const onAdmin = (sql: string) => prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, sql)
      const [{ me }] = await bypass(() => prisma.$queryRawUnsafe<Array<{ me: string }>>(`SELECT session_user::text AS me`))
      onAdmin(`ALTER ROLE "${me}" IN DATABASE "${scratch!.name}" SET role = '${OUTSIDER}';`)
      await prisma.$disconnect()
      try {
        const [who] = await bypass(() => prisma.$queryRawUnsafe<Array<{ name: string; exempt: boolean }>>(
          `SELECT current_user::text AS name, (r.rolsuper OR r.rolbypassrls) AS exempt FROM pg_roles r WHERE r.rolname = current_user`,
        ))
        expect(who).toEqual({ name: OUTSIDER, exempt: false })
        return await work()
      } finally {
        onAdmin(`ALTER ROLE "${me}" IN DATABASE "${scratch!.name}" RESET role;`)
        await prisma.$disconnect()
        const [again] = await bypass(() => prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT current_user::text AS name`))
        expect(again.name).toBe(me)
      }
    }

    it("tells a stranger nothing while the organization has no field product, and then exactly the point the employee's phone last reported", async () => {
      await at(NOON, async () => {
        const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
        const made = await POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))
        const link = await made.json()
        expect(made.status, JSON.stringify(link).slice(0, 300)).toBe(201)
        watched = link.data.link.id
        watchedToken = new URL(link.data.url, "http://localhost").pathname.split("/").pop() ?? ""
        expect(link.data.link.expiresAt).toBe(after(HOUR).toISOString())

        // He started at nine. His phone reported two minutes ago; a minute ago it
        // sent one more point, too vague to be a position; and there is one from
        // the evening before, when he was not on shift.
        shift = (await bypass(() => prisma.mtmAgentWorkday.create({
          data: { organizationId: ORG, agentId: shown, workDate: new Date("2026-10-12T00:00:00.000Z"), status: "STARTED", startedAt: after(-3 * HOUR) },
          select: { id: true },
        }))).id
        await bypass(() => prisma.mtmAgentLocation.createMany({
          data: [
            { organizationId: ORG, agentId: shown, ...POINT, accuracy: 15, speed: 11, heading: 90, battery: 64, isMoving: true, recordedAt: after(-2 * MINUTE) },
            { organizationId: ORG, agentId: shown, latitude: 40.9, longitude: 49.1, accuracy: 800, speed: 0, battery: 64, isMoving: false, recordedAt: after(-1 * MINUTE) },
            { organizationId: ORG, agentId: shown, latitude: 40.1, longitude: 49.5, accuracy: 5, speed: 0, battery: 90, isMoving: false, recordedAt: after(-16 * HOUR) },
          ],
        }))

        // The organization as this suite made it was never given the field product: its links open nothing.
        expect(await openLink()).toEqual(GONE)
        expect(await openings()).toEqual({ viewCount: 0, lastViewedAt: null })

        await bypass(() => prisma.organization.update({ where: { id: ORG }, data: { modules: { "route-field": true } } }))
        const organization = await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: ORG }, select: { name: true } }))
        expect(await openLink()).toEqual({
          status: 200,
          body: {
            success: true,
            state: "AVAILABLE",
            data: {
              name: "Shown Courier",
              organizationName: organization.name,
              ...POINT,
              recordedAt: after(-2 * MINUTE).toISOString(),
              expiresAt: after(HOUR).toISOString(),
              generatedAt: NOON.toISOString(),
              timezone: "Asia/Baku",
            },
          },
        })
        expect(await openings()).toEqual({ viewCount: 1, lastViewedAt: NOON })

        // The managers' list tells the card the same thing at the same moment: a link to him shows a point now.
        const { GET } = await import("@/app/api/v1/mtm/locations/share-links/route")
        const listed = await (await GET(new NextRequest(`http://localhost:3000${linksUrl}?agentId=${shown}`))).json()
        expect(listed.data.showsNow).toBe(true)
        expect(listed.data.links.find((one: { id: string }) => one.id === watched)).toMatchObject({ alive: true, viewCount: 1 })
      })
    })

    it("counts a page left open as one opening, and a look after five minutes of silence as the next — also when two people look at the same instant", async () => {
      // The page's own refresh half a minute later writes nothing.
      await at(after(30 * SECOND), async () => expect((await openLink()).status).toBe(200))
      expect(await openings()).toEqual({ viewCount: 1, lastViewedAt: NOON })
      // A minute on it is the same visitor still: «последний раз» moves, the count does not.
      await at(after(MINUTE), async () => expect((await openLink()).status).toBe(200))
      expect(await openings()).toEqual({ viewCount: 1, lastViewedAt: after(MINUTE) })
      // Both read the row before either writes to it: each handler has five
      // more reads to make first. Postgres lets one of the two updates through.
      const both = () => Promise.all([openLink(), openLink("203.0.113.51")])
      await at(after(3 * MINUTE), async () => {
        expect((await both()).map((answer) => [answer.status, answer.body.state])).toEqual([[200, "AVAILABLE"], [200, "AVAILABLE"]])
      })
      expect(await openings()).toEqual({ viewCount: 1, lastViewedAt: after(3 * MINUTE) })
      // Nobody asks for five minutes. Then two people at once: one new opening, not two.
      await at(after(8 * MINUTE), async () => {
        expect((await both()).map((answer) => answer.status)).toEqual([200, 200])
      })
      expect(await openings()).toEqual({ viewCount: 2, lastViewedAt: after(8 * MINUTE) })
      // Nobody else's link was counted with it.
      expect(await bypass(() => prisma.mtmLocationShareLink.count({ where: { id: { not: watched }, viewCount: { gt: 0 } } }))).toBe(0)
    })

    it("says nothing of where he is during a break — nor, after it, of where he spent it", async () => {
      const lunchPlace = { latitude: 40.2, longitude: 49.6 }
      const backAtWork = { latitude: 40.39, longitude: 49.84 }
      await at(after(10 * MINUTE), async () => {
        const organization = await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: ORG }, select: { name: true } }))
        const nothingToShow = {
          status: 200,
          body: {
            success: true,
            state: "UNAVAILABLE",
            data: {
              name: "Shown Courier", organizationName: organization.name,
              expiresAt: after(HOUR).toISOString(), generatedAt: after(10 * MINUTE).toISOString(), timezone: "Asia/Baku",
            },
          },
        }
        // He pressed «перерыв» a minute and a half ago. His phone went on
        // reporting through a door that does not refuse a break's points
        // (the batch ingestion, «поделиться своим местоположением»).
        await setShift({ status: "PAUSED", pausedAt: after(8 * MINUTE + 30 * SECOND) })
        await journal("PAUSE", after(8 * MINUTE + 30 * SECOND))
        await report(after(9 * MINUTE), lunchPlace)
        // The link works; there is no point in the answer, and no word about why.
        expect(await openLink()).toEqual(nothingToShow)
        const { GET } = await import("@/app/api/v1/mtm/locations/share-links/route")
        const told = async () => (await (await GET(new NextRequest(`http://localhost:3000${linksUrl}?agentId=${shown}`))).json()).data.showsNow
        expect(await told()).toBe(false)

        await setShift({ status: "COMPLETED", pausedAt: null, completedAt: after(9 * MINUTE) })
        expect((await openLink()).body.state).toBe("UNAVAILABLE")

        // «Продолжить», half a minute ago. The newest point the table holds
        // of him is the one from the break, a minute old — and it is not shown.
        await journal("RESUME", after(9 * MINUTE + 30 * SECOND))
        await setShift({ status: "STARTED", pausedAt: null, completedAt: null })
        expect(await openLink()).toEqual(nothingToShow)
        expect(await told()).toBe(false)

        // The phone reports from where he is now: that, and only that, is shown.
        await report(after(9 * MINUTE + 45 * SECOND), backAtWork)
        expect((await openLink()).body).toMatchObject({ state: "AVAILABLE", data: { ...backAtWork, recordedAt: after(9 * MINUTE + 45 * SECOND).toISOString() } })
        expect(await told()).toBe(true)
      })
    })

    it("answers the same to a database role no policy exempts: the lookup by token goes through the bypass, everything after it through the organization", async () => {
      const { runWithTenant } = await import("@/lib/rls-context")
      const byToken = () => prisma.mtmLocationShareLink.findUnique({ where: { tokenHash: sha256(watchedToken) }, select: { id: true } })
      await underNoExemption(async () => {
        // The client's own contexts, as the handler uses them: another
        // organization's finds nothing, the right one and the bypass find the link.
        expect(await runWithTenant(OTHER_ORG, byToken)).toBeNull()
        expect(await runWithTenant(ORG, byToken)).toEqual({ id: watched })
        expect(await bypass(byToken)).toEqual({ id: watched })

        const before = await openings()
        await at(after(16 * MINUTE), async () => {
          expect(await openLink("203.0.113.52")).toMatchObject({
            status: 200,
            body: { success: true, state: "AVAILABLE", data: { name: "Shown Courier", latitude: 40.39, longitude: 49.84, recordedAt: after(9 * MINUTE + 45 * SECOND).toISOString() } },
          })
        })
        // Six minutes after the last look: a new opening, written too — an UPDATE the policy had to let through.
        expect(await openings()).toEqual({ viewCount: before.viewCount + 1, lastViewedAt: after(16 * MINUTE) })
      })
    }, 120_000)

    // ─── Switching the links off ──────────────────────────────────────────
    //
    // Decision of 2026-10-11: off ends every link already handed out, for
    // good. An administrator who switches off to stop a leak expects it to
    // stay stopped; switching on again an hour later must bring nothing back.

    it("a save that cannot end the links does not switch them off either: nothing is half done, and the link goes on working", async () => {
      const { PUT } = await import("@/app/api/v1/mtm/settings/route")
      const { getMtmSettings } = await import("@/lib/mtm-settings")
      const { runWithTenant } = await import("@/lib/rls-context")
      // The table refuses every change to a link, as a database in trouble would.
      run(`CREATE FUNCTION mtm_share_link_refuse_${process.pid}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'links cannot be written right now'; END $$;
           CREATE TRIGGER refuse_writes BEFORE UPDATE ON "${TABLE}" FOR EACH ROW EXECUTE FUNCTION mtm_share_link_refuse_${process.pid}();`)
      try {
        await at(after(17 * MINUTE), async () => {
          const refused = await PUT(put("/api/v1/mtm/settings", { locationShareLinksEnabled: false }))
          expect(refused.status).toBe(400)
          // Still on — the switch and the links are one transaction — and the link still opens.
          expect((await runWithTenant(ORG, () => getMtmSettings(ORG))).locationShareLinksEnabled).toBe(true)
          expect((await bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: watched } }))).revokedAt).toBeNull()
          expect((await openLink("203.0.113.55")).body.state).toBe("AVAILABLE")
        })
      } finally {
        run(`DROP TRIGGER refuse_writes ON "${TABLE}";
             DROP FUNCTION mtm_share_link_refuse_${process.pid}();`)
      }
    }, 120_000)

    it("switched off, every working link of the organization is ended for good: on again it is STILL gone, and a link made afterwards works", async () => {
      const { PUT } = await import("@/app/api/v1/mtm/settings/route")
      const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      // Another organization's link that works at this hour, and one of this organization's whose time is long up.
      await insertLink("theirs-working", { organizationId: OTHER_ORG, agentId: elsewhere, createdAt: `'${NOON.toISOString()}'`, expiresAt: `'${after(2 * HOUR).toISOString()}'` })
      await insertLink("ours-ran-out", { createdAt: `'${after(-2 * HOUR).toISOString()}'`, expiresAt: `'${after(-1 * HOUR).toISOString()}'` })
      const rowOf = (id: string) => bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id }, select: { revokedAt: true, revokedBy: true } }))

      // As the role no policy exempts: the statement that ends the links has to
      // run inside its organization's scope, or it would find no row to end.
      await underNoExemption(() => at(after(18 * MINUTE), async () => {
        expect((await openLink("203.0.113.56")).body.state).toBe("AVAILABLE")
        const working = await bypass(() => prisma.mtmLocationShareLink.count({ where: { organizationId: ORG, revokedAt: null, expiresAt: { gt: after(18 * MINUTE) } } }))
        expect(working).toBeGreaterThanOrEqual(1)
        const counted = await openings()

        // Switched off the way a person does it: the settings page's own save.
        const off = await PUT(put("/api/v1/mtm/settings", { locationShareLinksEnabled: false }))
        expect(off.status, JSON.stringify(await off.clone().json()).slice(0, 300)).toBe(200)
        expect(await openLink("203.0.113.56")).toEqual(GONE)
        // A link that does not work is not «opened».
        expect(await openings()).toEqual(counted)
        // Ended in the table, at that moment, by whoever saved…
        expect(await rowOf(watched)).toEqual({ revokedAt: after(18 * MINUTE), revokedBy: "admin-user" })
        expect(await bypass(() => prisma.mtmLocationShareLink.count({ where: { organizationId: ORG, revokedAt: null, expiresAt: { gt: after(18 * MINUTE) } } }))).toBe(0)
        // …this organization's working links only: not one whose time was up, not another organization's.
        expect(await rowOf("ours-ran-out")).toEqual({ revokedAt: null, revokedBy: null })
        expect(await rowOf("theirs-working")).toEqual({ revokedAt: null, revokedBy: null })
        // The journal's one row for the save says how many; there is no row per link.
        const [saved] = await bypass(() => prisma.mtmAuditLog.findMany({
          where: { organizationId: ORG, action: "SETTINGS_UPDATE" }, orderBy: { createdAt: "desc" }, take: 1, select: { newData: true, actorUserId: true },
        }))
        expect(saved).toMatchObject({ actorUserId: "admin-user", newData: { locationShareLinksEnabled: false, locationShareLinksEnded: working } })
        expect(await bypass(() => prisma.mtmAuditLog.count({ where: { organizationId: ORG, entityId: watched, action: "LOCATION_SHARE_LINK_REVOKE" } }))).toBe(0)

        // Switched back on: nothing comes back.
        expect((await PUT(put("/api/v1/mtm/settings", { locationShareLinksEnabled: true }))).status).toBe(200)
        expect(await openLink("203.0.113.56")).toEqual(GONE)
        expect(await rowOf(watched)).toEqual({ revokedAt: after(18 * MINUTE), revokedBy: "admin-user" })
        // The managers' list shows it as one that no longer works.
        const { GET } = await import("@/app/api/v1/mtm/locations/share-links/route")
        const listed = await (await GET(new NextRequest(`http://localhost:3000${linksUrl}?agentId=${shown}`))).json()
        expect(listed.data.links.find((one: { id: string }) => one.id === watched)).toMatchObject({ alive: false, revokedAt: after(18 * MINUTE).toISOString() })

        // A link made now is a new link, and it works.
        const dead = watchedToken
        const made = await POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))
        const link = await made.json()
        expect(made.status, JSON.stringify(link).slice(0, 300)).toBe(201)
        watched = link.data.link.id
        watchedToken = new URL(link.data.url, "http://localhost").pathname.split("/").pop() ?? ""
        expect(watchedToken).not.toBe(dead)
        expect((await openLink("203.0.113.56")).body).toMatchObject({ state: "AVAILABLE", data: { latitude: 40.39, longitude: 49.84, expiresAt: after(HOUR + 18 * MINUTE).toISOString() } })
        expect(await openLink("203.0.113.56", dead)).toEqual(GONE)
      }))
      // The other organization's link was never this save's to touch — also when its own switch is looked at.
      expect((await bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: "theirs-working" } }))).revokedAt).toBeNull()
    }, 120_000)

    it("stops at the moment its time is up, and at once when it is revoked", async () => {
      // The link made after the switch came back on: an hour from 12:18.
      const ends = after(HOUR + 18 * MINUTE)
      // A millisecond before its time the link still works — though by then
      // the point is an hour old and is not shown.
      expect(await at(new Date(ends.getTime() - 1), () => openLink())).toMatchObject({ status: 200, body: { state: "UNAVAILABLE" } })
      const counted = await openings()
      expect(await at(ends, () => openLink())).toEqual(GONE)
      expect(await at(new Date(ends.getTime() + HOUR), () => openLink())).toEqual(GONE)
      expect(await openings()).toEqual(counted)

      // Back within its time, with a fresh point: it works — until it is revoked through the real route.
      await at(after(30 * MINUTE), async () => {
        await bypass(() => prisma.mtmAgentLocation.create({
          data: { organizationId: ORG, agentId: shown, latitude: 40.41, longitude: 49.87, accuracy: 9, recordedAt: after(29 * MINUTE) },
        }))
        expect((await openLink("203.0.113.53")).body).toMatchObject({ state: "AVAILABLE", data: { latitude: 40.41, longitude: 49.87 } })
        const { DELETE } = await import("@/app/api/v1/mtm/locations/share-links/[id]/route")
        const revoked = await DELETE(new NextRequest(`http://localhost:3000${linksUrl}/${watched}`, { method: "DELETE" }), params(watched))
        expect(revoked.status).toBe(200)
        expect(await openLink("203.0.113.53")).toEqual(GONE)
      })
      // Revoked is revoked: at no later or earlier moment does it open again.
      expect(await at(after(31 * MINUTE), () => openLink("203.0.113.54"))).toEqual(GONE)
    })

    // ─── Switched off while a link is being made ──────────────────────────
    //
    // A creation looks at the switch, then waits for the employee's lock,
    // then inserts. A save that switched the links off inside that wait had
    // ended every link there was and gone — and the creation then made one
    // more, ended by nobody: gone while off, working again the moment the
    // switch came back on (found on 2026-10-11 by holding the lock the way
    // the first case below does). The creation now reads the switch once
    // more behind the lock and holds its row, so that the save and the
    // creation take turns. Neither turn can be shown by a mock: it takes two
    // sessions of a real Postgres, one of them stopped half-way by a third.

    /** Sessions of this database that stand in a queue right now: for an advisory lock, or for a row another session holds. */
    const queued = async (what: "advisory" | "row") => {
      const [{ n }]: Array<{ n: number }> = await bypass(() => prisma.$queryRawUnsafe(
        `SELECT count(DISTINCT l.pid)::int AS n
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE a.datname = current_database() AND NOT l.granted
           AND l.locktype IN (${what === "advisory" ? "'advisory'" : "'transactionid', 'tuple'"})`,
      ))
      return n
    }
    /**
     * Waits for what another session is about to do, and says what never
     * happened instead of hanging. By the steady clock: the calendar one is
     * held still here. Shorter than the five seconds a creation's own
     * transaction is given, so a wait that fails does so by its own name.
     */
    async function until(happened: () => Promise<boolean>, what: string) {
      const started = performance.now()
      while (!(await happened())) {
        if (performance.now() - started > 4_000) throw new Error(`never happened: ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    /**
     * Another session — a colleague's request half-way through — that keeps
     * what `take` took until it is let go. Nothing of it is left afterwards.
     */
    async function heldByAnotherSession(take: (tx: RawTx) => Promise<unknown>) {
      let letGo: () => void = () => {}
      const lettingGo = new Promise<void>((resolve) => { letGo = resolve })
      let taken: () => void = () => {}
      let refused: (error: unknown) => void = () => {}
      const holding = new Promise<void>((resolve, reject) => { taken = resolve; refused = reject })
      const session = bypass(() => prisma.$transaction(async (tx: unknown) => {
        await take(tx as RawTx)
        taken()
        await lettingGo
      }, { timeout: 60_000, maxWait: 20_000 }))
      session.catch(refused)
      await holding
      return async () => {
        letGo()
        await session
      }
    }
    const switchLinks = async (on: boolean) => {
      const { PUT } = await import("@/app/api/v1/mtm/settings/route")
      return PUT(put("/api/v1/mtm/settings", { locationShareLinksEnabled: on }))
    }
    const linksOfOrganization = (working: boolean) => bypass(() => prisma.mtmLocationShareLink.count({
      where: { organizationId: ORG, ...(working ? { revokedAt: null, expiresAt: { gt: new Date() } } : {}) },
    }))
    const tokenIn = (body: { data?: { url?: unknown } } | null) =>
      typeof body?.data?.url === "string" ? new URL(body.data.url, "http://localhost").pathname.split("/").pop() ?? "" : ""

    it("keeps the organization's switch in a table Postgres guards as production does — the reads of it above ran against that policy", async () => {
      const [flags]: Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }> = await bypass(() => prisma.$queryRawUnsafe(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"mtm_settings"'::regclass`,
      ))
      expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      // The role no policy exempts (the save and the creation ran as it two cases up) reads the row inside its organization and nowhere else.
      run(`GRANT SELECT, UPDATE ON "mtm_settings" TO "${OUTSIDER}";`)
      const switchOf = (settings: { orgId?: string }) => asOutsider<Array<{ value: unknown }>>(
        settings, `SELECT "value" FROM "mtm_settings" WHERE "key" = 'locationShareLinksEnabled' FOR SHARE`,
      )
      expect(await switchOf({ orgId: ORG })).toEqual([{ value: true }])
      expect(await switchOf({ orgId: OTHER_ORG })).toEqual([])
      expect(await switchOf({})).toEqual([])
    })

    it("a link being made at the moment the links are switched off is not made: behind the employee's lock the creation asks the switch again", async () => {
      const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const { resetRateLimit } = await import("@/lib/rate-limit")
      resetRateLimit(`mtm-location-share-links-write:${ORG}:admin-user`)
      const journalled = () => bypass(() => prisma.mtmAuditLog.count({ where: { organizationId: ORG, agentId: shown, action: "LOCATION_SHARE_LINK_CREATE" } }))

      await at(after(40 * MINUTE), async () => {
        expect((await switchLinks(true)).status).toBe(200)
        const before = { rows: await linksOfOrganization(false), journalled: await journalled() }

        // A colleague's request holds this employee's lock: the creation has
        // looked at the switch — on — and now stands between that look and its insert.
        const letGo = await heldByAnotherSession((tx) => tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, `mtm-location-share-link:${ORG}:${shown}`,
        ))
        const creating = POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))
        let off: Response | null = null
        let workingRightAfterOff: number | null = null
        try {
          await until(async () => (await queued("advisory")) >= 1, "the creation came to wait for the employee's lock")
          // Switched off meanwhile, the way a person does it: the settings page's own save. It waits for nobody.
          off = await switchLinks(false)
          workingRightAfterOff = await linksOfOrganization(true)
        } finally {
          await letGo()
          await creating.catch(() => null)
        }
        const made = await creating
        const body = await made.json()
        const handedOver = tokenIn(body)
        const workingAfterCreation = await linksOfOrganization(true)

        // Switched on again.
        const on = await switchLinks(true)
        expect({
          off: off?.status,
          workingRightAfterOff,
          creation: made.status,
          rowsAdded: (await linksOfOrganization(false)) - before.rows,
          journalRowsAdded: (await journalled()) - before.journalled,
          workingAfterCreation,
          on: on.status,
          workingAfterOnAgain: await linksOfOrganization(true),
          // Were a link handed over all the same, this is where it would open.
          handedOverLinkOpens: handedOver ? (await openLink("203.0.113.60", handedOver)).status : "no link was handed over",
        }).toEqual({
          off: 200,
          workingRightAfterOff: 0,
          creation: 403,
          rowsAdded: 0,
          journalRowsAdded: 0,
          workingAfterCreation: 0,
          on: 200,
          workingAfterOnAgain: 0,
          handedOverLinkOpens: "no link was handed over",
        })
        // The same answer as a creation that found the links off at the door.
        expect(body).toEqual({
          error: "The organization has location links switched off",
          code: "MTM_LOCATION_SHARE_LINK_DISABLED",
          setting: "locationShareLinksEnabled",
        })
      })
    }, 120_000)

    it("and one that got to the switch first is ended by that very save: the save waits for the link to be made, then ends it with the rest", async () => {
      const { POST } = await import("@/app/api/v1/mtm/locations/share-links/route")
      const { resetRateLimit } = await import("@/lib/rate-limit")
      resetRateLimit(`mtm-location-share-links-write:${ORG}:admin-user`)

      await at(after(45 * MINUTE), async () => {
        expect((await switchLinks(true)).status).toBe(200)
        const workingBefore = await linksOfOrganization(true)

        // A colleague's request holds the employee's own row: the creation
        // gets through the lock and the switch — on, its row now held — and
        // stops at the insert, which has to look that employee up.
        const letGo = await heldByAnotherSession((tx) => tx.$queryRawUnsafe(
          `SELECT 1 AS held FROM "mtm_agents" WHERE "organizationId" = $1 AND "id" = $2 FOR UPDATE`, ORG, shown,
        ))
        const creating = POST(send("POST", linksUrl, { agentId: shown, duration: "1h" }))
        let saving: Promise<Response> | null = null
        let saved = false
        try {
          await until(async () => (await queued("row")) >= 1, "the creation came to wait at its insert")
          saving = switchLinks(false).finally(() => { saved = true })
          // The save has to wait for the row the creation holds. (Were the row
          // not held, the save would be through by now — and what follows would say so.)
          await until(async () => saved || (await queued("row")) >= 2, "the save either waited for the creation or went past it")
        } finally {
          await letGo()
          await creating.catch(() => null)
          await saving?.catch(() => null)
        }
        const made = await creating
        const body = await made.json()
        expect(made.status, JSON.stringify(body).slice(0, 300)).toBe(201)
        const madeToken = tokenIn(body)
        expect(madeToken).toMatch(/^[a-f0-9]{64}$/)
        const off = await saving
        expect(off?.status, JSON.stringify(await off?.clone().json()).slice(0, 300)).toBe(200)

        // The link was made — and ended by the save that had been waiting for it, at that save's own moment, by whoever saved.
        const row = () => bypass(() => prisma.mtmLocationShareLink.findUniqueOrThrow({ where: { id: body.data.link.id }, select: { revokedAt: true, revokedBy: true } }))
        expect(await row()).toEqual({ revokedAt: after(45 * MINUTE), revokedBy: "admin-user" })
        expect(await linksOfOrganization(true)).toBe(0)
        // The journal's row for the save counts it with the rest.
        const [journal] = await bypass(() => prisma.mtmAuditLog.findMany({
          where: { organizationId: ORG, action: "SETTINGS_UPDATE" }, orderBy: { createdAt: "desc" }, take: 1, select: { newData: true },
        }))
        expect(journal.newData).toMatchObject({ locationShareLinksEnabled: false, locationShareLinksEnded: workingBefore + 1 })
        expect(await openLink("203.0.113.61", madeToken)).toEqual(GONE)

        // Switched on again: it stays ended.
        expect((await switchLinks(true)).status).toBe(200)
        expect(await openLink("203.0.113.62", madeToken)).toEqual(GONE)
        expect(await row()).toEqual({ revokedAt: after(45 * MINUTE), revokedBy: "admin-user" })
        expect(await linksOfOrganization(true)).toBe(0)
      })
    }, 120_000)
  })
})
