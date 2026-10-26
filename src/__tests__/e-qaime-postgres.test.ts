/**
 * Finance → «E-qaimə» on a real Postgres under row-level security: what the
 * Chrome extension brings in from e-Taxes, read back off the table and through
 * the tab's own handlers.
 *
 *  - An invoice is filed under the signed-in company only when that company is
 *    its buyer (incoming) or its seller (outgoing); a batch with one foreign
 *    invoice writes nothing.
 *  - Totals are summed here from the lines, six decimals kept, and the VAT is
 *    18 % of the portal's 18 % base — not 18 % of the whole.
 *  - Reading the same invoice again updates its status and keeps its PDF; the
 *    PDF is stored sealed and comes back as the same bytes.
 *  - The counterparty is linked to the CRM company with its VÖEN, in this
 *    organization only.
 *  - Another organization sees none of it, with the app connected as a role
 *    that cannot bypass row-level security.
 *  - The Excel file has a row per product with the same sums.
 *
 * The real handlers run with the real `requireAuth` (role matrix, Finance
 * module gate), the real RLS wrappers and the real Prisma client. Only the
 * session cookie is a stand-in.
 *
 * Set E_QAIME_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55497:5432 postgres:16
 *   E_QAIME_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («E-qaimə database gate»), where `E_QAIME_DB_GATE=required` turns
 * a missing URL into a failure so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import ExcelJS from "exceljs"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.E_QAIME_TEST_DATABASE_URL
if (!adminUrl && process.env.E_QAIME_DB_GATE === "required") {
  throw new Error("E_QAIME_TEST_DATABASE_URL is required by the e-qaimə database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.E_QAIME_TEST_DATABASE_URL
  if (!admin) return null
  const name = `e_qaime_${process.pid}`
  const role = `e_qaime_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  return { name, role, password, adminScratch: adminScratch.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = path.join(ROOT, "prisma/migrations/20261105100000_e_qaime_invoices/migration.sql")
const ORG = "org-eqaime"
const OTHER = "org-eqaime-other"
const OURS = "1400000000"
const SUPPLIER = "1700000011"
const BUYER = "1900000049"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}
const sql = (url: string, statement: string) => prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

/** The schema as `db push` can build it on any Postgres (no pgvector columns). */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "e-qaime-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** The migration's own row-level security and CHECK, applied over the pushed table. */
function migrationGuards(): string {
  const text = readFileSync(MIGRATION, "utf8")
  const check = text.match(/CONSTRAINT "e_qaime_invoices_direction_check" CHECK \([^;]*?\)\)/)?.[0]
  const rls = text.slice(text.indexOf(`ALTER TABLE "e_qaime_invoices" ENABLE ROW LEVEL SECURITY;`))
  if (!check || !rls.includes("FORCE ROW LEVEL SECURITY") || !rls.includes("CREATE POLICY tenant_isolation")) {
    throw new Error("row-level security or the direction CHECK not found in the migration")
  }
  // The generic isolation migration above puts its own policy on every table
  // with organizationId; what is tested here is this migration's.
  return `DROP POLICY IF EXISTS tenant_isolation ON "e_qaime_invoices";\nALTER TABLE "e_qaime_invoices" ADD ${check};\n${rls}`
}

function signIn(role: string, organizationId = ORG) {
  session.current = { user: { id: `user-${role}`, organizationId, role, email: `${role}@example.com`, name: `Name ${role}` } }
}

const json = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
})
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n")

function incoming(over: Record<string, unknown> = {}) {
  return {
    portalId: "5001",
    direction: "inbox",
    serialNumber: "MT261024318807",
    kind: "defaultInvoice",
    docType: "current",
    status: "onApproval",
    issuedAt: "2026-10-24T06:15:00.000Z",
    sender: { voen: SUPPLIER, name: "Gəncə Kərpic ASC" },
    receiver: { voen: OURS, name: "Nümunə MMC" },
    comment: "34 nömrəli 21.09.2026 tarixli müqavilə",
    items: [
      { name: "Kərpic", code: "6904100000", unit: "ədəd", quantity: 1000, price: 0.222711876, cost: 222.711876, vat18: 222.711876 },
      { name: "Daşınma", code: "4900000000", unit: "xidmət", quantity: 1, price: 50, cost: 50, vatFree: 50, roadTax: 1.5 },
    ],
    ...over,
  }
}
function outgoing(over: Record<string, unknown> = {}) {
  return {
    portalId: "7001",
    direction: "outbox",
    serialNumber: "MT261020275311",
    kind: "defaultInvoice",
    status: "approved",
    issuedAt: "2026-10-20T08:00:00.000Z",
    sender: { voen: OURS, name: "Nümunə MMC" },
    receiver: { voen: BUYER, name: "Ağ Şəhər Tikinti MMC" },
    items: [{ name: "Xidmət", code: "4900000000", unit: "xidmət", quantity: 2, price: 600, cost: 1200, vat18: 1200 }],
    ...over,
  }
}
const own = { voen: OURS, name: "Nümunə MMC" }

