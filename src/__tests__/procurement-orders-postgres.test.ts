/**
 * Purchasing for a customer order on a real Postgres (docs/sales-procurement/README.md,
 * stage 3): a request raised from a deal, supplier quotes, an order made from
 * the chosen one, approval by the organization's amount bands, sending,
 * production, transit and receipt — read back from the tables after the real
 * handlers ran under the real requireAuth and RLS wrappers. The harness is the
 * one of procurement-suppliers-postgres.test.ts.
 *
 * PROCUREMENT_TEST_DATABASE_URL / PROCUREMENT_DB_GATE — as there.
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
  // Files of a deal are sealed with the organization's key (test value, not a credential).
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.PROCUREMENT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `procurement_orders_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
/** The mailer is the one stand-in besides the session: what it was handed is what a supplier would get. */
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; attachment: { filename: string; bytes: number; pdf: boolean } | null }[], fail: false }))
vi.mock("@/lib/email", async () => {
  const fs = await import("node:fs")
  return {
    sendEmail: vi.fn(async (input: { to: string; subject: string; attachments?: { filename: string; path: string }[] }) => {
      const file = input.attachments?.[0]
      const bytes = file ? fs.readFileSync(file.path) : null
      mail.sent.push({ to: input.to, subject: input.subject, attachment: file && bytes ? { filename: file.filename, bytes: bytes.length, pdf: bytes.subarray(0, 4).toString() === "%PDF" } : null })
      ;(mail as unknown as { lastPath?: string }).lastPath = file?.path
      return mail.fail ? { success: false, error: "smtp down" } : { success: true }
    }),
  }
})
/** Outgoing webhooks as the organization's systems would receive them (task 6.4). */
const hooks = vi.hoisted(() => ({ fired: [] as { event: string; data: Record<string, unknown> }[] }))
vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn(async (_orgId: string, event: string, data: Record<string, unknown>) => { hooks.fired.push({ event, data }) }),
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const API = "http://localhost:3000/api/v1/procurement"

const BUYER = "org-buyer"
const PLAIN = "org-plain"
const ROLES = ["admin", "manager", "procurement", "finance", "sales", "support", "viewer"] as const
/** Two managers, to decide the same step at once. */
const EXTRA_MANAGER = "manager2"

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

