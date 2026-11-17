/**
 * Suppliers on a real Postgres (docs/sales-procurement/README.md, tasks 1.1–2.1).
 *
 * A supplier is a company of the category `supplier`. What has to hold, read
 * back from the tables after the real handlers ran:
 *   - the module decides: an organization without `procurement` gets 403 and
 *     nothing is written;
 *   - the role decides: purchasing and management add suppliers, sales reads
 *     the list and cannot add one;
 *   - a supplier never shows up in the customer list of companies, and the
 *     supplier list shows only this organization's suppliers;
 *   - a malformed VÖEN is refused before anything is written.
 *
 * The real handlers run with the real `requireAuth`, the real RLS wrappers and
 * the real Prisma client over a scratch database built from schema.prisma; the
 * session cookie is the only stand-in.
 *
 * Set PROCUREMENT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   PROCUREMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («Procurement database gate»), where PROCUREMENT_DB_GATE=required turns
 * a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.PROCUREMENT_TEST_DATABASE_URL
if (!adminUrl && process.env.PROCUREMENT_DB_GATE === "required") {
  throw new Error("PROCUREMENT_TEST_DATABASE_URL is required by the procurement database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.PROCUREMENT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `procurement_${process.pid}`
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
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const SUPPLIERS_URL = "http://localhost:3000/api/v1/procurement/suppliers"
const COMPANIES_URL = "http://localhost:3000/api/v1/companies"

/** Buys for its orders: has the procurement module. */
const BUYER = "org-buyer"
/** Has CRM and sales, never given procurement. */
const PLAIN = "org-plain"
const ROLES = ["admin", "manager", "procurement", "finance", "sales", "support", "viewer"] as const

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/** The schema as `db push` can build it on any Postgres (no pgvector columns). */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "procurement-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

function signIn(orgId: string, role: string) {
  session.current = {
    user: { id: `${role}-${orgId}`, organizationId: orgId, role, email: `${role}@${orgId}.example`, name: role },
  }
}

