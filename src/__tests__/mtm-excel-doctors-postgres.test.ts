/**
 * Doctors from Excel (Zeytun, 2026-11-13) — the real upload and apply
 * handlers over a real Postgres, read back from the tables.
 *
 * What a mocked Prisma cannot show: that one name under one agent in two rows
 * becomes ONE doctor with two workplaces (owner: «некоторые врачи бывают в
 * разных клиниках»), that the same name under another agent stays a separate
 * doctor, that «12 Saylı» and «12 sayli» are one clinic and an existing clinic
 * is reused rather than copied, that a file with an unknown agent or a doctor
 * without a clinic writes nothing, that a repeated file adds nothing, and that
 * a doctor who already has a primary agent gets the new one as a second —
 * the database allows one primary.
 *
 * Set MTM_EXCEL_DOCTORS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_EXCEL_DOCTORS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («MTM Excel doctors database gate»), where
 * `MTM_EXCEL_DOCTORS_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildMtmExcelTemplate } from "@/lib/mtm/excel-contract"

const adminUrl = process.env.MTM_EXCEL_DOCTORS_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_EXCEL_DOCTORS_DB_GATE === "required") {
  throw new Error("MTM_EXCEL_DOCTORS_TEST_DATABASE_URL is required by the MTM Excel doctors database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_EXCEL_DOCTORS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_excel_doctors_${process.pid}`
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
  // The organization's administrator at a browser.
  requireAuth: vi.fn(async () => ({
    orgId: "org-excel-doctors",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.test",
    name: "Admin",
    principalType: "session",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
// The tenant's plan is not what is under test.
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-excel-doctors"
const IMPORT_URL = "http://localhost:3000/api/v1/mtm/excel/imports"
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-excel-doctors-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** The unique indexes that decide what a write may do, lifted from their migration. */
function assignmentIndexes(): string[] {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20260715173000_mtm_contact_assignment_foundation/migration.sql"), "utf8")
  const names = [
    "mtm_contact_workplaces_active_pair_key",
    "mtm_contact_agent_assignments_active_key",
    "mtm_contact_agent_assignments_active_primary_key",
  ]
  return names.map((name) => {
    const statement = sql.match(new RegExp(`CREATE UNIQUE INDEX "${name}"[^;]*;`))?.[0]
    if (!statement) throw new Error(`${name} not found in its migration`)
    return statement
  })
}