pgDescribe("purchasing for a customer order on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let requests!: typeof import("@/app/api/v1/procurement/requests/route")
  let requestOne!: typeof import("@/app/api/v1/procurement/requests/[id]/route")
  let quotes!: typeof import("@/app/api/v1/procurement/requests/[id]/quotes/route")
  let orders!: typeof import("@/app/api/v1/procurement/orders/route")
  let orderOne!: typeof import("@/app/api/v1/procurement/orders/[id]/route")
  let actions!: typeof import("@/app/api/v1/procurement/orders/[id]/actions/route")
  let receive!: typeof import("@/app/api/v1/procurement/orders/[id]/receive/route")
  let dealId = ""
  let lineIds: string[] = []
  let supplierA = ""
  let supplierB = ""

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const as = (role: string, orgId = BUYER) => signIn(orgId, role)
  async function json(res: Response) { return { status: res.status, body: await res.json() } }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    // The CHECKs of the migration, which `db push` does not know.
    const migration = ["20261222090000_procurement_core", "20261223090000_procurement_product_costs"]
      .map((name) => readFileSync(path.join(ROOT, `prisma/migrations/${name}/migration.sql`), "utf8")).join("\n")
    const checks = migration.split("\n").join(" ").match(/ALTER TABLE "[a-z_]+" ADD CONSTRAINT "[a-z_]+_check"[^;]+;/g) ?? []
    expect(checks.length).toBeGreaterThan(5)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, checks.join("\n"))
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    requests = await import("@/app/api/v1/procurement/requests/route")
    requestOne = await import("@/app/api/v1/procurement/requests/[id]/route")
    quotes = await import("@/app/api/v1/procurement/requests/[id]/quotes/route")
    orders = await import("@/app/api/v1/procurement/orders/route")
    orderOne = await import("@/app/api/v1/procurement/orders/[id]/route")
    actions = await import("@/app/api/v1/procurement/orders/[id]/actions/route")
    receive = await import("@/app/api/v1/procurement/orders/[id]/receive/route")
    for (const tenant of [{ id: BUYER, modules: { crm: true, sales: true, procurement: true, settings: true } }, { id: PLAIN, modules: { crm: true, sales: true, settings: true } }]) {
      await bypass(() => prisma.organization.create({
        data: {
          id: tenant.id, name: `Tenant ${tenant.id}`, slug: tenant.id, modules: tenant.modules,
          // Up to 1000 a manager decides; from 1000 a manager and then finance.
          settings: { procurement: { approvalRules: [
            { minAmount: 0, maxAmount: 1000, approvers: [{ role: "manager" }] },
            { minAmount: 1000, maxAmount: null, approvers: [{ role: "manager" }, { role: "finance" }] },
          ] } },
        },
      }))
      for (const role of [...ROLES, EXTRA_MANAGER]) {
        await bypass(() => prisma.user.create({
          data: { id: `${role}-${tenant.id}`, organizationId: tenant.id, email: `${role}@${tenant.id}.example`, name: role, passwordHash: "x", role: role === EXTRA_MANAGER ? "manager" : role },
        }))
      }
    }
    const deal = await bypass(() => prisma.deal.create({
      data: {
        organizationId: BUYER, name: "Conference stand for a bank", stage: "proposal", valueAmount: 5000, assignedTo: `sales-${BUYER}`,
        lineItems: { create: [
          { organizationId: BUYER, name: "Stand 3×2 m", quantity: 1, unitPrice: 3000, sortOrder: 0 },
          { organizationId: BUYER, name: "Banner", quantity: 4, unitPrice: 500, sortOrder: 1 },
        ] },
      },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    }))
    dealId = deal.id
    lineIds = deal.lineItems.map((line) => line.id)
    supplierA = (await bypass(() => prisma.company.create({ data: { organizationId: BUYER, name: "Wood Workshop", category: "supplier" } }))).id
    supplierB = (await bypass(() => prisma.company.create({ data: { organizationId: BUYER, name: "Print House", category: "supplier" } }))).id
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(async () => {
    await bypass(() => prisma.purchaseOrder.deleteMany({}))
    await bypass(() => prisma.purchaseRequest.deleteMany({}))
    await bypass(() => prisma.notification.deleteMany({}))
  })

  /** Sales raises a request from the deal and sends it; purchasing quotes it twice. */
  async function requestWithQuotes() {
    as("sales")
    const created = await json(await requests.POST(request(`${API}/requests`, "POST", { dealId, submit: true })))
    expect(created.status).toBe(201)
    const requestId = created.body.data.id as string
    const items = await bypass(() => prisma.purchaseRequestItem.findMany({ where: { requestId }, orderBy: { sortOrder: "asc" } }))
    as("procurement")
    const cheap = await json(await quotes.POST(request(`${API}/requests/${requestId}/quotes`, "POST", {
      supplierId: supplierA, leadTimeDays: 10,
      items: [{ requestItemId: items[0].id, quantity: 1, unitPrice: 1200 }, { requestItemId: items[1].id, quantity: 4, unitPrice: 150 }],
    }), ctx(requestId)))
    const dear = await json(await quotes.POST(request(`${API}/requests/${requestId}/quotes`, "POST", {
      supplierId: supplierB, leadTimeDays: 5,
      items: [{ requestItemId: items[0].id, quantity: 1, unitPrice: 1500 }, { requestItemId: items[1].id, quantity: 4, unitPrice: 160 }],
    }), ctx(requestId)))
    expect([cheap.status, dear.status]).toEqual([201, 201])
    return { requestId, items, cheapQuote: cheap.body.data.id as string }
  }

  async function orderFrom(quoteId: string) {
    as("procurement")
    const res = await json(await orders.POST(request(`${API}/orders`, "POST", { quoteId })))
    expect(res.status).toBe(201)
    return res.body.data.id as string
  }

  async function act(role: string, orderId: string, action: string, comment?: string, userId?: string) {
    as(role)
    if (userId) session.current = { user: { ...(session.current!.user as object), id: userId } }
    return actions.POST(request(`${API}/orders/${orderId}/actions`, "POST", { action, ...(comment ? { comment } : {}) }), ctx(orderId))
  }

  const orderRow = (id: string) => bypass(() => prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } }, approvals: { orderBy: [{ revision: "asc" }, { stepNo: "asc" }] }, events: true } }))

  it("a request raised from the deal carries its lines and reaches purchasing in their language", async () => {
    const { requestId, items } = await requestWithQuotes()
    expect(items.map((item) => [item.name, Number(item.quantity), item.dealLineItemId])).toEqual([
      ["Stand 3×2 m", 1, lineIds[0]],
      ["Banner", 4, lineIds[1]],
    ])
    const row = await bypass(() => prisma.purchaseRequest.findUniqueOrThrow({ where: { id: requestId } }))
    expect(row.status).toBe("in_progress")
    expect(row.requestedById).toBe(`sales-${BUYER}`)
    const notices = await bypass(() => prisma.notification.findMany({ where: { organizationId: BUYER } }))
    expect(notices.map((n) => n.userId)).toEqual([`procurement-${BUYER}`])
    expect(notices[0].title).toMatch(/^Satınalma sorğusu PR-0001$/)
  })

  it("sales cannot quote or order, and reads purchases without a single price", async () => {
    const { requestId, items, cheapQuote } = await requestWithQuotes()
    as("sales")
    const quote = await quotes.POST(request(`${API}/requests/${requestId}/quotes`, "POST", { supplierId: supplierA, items: [{ requestItemId: items[0].id, quantity: 1, unitPrice: 1 }] }), ctx(requestId))
    expect(quote.status).toBe(403)
    expect((await orders.POST(request(`${API}/orders`, "POST", { quoteId: cheapQuote }))).status).toBe(403)
    const orderId = await orderFrom(cheapQuote)
    as("sales")
    const seen = await json(await orderOne.GET(request(`${API}/orders/${orderId}`, "GET"), ctx(orderId)))
    expect(seen.status).toBe(200)
    expect(seen.body.data.totalAmount).toBeNull()
    expect(seen.body.data.items.map((item: { unitPrice: unknown; total: unknown; quantity: unknown }) => [item.unitPrice, item.total])).toEqual([[null, null], [null, null]])
    const detail = await json(await requestOne.GET(request(`${API}/requests/${requestId}`, "GET"), ctx(requestId)))
    expect(JSON.stringify(detail.body.data.quotes)).not.toMatch(/1200|1500/)
    as("finance")
    const finance = await json(await orderOne.GET(request(`${API}/orders/${orderId}`, "GET"), ctx(orderId)))
    expect(Number(finance.body.data.totalAmount)).toBe(1800)
  })

  it("an order made from the chosen quote copies its lines, prices and lead time and closes the loop on the request", async () => {
    const { requestId, cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    const order = await orderRow(orderId)
    expect(order.status).toBe("draft")
    expect(Number(order.totalAmount)).toBe(1800)
    expect(order.items.map((item) => [item.name, Number(item.quantity), Number(item.unitPrice), Number(item.total), item.dealLineItemId])).toEqual([
      ["Stand 3×2 m", 1, 1200, 1200, lineIds[0]],
      ["Banner", 4, 150, 600, lineIds[1]],
    ])
    expect(order.dealId).toBe(dealId)
    expect(order.expectedDeliveryAt).not.toBeNull()
    expect((await bypass(() => prisma.purchaseRequest.findUniqueOrThrow({ where: { id: requestId } }))).status).toBe("ordered")
    expect((await bypass(() => prisma.supplierQuote.findUniqueOrThrow({ where: { id: cheapQuote } }))).status).toBe("selected")
  })

  it("an order of 1800 needs a manager and then finance; its author decides nothing", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    expect((await act("procurement", orderId, "submit")).status).toBe(200)
    let order = await orderRow(orderId)
    expect(order.status).toBe("pending_approval")
    expect(order.approvals.map((step) => [step.stepNo, step.approverRole, step.status])).toEqual([[1, "manager", "pending"], [2, "finance", "pending"]])
    expect((await act("procurement", orderId, "approve")).status).toBe(403)
    // Finance cannot jump the queue: step 1 is the manager's.
    expect((await act("finance", orderId, "approve")).status).toBe(403)
    expect((await act("manager", orderId, "approve")).status).toBe(200)
    expect((await orderRow(orderId)).status).toBe("pending_approval")
    expect((await act("finance", orderId, "approve")).status).toBe(200)
    order = await orderRow(orderId)
    expect(order.status).toBe("approved")
    expect(order.approvals.map((step) => [step.status, step.actedById])).toEqual([["approved", `manager-${BUYER}`], ["approved", `finance-${BUYER}`]])
    const approvedNotice = await bypass(() => prisma.notification.findMany({ where: { organizationId: BUYER, title: { contains: "təsdiqləndi" } } }))
    expect(approvedNotice.map((n) => n.userId).sort()).toEqual([`procurement-${BUYER}`, `sales-${BUYER}`].sort())
  })

  it("two managers deciding the same step at once: one wins, the step is decided once", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    as("manager")
    const first = actions.POST(request(`${API}/orders/${orderId}/actions`, "POST", { action: "approve" }), ctx(orderId))
    signIn(BUYER, "manager")
    session.current = { user: { ...(session.current!.user as object), id: `${EXTRA_MANAGER}-${BUYER}` } }
    const second = actions.POST(request(`${API}/orders/${orderId}/actions`, "POST", { action: "approve" }), ctx(orderId))
    const statuses = (await Promise.all([first, second])).map((res) => res.status).sort()
    // The second sees step 1 decided and finds step 2 is finance's.
    expect(statuses).toEqual([200, 403])
    const order = await orderRow(orderId)
    expect(order.approvals.filter((step) => step.status === "approved")).toHaveLength(1)
  })

  it("a rejected order needs a reason, comes back as a new revision and a new chain", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    expect((await act("manager", orderId, "reject")).status).toBe(400)
    expect((await act("manager", orderId, "reject", "Too expensive")).status).toBe(200)
    let order = await orderRow(orderId)
    expect(order.status).toBe("rejected")
    expect(order.approvals.map((step) => step.status)).toEqual(["rejected", "skipped"])
    as("procurement")
    const edited = await orderOne.PATCH(request(`${API}/orders/${orderId}`, "PATCH", { items: [{ name: "Stand 3×2 m", quantity: 1, unitPrice: 900, dealLineItemId: lineIds[0] }] }), ctx(orderId))
    expect(edited.status).toBe(200)
    order = await orderRow(orderId)
    expect([order.status, order.revision, Number(order.totalAmount)]).toEqual(["draft", 2, 900])
    expect((await act("procurement", orderId, "submit")).status).toBe(200)
    order = await orderRow(orderId)
    // 900 is under 1000: one manager this time; the old chain stays as history.
    expect(order.approvals.map((step) => [step.revision, step.stepNo, step.approverRole, step.status])).toEqual([
      [1, 1, "manager", "rejected"], [1, 2, "finance", "skipped"], [2, 1, "manager", "pending"],
    ])
  })

  it("sent, in production, in transit, received in two parts; never more than ordered", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    expect((await act("procurement", orderId, "send")).status).toBe(409)
    await act("procurement", orderId, "submit")
    await act("manager", orderId, "approve")
    await act("finance", orderId, "approve")
    expect((await act("procurement", orderId, "send")).status).toBe(200)
    expect((await act("procurement", orderId, "in_transit")).status).toBe(200)
    expect((await act("procurement", orderId, "in_production")).status).toBe(409)
    const lines = (await orderRow(orderId)).items
    as("procurement")
    const over = await receive.POST(request(`${API}/orders/${orderId}/receive`, "POST", { items: [{ itemId: lines[1].id, quantity: 5 }] }), ctx(orderId))
    expect(over.status).toBe(409)
    const part = await receive.POST(request(`${API}/orders/${orderId}/receive`, "POST", { items: [{ itemId: lines[1].id, quantity: 4 }] }), ctx(orderId))
    expect(part.status).toBe(200)
    expect((await orderRow(orderId)).status).toBe("partially_received")
    const rest = await receive.POST(request(`${API}/orders/${orderId}/receive`, "POST", { items: [{ itemId: lines[0].id, quantity: 1 }] }), ctx(orderId))
    expect(rest.status).toBe(200)
    const order = await orderRow(orderId)
    expect(order.status).toBe("received")
    expect(order.receivedAt).not.toBeNull()
    expect(order.events.filter((event) => event.type === "status").map((event) => event.toStatus).sort()).toEqual(["approved", "in_transit", "pending_approval", "sent"].sort())
    expect((await act("procurement", orderId, "cancel", "late")).status).toBe(409)
  })

  it("a late supplier is marked and its people told once; a new date clears the mark", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    await act("manager", orderId, "approve")
    await act("finance", orderId, "approve")
    await act("procurement", orderId, "send")
    await bypass(() => prisma.purchaseOrder.update({ where: { id: orderId }, data: { expectedDeliveryAt: new Date(Date.now() - 86_400_000) } }))
    await bypass(() => prisma.notification.deleteMany({}))
    const { runProcurementOverdueJob } = await import("@/lib/procurement/overdue-job")
    const first = await runProcurementOverdueJob()
    expect(first).toEqual({ status: "completed", value: { checked: 1, marked: 1 } })
    expect((await orderRow(orderId)).overdueAt).not.toBeNull()
    const late = await bypass(() => prisma.notification.findMany({ where: { organizationId: BUYER } }))
    expect(late.map((n) => n.userId).sort()).toEqual([`procurement-${BUYER}`, `sales-${BUYER}`].sort())
    expect(late.every((n) => /gecikir/.test(n.title))).toBe(true)
    // Nothing more on the next pass.
    expect(await runProcurementOverdueJob()).toEqual({ status: "completed", value: { checked: 0, marked: 0 } })
    // A move after sending needs a reason, clears the mark and tells sales.
    as("procurement")
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString()
    expect((await orderOne.PATCH(request(`${API}/orders/${orderId}`, "PATCH", { expectedDeliveryAt: future }), ctx(orderId))).status).toBe(400)
    expect((await orderOne.PATCH(request(`${API}/orders/${orderId}`, "PATCH", { expectedDeliveryAt: future, deliveryNote: "Fabric came late" }), ctx(orderId))).status).toBe(200)
    expect((await orderRow(orderId)).overdueAt).toBeNull()
  })

  it("the salesperson changes a quantity in the deal: the line keeps its id, the open order is flagged and purchasing told", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    const { PUT } = await import("@/app/api/v1/deals/[id]/line-items/route")
    const before = await bypass(() => prisma.dealLineItem.findMany({ where: { dealId }, orderBy: { sortOrder: "asc" } }))
    await bypass(() => prisma.notification.deleteMany({}))
    as("sales")
    const res = await PUT(request(`http://localhost:3000/api/v1/deals/${dealId}/line-items`, "PUT", { lines: [
      { id: before[0].id, productId: null, name: before[0].name, sku: null, quantity: 1, unitPrice: 3000, discountPct: 0 },
      { id: before[1].id, productId: null, name: before[1].name, sku: null, quantity: 6, unitPrice: 500, discountPct: 0 },
    ] }), ctx(dealId))
    expect(res.status).toBe(200)
    const after = await bypass(() => prisma.dealLineItem.findMany({ where: { dealId }, orderBy: { sortOrder: "asc" } }))
    expect(after.map((line) => line.id)).toEqual(before.map((line) => line.id))
    expect(Number(after[1].quantity)).toBe(6)
    const order = await orderRow(orderId)
    expect(order.dealChangedAt).not.toBeNull()
    expect(order.items.map((item) => item.dealLineItemId)).toEqual(lineIds)
    expect(order.events.some((event) => event.type === "deal_changed")).toBe(true)
    const told = await bypass(() => prisma.notification.findMany({ where: { organizationId: BUYER } }))
    expect(told.some((n) => n.userId === `procurement-${BUYER}` && /Sövdələşmə dəyişdi/.test(n.title))).toBe(true)
    // Restore the deal for the next cases.
    await PUT(request(`http://localhost:3000/api/v1/deals/${dealId}/line-items`, "PUT", { lines: [
      { id: before[0].id, productId: null, name: before[0].name, sku: null, quantity: 1, unitPrice: 3000, discountPct: 0 },
      { id: before[1].id, productId: null, name: before[1].name, sku: null, quantity: 4, unitPrice: 500, discountPct: 0 },
    ] }), ctx(dealId))
  })

  it("the deal tab shows each line's stage, cost and margin to finance and no money to sales", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    await act("manager", orderId, "approve")
    await act("finance", orderId, "approve")
    await act("procurement", orderId, "send")
    const { GET } = await import("@/app/api/v1/procurement/deals/[id]/route")
    as("finance")
    const finance = await json(await GET(request(`${API}/deals/${dealId}`, "GET"), ctx(dealId)))
    expect(finance.status).toBe(200)
    expect(finance.body.data.lines.map((line: { stage: string; cost: number }) => [line.stage, line.cost])).toEqual([["sent", 1200], ["sent", 600]])
    expect(finance.body.data.totals).toEqual({ revenue: 5000, cost: 1800, margin: 3200, marginPct: 64, foreignCost: null, plannedCost: null, plannedMargin: null, plannedMarginPct: null, plannedMissing: 2 })
    expect(finance.body.data.summary).toMatchObject({ ready: 0, total: 2 })
    as("sales")
    const sales = await json(await GET(request(`${API}/deals/${dealId}`, "GET"), ctx(dealId)))
    expect(sales.body.data.totals).toEqual({ revenue: null, cost: null, margin: null, marginPct: null, foreignCost: null, plannedCost: null, plannedMargin: null, plannedMarginPct: null, plannedMissing: 2 })
    expect(sales.body.data.lines.every((line: { cost: unknown }) => line.cost === null)).toBe(true)
  })

  it("sending to the supplier e-mails the order's PDF, keeps no copy on disk and writes the outcome to the history", async () => {
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    await act("manager", orderId, "approve")
    await act("finance", orderId, "approve")
    mail.sent = []
    mail.fail = false
    as("procurement")
    const res = await json(await actions.POST(request(`${API}/orders/${orderId}/actions`, "POST", { action: "send", emailTo: "orders@wood.example", emailLang: "ru" }), ctx(orderId)))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ status: "sent", emailed: true })
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].to).toBe("orders@wood.example")
    expect(mail.sent[0].subject).toMatch(/^Заказ поставщику PO-\d{4} — Tenant org-buyer$/)
    expect(mail.sent[0].attachment).toMatchObject({ pdf: true })
    expect(mail.sent[0].attachment!.bytes).toBeGreaterThan(1000)
    const { existsSync } = await import("node:fs")
    expect(existsSync((mail as unknown as { lastPath: string }).lastPath)).toBe(false)
    // A failing mailer leaves the order sent and says so; sales cannot e-mail prices.
    mail.fail = true
    const again = await json(await (await import("@/app/api/v1/procurement/orders/[id]/email/route")).POST(request(`${API}/orders/${orderId}/email`, "POST", { to: "orders@wood.example" }), ctx(orderId)))
    expect(again.status).toBe(502)
    as("sales")
    expect((await (await import("@/app/api/v1/procurement/orders/[id]/email/route")).POST(request(`${API}/orders/${orderId}/email`, "POST", { to: "x@y.example" }), ctx(orderId))).status).toBe(403)
    const order = await orderRow(orderId)
    expect(order.status).toBe("sent")
    expect(order.events.filter((event) => event.type === "emailed").map((event) => (event.data as { ok: boolean }).ok).sort()).toEqual([false, true])
  })

  it("reports: one supplier on time, one late; spend per currency, margin per deal, files for finance, nothing for sales", async () => {
    const { cheapQuote, requestId, items } = await requestWithQuotes()
    const onTime = await orderFrom(cheapQuote)
    as("procurement")
    const lateRes = await json(await orders.POST(request(`${API}/orders`, "POST", {
      supplierId: supplierB, requestId, currency: "AZN",
      items: [{ name: "Banner", quantity: 4, unitPrice: 160, requestItemId: items[1].id, dealLineItemId: lineIds[1] }],
    })))
    expect(lateRes.status).toBe(201)
    const late = lateRes.body.data.id as string
    for (const id of [onTime, late]) {
      await act("procurement", id, "submit")
      await act("manager", id, "approve")
      if ((await orderRow(id)).status === "pending_approval") await act("finance", id, "approve")
      await act("procurement", id, "send")
    }
    const tomorrow = new Date(Date.now() + 86_400_000)
    await bypass(() => prisma.purchaseOrder.update({ where: { id: onTime }, data: { expectedDeliveryAt: tomorrow } }))
    await bypass(() => prisma.purchaseOrder.update({ where: { id: late }, data: { expectedDeliveryAt: new Date(Date.now() - 3 * 86_400_000) } }))
    for (const id of [onTime, late]) {
      const lines = (await orderRow(id)).items
      as("procurement")
      await receive.POST(request(`${API}/orders/${id}/receive`, "POST", { items: lines.map((line) => ({ itemId: line.id, quantity: Number(line.quantity) })) }), ctx(id))
    }
    const reports = await import("@/app/api/v1/procurement/reports/route")
    const exportRoute = await import("@/app/api/v1/procurement/reports/export/route")
    as("finance")
    const report = await json(await reports.GET(request(`${API}/reports`, "GET")))
    expect(report.status).toBe(200)
    expect(report.body.data.kpis).toMatchObject({ orders: 2, received: 2, onTimePct: 50, averageDelayDays: 1.5, lateOpen: 0, committedByCurrency: { AZN: 2440 } })
    expect(report.body.data.suppliers.map((row: { supplier: string; spend: number; onTime: number; late: number }) => [row.supplier, row.spend, row.onTime, row.late])).toEqual([
      ["Wood Workshop", 1800, 1, 0],
      ["Print House", 640, 0, 1],
    ])
    expect(report.body.data.deals).toEqual([{ dealId, deal: "Conference stand for a bank", currency: "AZN", revenue: 5000, cost: 2440, margin: 2560, marginPct: 51.2, otherCurrency: false }])
    const xlsx = await exportRoute.GET(request(`${API}/reports/export?format=xlsx&lang=ru`, "GET"))
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers.get("content-type")).toMatch(/spreadsheetml/)
    expect(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString()).toBe("PK")
    const pdf = await exportRoute.GET(request(`${API}/reports/export?format=pdf`, "GET"))
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF")
    as("sales")
    expect((await reports.GET(request(`${API}/reports`, "GET"))).status).toBe(403)
    expect((await exportRoute.GET(request(`${API}/reports/export`, "GET"))).status).toBe(403)
  })

  it("a file of the deal is sealed on disk, opened only inside the organization and its bytes go with the row", async () => {
    const { mkdtempSync, readFileSync, existsSync, rmSync } = await import("node:fs")
    const { homedir } = await import("node:os")
    const runtime = mkdtempSync(path.join(homedir(), ".deal-files-runtime-test-"))
    const logs = mkdtempSync(path.join(homedir(), ".deal-files-logs-test-"))
    process.env.LEADDRIVE_RUNTIME_DIR = runtime
    process.env.LEADDRIVE_LOG_DIR = logs
    try {
      const files = await import("@/app/api/v1/deals/[id]/files/route")
      const gate = await import("@/app/api/v1/uploads/[...path]/route")
      // A real PNG: signature, IHDR, IDAT, IEND (1×1 transparent).
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
      const form = new FormData()
      form.append("file", new File([png], "maket v2.png", { type: "image/png" }))
      as("sales")
      const created = await files.POST(new NextRequest(`http://localhost:3000/api/v1/deals/${dealId}/files`, { method: "POST", body: form }), ctx(dealId))
      expect(created.status).toBe(201)
      const row = (await created.json()).data as { id: string; fileName: string; url: string }
      const onDisk = path.join(runtime, "uploads", "deal-files", row.fileName)
      expect(readFileSync(onDisk).subarray(0, 4).toString()).toBe("LDFE")
      as("procurement")
      const listed = await json(await files.GET(request(`http://localhost:3000/api/v1/deals/${dealId}/files`, "GET"), ctx(dealId)))
      expect(listed.body.data.map((f: { originalName: string }) => f.originalName)).toEqual(["maket v2.png"])
      const served = await gate.GET(new NextRequest(`http://localhost:3000${row.url}`), { params: Promise.resolve({ path: ["deal-files", row.fileName] }) })
      expect(served.status).toBe(200)
      expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true)
      as("admin", PLAIN)
      const foreign = await gate.GET(new NextRequest(`http://localhost:3000${row.url}`), { params: Promise.resolve({ path: ["deal-files", row.fileName] }) })
      expect(foreign.status).toBe(404)
      as("support")
      expect((await files.DELETE(request(`http://localhost:3000/api/v1/deals/${dealId}/files?fileId=${row.id}`, "DELETE"), ctx(dealId))).status).toBe(403)
      as("sales")
      expect((await files.DELETE(request(`http://localhost:3000/api/v1/deals/${dealId}/files?fileId=${row.id}`, "DELETE"), ctx(dealId))).status).toBe(200)
      expect(existsSync(onDisk)).toBe(false)
      expect(await bypass(() => prisma.dealFile.count({ where: { dealId } }))).toBe(0)
      // A script disguised as a picture is refused by its bytes.
      const fake = new FormData()
      fake.append("file", new File([Buffer.from("<script>alert(1)</script>")], "logo.png", { type: "image/png" }))
      expect((await files.POST(new NextRequest(`http://localhost:3000/api/v1/deals/${dealId}/files`, { method: "POST", body: fake }), ctx(dealId))).status).toBe(400)
    } finally {
      delete process.env.LEADDRIVE_RUNTIME_DIR
      delete process.env.LEADDRIVE_LOG_DIR
      rmSync(runtime, { recursive: true, force: true })
      rmSync(logs, { recursive: true, force: true })
    }
  })

  it("a change the customer approved is journaled and flags every open purchase of the deal", async () => {
    const { requestId, cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    const route = await import("@/app/api/v1/deals/[id]/change-approvals/route")
    await bypass(() => prisma.notification.deleteMany({}))
    as("sales")
    const bad = await route.POST(request(`http://localhost:3000/api/v1/deals/${dealId}/change-approvals`, "POST", { kind: "size", after: "", approvedByName: "x", approvedAt: "2026-11-17", channel: "phone" }), ctx(dealId))
    expect(bad.status).toBe(400)
    const res = await route.POST(request(`http://localhost:3000/api/v1/deals/${dealId}/change-approvals`, "POST", {
      kind: "size", before: "3×2 m", after: "4×2 m", approvedByName: "Leyla (customer)", approvedAt: "2026-11-17", channel: "whatsapp", note: "by voice message",
    }), ctx(dealId))
    expect(res.status).toBe(201)
    const listed = await json(await route.GET(request(`http://localhost:3000/api/v1/deals/${dealId}/change-approvals`, "GET"), ctx(dealId)))
    expect(listed.body.data.map((row: { kind: string; before: string; after: string; approvedByName: string }) => [row.kind, row.before, row.after, row.approvedByName])).toEqual([["size", "3×2 m", "4×2 m", "Leyla (customer)"]])
    expect((await bypass(() => prisma.purchaseRequest.findUniqueOrThrow({ where: { id: requestId } }))).dealChangedAt).not.toBeNull()
    expect((await orderRow(orderId)).dealChangedAt).not.toBeNull()
    const told = await bypass(() => prisma.notification.findMany({ where: { organizationId: BUYER, userId: `procurement-${BUYER}` } }))
    expect(told.some((n) => n.message.includes("3×2 m → 4×2 m"))).toBe(true)
    as("support")
    expect((await route.POST(request(`http://localhost:3000/api/v1/deals/${dealId}/change-approvals`, "POST", { kind: "other", after: "x", approvedByName: "x", approvedAt: "2026-11-17", channel: "phone" }), ctx(dealId))).status).toBe(403)
  })

  it("a commercial offer gets versions: the old one stays as sent, the new is a draft copy, and both are journaled", async () => {
    const quotesRoute = await import("@/app/api/v1/quotes/route")
    const versionsRoute = await import("@/app/api/v1/quotes/[id]/versions/route")
    as("sales")
    const created = await json(await quotesRoute.POST(request("http://localhost:3000/api/v1/quotes", "POST", {
      quoteNumber: "KP-77", dealId, currency: "AZN",
      lineItems: [{ productName: "Stand 3×2 m", quantity: 1, unitPrice: 3000 }, { productName: "Banner", quantity: 4, unitPrice: 500 }],
    })))
    expect(created.status).toBe(201)
    const v1 = created.body.quote.id as string
    const [first, second] = await Promise.all([
      versionsRoute.POST(request(`http://localhost:3000/api/v1/quotes/${v1}/versions`, "POST"), ctx(v1)),
      versionsRoute.POST(request(`http://localhost:3000/api/v1/quotes/${v1}/versions`, "POST"), ctx(v1)),
    ])
    expect([first.status, second.status]).toEqual([201, 201])
    const listed = await json(await versionsRoute.GET(request(`http://localhost:3000/api/v1/quotes/${v1}/versions`, "GET"), ctx(v1)))
    expect(listed.body.data.map((v: { version: number; status: string; lineItems: unknown[] }) => [v.version, v.status, v.lineItems.length])).toEqual([[3, "draft", 2], [2, "draft", 2], [1, "draft", 2]])
    // The routes journal without awaiting (logAudit is fire-and-forget), so the
    // rows land a moment after the responses: wait for them, then compare.
    await vi.waitFor(async () => {
      const journal = await bypass(() => prisma.auditLog.findMany({ where: { organizationId: BUYER, entityType: "quote" }, select: { action: true } }))
      expect(journal.map((row) => row.action).sort()).toEqual(["create", "new_version", "new_version"])
    }, { timeout: 5_000, interval: 100 })
    as("support")
    expect((await versionsRoute.POST(request(`http://localhost:3000/api/v1/quotes/${v1}/versions`, "POST"), ctx(v1))).status).toBe(403)
  })

  it("Excel import: columns guessed from az/ru headers, duplicates and bad rows skipped, nothing fired for old contacts", async () => {
    const ExcelJS = (await import("exceljs")).default
    const route = await import("@/app/api/v1/imports/route")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Təchizatçılar")
    sheet.addRow(["Ad", "VÖEN", "Telefon", "E-poçt"])
    sheet.addRow(["Akril Studio", "1400000001", "+994 50 111 11 11", "info@akril.example"])
    sheet.addRow(["Wood Workshop", "", "", ""]) // already a supplier of this organization
    sheet.addRow(["Bad Number", "12-34", "", ""])
    sheet.addRow(["Akril Studio", "1400000001", "", ""]) // repeated in the file
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer())
    const send = (step: string, entity: string, file: File, mapping?: unknown) => {
      const form = new FormData()
      form.append("entity", entity)
      form.append("step", step)
      form.append("file", file)
      if (mapping) form.append("mapping", JSON.stringify(mapping))
      return route.POST(new NextRequest("http://localhost:3000/api/v1/imports", { method: "POST", body: form }))
    }
    const book = new File([xlsx], "suppliers.xlsx")
    as("procurement")
    const read = await json(await send("read", "suppliers", book))
    expect(read.status).toBe(200)
    expect(read.body.data.mapping).toEqual(["name", "voen", "phone", "email"])
    const check = await json(await send("check", "suppliers", book, read.body.data.mapping))
    expect(check.body.data).toMatchObject({ total: 4, created: 1, duplicateCount: 2, errorCount: 1, errors: [{ row: 4, message: "voen" }] })
    expect(await bypass(() => prisma.company.count({ where: { organizationId: BUYER, name: "Akril Studio" } }))).toBe(0)
    const done = await json(await send("import", "suppliers", book, read.body.data.mapping))
    expect(done.body.data.created).toBe(1)
    expect(await bypass(() => prisma.company.findMany({ where: { organizationId: BUYER, name: "Akril Studio" }, select: { category: true, voen: true } }))).toEqual([{ category: "supplier", voen: "1400000001" }])
    // Sales cannot import suppliers.
    as("sales")
    expect((await send("read", "suppliers", book)).status).toBe(403)
    // A Russian CSV with semicolons and a quoted comma, for contacts: no notification per old contact.
    await bypass(() => prisma.notification.deleteMany({}))
    const csv = new File([Buffer.from("\uFEFFФИО;Телефон;Компания\n\"Алиев, Рашад\";+994 55 000 00 01;Wood Workshop\nЛейла;+994 55 000 00 01;\n", "utf8")], "contacts.csv")
    const contactRead = await json(await send("read", "contacts", csv))
    expect(contactRead.body.data.mapping).toEqual(["fullName", "phone", "companyName"])
    const contacts = await json(await send("import", "contacts", csv, contactRead.body.data.mapping))
    expect(contacts.body.data).toMatchObject({ created: 1, duplicateCount: 1 })
    const created = await bypass(() => prisma.contact.findMany({ where: { organizationId: BUYER, fullName: "Алиев, Рашад" }, select: { companyId: true, source: true } }))
    expect(created).toEqual([{ companyId: supplierA, source: "import" }])
    expect(await bypass(() => prisma.notification.count({ where: { organizationId: BUYER } }))).toBe(0)
    expect(await bypass(() => prisma.auditLog.count({ where: { organizationId: BUYER, action: "import" } }))).toBe(2)
  })

  it("the organization's systems hear each sent request and every status of an order by webhook, with the total", async () => {
    hooks.fired = []
    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    await act("manager", orderId, "approve")
    await act("finance", orderId, "approve")
    await act("procurement", orderId, "send")
    const lines = (await orderRow(orderId)).items
    as("procurement")
    await receive.POST(request(`${API}/orders/${orderId}/receive`, "POST", { items: lines.map((line) => ({ itemId: line.id, quantity: Number(line.quantity) })) }), ctx(orderId))
    const procurement = hooks.fired.filter((hook) => hook.event.startsWith("purchase_"))
    expect(procurement.map((hook) => [hook.event, hook.data.to ?? null])).toEqual([
      ["purchase_request.submitted", null],
      ["purchase_order.status_changed", "pending_approval"],
      ["purchase_order.status_changed", "approved"],
      ["purchase_order.status_changed", "sent"],
      ["purchase_order.status_changed", "received"],
    ])
    expect(procurement[4].data).toMatchObject({ total: "1800", currency: "AZN", supplier: { name: "Wood Workshop" } })
  })

  it("a product's purchase price: purchasing sets it, sales neither reads nor writes it, and the catalog never carries it", async () => {
    const product = await bypass(() => prisma.product.create({ data: { organizationId: BUYER, name: "Roll-up banner", price: 120, currency: "AZN", unit: "ədəd" } }))
    const { GET, PUT } = await import("@/app/api/v1/procurement/products/[id]/cost/route")
    const url = `${API}/products/${product.id}/cost`
    const body = { purchasePrice: 45.5, currency: "azn", defaultSupplierId: supplierB, leadTimeDays: 7 }

    for (const role of ["sales", "support", "finance", "viewer"]) {
      as(role)
      expect((await PUT(request(url, "PUT", body), ctx(product.id))).status, role).toBe(403)
    }
    expect(await bypass(() => prisma.productCost.count({ where: { productId: product.id } }))).toBe(0)
    as("sales")
    expect((await GET(request(url, "GET"), ctx(product.id))).status).toBe(403)

    as("procurement")
    const saved = await json(await PUT(request(url, "PUT", body), ctx(product.id)))
    expect(saved.status).toBe(200)
    expect(saved.body.data).toMatchObject({ purchasePrice: 45.5, currency: "AZN", defaultSupplier: { id: supplierB, name: "Print House" }, leadTimeDays: 7 })
    as("finance")
    expect((await json(await GET(request(url, "GET"), ctx(product.id)))).body.data.purchasePrice).toBe(45.5)

    // A client company is not a supplier; another tenant's product is not found.
    as("procurement")
    const client = await bypass(() => prisma.company.create({ data: { organizationId: BUYER, name: "Some Bank" } }))
    expect((await PUT(request(url, "PUT", { ...body, defaultSupplierId: client.id }), ctx(product.id))).status).toBe(400)
    as("admin", PLAIN)
    expect((await PUT(request(url, "PUT", body), ctx(product.id))).status).toBe(403)

    // The catalog carries the unit, never the purchase price — not even to a
    // manager, who may see costs: the price lives in its own table.
    const catalog = await import("@/app/api/v1/products/route")
    as("manager")
    const listed = await json(await catalog.GET(request("http://localhost:3000/api/v1/products", "GET")))
    const row = listed.body.data.find((p: { id: string }) => p.id === product.id)
    expect(row.unit).toBe("ədəd")
    expect(JSON.stringify(listed.body)).not.toMatch(/45\.5|purchasePrice/)
    await bypass(() => prisma.product.delete({ where: { id: product.id } }))
    expect(await bypass(() => prisma.productCost.count({ where: { productId: product.id } }))).toBe(0)
  })

  it("the plan: a new deal line takes the purchase price as its planned cost, the deal tab shows plan and planned margin to finance only", async () => {
    const stand = await bypass(() => prisma.product.create({ data: { organizationId: BUYER, name: "Stand 3×2 m", price: 3000, currency: "AZN", unit: "ədəd" } }))
    const banner = await bypass(() => prisma.product.create({ data: { organizationId: BUYER, name: "Banner", price: 500, currency: "AZN", unit: "m²" } }))
    const imported = await bypass(() => prisma.product.create({ data: { organizationId: BUYER, name: "Imported lamp", price: 90, currency: "AZN" } }))
    await bypass(() => prisma.productCost.createMany({ data: [
      { productId: stand.id, organizationId: BUYER, purchasePrice: 1100, currency: "AZN" },
      { productId: banner.id, organizationId: BUYER, purchasePrice: 140, currency: "AZN" },
      // Bought in dollars: no exchange rates, so never a planned cost in a manat deal.
      { productId: imported.id, organizationId: BUYER, purchasePrice: 30, currency: "USD" },
    ] }))
    const deal = await bypass(() => prisma.deal.create({ data: { organizationId: BUYER, name: "Expo booth", stage: "proposal", valueAmount: 0, currency: "AZN", assignedTo: `sales-${BUYER}` } }))
    const lines = await import("@/app/api/v1/deals/[id]/line-items/route")
    const linesUrl = `http://localhost:3000/api/v1/deals/${deal.id}/line-items`
    as("sales")
    expect((await lines.PUT(request(linesUrl, "PUT", { lines: [
      { productId: stand.id, name: "Stand 3×2 m", quantity: 1, unitPrice: 3000, discountPct: 0 },
      { productId: banner.id, name: "Banner", quantity: 4, unitPrice: 500, discountPct: 0 },
      { productId: imported.id, name: "Imported lamp", quantity: 2, unitPrice: 90, discountPct: 0 },
    ] }), ctx(deal.id))).status).toBe(200)
    let rows = await bypass(() => prisma.dealLineItem.findMany({ where: { dealId: deal.id }, orderBy: { sortOrder: "asc" } }))
    expect(rows.map((row) => (row.plannedUnitCost === null ? null : Number(row.plannedUnitCost)))).toEqual([1100, 140, null])
    // What sales reads of its own lines carries no planned cost.
    expect(JSON.stringify((await json(await lines.GET(request(linesUrl, "GET"), ctx(deal.id)))).body)).not.toMatch(/planned|1100/)

    // A request raised from the deal takes each product's unit.
    expect((await requests.POST(request(`${API}/requests`, "POST", { dealId: deal.id }))).status).toBe(201)
    const items = await bypass(() => prisma.purchaseRequestItem.findMany({ where: { request: { dealId: deal.id } }, orderBy: { sortOrder: "asc" } }))
    expect(items.map((item) => item.unit)).toEqual(["ədəd", "m²", null])

    // Sales cannot set the plan; purchasing fills the missing line.
    const plan = await import("@/app/api/v1/procurement/deals/[id]/planned-costs/route")
    const planUrl = `${API}/deals/${deal.id}/planned-costs`
    expect((await plan.PUT(request(planUrl, "PUT", { lines: [{ dealLineItemId: rows[2].id, plannedUnitCost: 1 }] }), ctx(deal.id))).status).toBe(403)
    as("procurement")
    expect((await plan.PUT(request(planUrl, "PUT", { lines: [{ dealLineItemId: lineIds[0], plannedUnitCost: 1 }] }), ctx(deal.id))).status).toBe(400)
    expect((await plan.PUT(request(planUrl, "PUT", { lines: [{ dealLineItemId: rows[2].id, plannedUnitCost: 55 }] }), ctx(deal.id))).status).toBe(200)

    const tab = await import("@/app/api/v1/procurement/deals/[id]/route")
    as("finance")
    const finance = await json(await tab.GET(request(`${API}/deals/${deal.id}`, "GET"), ctx(deal.id)))
    // Revenue 3000 + 2000 + 180 = 5180; plan 1100 + 560 + 110 = 1770.
    expect(finance.body.data.lines.map((line: { plannedCost: number }) => line.plannedCost)).toEqual([1100, 560, 110])
    expect(finance.body.data.totals).toMatchObject({ revenue: 5180, plannedCost: 1770, plannedMargin: 3410, plannedMarginPct: 65.8, plannedMissing: 0 })
    as("sales")
    const sales = await json(await tab.GET(request(`${API}/deals/${deal.id}`, "GET"), ctx(deal.id)))
    expect(sales.body.data.totals).toMatchObject({ plannedCost: null, plannedMargin: null, plannedMarginPct: null })
    expect(sales.body.data.lines.every((line: { plannedCost: unknown; plannedUnitCost: unknown }) => line.plannedCost === null && line.plannedUnitCost === null)).toBe(true)

    // Sales saves its lines again: the plan stays. Switching a line to another product re-plans it.
    rows = await bypass(() => prisma.dealLineItem.findMany({ where: { dealId: deal.id }, orderBy: { sortOrder: "asc" } }))
    expect((await lines.PUT(request(linesUrl, "PUT", { lines: [
      { id: rows[0].id, productId: stand.id, name: "Stand 3×2 m", quantity: 2, unitPrice: 3000, discountPct: 0 },
      { id: rows[1].id, productId: stand.id, name: "Stand 3×2 m", quantity: 1, unitPrice: 3000, discountPct: 0 },
      { id: rows[2].id, productId: imported.id, name: "Imported lamp", quantity: 2, unitPrice: 90, discountPct: 0 },
    ] }), ctx(deal.id))).status).toBe(200)
    rows = await bypass(() => prisma.dealLineItem.findMany({ where: { dealId: deal.id }, orderBy: { sortOrder: "asc" } }))
    expect(rows.map((row) => (row.plannedUnitCost === null ? null : Number(row.plannedUnitCost)))).toEqual([1100, 1100, 55])

    await bypass(() => prisma.purchaseRequest.deleteMany({ where: { dealId: deal.id } }))
    await bypass(() => prisma.deal.delete({ where: { id: deal.id } }))
    await bypass(() => prisma.product.deleteMany({ where: { id: { in: [stand.id, banner.id, imported.id] } } }))
  })

  it("automations: an admin's rules on a sent request, a status and a late supplier run, and no rule can move an order", async () => {
    const rule = (name: string, entityType: string, triggerEvent: string, actions: { actionType: string; actionConfig: Record<string, unknown> }[], conditions: Record<string, unknown> = {}) =>
      bypass(() => prisma.workflowRule.create({ data: { organizationId: BUYER, name, entityType, triggerEvent, conditions: conditions as object, actions: { create: actions.map((action, index) => ({ ...action, actionConfig: action.actionConfig as object, actionOrder: index })) } } }))
    await rule("Check a new request", "purchase_request", "submitted", [{ actionType: "create_task", actionConfig: { title: "Check what was asked" } }])
    await rule("Tell the customer it is ordered", "purchase_order", "status_changed", [{ actionType: "create_task", actionConfig: { title: "Tell the customer: ordered" } }], { rules: [{ field: "status", operator: "equals", value: "sent" }] })
    await rule("Big orders", "purchase_order", "status_changed", [{ actionType: "create_task", actionConfig: { title: "Big order moved" } }], { rules: [{ field: "amount", operator: "greater_than", value: "5000" }] })
    // A rule that tries to cancel an order: purchases are not on the engine's update list.
    await rule("Try to cancel", "purchase_order", "status_changed", [{ actionType: "update_field", actionConfig: { field: "status", value: "cancelled" } }, { actionType: "assign_to", actionConfig: { assignTo: `viewer-${BUYER}` } }])
    await rule("Late supplier", "purchase_order", "overdue", [{ actionType: "create_task", actionConfig: { title: "Call the supplier" } }])
    // Another tenant's rule never runs here.
    await bypass(() => prisma.workflowRule.create({ data: { organizationId: PLAIN, name: "Foreign", entityType: "purchase_order", triggerEvent: "status_changed", actions: { create: [{ actionType: "create_task", actionConfig: { title: "Foreign task" } }] } } }))
    await bypass(() => prisma.task.deleteMany({}))

    const { cheapQuote } = await requestWithQuotes()
    const orderId = await orderFrom(cheapQuote)
    await act("procurement", orderId, "submit")
    await act("manager", orderId, "approve")
    await act("finance", orderId, "approve")
    await act("procurement", orderId, "send")
    expect((await orderRow(orderId)).status).toBe("sent")

    await bypass(() => prisma.purchaseOrder.update({ where: { id: orderId }, data: { expectedDeliveryAt: new Date(Date.now() - 86_400_000) } }))
    const { runProcurementOverdueJob } = await import("@/lib/procurement/overdue-job")
    await runProcurementOverdueJob()

    const tasks = await bypass(() => prisma.task.findMany({ select: { organizationId: true, title: true, assignedTo: true, relatedType: true, relatedId: true }, orderBy: { createdAt: "asc" } }))
    // The request was asked for by sales; the order is for sales' deal.
    expect(tasks.map((task) => [task.title, task.assignedTo, task.relatedType])).toEqual([
      ["Check what was asked", `sales-${BUYER}`, "purchase_request"],
      ["Tell the customer: ordered", `sales-${BUYER}`, "purchase_order"],
      ["Call the supplier", `sales-${BUYER}`, "purchase_order"],
    ])
    expect(tasks.every((task) => task.organizationId === BUYER)).toBe(true)
    expect(tasks[1].relatedId).toBe(orderId)
    const order = await orderRow(orderId)
    expect(order.status).toBe("sent")
    expect(order.events.some((event) => event.type === "overdue")).toBe(true)

    await bypass(() => prisma.workflowRule.deleteMany({}))
    await bypass(() => prisma.task.deleteMany({}))
  })

  it("eight requests saved at once get eight different numbers", async () => {
    as("sales")
    const results = await Promise.all(Array.from({ length: 8 }, () => requests.POST(request(`${API}/requests`, "POST", { title: "Paint", items: [{ name: "Paint", quantity: 2 }] }))))
    expect(results.map((res) => res.status)).toEqual(Array(8).fill(201))
    const seqs = (await bypass(() => prisma.purchaseRequest.findMany({ where: { organizationId: BUYER }, select: { seq: true } }))).map((row) => row.seq).sort((a, b) => a - b)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("without the module nothing is read or written", async () => {
    as("admin", PLAIN)
    expect((await requests.POST(request(`${API}/requests`, "POST", { title: "x", items: [{ name: "x", quantity: 1 }] }))).status).toBe(403)
    expect((await orders.GET(request(`${API}/orders`, "GET"))).status).toBe(403)
    expect(await bypass(() => prisma.purchaseRequest.count({ where: { organizationId: PLAIN } }))).toBe(0)
  })
})