function request(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("suppliers on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let listSuppliers!: typeof import("@/app/api/v1/procurement/suppliers/route").GET
  let addSupplier!: typeof import("@/app/api/v1/procurement/suppliers/route").POST
  let listCompanies!: typeof import("@/app/api/v1/companies/route").GET

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    ;({ GET: listSuppliers, POST: addSupplier } = await import("@/app/api/v1/procurement/suppliers/route"))
    listCompanies = (await import("@/app/api/v1/companies/route")).GET
    const tenants = [
      { id: BUYER, modules: { crm: true, sales: true, procurement: true, settings: true } },
      { id: PLAIN, modules: { crm: true, sales: true, settings: true } },
    ]
    for (const tenant of tenants) {
      await bypass(() => prisma.organization.create({
        data: { id: tenant.id, name: `Tenant ${tenant.id}`, slug: tenant.id, modules: tenant.modules },
      }))
      for (const role of ROLES) {
        await bypass(() => prisma.user.create({
          data: { id: `${role}-${tenant.id}`, organizationId: tenant.id, email: `${role}@${tenant.id}.example`, name: role, passwordHash: "x", role },
        }))
      }
    }
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(async () => {
    await bypass(() => prisma.auditLog.deleteMany({}))
    await bypass(() => prisma.company.deleteMany({}))
  })

  async function add(orgId: string, role: string, body: Record<string, unknown>) {
    signIn(orgId, role)
    return addSupplier(request(SUPPLIERS_URL, "POST", body))
  }

  async function names(res: Response, key: "suppliers" | "companies"): Promise<string[]> {
    const body = await res.json()
    return (body.data?.[key] ?? []).map((row: { name: string }) => row.name).sort()
  }

  const companiesOf = (orgId: string) =>
    bypass(() => prisma.company.findMany({ where: { organizationId: orgId }, select: { name: true, category: true, voen: true }, orderBy: { name: "asc" } }))

  it("purchasing and management add a supplier; it is written as a company of the category supplier", async () => {
    for (const role of ["admin", "manager", "procurement"]) {
      const res = await add(BUYER, role, { name: `Decor Materials ${role}`, voen: "1234567890", phone: "+994 12 555 00 00" })
      expect(res.status, role).toBe(201)
    }
    expect(await companiesOf(BUYER)).toEqual([
      { name: "Decor Materials admin", category: "supplier", voen: "1234567890" },
      { name: "Decor Materials manager", category: "supplier", voen: "1234567890" },
      { name: "Decor Materials procurement", category: "supplier", voen: "1234567890" },
    ])
    const audit = await bypass(() => prisma.auditLog.findMany({ where: { organizationId: BUYER, entityType: "company", action: "create" } }))
    expect(audit).toHaveLength(3)
  })

  it("sales, finance, support and viewers add nothing", async () => {
    for (const role of ["sales", "finance", "support", "viewer"]) {
      const res = await add(BUYER, role, { name: `Should not exist ${role}` })
      expect(res.status, role).toBe(403)
    }
    expect(await companiesOf(BUYER)).toEqual([])
  })

  it("an organization without the module is refused both reading and adding, and nothing is written", async () => {
    const write = await add(PLAIN, "admin", { name: "Not here" })
    expect(write.status).toBe(403)
    signIn(PLAIN, "admin")
    const read = await listSuppliers(request(SUPPLIERS_URL, "GET"))
    expect(read.status).toBe(403)
    expect(await companiesOf(PLAIN)).toEqual([])
  })

  it("everyone who follows a purchase reads the list; support does not", async () => {
    await add(BUYER, "procurement", { name: "Printing House" })
    for (const role of ["admin", "manager", "procurement", "finance", "sales", "viewer"]) {
      signIn(BUYER, role)
      const res = await listSuppliers(request(SUPPLIERS_URL, "GET"))
      expect(res.status, role).toBe(200)
      expect(await names(res, "suppliers"), role).toEqual(["Printing House"])
    }
    signIn(BUYER, "support")
    expect((await listSuppliers(request(SUPPLIERS_URL, "GET"))).status).toBe(403)
  })

  it("the customer list of companies leaves suppliers out; asking for the category shows them", async () => {
    await add(BUYER, "procurement", { name: "Fabric Supplier" })
    await bypass(() => prisma.company.createMany({
      data: [
        { organizationId: BUYER, name: "Client Bank", category: "client" },
        { organizationId: BUYER, name: "Partner Agency", category: "partner" },
        { organizationId: BUYER, name: "Prospect Hotel", category: "prospect" },
      ],
    }))
    signIn(BUYER, "admin")
    expect(await names(await listCompanies(request(COMPANIES_URL, "GET")), "companies")).toEqual(["Client Bank", "Prospect Hotel"])
    expect(await names(await listCompanies(request(`${COMPANIES_URL}?view=list`, "GET")), "companies")).toEqual(["Client Bank", "Prospect Hotel"])
    expect(await names(await listCompanies(request(`${COMPANIES_URL}?category=supplier`, "GET")), "companies")).toEqual(["Fabric Supplier"])
  })

  it("the supplier list shows only suppliers, only this organization's, and finds them by VÖEN", async () => {
    await add(BUYER, "procurement", { name: "Wood Workshop", voen: "1111111111" })
    await add(BUYER, "procurement", { name: "Paint Shop", voen: "2222222222" })
    await bypass(() => prisma.company.createMany({
      data: [
        { organizationId: BUYER, name: "A Client", category: "client" },
        { organizationId: PLAIN, name: "Somebody else's supplier", category: "supplier" },
      ],
    }))
    signIn(BUYER, "procurement")
    expect(await names(await listSuppliers(request(SUPPLIERS_URL, "GET")), "suppliers")).toEqual(["Paint Shop", "Wood Workshop"])
    expect(await names(await listSuppliers(request(`${SUPPLIERS_URL}?search=2222`, "GET")), "suppliers")).toEqual(["Paint Shop"])
  })

  it("a malformed VÖEN is refused and nothing is written", async () => {
    const res = await add(BUYER, "procurement", { name: "Bad Number", voen: "12-34" })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_VOEN")
    expect(await companiesOf(BUYER)).toEqual([])
  })
})