/** One row of the uploaded file. */
type FileRow = { agent: string; doctor: string; code?: string; specialty?: string; clinic?: string; city?: string; district?: string; address?: string }
type Warning = { code: string; params?: Record<string, string> }
type ImportAnswer = {
  data?: {
    job: { id: string }
    summary: { createRows: number; updateRows: number; unchangedRows: number; errorRows: number; newPlaces?: number }
    preview: Array<{ doctorName: string; operation: string; warnings: Warning[] }>
    errors: Array<{ rowNumber: number; columnName: string; errorCode: string }>
  }
  error?: string
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("doctors from Excel on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let postImport!: typeof import("@/app/api/v1/mtm/excel/imports/route").POST
  let postApply!: typeof import("@/app/api/v1/mtm/excel/imports/[id]/apply/route").POST
  const agents = new Map<string, string>()
  let existingClinic = ""
  let files = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    for (const statement of assignmentIndexes()) {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, statement)
    }
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    postImport = (await import("@/app/api/v1/mtm/excel/imports/route")).POST
    postApply = (await import("@/app/api/v1/mtm/excel/imports/[id]/apply/route")).POST
    await bypass(async () => {
      await prisma.organization.create({
        data: { id: ORG, name: "Tenant with doctors", slug: ORG, modules: { mtm: true, "route-field": true } },
      })
      for (const [key, name, code] of [["first", "First Agent", "AG-1"], ["second", "Second Agent", null], ["third", "Third Agent", "AG-3"]] as const) {
        const agent = await prisma.mtmAgent.create({ data: { organizationId: ORG, name, externalCode: code } })
        agents.set(key, agent.id)
      }
      // A clinic MTM already knows; the file writes it in other letters.
      const clinic = await prisma.mtmCustomer.create({ data: { organizationId: ORG, name: "Şəhər Klinikası", city: "Bakı", objectType: "CLINIC", latitude: 40.4, longitude: 49.8 } })
      existingClinic = clinic.id
      // A pharmacy of the same name is not a clinic to put doctors in.
      await prisma.mtmCustomer.create({ data: { organizationId: ORG, name: "Central Point", city: "Bakı", objectType: "PHARMACY" } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  async function upload(rows: FileRow[]) {
    const workbook = buildMtmExcelTemplate("DOCTORS", "en")
    const sheet = workbook.getWorksheet("doctors")!
    sheet.spliceRows(2, 1) // the template's example row
    for (const row of rows) {
      sheet.addRow([row.agent, row.doctor, row.code ?? null, row.specialty ?? null, row.clinic ?? null, row.city ?? null, row.district ?? null, row.address ?? null])
    }
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer)
    const form = new FormData()
    form.set("type", "DOCTORS")
    form.set("file", new File([bytes], `doctors-${++files}.xlsx`, { type: XLSX }))
    const response = await postImport(new NextRequest(IMPORT_URL, { method: "POST", body: form }))
    const body = await response.json() as ImportAnswer
    expect(response.status, JSON.stringify(body)).toBe(201)
    return body.data!
  }

  async function apply(jobId: string) {
    const response = await postApply(new NextRequest(`${IMPORT_URL}/${jobId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowConflictOverride: false }),
    }), { params: Promise.resolve({ id: jobId }) })
    return { status: response.status, body: await response.json() as { error?: string } }
  }

  const counts = () => bypass(async () => ({
    doctors: await prisma.mtmContact.count({ where: { organizationId: ORG, type: "DOCTOR" } }),
    clinics: await prisma.mtmCustomer.count({ where: { organizationId: ORG, objectType: "CLINIC" } }),
    workplaces: await prisma.mtmContactWorkplace.count({ where: { organizationId: ORG } }),
    assignments: await prisma.mtmContactAgentAssignment.count({ where: { organizationId: ORG } }),
  }))

  const doctorsNamed = (displayName: string) => bypass(() => prisma.mtmContact.findMany({
    where: { organizationId: ORG, displayName },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      specialtyName: true,
      workplaces: { select: { customer: { select: { id: true, name: true, objectType: true, latitude: true } } } },
      agentAssignments: { select: { agentId: true, role: true } },
    },
  }))

  // Fictional people and places only: the repository is public.
  const FILE: FileRow[] = [
    { agent: "AG-1", doctor: "Doctor Twoplace", specialty: "Neurologist", clinic: "12 Saylı Poliklinika", city: "Bakı", district: "Yasamal" },
    { agent: "first agent", doctor: "Doctor  Twoplace", clinic: "seher klinikasi", city: "Baki" },
    { agent: "Second Agent", doctor: "Doctor Namesake", clinic: "12 sayli poliklinika", city: "Bakı" },
    { agent: "AG-3", doctor: "Doctor Namesake", clinic: "Rayon Xəstəxanası", city: "Şəki" },
  ]

  it("writes nothing while a row names an unknown agent or a doctor without a clinic", async () => {
    const before = await counts()
    const result = await upload([...FILE, { agent: "Nobody Here", doctor: "Doctor Lost", clinic: "Clinic X" }, { agent: "AG-1", doctor: "Doctor Nowhere" }])
    expect(result.errors.map((error) => [error.rowNumber, error.columnName, error.errorCode])).toEqual([
      [6, "agent", "AGENT_NOT_FOUND"],
      [7, "clinic_name", "REQUIRED"],
    ])
    const refused = await apply(result.job.id)
    expect(refused.status).toBe(409)
    expect(await counts()).toEqual(before)
  })

  it("makes one doctor of one name under one agent, keeps namesakes of other agents apart, and reuses a clinic MTM knows", async () => {
    const result = await upload(FILE)
    expect(result.errors).toEqual([])
    expect(result.summary).toMatchObject({ createRows: 3, updateRows: 0, unchangedRows: 0, errorRows: 0, newPlaces: 2 })
    const codes = result.preview.flatMap((row) => row.warnings.map((warning) => warning.code)).sort()
    expect(codes).toEqual(["CLINIC_SPELLINGS", "NAMESAKE_OTHER_AGENT", "NAMESAKE_OTHER_AGENT", "TWO_CLINICS"])
    expect((await apply(result.job.id)).status).toBe(200)

    const [twoPlaces] = await doctorsNamed("Doctor Twoplace")
    expect(twoPlaces).toMatchObject({ firstName: "Doctor", lastName: "Twoplace", specialtyName: "Neurologist" })
    expect(twoPlaces.workplaces.map((workplace) => workplace.customer.name).sort()).toEqual(["12 Saylı Poliklinika", "Şəhər Klinikası"])
    // The clinic MTM already had, with its pin — not a pinless copy.
    expect(twoPlaces.workplaces.find((workplace) => workplace.customer.name === "Şəhər Klinikası")!.customer).toMatchObject({ id: existingClinic, latitude: 40.4 })
    expect(twoPlaces.agentAssignments).toEqual([{ agentId: agents.get("first"), role: "PRIMARY" }])

    const namesakes = await doctorsNamed("Doctor Namesake")
    expect(namesakes).toHaveLength(2)
    expect(namesakes.map((doctor) => doctor.agentAssignments[0].agentId).sort()).toEqual([agents.get("second"), agents.get("third")].sort())
    // «12 Saylı» and «12 sayli» are one clinic; the new ones are clinics without a pin.
    expect(namesakes[0].workplaces[0].customer.id).toBe(twoPlaces.workplaces.find((workplace) => workplace.customer.name === "12 Saylı Poliklinika")!.customer.id)
    expect(await counts()).toEqual({ doctors: 3, clinics: 3, workplaces: 4, assignments: 3 })
    const created = await bypass(() => prisma.mtmCustomer.findMany({ where: { organizationId: ORG, objectType: "CLINIC", id: { not: existingClinic } }, select: { latitude: true, district: true, name: true } }))
    expect(created.every((clinic) => clinic.latitude === null)).toBe(true)
    expect(created.find((clinic) => clinic.name === "12 Saylı Poliklinika")?.district).toBe("Yasamal")
  })

  it("adds nothing when the same list comes again", async () => {
    const before = await counts()
    const result = await upload([...FILE].reverse())
    expect(result.summary).toMatchObject({ createRows: 0, updateRows: 0, unchangedRows: 3, errorRows: 0, newPlaces: 0 })
    expect((await apply(result.job.id)).status).toBe(200)
    expect(await counts()).toEqual(before)
  })

  it("adds a new clinic to a known doctor, and gives a doctor with a primary agent the new agent as a second one", async () => {
    const result = await upload([
      { agent: "AG-1", doctor: "Doctor Twoplace", clinic: "Third Place Clinic", city: "Bakı" },
      { agent: "AG-3", doctor: "Doctor Twoplace", clinic: "12 Saylı Poliklinika", city: "Bakı" },
    ])
    // The second row is another agent's: a new doctor of that name, said so.
    expect(result.summary).toMatchObject({ createRows: 1, updateRows: 1, errorRows: 0, newPlaces: 1 })
    expect(result.preview.flatMap((row) => row.warnings.map((warning) => warning.code))).toEqual(expect.arrayContaining(["SAME_NAME_EXISTS"]))
    expect((await apply(result.job.id)).status).toBe(200)
    const doctors = await doctorsNamed("Doctor Twoplace")
    expect(doctors[0].workplaces.map((workplace) => workplace.customer.name).sort()).toEqual(["12 Saylı Poliklinika", "Third Place Clinic", "Şəhər Klinikası"])

    // By code: the same doctor, another agent — the database allows one primary.
    await bypass(() => prisma.mtmContact.update({ where: { id: doctors[0].id }, data: { externalCode: "DR-1" } }))
    const second = await upload([{ agent: "Second Agent", doctor: "Doctor Twoplace", code: "DR-1", clinic: "Third Place Clinic", city: "Bakı" }])
    expect(second.summary).toMatchObject({ updateRows: 1, errorRows: 0 })
    expect(second.preview[0].warnings.map((warning) => warning.code)).toEqual(["OTHER_PRIMARY_AGENT"])
    expect((await apply(second.job.id)).status).toBe(200)
    const [coded] = await bypass(() => prisma.mtmContact.findMany({ where: { id: doctors[0].id }, select: { agentAssignments: { select: { agentId: true, role: true }, orderBy: { createdAt: "asc" } } } }))
    expect(coded.agentAssignments).toEqual([
      { agentId: agents.get("first"), role: "PRIMARY" },
      { agentId: agents.get("second"), role: "SECONDARY" },
    ])
  })
})
