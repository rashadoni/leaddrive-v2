/**
 * Which existing routes an Excel route import calls a schedule conflict —
 * asked of the real upload, apply and export handlers over a real Postgres.
 *
 * Until 2026-10-15 the import compared each route of the file with every
 * published or started route of the same employee on ANY date, and read those
 * routes without their meeting times, so every stop looked untimed. Every
 * route of every file "conflicted", apply refused without the manager's
 * override checkbox, and the checkbox stopped meaning anything. A conflict is
 * now what the route builder and publish call one: the same employee (primary
 * or participant), the same day, and a meeting slot that matches or is missing
 * on either side.
 *
 * `planned_time` in the file is a wall-clock time in the organization's MTM
 * timezone (the template contract), resolved the way the route builder
 * resolves its time inputs. Until the same day the import stored and compared
 * it as UTC, so an imported 10:00 was a different instant from a 10:00 set by
 * hand, and the export wrote it back the same way. The organization here is in
 * Asia/Tashkent (UTC+5, no daylight saving) — not the default zone, so the
 * suite also shows the setting is read. Routes "built by hand" are written the
 * way the builder stores them: the local slot as a UTC instant.
 *
 * What a mocked Prisma cannot show is what the handlers select and filter by:
 * the bug was a missing `date` filter and a missing `plannedTime` column. The
 * stand-ins are who is calling (an administrator's web session) and the
 * tenant's plan. The scratch database runs in Europe/Berlin, like production.
 *
 * Set MTM_EXCEL_ROUTES_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   MTM_EXCEL_ROUTES_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM Excel route conflicts database gate»), where
 * `MTM_EXCEL_ROUTES_DB_GATE=required` turns a missing URL into a failure so the
 * gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ExcelJS from "exceljs"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildMtmExcelTemplate } from "@/lib/mtm/excel-contract"
import { buildMtmRouteDedupeKey } from "@/lib/mtm/route-planning"

const adminUrl = process.env.MTM_EXCEL_ROUTES_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_EXCEL_ROUTES_DB_GATE === "required") {
  throw new Error("MTM_EXCEL_ROUTES_TEST_DATABASE_URL is required by the MTM Excel route conflicts database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_EXCEL_ROUTES_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_excel_routes_${process.pid}`
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
    orgId: "org-excel-routes",
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
const ORG = "org-excel-routes"
const IMPORT_URL = "http://localhost:3000/api/v1/mtm/excel/imports"
const EXPORT_URL = "http://localhost:3000/api/v1/mtm/excel/exports/ROUTES"
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** The day every imported route is planned for. */
const DAY = "2026-11-03"
/** A meeting slot on DAY in Asia/Tashkent, as the route builder stores it (UTC instant). */
const slot = (localTime: string, date = DAY) => {
  const [hours, minutes] = localTime.split(":").map(Number)
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hours - 5, minutes))
}

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
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-excel-routes-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** One stop of a route in the uploaded file. Agent codes: the first is the primary. */
type FileStop = { route: string; date?: string; agents: string[]; order: number; customer: string; time?: string }
type Warning = { code: string; message: string }
type ImportAnswer = {
  data?: {
    job: { id: string }
    summary: { createRows: number; errorRows: number; requiresConflictOverride: boolean }
    preview: Array<{ externalId: string; warnings: Warning[] }>
    errors: Array<{ errorCode: string }>
  }
  error?: string
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("Excel route import conflicts on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let postImport!: typeof import("@/app/api/v1/mtm/excel/imports/route").POST
  let postApply!: typeof import("@/app/api/v1/mtm/excel/imports/[id]/apply/route").POST
  let getExport!: typeof import("@/app/api/v1/mtm/excel/exports/[type]/route").GET
  const agentIds = new Map<string, string>()
  const customerIds = new Map<string, string>()
  let handBuilt = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    // Production sessions run in Europe/Berlin (postgresql.conf), not UTC.
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `ALTER DATABASE "${scratch!.name}" SET timezone TO 'Europe/Berlin'`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    postImport = (await import("@/app/api/v1/mtm/excel/imports/route")).POST
    postApply = (await import("@/app/api/v1/mtm/excel/imports/[id]/apply/route")).POST
    getExport = (await import("@/app/api/v1/mtm/excel/exports/[type]/route")).GET
    await bypass(async () => {
      await prisma.organization.create({
        data: { id: ORG, name: "Tenant with field agents", slug: ORG, modules: { mtm: true, "route-field": true } },
      })
      await prisma.mtmSetting.create({ data: { organizationId: ORG, key: "timezone", value: "Asia/Tashkent" } })
      for (const code of ["AG-ELSEWHERE", "AG-APART", "AG-SAME-SLOT", "AG-LOCAL", "AG-UNTIMED", "AG-NO-TIME", "AG-LEAD", "AG-PARTNER", "AG-COPY"]) {
        const agent = await prisma.mtmAgent.create({ data: { organizationId: ORG, name: `Agent ${code}`, externalCode: code } })
        agentIds.set(code, agent.id)
      }
      for (const [code, name] of [["CL-001", "Clinic One"], ["CL-002", "Clinic Two"], ["CL-003", "Clinic Three"]]) {
        const customer = await prisma.mtmCustomer.create({ data: { organizationId: ORG, name, code } })
        customerIds.set(code, customer.id)
      }
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  const agent = (code: string) => agentIds.get(code)!
  const customer = (code: string) => customerIds.get(code)!

  /**
   * A route already published (or started) from the route builder, with the
   * builder's dedupe key. `times` holds one entry per stop: a local slot, or
   * null for a stop without a meeting time.
   */
  async function routeBuiltByHand(input: {
    primary: string
    participants?: string[]
    date?: string
    status?: "PLANNED" | "IN_PROGRESS"
    times: Array<string | null>
  }) {
    const date = input.date ?? DAY
    const points = input.times.map((time, index) => ({
      customerId: customer(`CL-00${index + 1}`),
      plannedTime: time ? slot(time, date) : null,
    }))
    const assignments = [
      { agentId: agent(input.primary), role: "PRIMARY" as const },
      ...(input.participants ?? []).map((code) => ({ agentId: agent(code), role: "PARTICIPANT" as const })),
    ]
    return bypass(() => prisma.mtmRoute.create({
      data: {
        organizationId: ORG,
        agentId: agent(input.primary),
        date: new Date(`${date}T00:00:00.000Z`),
        name: `Hand-built route ${++handBuilt}`,
        status: input.status ?? "PLANNED",
        dedupeKey: buildMtmRouteDedupeKey({ date, primaryAgentId: agent(input.primary), assignments, points }),
        assignments: { create: assignments.map((assignment) => ({ organizationId: ORG, ...assignment })) },
        points: { create: points.map((point, orderIndex) => ({ organizationId: ORG, orderIndex, ...point })) },
      },
      select: { id: true },
    }))
  }

  async function upload(stops: FileStop[]) {
    const workbook = buildMtmExcelTemplate("ROUTES", "en")
    const sheet = workbook.getWorksheet("routes")!
    sheet.spliceRows(2, 1) // the template's example row
    for (const stop of stops) {
      sheet.addRow([stop.route, stop.date ?? DAY, null, stop.agents.join(","), stop.agents[0], stop.order, stop.customer, stop.time ?? null, null])
    }
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer)
    const form = new FormData()
    form.set("type", "ROUTES")
    form.set("file", new File([bytes], "routes.xlsx", { type: XLSX }))
    const response = await postImport(new NextRequest(IMPORT_URL, { method: "POST", body: form }))
    const body = await response.json() as ImportAnswer
    expect(response.status, JSON.stringify(body)).toBe(201)
    return body.data!
  }

  async function apply(jobId: string, allowConflictOverride: boolean) {
    const response = await postApply(new NextRequest(`${IMPORT_URL}/${jobId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowConflictOverride }),
    }), { params: Promise.resolve({ id: jobId }) })
    return { status: response.status, body: await response.json() as { error?: string } }
  }

  const importedRoute = (externalId: string) => bypass(() => prisma.mtmRoute.findFirst({
    where: { organizationId: ORG, externalId },
    select: { status: true, date: true, points: { select: { plannedTime: true }, orderBy: { orderIndex: "asc" } } },
  }))

  it("ignores the employee's published and started routes on other days, and stores the file's time in the organization's zone", async () => {
    // Same day the conservative rule would flag both: one has a stop without a
    // time, the other a stop in the very slot the file asks for.
    await routeBuiltByHand({ primary: "AG-ELSEWHERE", date: "2026-11-02", times: [null] })
    await routeBuiltByHand({ primary: "AG-ELSEWHERE", date: "2026-11-04", status: "IN_PROGRESS", times: ["10:00"] })

    const result = await upload([{ route: "XL-ELSEWHERE", agents: ["AG-ELSEWHERE"], order: 1, customer: "CL-001", time: "10:00" }])

    expect(result.summary).toMatchObject({ createRows: 1, errorRows: 0, requiresConflictOverride: false })
    expect(result.preview[0].warnings).toEqual([])
    expect(await apply(result.job.id, false)).toMatchObject({ status: 200 })
    const route = await importedRoute("XL-ELSEWHERE")
    expect(route).toMatchObject({ status: "DRAFT", date: new Date(`${DAY}T00:00:00.000Z`) })
    // 10:00 in Tashkent, not 10:00 UTC.
    expect(route!.points.map((point: { plannedTime: Date | null }) => point.plannedTime?.toISOString())).toEqual(["2026-11-03T05:00:00.000Z"])

    // And the export gives the planner back the time they typed.
    const exported = await getExport(new NextRequest(`${EXPORT_URL}?from=${DAY}&to=${DAY}`), { params: Promise.resolve({ type: "ROUTES" }) })
    expect(exported.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exported.arrayBuffer() as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet("routes")!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
    const exportedRows = Array.from({ length: sheet.actualRowCount - 1 }, (_, index) => {
      const values = (sheet.getRow(index + 2).values as unknown[]).slice(1)
      return Object.fromEntries(headers.map((header, column) => [header, values[column]]))
    })
    expect(exportedRows.find((row) => row.route_external_id === "XL-ELSEWHERE")).toMatchObject({ planned_time: "10:00" })
  })

  it("lets a route of the same day through when every meeting has its own slot", async () => {
    await routeBuiltByHand({ primary: "AG-APART", times: ["09:00", "11:00"] })

    const result = await upload([
      { route: "XL-APART", agents: ["AG-APART"], order: 1, customer: "CL-001", time: "10:00" },
      { route: "XL-APART", agents: ["AG-APART"], order: 2, customer: "CL-002", time: "12:00" },
    ])

    expect(result.summary).toMatchObject({ createRows: 1, errorRows: 0, requiresConflictOverride: false })
    expect(await apply(result.job.id, false)).toMatchObject({ status: 200 })
    expect(await importedRoute("XL-APART")).toMatchObject({ status: "DRAFT" })
  })

  it("reports a route of the same day with a meeting in the same slot, and refuses it without the override", async () => {
    const existing = await routeBuiltByHand({ primary: "AG-SAME-SLOT", times: ["09:00", "10:00"] })

    const result = await upload([{ route: "XL-SAME-SLOT", agents: ["AG-SAME-SLOT"], order: 1, customer: "CL-003", time: "10:00" }])

    expect(result.summary).toMatchObject({ createRows: 1, errorRows: 0, requiresConflictOverride: true })
    expect(result.preview[0].warnings).toEqual([{ code: "ROUTE_CONFLICT_AGENT_SCHEDULE_CONFLICT", message: `Conflicts with route ${existing.id}` }])
    const refused = await apply(result.job.id, false)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(/explicit manager override/)
    expect(await importedRoute("XL-SAME-SLOT")).toBeNull()

    expect(await apply(result.job.id, true)).toMatchObject({ status: 200 })
    expect(await importedRoute("XL-SAME-SLOT")).toMatchObject({ status: "DRAFT" })
  })

  it("reads the file's time in the organization's zone when comparing slots", async () => {
    // 10:00 in Tashkent is 05:00 UTC. A file saying 05:00 means five in the
    // morning there — a different slot; a file saying 10:00 is the same one.
    const existing = await routeBuiltByHand({ primary: "AG-LOCAL", times: ["10:00"] })

    const early = await upload([{ route: "XL-LOCAL-EARLY", agents: ["AG-LOCAL"], order: 1, customer: "CL-002", time: "05:00" }])
    expect(early.summary.requiresConflictOverride).toBe(false)

    const same = await upload([{ route: "XL-LOCAL-SAME", agents: ["AG-LOCAL"], order: 1, customer: "CL-002", time: "10:00" }])
    expect(same.preview[0].warnings).toEqual([{ code: "ROUTE_CONFLICT_AGENT_SCHEDULE_CONFLICT", message: `Conflicts with route ${existing.id}` }])
  })

  it("reports a route of the same day whose stop has no meeting time, on either side", async () => {
    const untimed = await routeBuiltByHand({ primary: "AG-UNTIMED", times: ["09:00", null] })
    const fromFile = await upload([{ route: "XL-UNTIMED", agents: ["AG-UNTIMED"], order: 1, customer: "CL-003", time: "15:00" }])
    expect(fromFile.summary.requiresConflictOverride).toBe(true)
    expect(fromFile.preview[0].warnings).toEqual([{ code: "ROUTE_CONFLICT_AGENT_SCHEDULE_CONFLICT", message: `Conflicts with route ${untimed.id}` }])

    const timed = await routeBuiltByHand({ primary: "AG-NO-TIME", times: ["09:00"] })
    const noTime = await upload([{ route: "XL-NO-TIME", agents: ["AG-NO-TIME"], order: 1, customer: "CL-003" }])
    expect(noTime.summary.requiresConflictOverride).toBe(true)
    expect(noTime.preview[0].warnings).toEqual([{ code: "ROUTE_CONFLICT_AGENT_SCHEDULE_CONFLICT", message: `Conflicts with route ${timed.id}` }])
  })

  it("counts an employee who is a participant of a route of the same day", async () => {
    const shared = await routeBuiltByHand({ primary: "AG-LEAD", participants: ["AG-PARTNER"], times: ["10:00"] })

    const result = await upload([{ route: "XL-PARTNER", agents: ["AG-PARTNER"], order: 1, customer: "CL-002", time: "10:00" }])

    expect(result.preview[0].warnings).toEqual([{ code: "ROUTE_CONFLICT_AGENT_SCHEDULE_CONFLICT", message: `Conflicts with route ${shared.id}` }])
  })

  it("still refuses a route identical to one built by hand", async () => {
    // Same employee, day, client and local slot: the file's fingerprint now
    // equals the route builder's, so the duplicate is caught.
    await routeBuiltByHand({ primary: "AG-COPY", times: ["10:00"] })

    const result = await upload([{ route: "XL-COPY", agents: ["AG-COPY"], order: 1, customer: "CL-001", time: "10:00" }])

    expect(result.summary).toMatchObject({ createRows: 0, errorRows: 1 })
    expect(result.errors).toEqual([expect.objectContaining({ errorCode: "ROUTE_DUPLICATE" })])
  })
})
