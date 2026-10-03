/**
 * Loading a client base from Excel, against a real Postgres.
 *
 * The real upload, apply, client-list and assignment handlers run over a
 * scratch database built from the real schema; only the session and the
 * tenant's plan are stubbed. A mocked Prisma answers anything, and on
 * 2026-10-02 that is how a feature with every unit test green reached prod
 * unable to save once — so what an import writes, and what a field agent then
 * sees, is checked here on the database itself.
 *
 * Every name in the spreadsheets below is invented.
 *
 * Set MTM_EXCEL_CONTACTS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   MTM_EXCEL_CONTACTS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks`, where
 * `MTM_EXCEL_CONTACTS_DB_GATE=required` turns a missing URL into a failure so
 * the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_EXCEL_CONTACTS_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_EXCEL_CONTACTS_DB_GATE === "required") {
  throw new Error("MTM_EXCEL_CONTACTS_TEST_DATABASE_URL is required by the MTM client import database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_EXCEL_CONTACTS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_excel_contacts_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const ORG = "org-client-import"
const ADMIN = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const SUPERVISOR = { orgId: ORG, userId: "supervisor-user", role: "manager", email: "supervisor@example.com", name: "Supervisor" }
const FIELD_AGENT = { orgId: ORG, userId: "elvin-user", role: "member", email: "elvin@example.com", name: "Elvin" }

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
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
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres: two knowledge-base
 * tables carry a pgvector column that plain `postgres:16` cannot create, and
 * nothing here reads them.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-excel-contacts-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

type Row = Partial<Record<
  | "external_code" | "last_name" | "first_name" | "middle_name" | "contact_type" | "specialty"
  | "institution_code" | "institution_name" | "institution_address" | "institution_city"
  | "phone" | "notes" | "agent_code_or_email",
  string
>>

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("client import from Excel on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let elvinId!: string
  let otherTeamAgentId!: string

  /** A filled-in template, as the administrator would upload it. */
  async function xlsx(rows: Row[]): Promise<Buffer> {
    const { buildMtmExcelTemplate, getMtmExcelContract } = await import("@/lib/mtm/excel-contract")
    const book = buildMtmExcelTemplate("CONTACTS", "en")
    const sheet = book.getWorksheet("contacts")!
    const columns = getMtmExcelContract("CONTACTS").columns.map((column) => column.key)
    rows.forEach((row, index) => {
      sheet.getRow(2 + index).values = columns.map((key) => row[key as keyof Row] ?? null)
    })
    return Buffer.from(await book.xlsx.writeBuffer())
  }

  async function upload(bytes: Buffer, fileName: string, type = "CONTACTS") {
    const { POST } = await import("@/app/api/v1/mtm/excel/imports/route")
    const form = new FormData()
    form.append("type", type)
    form.append("locale", "en")
    form.append("file", new File([new Uint8Array(bytes)], fileName))
    const response = await POST(new NextRequest("http://localhost:3000/api/v1/mtm/excel/imports", { method: "POST", body: form }))
    return { status: response.status, body: await response.json() }
  }

  async function apply(jobId: string) {
    const { POST } = await import("@/app/api/v1/mtm/excel/imports/[id]/apply/route")
    const response = await POST(
      new NextRequest(`http://localhost:3000/api/v1/mtm/excel/imports/${jobId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: jobId }) },
    )
    return { status: response.status, body: await response.json() }
  }

  async function signInAs(user: typeof ADMIN) {
    const { requireAuth } = await import("@/lib/api-auth")
    vi.mocked(requireAuth).mockResolvedValue(user as never)
  }

  /** What the «Клиенты» list shows the signed-in person. */
  async function clientList(query = "") {
    const { GET } = await import("@/app/api/v1/mtm/contacts/route")
    const response = await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/contacts?limit=200${query}`))
    const body = await response.json()
    return (body.data.contacts as Array<{ externalCode: string | null; displayName: string }>).map((contact) => contact.externalCode)
  }

  function counts() {
    return bypass(async () => ({
      contacts: await prisma.mtmContact.count({ where: { organizationId: ORG } }),
      institutions: await prisma.mtmCustomer.count({ where: { organizationId: ORG } }),
      workplaces: await prisma.mtmContactWorkplace.count({ where: { organizationId: ORG } }),
      assignments: await prisma.mtmContactAgentAssignment.count({ where: { organizationId: ORG } }),
    }))
  }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Nümunə Pharma", slug: "client-import-test" } })
      await prisma.user.createMany({
        data: [ADMIN, SUPERVISOR, FIELD_AGENT].map((user) => ({
          id: user.userId, organizationId: ORG, email: user.email, name: user.name, passwordHash: "-", role: user.role,
        })),
      })
      const team = await prisma.mtmTeam.create({ data: { organizationId: ORG, name: "Bakı" }, select: { id: true } })
      await prisma.mtmAgent.create({
        data: { organizationId: ORG, name: "Supervisor", userId: SUPERVISOR.userId, role: "SUPERVISOR", teamId: team.id },
      })
      elvinId = (await prisma.mtmAgent.create({
        data: { organizationId: ORG, name: "Elvin Sahə", userId: FIELD_AGENT.userId, email: FIELD_AGENT.email, externalCode: "AG-07", role: "AGENT", teamId: team.id },
        select: { id: true },
      })).id
      otherTeamAgentId = (await prisma.mtmAgent.create({
        data: { organizationId: ORG, name: "Başqa Komanda", externalCode: "AG-31", role: "AGENT" },
        select: { id: true },
      })).id
      await prisma.mtmCustomer.create({
        data: { organizationId: ORG, code: "KL-001", name: "Mərkəzi Klinika", objectType: "CLINIC" },
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => signInAs(ADMIN))

  it("accepts the migration's enum value on a database that does not have it yet", async () => {
    // `db push` built the scratch enum from schema.prisma, so the migration
    // file itself would otherwise never meet a database. Here it runs, as
    // written, against the enum as the original migration left it.
    const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261003120000_mtm_import_type_contacts/migration.sql"), "utf8")
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, [
      `CREATE SCHEMA migration_probe;`,
      `CREATE TYPE migration_probe."MtmImportType" AS ENUM ('CUSTOMERS', 'ROUTES', 'SALES_FACTS', 'VISIT_RESULTS', 'PLAN_FACT');`,
    ].join("\n"))
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `SET search_path TO migration_probe;\n${migration}`)
    // A second run is what a re-applied migration does.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `SET search_path TO migration_probe;\n${migration}`)

    const labels: Array<{ label: string }> = await bypass(() => prisma.$queryRaw`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'migration_probe' AND t.typname = 'MtmImportType'
      ORDER BY e.enumsortorder`)
    expect(labels.map((row) => row.label)).toEqual(["CUSTOMERS", "ROUTES", "SALES_FACTS", "VISIT_RESULTS", "PLAN_FACT", "CONTACTS"])
  })

  it("writes nothing while a file has errors, and checks the same file again once the base is fixed", async () => {
    const bytes = await xlsx([
      { external_code: "TRP.010", last_name: "Qurbanlı", first_name: "Aynur", specialty: "terapevt", institution_code: "KL-001", agent_code_or_email: "AG-55" },
      { external_code: "TRP.011", first_name: "Rəna", institution_code: "KL-001" },
    ])
    const before = await counts()

    const first = await upload(bytes, "doctors-with-problems.xlsx")
    expect(first.status).toBe(201)
    expect(first.body.data.summary).toMatchObject({ totalRows: 2, createRows: 0, errorRows: 2 })
    expect(first.body.data.errors.map((error: { rowNumber: number; errorCode: string }) => [error.rowNumber, error.errorCode]))
      .toEqual([[2, "REFERENCE_NOT_FOUND"], [3, "REQUIRED"]])
    const refused = await apply(first.body.data.job.id)
    expect(refused.status).toBe(409)
    expect(await counts()).toEqual(before)

    // The administrator gives the missing employee his code and fixes nothing
    // in the file's first row; the second row still has no last name.
    await bypass(() => prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Yeni Əməkdaş", externalCode: "AG-55", role: "AGENT" } }))
    const again = await upload(bytes, "doctors-with-problems.xlsx")
    expect(again.status).toBe(200)
    expect(again.body.data.job.id).toBe(first.body.data.job.id)
    expect(again.body.data.summary).toMatchObject({ createRows: 1, errorRows: 1, assignRows: 1 })
    const stored = await bypass(() => prisma.mtmImportRowError.findMany({
      where: { jobId: first.body.data.job.id },
      select: { rowNumber: true, errorCode: true },
    }))
    expect(stored).toEqual([{ rowNumber: 3, errorCode: "REQUIRED" }])
    expect(await counts()).toEqual(before)
  })

  it("loads a base: institutions once, each client with a workplace, and owners the field agent can see", async () => {
    const before = await counts()
    const bytes = await xlsx([
      { external_code: "TRP.001", last_name: "Səfərov", first_name: "Tural", middle_name: "Kamil oğlu", specialty: "terapevt", institution_code: "KL-001", agent_code_or_email: "AG-07", phone: "+994500000001" },
      { external_code: "TRP.002", last_name: "Nağıyeva", first_name: "Lalə", specialty: "Qastroenteroloq", institution_name: "Sağlam Ailə Klinikası", institution_address: "[Адрес ожидает обработки]", institution_city: "Təyin edilməyib", agent_code_or_email: "elvin@example.com" },
      { external_code: "TRP.003", last_name: "Əhmədov", first_name: "Samir", institution_name: "SAĞLAM AİLƏ KLİNİKASI", institution_address: "Bağ küçəsi 3", institution_city: "Bakı", agent_code_or_email: "AG-31", notes: "Çərşənbə günləri qəbul edir" },
      { external_code: "APT.001", last_name: "Vəliyeva", first_name: "Günay", contact_type: "pharmacist", institution_name: "Şəfa Aptek" },
      { external_code: "TRP.004", last_name: "—", first_name: "Fidan", institution_code: "KL-001", agent_code_or_email: "AG-07" },
    ])

    const uploaded = await upload(bytes, "doctors.xlsx")
    expect(uploaded.body.data.errors).toEqual([])
    expect(uploaded.body.data.summary).toMatchObject({ totalRows: 5, createRows: 5, errorRows: 0, createInstitutions: 2, assignRows: 4 })
    expect(uploaded.body.data.warnings.map((warning: { rowNumber: number; code: string }) => [warning.rowNumber, warning.code]))
      .toEqual([[6, "LAST_NAME_UNKNOWN"]])
    expect(await counts()).toEqual(before)

    const applied = await apply(uploaded.body.data.job.id)
    expect(applied.body).toMatchObject({ success: true, data: { status: "COMPLETED", replayed: false } })
    expect(await counts()).toEqual({
      contacts: before.contacts + 5,
      institutions: before.institutions + 2,
      workplaces: before.workplaces + 5,
      assignments: before.assignments + 4,
    })

    const stored = await bypass(() => prisma.mtmContact.findMany({
      where: { organizationId: ORG, externalCode: { in: ["TRP.001", "TRP.002", "TRP.003", "APT.001", "TRP.004"] } },
      orderBy: { externalCode: "asc" },
      select: {
        externalCode: true, displayName: true, lastName: true, type: true, specialtyName: true, phone: true, notes: true, status: true, source: true,
        workplaces: { select: { isPrimary: true, source: true, customer: { select: { name: true, code: true, objectType: true, address: true, city: true } } } },
        agentAssignments: { select: { agentId: true, role: true, source: true, effectiveTo: true, assignedBy: true } },
      },
    }))
    const byCode = new Map<string, Record<string, unknown>>(
      stored.map((contact: { externalCode: string }) => [contact.externalCode, contact]),
    )
    expect(byCode.get("TRP.001")).toMatchObject({
      displayName: "Səfərov Tural Kamil oğlu", type: "DOCTOR", specialtyName: "Terapevt", phone: "+994500000001", status: "ACTIVE", source: "EXCEL_IMPORT",
      workplaces: [{ isPrimary: true, customer: { code: "KL-001", name: "Mərkəzi Klinika" } }],
      agentAssignments: [{ agentId: elvinId, role: "PRIMARY", source: "EXCEL_IMPORT", effectiveTo: null, assignedBy: ADMIN.userId }],
    })
    // Two spellings that differ by case are one new institution; the placeholder
    // address of the first row gives way to the real one of the second.
    const family = { code: null, name: "Sağlam Ailə Klinikası", objectType: "CLINIC", address: "Bağ küçəsi 3", city: "Bakı" }
    expect(byCode.get("TRP.002")?.workplaces).toEqual([{ isPrimary: true, source: "EXCEL_IMPORT", customer: family }])
    expect(byCode.get("TRP.003")).toMatchObject({
      notes: "Çərşənbə günləri qəbul edir",
      workplaces: [{ customer: family }],
      agentAssignments: [{ agentId: otherTeamAgentId }],
    })
    expect(byCode.get("APT.001")).toMatchObject({
      type: "PHARMACIST",
      workplaces: [{ customer: { name: "Şəfa Aptek", objectType: "PHARMACY", address: null, city: null } }],
      agentAssignments: [],
    })
    expect(byCode.get("TRP.004")).toMatchObject({ lastName: "—", displayName: "Fidan" })

    // The trail the single-record endpoints leave: one entry per record, the
    // batch entries of the assignment endpoint, and the import itself.
    const audit = await bypass(() => prisma.mtmAuditLog.groupBy({
      by: ["action"],
      where: { organizationId: ORG, action: { in: ["CONTACT_CREATE", "FIELD_ORGANIZATION_CREATE", "CONTACT_BULK_ASSIGN", "IMPORT_APPLY"] } },
      _count: { _all: true },
      orderBy: { action: "asc" },
    }))
    expect(audit.map((row: { action: string; _count: { _all: number } }) => [row.action, row._count._all])).toEqual([
      ["CONTACT_BULK_ASSIGN", 2], ["CONTACT_CREATE", 5], ["FIELD_ORGANIZATION_CREATE", 2], ["IMPORT_APPLY", 1],
    ])
    const operations = await bypass(() => prisma.mtmContactAssignmentOperation.findMany({
      where: { organizationId: ORG, idempotencyKey: { startsWith: `excel-import:${uploaded.body.data.job.id}:` } },
      select: { status: true, mode: true, targetAgentId: true, actorUserId: true },
      orderBy: { targetAgentId: "asc" },
    }))
    expect(operations.map((operation: { status: string; mode: string; actorUserId: string | null }) => [operation.status, operation.mode, operation.actorUserId]))
      .toEqual([["COMPLETED", "ASSIGN", ADMIN.userId], ["COMPLETED", "ASSIGN", ADMIN.userId]])

    // What it was all for: the agent opens «Клиенты» and finds his doctors —
    // his own three, not the colleague's and not the unassigned pharmacist.
    await signInAs(FIELD_AGENT)
    expect((await clientList()).sort()).toEqual(["TRP.001", "TRP.002", "TRP.004"])
    expect((await clientList(`&ownerAgentId=${elvinId}`)).sort()).toEqual(["TRP.001", "TRP.002", "TRP.004"])

    // Applying the same job again changes nothing.
    await signInAs(ADMIN)
    const replay = await apply(uploaded.body.data.job.id)
    expect(replay.body).toMatchObject({ success: true, data: { status: "COMPLETED", replayed: true } })
    expect((await counts()).contacts).toBe(before.contacts + 5)
  })

  it("hands an imported client to another agent through the assignment screen's own endpoints", async () => {
    const { POST: preview } = await import("@/app/api/v1/mtm/contact-assignments/preview/route")
    const { POST: execute } = await import("@/app/api/v1/mtm/contact-assignments/route")
    const contact = await bypass(() => prisma.mtmContact.findFirstOrThrow({ where: { organizationId: ORG, externalCode: "TRP.001" }, select: { id: true } }))
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date())
    const request = { contactIds: [contact.id], mode: "ASSIGN", targetAgentId: otherTeamAgentId, effectiveFrom: today, reason: "Ərazi dəyişdi" }
    const post = (url: string, body: unknown) => new NextRequest(`http://localhost:3000${url}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })

    const previewed = await (await preview(post("/api/v1/mtm/contact-assignments/preview", request))).json()
    expect(previewed.data.summary).toMatchObject({ selected: 1, assignable: 1 })
    const executed = await execute(post("/api/v1/mtm/contact-assignments", { ...request, previewToken: previewed.data.previewToken, idempotencyKey: "move-dte-001" }))
    expect(await executed.json()).toMatchObject({ success: true, data: { summary: { changed: 1 } } })

    const assignments = await bypass(() => prisma.mtmContactAgentAssignment.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: "asc" },
      select: { agentId: true, source: true, effectiveTo: true },
    }))
    expect(assignments).toMatchObject([
      { agentId: elvinId, source: "EXCEL_IMPORT" },
      { agentId: otherTeamAgentId, source: "BULK_ASSIGNMENT", effectiveTo: null },
    ])
    expect(assignments[0].effectiveTo).toBeInstanceOf(Date)
  })

  it("writes nothing at all when the base changed between the check and the apply", async () => {
    const bytes = await xlsx([
      { external_code: "GST.001", last_name: "Rzayev", first_name: "Emin", institution_name: "Yeni Tibb Mərkəzi", agent_code_or_email: "AG-07" },
      { external_code: "GST.002", last_name: "Abbasova", first_name: "Nigar", institution_name: "Yeni Tibb Mərkəzi" },
    ])
    const uploaded = await upload(bytes, "gastro.xlsx")
    expect(uploaded.body.data.summary).toMatchObject({ createRows: 2, errorRows: 0, createInstitutions: 1 })

    // Somebody adds one of these doctors by hand before "apply" is pressed.
    const { POST: createContact } = await import("@/app/api/v1/mtm/contacts/route")
    const byHand = await createContact(new NextRequest("http://localhost:3000/api/v1/mtm/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalCode: "GST.002", firstName: "Nigar", lastName: "Abbasova" }),
    }))
    expect(byHand.status).toBe(201)
    const before = await counts()

    const applied = await apply(uploaded.body.data.job.id)
    expect(applied.status).toBe(409)
    expect(applied.body.error).toContain("GST.002")
    // Not the first doctor, not the new institution, not an assignment.
    expect(await counts()).toEqual(before)
    const job = await bypass(() => prisma.mtmImportJob.findUniqueOrThrow({ where: { id: uploaded.body.data.job.id }, select: { status: true } }))
    expect(job.status).toBe("READY")

    // Uploading the same file again now says which row is in the way.
    const again = await upload(bytes, "gastro.xlsx")
    expect(again.body.data.errors.map((error: { rowNumber: number; errorCode: string }) => [error.rowNumber, error.errorCode]))
      .toEqual([[3, "ALREADY_EXISTS"]])
  })

  it("lets a supervisor load clients for their own team only, and a field agent not at all", async () => {
    const bytes = await xlsx([
      { external_code: "SUP.001", last_name: "Hacıyeva", first_name: "Leyla", institution_code: "KL-001", agent_code_or_email: "AG-07" },
      { external_code: "SUP.002", last_name: "Sultanov", first_name: "Elçin", institution_code: "KL-001", agent_code_or_email: "AG-31" },
    ])

    await signInAs(FIELD_AGENT)
    expect((await upload(bytes, "team.xlsx")).status).toBe(403)

    await signInAs(SUPERVISOR)
    // No manager opt-in is set: institutions stay closed, clients are open.
    expect((await upload(bytes, "team.xlsx", "CUSTOMERS")).status).toBe(403)
    const uploaded = await upload(bytes, "team.xlsx")
    expect(uploaded.status).toBe(201)
    expect(uploaded.body.data.errors.map((error: { rowNumber: number; errorCode: string }) => [error.rowNumber, error.errorCode]))
      .toEqual([[3, "OUTSIDE_SCOPE"]])

    const own = await upload(await xlsx([
      { external_code: "SUP.001", last_name: "Hacıyeva", first_name: "Leyla", institution_code: "KL-001", agent_code_or_email: "AG-07" },
    ]), "team-own.xlsx")
    const applied = await apply(own.body.data.job.id)
    expect(applied.body).toMatchObject({ success: true, data: { status: "COMPLETED" } })
    const owner = await bypass(() => prisma.mtmContactAgentAssignment.findFirstOrThrow({
      where: { organizationId: ORG, contact: { externalCode: "SUP.001" } },
      select: { agentId: true, assignedBy: true },
    }))
    expect(owner).toEqual({ agentId: elvinId, assignedBy: SUPERVISOR.userId })
  })
})
