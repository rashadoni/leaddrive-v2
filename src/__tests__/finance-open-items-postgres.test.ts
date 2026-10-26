/**
 * «İcmal» and «Debitor (A/R)» / «Kreditor (A/P)» name the same debt, on a real
 * Postgres (src/lib/finance/open-items.ts).
 *
 * Found on production 2026-10-26: the overview said 608,777 ₼ over 49 overdue
 * invoices, «Debitor» 585,777 ₼ over 48. The difference was one invoice marked
 * «paid» through its status — which leaves `balanceDue` as it was — counted
 * as debt by the overview and not by «Debitor». The overview also counted only
 * invoices issued in the picked year, so last year's unpaid ones would have
 * left it, overdue alert included, on the first of January.
 *
 * The real handlers run with the real RLS wrappers and Prisma over a scratch
 * database built from schema.prisma; only the session cookie is a stand-in.
 *
 * Set FINANCE_OPEN_ITEMS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55502:5432 postgres:16
 *   FINANCE_OPEN_ITEMS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55502/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («Finance open items database gate»), where
 * FINANCE_OPEN_ITEMS_DB_GATE=required turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.FINANCE_OPEN_ITEMS_TEST_DATABASE_URL
if (!adminUrl && process.env.FINANCE_OPEN_ITEMS_DB_GATE === "required") {
  throw new Error("FINANCE_OPEN_ITEMS_TEST_DATABASE_URL is required by the finance open items database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.FINANCE_OPEN_ITEMS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `finance_open_items_${process.pid}`
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
const ORG = "org-open-items"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "finance-open-items-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const get = (url: string) => new NextRequest(`http://localhost:3000${url}`)
const DAY = 86_400_000

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("the overview and the A/R and A/P tabs count the same debt, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let overview!: typeof import("@/app/api/finance/dashboard/route").GET
  let receivables!: typeof import("@/app/api/finance/receivables/route").GET
  let payables!: typeof import("@/app/api/finance/payables/stats/route").GET
  const thisYear = new Date().getUTCFullYear()

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    overview = (await import("@/app/api/finance/dashboard/route")).GET
    receivables = (await import("@/app/api/finance/receivables/route")).GET
    payables = (await import("@/app/api/finance/payables/stats/route")).GET

    const now = Date.now()
    const issuedThisYear = new Date(Date.UTC(thisYear, 0, 2))
    const invoice = (id: string, status: string, total: number, balance: number, issueDate: Date, dueDate: Date) => ({
      id, organizationId: ORG, invoiceNumber: id, title: id, status,
      totalAmount: total, paidAmount: total - balance, balanceDue: balance, issueDate, dueDate,
    })
    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Open items", slug: "open-items", modules: { crm: true, finance: true } } })
      await prisma.invoice.createMany({
        data: [
          invoice("INV-OVERDUE", "sent", 1000, 1000, issuedThisYear, new Date(now - 40 * DAY)),
          invoice("INV-PART", "partially_paid", 500, 200, issuedThisYear, new Date(now + 20 * DAY)),
          // Marked «paid» through the status field: the balance stayed, nothing was paid in the system.
          { ...invoice("INV-PAID-BY-STATUS", "paid", 23000, 23000, issuedThisYear, new Date(now - 60 * DAY)), paidAmount: 0 },
          invoice("INV-LAST-YEAR", "overdue", 700, 700, new Date(Date.UTC(thisYear - 1, 5, 1)), new Date(Date.UTC(thisYear - 1, 6, 1))),
          invoice("INV-DRAFT", "draft", 999, 999, issuedThisYear, new Date(now - 10 * DAY)),
        ],
      })
      await prisma.bill.createMany({
        data: [
          { id: "BILL-OVERDUE", organizationId: ORG, billNumber: "B-1", vendorName: "Landlord", title: "Rent", status: "pending", totalAmount: 300, balanceDue: 300, issueDate: issuedThisYear, dueDate: new Date(now - 5 * DAY) },
          { id: "BILL-PAID-BY-STATUS", organizationId: ORG, billNumber: "B-2", vendorName: "ISP", title: "Internet", status: "paid", totalAmount: 50, balanceDue: 50, issueDate: issuedThisYear, dueDate: new Date(now - 5 * DAY) },
        ],
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    session.current = { user: { id: "user-manager", organizationId: ORG, role: "manager", email: "m@example.com", name: "Manager" } }
  })

  it("names the same receivable on «İcmal» and on «Debitor», last year's unpaid invoice included", async () => {
    const dash = await (await overview(get(`/api/finance/dashboard?year=${thisYear}`))).json()
    const ar = await (await receivables(get("/api/finance/receivables"))).json()

    // Open: 1000 overdue + 200 not yet due + 700 from last year, overdue. Not the
    // «paid» invoice whatever its balance says, not the draft.
    expect(ar.data.total).toBe(1900)
    expect([ar.data.overdueTotal, ar.data.overdueCount]).toEqual([1700, 2])
    expect(dash.data.kpis.arTotal).toEqual({ amount: 1900, overdueAmount: 1700, overdueCount: 2 })
    const alert = dash.data.alerts.find((a: { id: string }) => a.id === "ar-overdue")
    expect(alert.params.count).toBe(2)
    expect(dash.data.arAging.reduce((s: number, b: { amount: number }) => s + b.amount, 0)).toBe(1900)
  })

  it("names the same payable on «İcmal» and on «Kreditor»", async () => {
    const dash = await (await overview(get(`/api/finance/dashboard?year=${thisYear}`))).json()
    const ap = await (await payables(get("/api/finance/payables/stats"))).json()

    expect([ap.data.total, ap.data.overdueTotal, ap.data.overdueCount]).toEqual([300, 300, 1])
    expect(dash.data.kpis.apTotal).toEqual({ amount: 300, overdueAmount: 300, overdueCount: 1 })
  })

  it("counts an invoice marked «paid» as collected revenue, so it is neither lost nor counted twice", async () => {
    const dash = await (await overview(get(`/api/finance/dashboard?year=${thisYear}`))).json()
    // 300 collected on the partly paid invoice + 23000 marked paid; the open
    // ones and last year's are not this year's revenue.
    expect(dash.data.kpis.revenue.fact).toBe(23300)
    expect(dash.data.kpis.expenses.fact).toBe(50)
  })
})
