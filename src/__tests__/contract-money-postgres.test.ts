/**
 * «Деньги по договору» on a real Postgres, connected as an application role without BYPASSRLS, the
 * tables under the standard tenant policy — the real routes, only the browser session stubbed
 * (owner 2026-11-26, mock «Деньги по договору», «Давай»).
 *
 * Until then an invoice without a price protocol was for the contract's whole value on every press,
 * even on a draft, and the card showed nothing of what was invoiced or paid.
 *
 *  - The chain reads the mock's own figures off real invoice rows: invoiced, drafts apart, paid, the
 *    customer's debt with what is overdue, left to invoice; cancelled and refunded count for nothing,
 *    another currency is a line of its own.
 *  - «Выставить счёт» invoices what is left; once nothing is, it refuses and writes nothing.
 *  - Two presses at once on one contract make one invoice, not two (the contract's row lock).
 *  - A contract that never took effect is not invoiced; another organization's is not there at all.
 *
 * Set CONTRACT_MONEY_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   CONTRACT_MONEY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Contract money
 * database gate»), where `CONTRACT_MONEY_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.CONTRACT_MONEY_TEST_DATABASE_URL
if (!adminUrl && process.env.CONTRACT_MONEY_DB_GATE === "required") {
  throw new Error("CONTRACT_MONEY_TEST_DATABASE_URL is required by the contract money database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.CONTRACT_MONEY_TEST_DATABASE_URL
  if (!admin) return null
  const name = `contract_money_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "contract-money-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  return { name, role, adminDb: db.toString() }
})

const browser = vi.hoisted(() => ({
  current: null as null | { orgId: string; userId: string; role: string; email: string; name: string; principalType: "session" },
}))
vi.mock("@/lib/api-auth", () => {
  const unauthorized = () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  return {
    getOrgId: vi.fn(async () => browser.current?.orgId ?? null),
    getSession: vi.fn(async () => browser.current),
    requireAuth: vi.fn(async () => browser.current ?? unauthorized()),
    requireSessionAuth: vi.fn(async () => browser.current ?? unauthorized()),
    isAuthError: (value: unknown) => value instanceof Response,
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn(() => NextResponse.json({ error: "Forbidden" }, { status: 403 })),
  }
})
vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: vi.fn(() => null) }))
// The ERP push is best-effort and leaves the process; nothing here is configured for it.
vi.mock("@/lib/integrations/erp/provider", () => ({ pushInvoiceToErp: vi.fn(async () => ({ skipped: true })) }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = ["contracts", "invoices", "contract_documents", "contract_document_lines"]

const ORG = "org-money"
const OTHER = "org-money-other"
const MANAGER = "user-money-manager"
const MAIN = "ctr-money-main" // the mock's contract: 120 000 AZN
const RACE = "ctr-money-race" // 1 000 AZN, nothing invoiced
const DRAFT = "ctr-money-draft"
const OTHERS = "ctr-money-other-org"

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "contract-money-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}
function tenantPolicy(table: string): string {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "${table}"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`
}

;(scratch ? describe : describe.skip)("money on a contract — a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let createInvoice!: typeof import("@/app/api/v1/contracts/[id]/create-invoice/route")
  let documents!: typeof import("@/app/api/v1/contracts/[id]/documents/route")
  let createdDb = false
  let createdRole = false

  // The exported prisma is untyped (CLAUDE.md, «Память тайпчека»), so are the rows it reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bypass = (fn: () => Promise<unknown>): Promise<any> => rls.runWithRlsBypass(fn) as Promise<any>
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const press = async (id: string) => {
    const res = await createInvoice.POST(new NextRequest(`http://localhost:3000/api/v1/contracts/${id}/create-invoice`, { method: "POST" }), ctx(id))
    return { status: res.status, body: await res.json() }
  }
  const money = async (id: string) => {
    const res = await documents.GET(new NextRequest(`http://localhost:3000/api/v1/contracts/${id}/documents`), ctx(id))
    return (await res.json()).data.money
  }
  const invoicesOf = (id: string) => bypass(() => prisma.invoice.findMany({ where: { contractId: id }, orderBy: { createdAt: "asc" }, select: { status: true, totalAmount: true, invoiceNumber: true } }))

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'contract-money-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    createInvoice = await import("@/app/api/v1/contracts/[id]/create-invoice/route")
    documents = await import("@/app/api/v1/contracts/[id]/documents/route")

    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: `Tenant ${id}`, slug: id, modules: { crm: true, contracts: true, invoices: true } } })
      await prisma.user.create({ data: { id: MANAGER, organizationId: ORG, email: "m@money.test", name: "Menecer", passwordHash: "x", role: "manager" } })
      for (const [id, org, status, value] of [
        [MAIN, ORG, "active", 120_000], [RACE, ORG, "active", 1_000], [DRAFT, ORG, "draft", 5_000], [OTHERS, OTHER, "active", 9_000],
      ] as const) {
        await prisma.contract.create({ data: { id, organizationId: org, contractNumber: id, title: `Contract ${id}`, status, valueAmount: value, currency: "AZN" } })
      }
      const past = new Date(Date.now() - 6 * 86_400_000)
      const later = new Date(Date.now() + 20 * 86_400_000)
      const rows: Array<[string, number, number, string, Date]> = [
        // status, total, paid, currency, due
        ["paid", 40_000, 40_000, "AZN", later],
        ["partially_paid", 25_000, 20_000, "AZN", later],
        ["sent", 15_000, 0, "AZN", past], // past due — overdue
        ["draft", 10_000, 0, "AZN", later],
        ["cancelled", 50_000, 0, "AZN", later],
        ["refunded", 7_000, 7_000, "AZN", later],
        ["sent", 900, 0, "USD", later],
      ]
      for (const [i, [status, total, paid, currency, dueDate]] of rows.entries()) {
        await prisma.invoice.create({
          data: {
            organizationId: ORG, contractId: MAIN, invoiceNumber: `PRE-${i}`, title: `Pre ${i}`, status, currency, dueDate,
            subtotal: total, totalAmount: total, paidAmount: paid, balanceDue: total - paid,
          },
        })
      }
    })
  }, 300_000)

  afterAll(async () => {
    browser.current = null
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
  }, 120_000)

  const asManager = () => { browser.current = { orgId: ORG, userId: MANAGER, role: "manager", email: "m@money.test", name: "Menecer", principalType: "session" } }

  it("the chain reads the mock's figures off real invoices", async () => {
    asManager()
    expect(await money(MAIN)).toMatchObject({
      currency: "AZN", value: 120_000,
      invoiced: 80_000, invoicedCount: 3, drafts: 10_000, draftCount: 1,
      paid: 60_000, debt: 20_000, overdue: 15_000,
      remaining: 30_000, overInvoiced: 0,
      other: [{ currency: "USD", invoiced: 900, debt: 900 }],
    })
  })

  it("«Выставить счёт» invoices what is left, then nothing is left", async () => {
    asManager()
    const res = await press(MAIN)
    expect(res.status).toBe(201)
    expect(Number(res.body.data.totalAmount)).toBe(30_000)
    expect(await money(MAIN)).toMatchObject({ drafts: 40_000, draftCount: 2, remaining: 0, overInvoiced: 0 })
    const before = (await invoicesOf(MAIN)).length
    expect(await press(MAIN)).toMatchObject({ status: 409, body: { code: "FULLY_INVOICED" } })
    expect((await invoicesOf(MAIN)).length).toBe(before)
  })

  it("two presses at once make one invoice", async () => {
    asManager()
    const results = await Promise.all([press(RACE), press(RACE)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    const made = await invoicesOf(RACE)
    expect(made).toHaveLength(1)
    expect(Number(made[0].totalAmount)).toBe(1_000)
  })

  it("a contract that never took effect is not invoiced; another organization's is not there", async () => {
    asManager()
    expect(await press(DRAFT)).toMatchObject({ status: 409, body: { code: "CONTRACT_NOT_IN_FORCE" } })
    expect(await invoicesOf(DRAFT)).toEqual([])
    expect((await press(OTHERS)).status).toBe(404)
    expect(await invoicesOf(OTHERS)).toEqual([])
  })
})
