/**
 * Paying a vendor bill, and approving and executing a payment order, against a
 * real Postgres.
 *
 * finance-api-authorization.test.ts checks who is refused and what the rows say
 * afterwards, over an in-memory stand-in for the database. Three things about
 * the money path a stand-in cannot show, because it has no concurrency and
 * only imitates a transaction:
 *
 *  - two payments recorded at the same moment both reach the bill's total (the
 *    old code read `paidAmount`, added in JavaScript and wrote the sum back, so
 *    one of two simultaneous payments vanished from the total);
 *  - a failure after the payment row is written takes the row back out (the
 *    three writes were not in a transaction);
 *  - an order executed twice at once pays its bill once.
 *
 * And one thing learned the hard way on 2026-10-02 (the MTM category editor):
 * a write path that has only ever met a mocked Prisma has not been run.
 *
 * The real handlers run here with the real `requireAuth`, the real RLS
 * wrappers and the real Prisma client over a scratch database built from
 * schema.prisma. Only the session cookie is a stand-in.
 *
 * Set FINANCE_BILL_PAYMENT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   FINANCE_BILL_PAYMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Finance bill payment database gate»), where
 * `FINANCE_BILL_PAYMENT_DB_GATE=required` turns a missing URL into a failure so
 * the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.FINANCE_BILL_PAYMENT_TEST_DATABASE_URL
if (!adminUrl && process.env.FINANCE_BILL_PAYMENT_DB_GATE === "required") {
  throw new Error("FINANCE_BILL_PAYMENT_TEST_DATABASE_URL is required by the finance bill payment database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.FINANCE_BILL_PAYMENT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `finance_bill_payment_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
// Telegram, e-mail and in-app notices are not what is under test.
vi.mock("@/lib/finance/telegram-notify", () => ({
  notifyPaymentOrderPending: vi.fn(),
  notifyPaymentOrderExecuted: vi.fn(),
  notifyBillPaymentRecorded: vi.fn(),
}))

const ROOT = process.cwd()
const ORG = "org-finance"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

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
  const directory = mkdtempSync(path.join(tmpdir(), "finance-bill-payment-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

function signIn(role: string) {
  session.current = {
    user: { id: `user-${role}`, organizationId: ORG, role, email: `${role}@example.com`, name: role },
  }
}

function post(url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("vendor bill payments on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let payBill!: typeof import("@/app/api/finance/payables/[id]/payments/route").POST
  let approve!: typeof import("@/app/api/finance/payment-orders/[id]/approve/route").POST
  let execute!: typeof import("@/app/api/finance/payment-orders/[id]/execute/route").POST
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    // What makes a registry insert fail on demand, for the rollback test below.
    prismaCli(
      ["db", "execute", "--url", scratch!.url, "--stdin"],
      process.env,
      `ALTER TABLE "payment_registry_entries" ADD CONSTRAINT "test_registry_refuses_marker" CHECK ("description" NOT LIKE '%REFUSE-THIS%')`,
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    payBill = (await import("@/app/api/finance/payables/[id]/payments/route")).POST
    approve = (await import("@/app/api/finance/payment-orders/[id]/approve/route")).POST
    execute = (await import("@/app/api/finance/payment-orders/[id]/execute/route")).POST
    await bypass(() => prisma.organization.create({
      data: { id: ORG, name: "Finance Test", slug: "finance-test", modules: { crm: true, finance: true } },
    }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    signIn("manager")
  })

  async function newBill(total: string, billNumber?: string) {
    const id = `bill-${++sequence}`
    await bypass(() => prisma.bill.create({
      data: {
        id,
        organizationId: ORG,
        billNumber: billNumber ?? `B-${sequence}`,
        vendorName: "Landlord LLC",
        title: "Rent",
        status: "pending",
        totalAmount: total,
        balanceDue: total,
      },
    }))
    return id
  }

  async function newOrder(status: string, amount: number, billId: string | null) {
    const id = `po-${++sequence}`
    await bypass(() => prisma.paymentOrder.create({
      data: {
        id,
        organizationId: ORG,
        orderNumber: `PO-${sequence}`,
        counterpartyName: "Landlord LLC",
        amount,
        purpose: "Rent",
        status,
        billId,
      },
    }))
    return id
  }

  const billRow = (id: string) => bypass(() => prisma.bill.findUniqueOrThrow({ where: { id } }))
  const paymentsOf = (billId: string) => bypass(() => prisma.billPayment.findMany({ where: { billId } }))
  const registryOf = (billId: string) => bypass(() => prisma.paymentRegistryEntry.findMany({ where: { billId } }))

  it("records a payment: the row, the bill's totals and the registry entry", async () => {
    const billId = await newBill("100")

    const res = await payBill(post(`/api/finance/payables/${billId}/payments`, { amount: "40.25" }), idParams(billId))

    expect(res.status).toBe(201)
    const bill = await billRow(billId)
    expect([bill.paidAmount.toFixed(4), bill.balanceDue.toFixed(4), bill.status]).toEqual(["40.2500", "59.7500", "partially_paid"])
    const payments = await paymentsOf(billId)
    expect(payments).toHaveLength(1)
    expect([payments[0].amount.toFixed(4), payments[0].createdBy]).toEqual(["40.2500", "user-manager"])
    const registry = await registryOf(billId)
    expect(registry).toHaveLength(1)
    expect(registry[0]).toMatchObject({ sourceType: "bill_payment", sourceId: payments[0].id, createdBy: "user-manager" })
  })

  it("adds up exactly: 0.1 and 0.2 settle a bill of 0.3", async () => {
    const billId = await newBill("0.3")

    await payBill(post(`/api/finance/payables/${billId}/payments`, { amount: 0.1 }), idParams(billId))
    await payBill(post(`/api/finance/payables/${billId}/payments`, { amount: 0.2 }), idParams(billId))

    const bill = await billRow(billId)
    expect([bill.paidAmount.toFixed(4), bill.balanceDue.toFixed(4), bill.status]).toEqual(["0.3000", "0.0000", "paid"])
    expect(bill.paidAt).toBeInstanceOf(Date)
  })

  it("eight payments at the same moment all reach the bill's total", async () => {
    const billId = await newBill("100")

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        payBill(post(`/api/finance/payables/${billId}/payments`, { amount: "10" }), idParams(billId))),
    )

    expect(responses.map((res) => res.status)).toEqual(Array(8).fill(201))
    const bill = await billRow(billId)
    // Eight rows and a total that counts all eight. Read-add-write lost some of
    // them here: the list showed eight payments and the bill said fewer.
    expect(await paymentsOf(billId)).toHaveLength(8)
    expect([bill.paidAmount.toFixed(4), bill.balanceDue.toFixed(4), bill.status]).toEqual(["80.0000", "20.0000", "partially_paid"])
  })

  it("when the registry entry cannot be written, the payment is not left behind", async () => {
    // The scratch database refuses a registry row whose description carries
    // this marker, and the description quotes the bill number.
    const billId = await newBill("100", "REFUSE-THIS")

    await expect(
      payBill(post(`/api/finance/payables/${billId}/payments`, { amount: "40" }), idParams(billId)),
    ).rejects.toThrow()

    const bill = await billRow(billId)
    expect([bill.paidAmount.toFixed(4), bill.balanceDue.toFixed(4), bill.status]).toEqual(["0.0000", "100.0000", "pending"])
    expect(await paymentsOf(billId)).toEqual([])
    expect(await registryOf(billId)).toEqual([])
  })

  it("a viewer is refused and the database is as it was", async () => {
    const billId = await newBill("100")
    signIn("viewer")

    const res = await payBill(post(`/api/finance/payables/${billId}/payments`, { amount: "40" }), idParams(billId))

    expect(res.status).toBe(403)
    const bill = await billRow(billId)
    expect([bill.paidAmount.toFixed(4), bill.status]).toEqual(["0.0000", "pending"])
    expect(await paymentsOf(billId)).toEqual([])
  })

  it("approval is stored with the approver, and a viewer's attempt stores nothing", async () => {
    const orderId = await newOrder("pending_approval", 500, null)

    signIn("viewer")
    const refused = await approve(post(`/api/finance/payment-orders/${orderId}/approve`), idParams(orderId))
    expect(refused.status).toBe(403)
    expect(await bypass(() => prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } })))
      .toMatchObject({ status: "pending_approval", approvedBy: null, approvedAt: null })

    signIn("manager")
    const res = await approve(post(`/api/finance/payment-orders/${orderId}/approve`), idParams(orderId))
    expect(res.status).toBe(200)
    const stored = await bypass(() => prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } }))
    expect(stored).toMatchObject({ status: "approved", approvedBy: "user-manager" })
    expect(stored.approvedAt).toBeInstanceOf(Date)
  })

  it("an order executed twice at once pays its bill once", async () => {
    const billId = await newBill("100")
    const orderId = await newOrder("approved", 40, billId)

    const responses = await Promise.all([
      execute(post(`/api/finance/payment-orders/${orderId}/execute`), idParams(orderId)),
      execute(post(`/api/finance/payment-orders/${orderId}/execute`), idParams(orderId)),
    ])

    // One wins; the other is told the order is no longer approved (409 if it
    // lost the race inside the transaction, 400 if it read the order after).
    expect(responses.map((res) => res.status).sort()).toEqual(expect.arrayContaining([200]))
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1)
    const bill = await billRow(billId)
    expect(await paymentsOf(billId)).toHaveLength(1)
    expect([bill.paidAmount.toFixed(4), bill.balanceDue.toFixed(4)]).toEqual(["40.0000", "60.0000"])
    expect(await bypass(() => prisma.paymentRegistryEntry.count({ where: { sourceType: "payment_order", sourceId: orderId } }))).toBe(1)
  })
})
