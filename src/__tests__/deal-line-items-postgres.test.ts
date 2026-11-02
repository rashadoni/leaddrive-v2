/**
 * Product lines of a deal against a real Postgres: the deal's amount is the
 * lines' sum, an ordinary deal edit cannot overwrite it or change the currency
 * under it, a catalog price in another currency is not copied, «Next best
 * offers» adds a real line, and a deleted product leaves the agreed line.
 *
 * Nothing is stood in: routes, the deal update command, the tables and their
 * CHECKs are the real ones.
 *
 * Set DEAL_LINES_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55501:5432 postgres:16
 *   DEAL_LINES_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55501/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («Deal line items database gate»), where DEAL_LINES_DB_GATE=required
 * turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.DEAL_LINES_TEST_DATABASE_URL
if (!adminUrl && process.env.DEAL_LINES_DB_GATE === "required") {
  throw new Error("DEAL_LINES_TEST_DATABASE_URL is required by the deal line items database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "5".repeat(64)
  const admin = process.env.DEAL_LINES_TEST_DATABASE_URL
  if (!admin) return null
  const name = `deal_lines_${process.pid}`
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
const ORG = "org-lines"
const OTHER_ORG = "org-lines-other"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "deal-lines-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** `db push` builds no CHECKs; the line table's are lifted from the migration. */
function constraintsSql(): string {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261105090000_deal_line_items/migration.sql"), "utf8")
  const checks = [...sql.matchAll(/CONSTRAINT "(deal_line_items_\w+_check)" CHECK (\(.*\))/g)]
  if (checks.length !== 3) throw new Error("deal line CHECKs not found in the migration")
  return checks.map(([, name, body]) => `ALTER TABLE "deal_line_items" ADD CONSTRAINT "${name}" CHECK ${body.replace(/,$/, "")};`).join("\n")
}