describe.skipIf(!scratch)("e-qaimə on a real Postgres under row-level security", () => {
  type App = typeof import("@/lib/prisma").prisma
  let app!: App
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let importPost!: typeof import("@/app/api/finance/e-qaime/import/route").POST
  let knownPost!: typeof import("@/app/api/finance/e-qaime/known/route").POST
  let list!: typeof import("@/app/api/finance/e-qaime/route").GET
  let pdf!: typeof import("@/app/api/finance/e-qaime/[id]/pdf/route")
  let exportGet!: typeof import("@/app/api/finance/e-qaime/export/route").GET
  let runtimeDir = ""
  let logDir = ""

  beforeAll(async () => {
    const control = adminUrl!
    sql(control, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(control, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    // Production's isolation on the other tenant tables (companies among them),
    // then this table's own, exactly as its migration writes it.
    prismaCli(["db", "execute", "--url", scratch!.adminScratch, "--file", path.join(ROOT, "prisma/migrations/20260825170000_tenant_isolation_from_migrations/migration.sql")], process.env)
    sql(scratch!.adminScratch, migrationGuards())
    sql(control, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(control, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)

    // The real external-runtime guard rejects /tmp, as it should in production;
    // a configured runtime root asks for a log root outside the checkout too.
    runtimeDir = mkdtempSync(path.join(homedir(), ".e-qaime-runtime-test-"))
    process.env.LEADDRIVE_RUNTIME_DIR = runtimeDir
    logDir = mkdtempSync(path.join(homedir(), ".e-qaime-logs-test-"))
    process.env.LEADDRIVE_LOG_DIR = logDir

    app = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    importPost = (await import("@/app/api/finance/e-qaime/import/route")).POST
    knownPost = (await import("@/app/api/finance/e-qaime/known/route")).POST
    list = (await import("@/app/api/finance/e-qaime/route")).GET
    pdf = await import("@/app/api/finance/e-qaime/[id]/pdf/route")
    exportGet = (await import("@/app/api/finance/e-qaime/export/route")).GET

    await bypass(async () => {
      for (const id of [ORG, OTHER]) {
        await app.organization.create({ data: { id, name: id, slug: id, modules: { crm: true, finance: true } } })
      }
      await app.company.create({ data: { id: "co-supplier", organizationId: ORG, name: "Gəncə Kərpic (CRM)", voen: SUPPLIER } })
      // The same VÖEN in another organization: never linked from ours.
      await app.company.create({ data: { id: "co-elsewhere", organizationId: OTHER, name: "Elsewhere", voen: BUYER } })
    })
  }, 300_000)

  afterAll(async () => {
    await app?.$disconnect()
    for (const dir of [runtimeDir, logDir]) if (dir) rmSync(dir, { recursive: true, force: true })
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  beforeEach(() => signIn("manager"))

  async function rows(organizationId = ORG) {
    return bypass(() => app.eQaimeInvoice.findMany({ where: { organizationId }, orderBy: { serialNumber: "asc" } }))
  }

  it("files incoming and outgoing invoices, summed from their lines", async () => {
    const res = await importPost(json("POST", "/api/finance/e-qaime/import", { own, invoices: [incoming(), outgoing()] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { portalId: string; hasPdf: boolean }) => [r.portalId, r.hasPdf])).toEqual([["5001", false], ["7001", false]])

    const [out, inc] = await rows()
    expect([inc.direction, inc.counterpartyVoen, inc.counterpartyName, inc.counterpartyCompanyId]).toEqual(["inbox", SUPPLIER, "Gəncə Kərpic ASC", "co-supplier"])
    // 18 % of the 18 % base only; the transport line is not taxed.
    expect(inc.vatAmount.toString()).toBe("40.088138")
    expect(inc.netAmount.toString()).toBe("272.711876")
    expect(inc.roadTaxAmount.toString()).toBe("1.5")
    expect(inc.totalAmount.toString()).toBe("314.300014")
    expect(inc.importedByUserId).toBe("user-manager")
    // The buyer's VÖEN belongs to a company of another organization: no link.
    expect([out.direction, out.counterpartyVoen, out.counterpartyCompanyId, out.vatAmount.toString()]).toEqual(["outbox", BUYER, null, "216"])
  })

  it("refuses the whole batch when one invoice is not the signed-in company's", async () => {
    const before = await rows()
    const stranger = incoming({ portalId: "5999", serialNumber: "MT261024999999", receiver: { voen: "1111111111", name: "Somebody" } })
    const res = await importPost(json("POST", "/api/finance/e-qaime/import", { own, invoices: [incoming({ portalId: "5002", serialNumber: "MT261024000002" }), stranger] }))
    expect(res.status).toBe(422)
    expect((await res.json()).serialNumbers).toEqual(["MT261024999999"])
    expect(await rows()).toEqual(before)
  })

  it("keeps the PDF sealed on disk and gives back the same bytes", async () => {
    const [, inc] = await rows()
    const put = await pdf.PUT(new NextRequest(`http://localhost:3000/api/finance/e-qaime/${inc.id}/pdf`, { method: "PUT", body: PDF }), params(inc.id))
    expect(put.status).toBe(200)

    const stored = readdirSync(path.join(runtimeDir, "uploads", "e-qaime"))
    expect(stored).toHaveLength(1)
    const onDisk = readFileSync(path.join(runtimeDir, "uploads", "e-qaime", stored[0]))
    expect(onDisk.includes(PDF)).toBe(false)

    const got = await pdf.GET(json("GET", `/api/finance/e-qaime/${inc.id}/pdf`), params(inc.id))
    expect(got.status).toBe(200)
    expect(Buffer.from(await got.arrayBuffer()).equals(PDF)).toBe(true)

    const notPdf = await pdf.PUT(new NextRequest(`http://localhost:3000/api/finance/e-qaime/${inc.id}/pdf`, { method: "PUT", body: Buffer.from("<html>") }), params(inc.id))
    expect(notPdf.status).toBe(400)
  })

  it("a second reading updates the status and keeps the PDF", async () => {
    const known = await knownPost(json("POST", "/api/finance/e-qaime/known", {
      ownVoen: OURS,
      keys: [{ portalId: "5001", direction: "inbox" }, { portalId: "7001", direction: "outbox" }, { portalId: "9999", direction: "inbox" }],
    }))
    expect((await known.json()).data.map((k: { portalId: string; status: string; hasPdf: boolean }) => [k.portalId, k.status, k.hasPdf]).sort())
      .toEqual([["5001", "onApproval", true], ["7001", "approved", false]])

    const res = await importPost(json("POST", "/api/finance/e-qaime/import", { own, invoices: [incoming({ status: "approved" })] }))
    expect((await res.json()).data).toMatchObject([{ portalId: "5001", hasPdf: true }])
    const all = await rows()
    expect(all).toHaveLength(2)
    expect(all.find((r) => r.portalId === "5001")).toMatchObject({ status: "approved" })
    expect(all.find((r) => r.portalId === "5001")?.pdfFile).toBeTruthy()
  })

  it("the tab lists one direction, with tiles for both", async () => {
    const res = await list(json("GET", "/api/finance/e-qaime?direction=inbox&from=2026-10-01&to=2026-10-31"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((r: { serialNumber: string; company: { id: string } | null; hasPdf: boolean }) => [r.serialNumber, r.company?.id, r.hasPdf]))
      .toEqual([["MT261024318807", "co-supplier", true]])
    expect(body.tiles.inbox).toMatchObject({ count: 1, total: "314.300014", vat: "40.088138" })
    expect(body.tiles.outbox).toMatchObject({ count: 1, total: "1416", vat: "216" })
    expect(body.lastSync).toMatchObject({ ownVoen: OURS, by: null })
  })

  it("another organization sees none of it, even naming the row", async () => {
    signIn("admin", OTHER)
    const body = await (await list(json("GET", "/api/finance/e-qaime?direction=inbox"))).json()
    expect([body.data, body.tiles.inbox.count, body.lastSync]).toEqual([[], 0, null])
    const [, inc] = await rows()
    expect((await pdf.GET(json("GET", `/api/finance/e-qaime/${inc.id}/pdf`), params(inc.id))).status).toBe(404)
    // And the table itself, read as the app role inside the other tenant's context.
    const { runWithTenant } = await import("@/lib/rls-context")
    expect(await runWithTenant(OTHER, () => app.eQaimeInvoice.count())).toBe(0)
    expect(await runWithTenant(ORG, () => app.eQaimeInvoice.count())).toBe(2)
  })

  it("a viewer reads the tab but cannot bring invoices in", async () => {
    signIn("viewer")
    expect((await list(json("GET", "/api/finance/e-qaime"))).status).toBe(200)
    const res = await importPost(json("POST", "/api/finance/e-qaime/import", { own, invoices: [outgoing({ portalId: "7002", serialNumber: "MT261020000002" })] }))
    expect(res.status).toBe(403)
    expect(await rows()).toHaveLength(2)
  })

  it("the Excel file has a row per product, with the same sums", async () => {
    const res = await exportGet(new NextRequest("http://localhost:3000/api/finance/e-qaime/export?from=2026-10-01&to=2026-10-31", { headers: { cookie: "NEXT_LOCALE=ru" } }))
    expect(res.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer)
    const sheet = workbook.worksheets[0]
    const header = (sheet.getRow(1).values as unknown[]).slice(1)
    expect(header.slice(0, 4)).toEqual(["Направление", "Вид", "Статус", "Номер"])
    const data = sheet.getSheetValues().slice(2).filter(Boolean) as unknown[][]
    expect(data).toHaveLength(3)
    const col = (name: string) => header.indexOf(name) + 1
    const brick = data.find((row) => row[col("Товар / услуга")] === "Kərpic")!
    expect([brick[col("НДС 18%")], brick[col("Итого по строке")], brick[col("VÖEN продавца")], brick[col("VÖEN покупателя")]])
      .toEqual([40.088138, 262.800014, SUPPLIER, OURS])
  })
})
