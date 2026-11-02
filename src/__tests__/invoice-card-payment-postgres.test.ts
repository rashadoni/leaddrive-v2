/**
 * Paying a customer invoice by card through Kapital Bank, against a real
 * Postgres.
 *
 * The bank is the one thing stood in for: `fetch` answers like Kapital Bank's
 * e-commerce API (create order, order status, `InvalidLogin` on a wrong pair),
 * with the order's status set by the test. Everything on our side is real —
 * the routes, the RLS wrappers, the Prisma client, the transaction that claims
 * the intent and records the payment.
 *
 * What only a database can show:
 *  - the customer coming back from the bank, a second tab doing the same and
 *    the reconcile cron, all at once, record the payment ONCE;
 *  - the STATUS the bank puts in the return link is not believed — only the
 *    status read back from the bank records money;
 *  - the merchant password is stored encrypted, never as written.
 *
 * Set INVOICE_CARD_PAYMENT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   INVOICE_CARD_PAYMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Invoice card payment database gate»), where
 * `INVOICE_CARD_PAYMENT_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.INVOICE_CARD_PAYMENT_TEST_DATABASE_URL
if (!adminUrl && process.env.INVOICE_CARD_PAYMENT_DB_GATE === "required") {
  throw new Error("INVOICE_CARD_PAYMENT_TEST_DATABASE_URL is required by the invoice card payment database gate")
}

const scratch = vi.hoisted(() => {
  // The merchant password and each order's password are sealed with it.
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test"
  const admin = process.env.INVOICE_CARD_PAYMENT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `invoice_card_payment_${process.pid}`
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

const ROOT = process.cwd()
const ORG = "org-card-pay"
const LOGIN = "TerminalSys/test"
const PASSWORD = "merchant-secret-7731"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

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
  const directory = mkdtempSync(path.join(tmpdir(), "invoice-card-payment-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/**
 * `db push` builds no CHECKs and no partial indexes. The payment tables' own
 * rules are what the claim relies on, so they are lifted from the migrations
 * that create them — the statements the production database runs.
 */
function paymentConstraintsSql(): string {
  const payments = readFileSync(path.join(ROOT, "prisma/migrations/20260517200000_payments/migration.sql"), "utf8")
  const kapital = readFileSync(path.join(ROOT, "prisma/migrations/20261031090000_kapitalbank_payment_provider/migration.sql"), "utf8")
  const pick = (sql: string, pattern: RegExp) => {
    const match = sql.match(pattern)
    if (!match) throw new Error(`constraint not found in migration: ${pattern}`)
    return match[0]
  }
  return [
    pick(payments, /ALTER TABLE "payment_intents"\s+ADD CONSTRAINT "payment_intents_status_check"[\s\S]*?\);/),
    pick(payments, /ALTER TABLE "payment_intents"\s+ADD CONSTRAINT "payment_intents_outcome_coherence_check"[\s\S]*?\n  \);/),
    pick(payments, /ALTER TABLE "payment_intents"\s+ADD CONSTRAINT "payment_intents_failure_coherence_check"[\s\S]*?\n  \);/),
    pick(payments, /CREATE UNIQUE INDEX "payment_intents_provider_external_uniq"[\s\S]*?;/),
    // The original type CHECK, then the migration that widens it.
    pick(payments, /ALTER TABLE "payment_providers"\s+ADD CONSTRAINT "payment_providers_type_check"[\s\S]*?;/),
    kapital.split("\n").filter((line) => !line.startsWith("--")).join("\n"),
  ].join("\n")
}

/* ─── A stand-in for Kapital Bank ─────────────────────────────────────── */

interface BankOrder { id: string; password: string; amount: number; currency: string; status: string; prevStatus: string | null }

const bank = {
  orders: new Map<string, BankOrder>(),
  nextId: 500_000,
  creates: 0,
  statusCalls: 0,
  reset() {
    this.orders.clear()
    this.creates = 0
    this.statusCalls = 0
  },
  set(id: string, status: string) {
    const order = this.orders.get(id)
    if (!order) throw new Error(`no bank order ${id}`)
    order.prevStatus = order.status
    order.status = status
  },
}