const request = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("a deal's product lines on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let lineRoute!: typeof import("@/app/api/v1/deals/[id]/line-items/route")
  let productRoute!: typeof import("@/app/api/v1/deals/[id]/products/route")
  let dealRoute!: typeof import("@/app/api/v1/deals/[id]/route")

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, constraintsSql())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    lineRoute = await import("@/app/api/v1/deals/[id]/line-items/route")
    productRoute = await import("@/app/api/v1/deals/[id]/products/route")
    dealRoute = await import("@/app/api/v1/deals/[id]/route")
    await bypass(async () => {
      for (const [id, slug] of [[ORG, "lines-shop"], [OTHER_ORG, "lines-other"]]) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, sales: true } } })
      }
      await prisma.user.create({ data: { id: "u-admin", organizationId: ORG, email: "admin@lines.test", name: "Leyla", passwordHash: "-", role: "admin" } })
      await prisma.product.createMany({
        data: [
          { id: "p-licence", organizationId: ORG, name: "CRM lisenziyası (1 il)", sku: "LD-CRM-12", price: 240, currency: "AZN" },
          { id: "p-server", organizationId: ORG, name: "Server", price: 900, currency: "USD" },
          { id: "p-foreign", organizationId: OTHER_ORG, name: "Their product", price: 1, currency: "AZN" },
        ],
      })
      await prisma.deal.create({ data: { id: "d-1", organizationId: ORG, name: "Aqua Market", stage: "PROPOSAL", valueAmount: 500, currency: "AZN" } })
      await prisma.deal.create({ data: { id: "d-plain", organizationId: ORG, name: "Plain", stage: "LEAD", valueAmount: 100, currency: "AZN" } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    session.current = { user: { id: "u-admin", organizationId: ORG, role: "admin", email: "admin@lines.test", name: "Leyla" } }
  })

  const amount = async (id: string) => Number((await bypass(() => prisma.deal.findFirstOrThrow({ where: { id } }))).valueAmount)
  const putLines = (id: string, lines: unknown[]) => lineRoute.PUT(request("PUT", `/api/v1/deals/${id}/line-items`, { lines }), params(id))

  it("sets the deal's amount to the sum of its lines, discounts included", async () => {
    const res = await putLines("d-1", [
      { productId: "p-licence", name: "CRM lisenziyası (1 il)", sku: "LD-CRM-12", quantity: 10, unitPrice: 240, discountPct: 10 },
      { productId: null, name: "Tətbiq və təlim", quantity: 1, unitPrice: 1500, discountPct: 0 },
    ])
    const body = await res.json()

    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.data.total).toBe(3660)
    expect(body.data.lines.map((line: { name: string; total: number }) => [line.name, line.total])).toEqual([["CRM lisenziyası (1 il)", 2160], ["Tətbiq və təlim", 1500]])
    expect(await amount("d-1")).toBe(3660)
  })

  it("refuses another organization's product and changes nothing", async () => {
    const res = await putLines("d-1", [{ productId: "p-foreign", name: "Their product", quantity: 1, unitPrice: 1, discountPct: 0 }])
    expect([res.status, (await res.json()).code]).toEqual([400, "PRODUCT_NOT_FOUND"])
    expect(await amount("d-1")).toBe(3660)
    expect(await bypass(() => prisma.dealLineItem.count({ where: { dealId: "d-1" } }))).toBe(2)
  })

  it("keeps the amount from the lines against an ordinary deal edit, and refuses a currency change", async () => {
    const typed = await dealRoute.PUT(request("PUT", "/api/v1/deals/d-1", { valueAmount: 999, name: "Aqua Market MMC" }), params("d-1"))
    expect(typed.status, await typed.clone().text()).toBe(200)
    expect(await amount("d-1")).toBe(3660)
    expect((await bypass(() => prisma.deal.findFirstOrThrow({ where: { id: "d-1" } }))).name).toBe("Aqua Market MMC")

    const currency = await dealRoute.PUT(request("PUT", "/api/v1/deals/d-1", { currency: "USD" }), params("d-1"))
    expect(currency.status).toBe(400)
    expect((await bypass(() => prisma.deal.findFirstOrThrow({ where: { id: "d-1" } }))).currency).toBe("AZN")

    const plain = await dealRoute.PUT(request("PUT", "/api/v1/deals/d-plain", { valueAmount: 250 }), params("d-plain"))
    expect(plain.status).toBe(200)
    expect(await amount("d-plain")).toBe(250)
  })

  it("adds a «Next best offers» product as a line, without copying a price in another currency", async () => {
    const usd = await productRoute.POST(request("POST", "/api/v1/deals/d-1/products", { productId: "p-server", name: "x", price: 1 }), params("d-1"))
    const again = await productRoute.POST(request("POST", "/api/v1/deals/d-1/products", { productId: "p-server" }), params("d-1"))
    const body = await usd.json()

    expect(usd.status).toBe(200)
    expect(body.data.lines.at(-1)).toMatchObject({ productId: "p-server", name: "Server", unitPrice: null, total: 0 })
    expect(again.status).toBe(409)
    expect(await amount("d-1")).toBe(3660)
  })

  it("keeps the agreed line when the product is deleted from the catalog", async () => {
    await bypass(() => prisma.product.delete({ where: { id: "p-licence" } }))
    const lines = await bypass(() => prisma.dealLineItem.findMany({ where: { dealId: "d-1" }, orderBy: { sortOrder: "asc" } }))
    expect(lines[0]).toMatchObject({ productId: null, name: "CRM lisenziyası (1 il)", sku: "LD-CRM-12" })
    expect(await amount("d-1")).toBe(3660)
  })

  it("leaves the last amount when every line is removed, and the database refuses a zero quantity", async () => {
    await putLines("d-1", [])
    expect(await amount("d-1")).toBe(3660)
    const edit = await dealRoute.PUT(request("PUT", "/api/v1/deals/d-1", { valueAmount: 3000 }), params("d-1"))
    expect(edit.status).toBe(200)
    expect(await amount("d-1")).toBe(3000)

    await expect(bypass(() => prisma.dealLineItem.create({ data: { organizationId: ORG, dealId: "d-1", name: "x", quantity: 0 } }))).rejects.toThrow()
  })
})
