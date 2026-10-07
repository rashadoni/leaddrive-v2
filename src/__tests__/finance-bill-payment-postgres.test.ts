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
 * The same database carries the other half of the registry's story: a payment
 * that is taken back — deleted on its own, or along with the invoice or the
 * vendor bill it belonged to — leaves the payment registry too. The registry
 * has no foreign key to the payment it describes, so until 2026-10-07 nothing
 * removed its row, and the registry went on listing and totalling money that
 * no document accounted for any more.
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

function signIn(role: string, organizationId = ORG) {
  session.current = {
    user: { id: `user-${role}`, organizationId, role, email: `${role}@example.com`, name: role },
  }
}

function post(url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const remove = (url: string) => new NextRequest(`http://localhost:3000${url}`, { method: "DELETE" })

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("vendor bill payments on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let payBill!: typeof import("@/app/api/finance/payables/[id]/payments/route").POST
  let approve!: typeof import("@/app/api/finance/payment-orders/[id]/approve/route").POST
  let execute!: typeof import("@/app/api/finance/payment-orders/[id]/execute/route").POST
  let deleteBill!: typeof import("@/app/api/finance/payables/[id]/route").DELETE
  let payInvoice!: typeof import("@/app/api/v1/invoices/[id]/payments/route").POST
  let deleteInvoicePayment!: typeof import("@/app/api/v1/invoices/[id]/payments/[paymentId]/route").DELETE
  let deleteInvoice!: typeof import("@/app/api/v1/invoices/[id]/route").DELETE
  let readRegistry!: typeof import("@/app/api/finance/registry/route").GET
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
    // And what makes removing a registry row fail on demand.
    prismaCli(
      ["db", "execute", "--url", scratch!.url, "--stdin"],
      process.env,
      `CREATE FUNCTION "test_registry_keeps_marker"() RETURNS trigger AS $$
       BEGIN
         IF OLD."description" LIKE '%KEEP-THIS%' THEN RAISE EXCEPTION 'test: this registry row refuses to be deleted'; END IF;
         RETURN OLD;
       END $$ LANGUAGE plpgsql;
       CREATE TRIGGER "test_registry_keeps_marker" BEFORE DELETE ON "payment_registry_entries"
         FOR EACH ROW EXECUTE FUNCTION "test_registry_keeps_marker"();`,
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    payBill = (await import("@/app/api/finance/payables/[id]/payments/route")).POST
    approve = (await import("@/app/api/finance/payment-orders/[id]/approve/route")).POST
    execute = (await import("@/app/api/finance/payment-orders/[id]/execute/route")).POST
    deleteBill = (await import("@/app/api/finance/payables/[id]/route")).DELETE
    payInvoice = (await import("@/app/api/v1/invoices/[id]/payments/route")).POST
    deleteInvoicePayment = (await import("@/app/api/v1/invoices/[id]/payments/[paymentId]/route")).DELETE
    deleteInvoice = (await import("@/app/api/v1/invoices/[id]/route")).DELETE
    readRegistry = (await import("@/app/api/finance/registry/route")).GET
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

  async function newBill(total: string, billNumber?: string, organizationId = ORG) {
    const id = `bill-${++sequence}`
    await bypass(() => prisma.bill.create({
      data: {
        id,
        organizationId,
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

  async function newOrder(status: string, amount: number, billId: string | null, organizationId = ORG) {
    const id = `po-${++sequence}`
    await bypass(() => prisma.paymentOrder.create({
      data: {
        id,
        organizationId,
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

  describe("the payment registry when a payment is taken back", () => {
    // Each test gets an organization of its own, so the registry's totals —
    // which are per organization, not per page — are exactly what the test put
    // there and can be read as plain numbers.
    let org!: string

    beforeEach(async () => {
      org = `org-registry-${++sequence}`
      await bypass(() => prisma.organization.create({
        data: { id: org, name: org, slug: org, modules: { crm: true, finance: true } },
      }))
      // Deleting a payment, an invoice or a bill is an admin's action.
      signIn("admin", org)
    })

    async function newInvoice(total: string, invoiceNumber?: string) {
      const id = `inv-${++sequence}`
      await bypass(() => prisma.invoice.create({
        data: {
          id,
          organizationId: org,
          invoiceNumber: invoiceNumber ?? `INV-${sequence}`,
          title: "Services",
          status: "sent",
          totalAmount: total,
          balanceDue: total,
          recipientName: "Client LLC",
        },
      }))
      return id
    }

    /** Records a payment through the real handler and returns the payment's id. */
    async function receive(invoiceId: string, amount: number): Promise<string> {
      const res = await payInvoice(post(`/api/v1/invoices/${invoiceId}/payments`, { amount }), idParams(invoiceId))
      expect(res.status).toBe(201)
      return (await res.json()).data.id
    }

    async function takeBack(invoiceId: string, paymentId: string) {
      return deleteInvoicePayment(
        remove(`/api/v1/invoices/${invoiceId}/payments/${paymentId}`),
        { params: Promise.resolve({ id: invoiceId, paymentId }) },
      )
    }

    /** The registry as the finance screen gets it: the rows and the totals above them. */
    async function registryScreen() {
      const res = await readRegistry(new NextRequest("http://localhost:3000/api/finance/registry"))
      expect(res.status).toBe(200)
      const body = await res.json()
      return {
        sources: (body.data as Array<{ sourceType: string; sourceId: string }>)
          .map((entry) => `${entry.sourceType}:${entry.sourceId}`)
          .sort(),
        totalIncoming: body.stats.totalIncoming as number,
        totalOutgoing: body.stats.totalOutgoing as number,
        netFlow: body.stats.netFlow as number,
      }
    }

    const registryRowsFor = (sourceType: string, sourceId: string) =>
      bypass(() => prisma.paymentRegistryEntry.count({ where: { sourceType, sourceId } }))
    const invoiceRow = (id: string) => bypass(() => prisma.invoice.findUniqueOrThrow({ where: { id } }))

    it("a deleted invoice payment is gone from the registry and from its totals", async () => {
      const invoiceId = await newInvoice("100")
      const mistaken = await receive(invoiceId, 40)
      const kept = await receive(invoiceId, 25)
      expect(await registryScreen()).toEqual({
        sources: [`invoice_payment:${kept}`, `invoice_payment:${mistaken}`].sort(),
        totalIncoming: 65,
        totalOutgoing: 0,
        netFlow: 65,
      })

      const res = await takeBack(invoiceId, mistaken)

      expect(res.status).toBe(200)
      expect(await registryRowsFor("invoice_payment", mistaken)).toBe(0)
      expect(await registryRowsFor("invoice_payment", kept)).toBe(1)
      // The 40 used to stay here for good: listed as received, and counted.
      expect(await registryScreen()).toEqual({
        sources: [`invoice_payment:${kept}`],
        totalIncoming: 25,
        totalOutgoing: 0,
        netFlow: 25,
      })
      const invoice = await invoiceRow(invoiceId)
      expect([invoice.paidAmount.toFixed(4), invoice.balanceDue.toFixed(4), invoice.status]).toEqual(["25.0000", "75.0000", "partially_paid"])
    })

    it("another organization's registry row is left alone", async () => {
      const invoiceId = await newInvoice("100")
      const paymentId = await receive(invoiceId, 40)
      // A row in a different organization that happens to name the same source.
      const foreign = await bypass(() => prisma.paymentRegistryEntry.create({
        data: {
          organizationId: ORG,
          direction: "incoming",
          amount: 40,
          counterpartyName: "Someone else's client",
          sourceType: "invoice_payment",
          sourceId: paymentId,
          paymentDate: new Date(),
        },
      }))

      const res = await takeBack(invoiceId, paymentId)

      expect(res.status).toBe(200)
      expect(await bypass(() => prisma.paymentRegistryEntry.findMany({
        where: { sourceType: "invoice_payment", sourceId: paymentId },
        select: { id: true, organizationId: true },
      }))).toEqual([{ id: foreign.id, organizationId: ORG }])
    })

    it("when the registry row cannot be removed, the payment is not deleted either", async () => {
      // The scratch database refuses to delete a registry row whose description
      // carries this marker, and the description quotes the invoice number.
      const invoiceId = await newInvoice("100", "KEEP-THIS")
      const paymentId = await receive(invoiceId, 40)
      const logged = vi.spyOn(console, "error").mockImplementation(() => {})

      const res = await takeBack(invoiceId, paymentId)
      logged.mockRestore()

      // One transaction: either the payment and its registry row both go, or
      // neither does. Never a payment that is gone while the registry keeps it.
      expect(res.status).toBe(500)
      expect(await bypass(() => prisma.invoicePayment.count({ where: { id: paymentId } }))).toBe(1)
      expect(await registryRowsFor("invoice_payment", paymentId)).toBe(1)
      const invoice = await invoiceRow(invoiceId)
      expect([invoice.paidAmount.toFixed(4), invoice.balanceDue.toFixed(4), invoice.status]).toEqual(["40.0000", "60.0000", "partially_paid"])
    })

    it("deleting an invoice takes its payments out of the registry", async () => {
      // The database deletes an invoice's payments with it (a cascade), so the
      // registry has to let go of them at the same moment.
      const doomed = await newInvoice("100")
      await receive(doomed, 40)
      await receive(doomed, 25)
      const other = await newInvoice("100")
      const otherPayment = await receive(other, 10)

      const res = await deleteInvoice(remove(`/api/v1/invoices/${doomed}`), idParams(doomed))

      expect(res.status).toBe(200)
      expect(await bypass(() => prisma.invoice.count({ where: { id: doomed } }))).toBe(0)
      expect(await bypass(() => prisma.invoicePayment.count({ where: { invoiceId: doomed } }))).toBe(0)
      expect(await bypass(() => prisma.paymentRegistryEntry.count({ where: { invoiceId: doomed } }))).toBe(0)
      expect(await registryScreen()).toEqual({
        sources: [`invoice_payment:${otherPayment}`],
        totalIncoming: 10,
        totalOutgoing: 0,
        netFlow: 10,
      })
    })

    it("payments recorded while their invoice is being deleted leave nothing in the registry", async () => {
      const invoiceId = await newInvoice("1000")
      const pay = () => payInvoice(post(`/api/v1/invoices/${invoiceId}/payments`, { amount: 10 }), idParams(invoiceId))

      const [deleted, ...paid] = await Promise.all([
        deleteInvoice(remove(`/api/v1/invoices/${invoiceId}`), idParams(invoiceId)),
        ...Array.from({ length: 8 }, pay),
      ])

      // A payment either got in before the invoice went (and went with it) or
      // found no invoice. Which one is up to the race; what is left is not.
      expect(deleted.status).toBe(200)
      expect(paid.map((res) => res.status).filter((status) => status !== 201 && status !== 404)).toEqual([])
      expect(await bypass(() => prisma.invoicePayment.count({ where: { invoiceId } }))).toBe(0)
      expect(await bypass(() => prisma.paymentRegistryEntry.count({ where: { invoiceId } }))).toBe(0)
      expect(await registryScreen()).toEqual({ sources: [], totalIncoming: 0, totalOutgoing: 0, netFlow: 0 })
    })

    it("deleting a vendor bill takes its payments out of the registry", async () => {
      const doomed = await newBill("100", undefined, org)
      await payBill(post(`/api/finance/payables/${doomed}/payments`, { amount: "40" }), idParams(doomed))
      const other = await newBill("100", undefined, org)
      await payBill(post(`/api/finance/payables/${other}/payments`, { amount: "15" }), idParams(other))
      const [otherPayment] = await paymentsOf(other)
      expect((await registryScreen()).totalOutgoing).toBe(55)

      const res = await deleteBill(remove(`/api/finance/payables/${doomed}`), idParams(doomed))

      expect(res.status).toBe(200)
      expect(await paymentsOf(doomed)).toEqual([])
      expect(await registryOf(doomed)).toEqual([])
      expect(await registryScreen()).toEqual({
        sources: [`bill_payment:${otherPayment.id}`],
        totalIncoming: 0,
        totalOutgoing: 15,
        netFlow: -15,
      })
    })

    it("payments recorded while their bill is being deleted leave nothing in the registry", async () => {
      const billId = await newBill("1000", undefined, org)
      const pay = () => payBill(post(`/api/finance/payables/${billId}/payments`, { amount: "10" }), idParams(billId))

      // A payment that loses the race is turned away by the database itself (the
      // bill it names is gone), so the outcomes are settled rather than awaited.
      const [deleted] = await Promise.allSettled([
        deleteBill(remove(`/api/finance/payables/${billId}`), idParams(billId)),
        ...Array.from({ length: 8 }, pay),
      ])

      expect(deleted.status === "fulfilled" && deleted.value.status).toBe(200)
      expect(await paymentsOf(billId)).toEqual([])
      expect(await registryOf(billId)).toEqual([])
      expect(await registryScreen()).toEqual({ sources: [], totalIncoming: 0, totalOutgoing: 0, netFlow: 0 })
    })

    it("an executed order stays in the registry when the bill it paid is deleted", async () => {
      // Its registry row describes the order, not the bill, and the order is
      // still there saying "executed". Removing the row would leave an executed
      // order that the registry does not know about.
      const billId = await newBill("100", undefined, org)
      const orderId = await newOrder("approved", 40, billId, org)
      expect((await execute(post(`/api/finance/payment-orders/${orderId}/execute`), idParams(orderId))).status).toBe(200)

      const res = await deleteBill(remove(`/api/finance/payables/${billId}`), idParams(billId))

      expect(res.status).toBe(200)
      expect(await bypass(() => prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } }))).toMatchObject({ status: "executed" })
      expect(await registryScreen()).toEqual({
        sources: [`payment_order:${orderId}`],
        totalIncoming: 0,
        totalOutgoing: 40,
        netFlow: -40,
      })
    })
  })
})