function bankJson(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function fakeBank(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  if (url.origin !== "https://txpgtst.kapitalbank.az" && url.origin !== "https://e-commerce.kapitalbank.az") {
    throw new Error(`unexpected fetch ${url.href}`)
  }
  const auth = new Headers(init?.headers).get("authorization") ?? ""
  const [login, password] = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString("utf8").split(":")
  const method = (init?.method ?? "GET").toUpperCase()

  if (method === "POST" && url.pathname === "/api/order") {
    if (login !== LOGIN || password !== PASSWORD) {
      return bankJson(400, { errorCode: "InvalidLogin", errorDescription: "Invalid login or password" })
    }
    const body = JSON.parse(String(init?.body)) as { order: { amount: string; currency: string } }
    const id = String(++bank.nextId)
    bank.creates += 1
    bank.orders.set(id, {
      id, password: `pw${id}`, amount: Number(body.order.amount), currency: body.order.currency,
      status: "Preparing", prevStatus: null,
    })
    return bankJson(200, { order: { id: Number(id), hppUrl: `${url.origin}/flex`, password: `pw${id}`, status: "Preparing", secret: "1" } })
  }
  const match = url.pathname.match(/^\/api\/order\/(\d+)$/)
  if (method === "GET" && match) {
    bank.statusCalls += 1
    const order = bank.orders.get(match[1])
    if (!order || url.searchParams.get("password") !== order.password) {
      return bankJson(400, { errorCode: "ServiceError", errorDescription: "no order found" })
    }
    return bankJson(200, {
      order: {
        id: Number(order.id), typeRid: "Order_SMS", status: order.status, prevStatus: order.prevStatus,
        amount: order.amount, currency: order.currency,
      },
    })
  }
  throw new Error(`unexpected bank call ${method} ${url.pathname}`)
}

function signIn(role: string) {
  session.current = {
    user: { id: `user-${role}`, organizationId: ORG, role, email: `${role}@example.com`, name: role },
  }
}

const json = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
})
const get = (url: string) => new NextRequest(`http://localhost:3000${url}`)
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("invoice card payment through Kapital Bank on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let saveSettings!: typeof import("@/app/api/v1/settings/online-payment/route").PUT
  let readSettings!: typeof import("@/app/api/v1/settings/online-payment/route").GET
  let payLink!: typeof import("@/app/api/v1/invoices/[id]/pay-link/route").GET
  let publicView!: typeof import("@/app/api/v1/public/invoices/[token]/route").GET
  let checkout!: typeof import("@/app/api/v1/public/invoices/[token]/checkout/route").POST
  let bankReturn!: typeof import("@/app/api/v1/public/invoices/[token]/kapital-return/route").GET
  let reconcile!: typeof import("@/lib/payments/kapitalbank/invoice-checkout").reconcileKapitalIntents
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, paymentConstraintsSql())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    const settings = await import("@/app/api/v1/settings/online-payment/route")
    saveSettings = settings.PUT
    readSettings = settings.GET
    payLink = (await import("@/app/api/v1/invoices/[id]/pay-link/route")).GET
    publicView = (await import("@/app/api/v1/public/invoices/[token]/route")).GET
    checkout = (await import("@/app/api/v1/public/invoices/[token]/checkout/route")).POST
    bankReturn = (await import("@/app/api/v1/public/invoices/[token]/kapital-return/route")).GET
    reconcile = (await import("@/lib/payments/kapitalbank/invoice-checkout")).reconcileKapitalIntents
    await bypass(() => prisma.organization.create({
      data: { id: ORG, name: "Card Pay Test", slug: "card-pay-test", modules: { crm: true, finance: true, settings: true } },
    }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    bank.reset()
    vi.stubGlobal("fetch", vi.fn(fakeBank))
    signIn("admin")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function connectBank() {
    const res = await saveSettings(json("PUT", "/api/v1/settings/online-payment", {
      login: LOGIN, password: PASSWORD, isTestMode: true, isActive: true,
    }))
    expect(res.status, await res.clone().text()).toBe(200)
  }

  async function newInvoice(total: string, options: { currency?: string; viewToken?: string | null } = {}) {
    const id = `inv-${++sequence}`
    const viewToken = options.viewToken === undefined ? `token-${sequence}-${"x".repeat(24)}` : options.viewToken
    await bypass(() => prisma.invoice.create({
      data: {
        id,
        organizationId: ORG,
        invoiceNumber: `INV-${sequence}`,
        title: "Annual licence",
        status: "sent",
        currency: options.currency ?? "AZN",
        subtotal: total,
        totalAmount: total,
        balanceDue: total,
        recipientName: "Buyer LLC",
        viewToken,
        items: { create: [{ name: "Licence", quantity: 1, unitPrice: total, total }] },
      },
    }))
    return { id, token: viewToken as string }
  }

  /** Press «Pay» on the public page; answer the bank order the customer is sent to. */
  async function pressPay(token: string) {
    const res = await checkout(json("POST", `/api/v1/public/invoices/${token}/checkout`), tokenParams(token))
    const body = await res.json()
    return { status: res.status, body, order: body?.data?.url ? new URL(body.data.url).searchParams.get("id") : null }
  }

  const comeBack = (token: string, orderId: string, status = "FullyPaid") =>
    bankReturn(get(`/api/v1/public/invoices/${token}/kapital-return?ID=${orderId}&STATUS=${status}`), tokenParams(token))

  const invoiceRow = (id: string) => bypass(() => prisma.invoice.findUniqueOrThrow({ where: { id } }))
  const paymentsOf = (invoiceId: string) => bypass(() => prisma.invoicePayment.findMany({ where: { invoiceId } }))
  const registryOf = (invoiceId: string) => bypass(() => prisma.paymentRegistryEntry.findMany({ where: { invoiceId } }))
  const intentsOf = (invoiceId: string) => bypass(() => prisma.paymentIntent.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } }))

  it("refuses a login and password the bank rejects, and stores nothing", async () => {
    const res = await saveSettings(json("PUT", "/api/v1/settings/online-payment", {
      login: LOGIN, password: "wrong", isTestMode: true, isActive: true,
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_CREDENTIALS")
    expect(await bypass(() => prisma.paymentProvider.count({ where: { organizationId: ORG } }))).toBe(0)
  })

  it("stores the merchant password encrypted and never shows it back", async () => {
    await connectBank()

    const row = await bypass(() => prisma.paymentProvider.findFirstOrThrow({ where: { organizationId: ORG, type: "kapitalbank" } }))
    expect(JSON.stringify(row.credentials)).not.toContain(PASSWORD)
    expect(row.credentials).toMatchObject({ login: LOGIN })
    const view = await (await readSettings(get("/api/v1/settings/online-payment"))).json()
    expect(view.data).toEqual({ configured: true, isActive: true, isTestMode: true, login: LOGIN, hasPassword: true })
    expect(JSON.stringify(view)).not.toContain(PASSWORD)

    // Saving again without a password keeps the stored one (and still checks it).
    const again = await saveSettings(json("PUT", "/api/v1/settings/online-payment", { login: LOGIN, isTestMode: true, isActive: true }))
    expect(again.status).toBe(200)
    expect(bank.creates).toBe(2)
  })

  it("pays an invoice: link, bank order, return, and the payment on the invoice", async () => {
    await connectBank()
    const { id, token } = await newInvoice("150.50")

    signIn("manager")
    const link = await (await payLink(get(`/api/v1/invoices/${id}/pay-link`), idParams(id))).json()
    expect(link.data.url).toBe(`https://app.example.test/portal/invoice/${token}?lang=az`)
    expect(link.data.onlinePayment).toEqual({ available: true, amount: 150.5, currency: "AZN" })

    const view = await (await publicView(get(`/api/v1/public/invoices/${token}`), tokenParams(token))).json()
    expect(view.data).toMatchObject({ invoiceNumber: expect.any(String), balanceDue: 150.5, onlinePayment: { available: true } })

    const pay = await pressPay(token)
    expect(pay.status).toBe(200)
    expect(pay.body.data.url).toMatch(/^https:\/\/txpgtst\.kapitalbank\.az\/flex\?id=\d+&password=pw\d+$/)
    const [intent] = await intentsOf(id)
    expect(intent).toMatchObject({ status: "processing", externalRef: pay.order, invoiceId: id })
    expect(JSON.stringify(intent.metadata)).not.toContain(`pw${pay.order}`)

    bank.set(pay.order!, "FullyPaid")
    const back = await comeBack(token, pay.order!)
    expect(back.status).toBe(303)
    expect(back.headers.get("location")).toBe(`https://app.example.test/portal/invoice/${token}?lang=az&payment=paid`)

    const invoice = await invoiceRow(id)
    expect([invoice.status, invoice.paidAmount.toFixed(2), invoice.balanceDue.toFixed(2)]).toEqual(["paid", "150.50", "0.00"])
    const payments = await paymentsOf(id)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ paymentMethod: "card", reference: `Kapital Bank #${pay.order}` })
    const registry = await registryOf(id)
    expect(registry).toHaveLength(1)
    expect(registry[0]).toMatchObject({ sourceType: "invoice_payment", sourceId: payments[0].id, direction: "incoming" })
    expect((await intentsOf(id))[0]).toMatchObject({ status: "succeeded" })
  })

  it("a second press within minutes sends the customer to the same bank order", async () => {
    await connectBank()
    const { token } = await newInvoice("40")
    const createsBefore = bank.creates

    const first = await pressPay(token)
    const second = await pressPay(token)

    expect(second.order).toBe(first.order)
    expect(bank.creates - createsBefore).toBe(1)
  })

  it("the return page, a second tab and the cron at once record the payment once", async () => {
    await connectBank()
    const { id, token } = await newInvoice("99.99")
    const pay = await pressPay(token)
    bank.set(pay.order!, "FullyPaid")
    // Old enough for the cron to pick it up.
    await bypass(() => prisma.paymentIntent.updateMany({ where: { invoiceId: id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } }))

    await Promise.all([
      comeBack(token, pay.order!),
      comeBack(token, pay.order!),
      reconcile(),
      comeBack(token, pay.order!),
      reconcile(),
    ])

    expect(await paymentsOf(id)).toHaveLength(1)
    expect(await registryOf(id)).toHaveLength(1)
    const invoice = await invoiceRow(id)
    expect([invoice.status, invoice.paidAmount.toFixed(2)]).toEqual(["paid", "99.99"])
  })

  it("does not believe the STATUS in the return link", async () => {
    await connectBank()
    const { id, token } = await newInvoice("25")
    const pay = await pressPay(token)
    // The bank still says Preparing; the link claims FullyPaid.

    const back = await comeBack(token, pay.order!, "FullyPaid")

    expect(back.headers.get("location")).toContain("payment=pending")
    expect(await paymentsOf(id)).toHaveLength(0)
    expect((await invoiceRow(id)).status).toBe("sent")
    expect((await intentsOf(id))[0].status).toBe("processing")
  })

  it("a declined card leaves the invoice owing and the intent failed", async () => {
    await connectBank()
    const { id, token } = await newInvoice("60")
    const pay = await pressPay(token)
    bank.set(pay.order!, "Declined")

    const back = await comeBack(token, pay.order!, "Declined")

    expect(back.headers.get("location")).toContain("payment=failed")
    expect(await paymentsOf(id)).toHaveLength(0)
    expect((await intentsOf(id))[0]).toMatchObject({ status: "failed", failureCode: "Declined" })
    expect((await invoiceRow(id)).balanceDue.toFixed(2)).toBe("60.00")
  })

  it("the cron records a payment whose customer never came back", async () => {
    await connectBank()
    const { id, token } = await newInvoice("12.34")
    const pay = await pressPay(token)
    bank.set(pay.order!, "FullyPaid")
    bank.set(pay.order!, "Closed") // "closed after payment" by the time we ask
    await bypass(() => prisma.paymentIntent.updateMany({ where: { invoiceId: id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } }))

    const result = await reconcile()

    expect(result.paid).toBeGreaterThanOrEqual(1)
    expect(await paymentsOf(id)).toHaveLength(1)
    expect((await invoiceRow(id)).status).toBe("paid")
  })

  it("gives up on an order still undecided after two days", async () => {
    await connectBank()
    const { id, token } = await newInvoice("5")
    await pressPay(token)
    await bypass(() => prisma.paymentIntent.updateMany({ where: { invoiceId: id }, data: { createdAt: new Date(Date.now() - 49 * 3600_000) } }))

    await reconcile()

    expect((await intentsOf(id))[0]).toMatchObject({ status: "cancelled" })
    expect(await paymentsOf(id)).toHaveLength(0)
  })

  it("offers no card payment for an invoice in another currency, and opens no bank order", async () => {
    await connectBank()
    const createsBefore = bank.creates
    const { token } = await newInvoice("10", { currency: "USD" })

    const view = await (await publicView(get(`/api/v1/public/invoices/${token}`), tokenParams(token))).json()
    const pay = await pressPay(token)

    expect(view.data.onlinePayment).toEqual({ available: false, reason: "currency" })
    expect(pay.status).toBe(409)
    expect(bank.creates).toBe(createsBefore)
  })

  it("gives an invoice made before links existed its own link", async () => {
    await connectBank()
    const { id } = await newInvoice("10", { viewToken: null })
    signIn("manager")

    const link = await (await payLink(get(`/api/v1/invoices/${id}/pay-link`), idParams(id))).json()

    const saved = await invoiceRow(id)
    expect(saved.viewToken).toEqual(expect.any(String))
    expect(link.data.url).toContain(`/portal/invoice/${saved.viewToken}`)
  })

  it("an unknown link is not found", async () => {
    const res = await publicView(get("/api/v1/public/invoices/nope"), tokenParams("nope"))
    expect(res.status).toBe(404)
  })
})
