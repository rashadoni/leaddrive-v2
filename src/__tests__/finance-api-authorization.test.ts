/**
 * Who may call the finance APIs, checked on what the server does.
 *
 * Until 2026-10-07 forty of the forty-five route files under /api/finance,
 * /api/cost-model and /api/budgeting asked only "is this person signed in to
 * an organization" (`getOrgId`). No role, no module: a viewer could approve a
 * payment order, a sales rep could add a bank account, and a tenant without
 * the Finance module could do both.
 *
 * Nothing about authorization is mocked here. The real `requireAuth` runs, with
 * the real role matrix and the real module gate; only the session cookie
 * (`@/lib/auth`) and the database are stand-ins. The database is an in-memory
 * one that keeps rows, so "the refused request changed nothing" is read off the
 * rows — not off whether some mock was called with some argument.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const OPERATORS = new Set(["in", "notIn", "not", "gt", "gte", "lt", "lte", "equals", "contains", "startsWith", "mode"])

  const state = {
    tables: {} as Record<string, Row[]>,
    /** Every write the handlers attempted, whether or not a row matched. */
    writes: 0,
    seq: 0,
    /** `model.method` that throws when reached — a write failing half-way through. */
    failOn: null as string | null,
    /** Runs once, just before the next write — another request winning the race. */
    beforeNextWrite: null as (() => void) | null,
    session: null as Row | null,
  }

  const isPlainObject = (v: any) =>
    v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && typeof v.toFixed !== "function"

  /** `{ organizationId_key: { organizationId, key } }` → `{ organizationId, key }`. */
  function flatten(where: Row | undefined): Row {
    const out: Row = {}
    for (const [key, value] of Object.entries(where ?? {})) {
      if (key === "OR" || key === "AND" || key === "NOT") continue
      if (isPlainObject(value) && !Object.keys(value).some((k) => OPERATORS.has(k))) Object.assign(out, value)
      else out[key] = value
    }
    return out
  }

  function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(flatten(where)).every(([key, value]) => {
      if (isPlainObject(value)) {
        if ("in" in value) return value.in.includes(row[key])
        if ("notIn" in value) return !value.notIn.includes(row[key])
        if ("not" in value) return row[key] !== value.not
        if ("equals" in value) return row[key] === value.equals
        return true // range and text operators: no assertion here depends on them
      }
      return row[key] === value
    })
  }

  function apply(row: Row, data: Row | undefined) {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (isPlainObject(value) && "increment" in value) {
        row[key] = typeof row[key]?.plus === "function"
          ? row[key].plus(value.increment)
          : Number(row[key] ?? 0) + Number(value.increment)
      } else if (value !== undefined) {
        row[key] = value
      }
    }
  }

  function model(name: string) {
    const rows = () => (state.tables[name] ??= [])
    const write = (method: string) => {
      const hook = state.beforeNextWrite
      if (hook) {
        state.beforeNextWrite = null
        hook()
      }
      if (state.failOn === `${name}.${method}`) throw new Error(`simulated failure in ${name}.${method}`)
      state.writes += 1
    }
    const find = (where: Row | undefined) => rows().find((row) => matches(row, where))
    return {
      findFirst: async (args: Row = {}) => { const row = find(args.where); return row ? { ...row } : null },
      findUnique: async (args: Row = {}) => { const row = find(args.where); return row ? { ...row } : null },
      findMany: async (args: Row = {}) => rows().filter((row) => matches(row, args.where)).map((row) => ({ ...row })),
      count: async (args: Row = {}) => rows().filter((row) => matches(row, args.where)).length,
      aggregate: async () => ({ _sum: {}, _count: 0 }),
      groupBy: async () => [],
      create: async (args: Row) => {
        write("create")
        const row = { id: `${name}-${++state.seq}`, createdAt: new Date(), ...args.data }
        rows().push(row)
        return { ...row }
      },
      createMany: async (args: Row) => {
        write("createMany")
        for (const data of args.data) rows().push({ id: `${name}-${++state.seq}`, ...data })
        return { count: args.data.length }
      },
      update: async (args: Row) => {
        write("update")
        const row = find(args.where)
        if (!row) throw Object.assign(new Error("Record to update not found"), { code: "P2025" })
        apply(row, args.data)
        return { ...row }
      },
      updateMany: async (args: Row) => {
        write("updateMany")
        const hit = rows().filter((row) => matches(row, args.where))
        for (const row of hit) apply(row, args.data)
        return { count: hit.length }
      },
      upsert: async (args: Row) => {
        write("upsert")
        const row = find(args.where)
        if (row) { apply(row, args.update); return { ...row } }
        const created = { id: `${name}-${++state.seq}`, ...args.create }
        rows().push(created)
        return { ...created }
      },
      delete: async (args: Row) => {
        write("delete")
        const index = rows().findIndex((row) => matches(row, args.where))
        if (index === -1) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" })
        return rows().splice(index, 1)[0]
      },
      deleteMany: async (args: Row = {}) => {
        write("deleteMany")
        const keep = rows().filter((row) => !matches(row, args.where))
        const count = rows().length - keep.length
        state.tables[name] = keep
        return { count }
      },
    }
  }

  const models: Record<string, ReturnType<typeof model>> = {}
  const prisma: any = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined
      if (prop === "$transaction") {
        // All-or-nothing, as a database transaction is: a throw puts every table back.
        return async (arg: any) => {
          if (typeof arg !== "function") return Promise.all(arg)
          const before = Object.fromEntries(
            Object.entries(state.tables).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
          )
          try {
            return await arg(prisma)
          } catch (error) {
            state.tables = before
            throw error
          }
        }
      }
      if (prop.startsWith("$")) return async () => []
      return (models[prop] ??= model(prop))
    },
  })

  return { state, prisma }
})

vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma, logAudit: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: async () => fake.state.session }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/finance/telegram-notify", () => ({
  notifyPaymentOrderPending: vi.fn(),
  notifyPaymentOrderExecuted: vi.fn(),
  notifyBillPaymentRecorded: vi.fn(),
  notifyOverdueBills: vi.fn(),
  notifyOverdueInvoices: vi.fn(),
  notifyUpcomingDeadlines: vi.fn(),
  getAdvanceDays: vi.fn(async () => 7),
}))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn(async () => ({ summary: {}, clients: [] })),
  writeCostModelLog: vi.fn(),
  invalidateAiCache: vi.fn(),
  getAiCache: vi.fn(() => null),
  setAiCache: vi.fn(),
}))
vi.mock("@/lib/cost-model/ai-analysis", () => ({
  analyzeTab: vi.fn(async () => ({ analysis: "", thinking: "" })),
}))

const ORG = "org-1"
const OTHER_ORG = "org-2"
const ROLES = ["superadmin", "admin", "manager", "sales", "support", "ticketing", "viewer", "member"] as const
type TestRole = (typeof ROLES)[number]
type TestAction = "read" | "write" | "delete"

function signIn(role: TestRole, extra: Record<string, unknown> = {}) {
  fake.state.session = {
    user: { id: `user-${role}`, organizationId: ORG, role, email: `${role}@example.com`, name: role, ...extra },
  }
}

function seedOrganization(modules: Record<string, boolean> = { crm: true, finance: true }) {
  fake.state.tables.organization = [
    { id: ORG, isActive: true, plan: "enterprise", addons: [], features: [], modules },
  ]
}

/** The rows as they stand, for "nothing changed" comparisons. */
function snapshot() {
  return JSON.parse(JSON.stringify(fake.state.tables))
}

beforeEach(() => {
  fake.state.tables = {}
  fake.state.writes = 0
  fake.state.seq = 0
  fake.state.failOn = null
  fake.state.beforeNextWrite = null
  fake.state.session = null
  seedOrganization()
})

/* ------------------------------------------------------------------ */
/*  Every handler in the three namespaces, against every role          */
/* ------------------------------------------------------------------ */

const API_ROOT = path.resolve(__dirname, "../app/api")
const NAMESPACES: Record<string, string> = {
  finance: "finance",
  "cost-model": "profitability",
  budgeting: "budgeting",
}
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === "route.ts") out.push(full)
  }
  return out
}

/**
 * The product rule, written out rather than read from the matrix under test —
 * deriving the expectation from `checkPermission` would only prove the matrix
 * agrees with itself. Changing who may do what in finance means changing a row
 * here, in plain sight.
 */
const MAY: Record<string, Record<TestAction, readonly TestRole[]>> = {
  // Treasury: the manager runs it day to day, only an administrator deletes.
  finance: {
    read: ["superadmin", "admin", "manager", "viewer"],
    write: ["superadmin", "admin", "manager"],
    delete: ["superadmin", "admin"],
  },
  // The cost model: the manager reads it, an administrator maintains it.
  profitability: {
    read: ["superadmin", "admin", "manager", "viewer"],
    write: ["superadmin", "admin"],
    delete: ["superadmin", "admin"],
  },
  budgeting: {
    read: ["superadmin", "admin", "manager", "viewer"],
    write: ["superadmin", "admin", "manager"],
    delete: ["superadmin", "admin"],
  },
}

/** A POST that reads. Named here so the list of exceptions is visible. */
const READS_THROUGH_POST = new Set(["cost-model/ai-analysis"])

interface Endpoint {
  label: string
  url: string
  method: (typeof METHODS)[number]
  scope: string
  action: TestAction
  handler: (req: NextRequest, ctx: unknown) => Promise<Response>
}

const endpoints: Endpoint[] = []
for (const [namespace, scope] of Object.entries(NAMESPACES)) {
  for (const file of routeFiles(path.join(API_ROOT, namespace)).sort()) {
    const route = path.relative(API_ROOT, file).slice(0, -"/route.ts".length)
    const mod: Record<string, any> = await import(/* @vite-ignore */ file)
    for (const method of METHODS) {
      if (typeof mod[method] !== "function") continue
      const action: TestAction = method === "GET" || (method === "POST" && READS_THROUGH_POST.has(route))
        ? "read"
        : method === "DELETE" ? "delete" : "write"
      endpoints.push({
        label: `${method} /api/${route}`,
        url: `http://localhost/api/${route.replace(/\[[^\]]+\]/g, "x1")}`,
        method,
        scope,
        action,
        handler: mod[method],
      })
    }
  }
}

async function call(endpoint: Endpoint): Promise<"refused" | "admitted"> {
  const init: ConstructorParameters<typeof NextRequest>[1] = { method: endpoint.method }
  if (endpoint.method !== "GET" && endpoint.method !== "DELETE") {
    init.headers = { "content-type": "application/json", "idempotency-key": "authorization-test-1" }
    init.body = "{}"
  }
  const ctx = { params: Promise.resolve({ id: "x1", month: "2026-01" }) }
  try {
    const res = await endpoint.handler(new NextRequest(endpoint.url, init), ctx)
    return res.status === 401 || res.status === 403 ? "refused" : "admitted"
  } catch {
    // The handler ran and tripped over the empty request or the empty database:
    // it was let in, which is the only thing asked here.
    return "admitted"
  }
}

describe("the three finance namespaces are all there", () => {
  it("finds every route file", () => {
    // A floor, not a count to maintain: an empty scan would make the matrix
    // below pass by checking nothing.
    expect(endpoints.length).toBeGreaterThanOrEqual(70)
    for (const scope of Object.values(NAMESPACES)) {
      expect(endpoints.some((endpoint) => endpoint.scope === scope)).toBe(true)
    }
  })

  it("no handler resolves the organization without resolving the role", () => {
    const offenders: string[] = []
    for (const namespace of Object.keys(NAMESPACES)) {
      for (const file of routeFiles(path.join(API_ROOT, namespace))) {
        const source = readFileSync(file, "utf8")
        const bare = /\b(getOrgId|getSession|withRls)\s*\(/.test(source)
        const unwrapped = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(source)
        if (bare || unwrapped) offenders.push(path.relative(API_ROOT, file))
      }
    }
    expect(
      offenders,
      "These handlers are not built with withRlsAuth(scope, action, …), so nothing checks the caller's role or the tenant's Finance module.",
    ).toEqual([])
  })
})

describe.each(endpoints)("$label ($scope:$action)", (endpoint) => {
  it("admits exactly the roles that may, and a refused call writes nothing", async () => {
    const allowed = MAY[endpoint.scope][endpoint.action]
    const admitted: string[] = []

    for (const role of ROLES) {
      fake.state.tables = {}
      fake.state.writes = 0
      seedOrganization()
      signIn(role)
      const before = snapshot()

      const outcome = await call(endpoint)
      if (outcome === "admitted") {
        admitted.push(role)
      } else {
        expect([role, fake.state.writes, snapshot()]).toEqual([role, 0, before])
      }
    }

    expect(admitted).toEqual(ROLES.filter((role) => allowed.includes(role)))
  })

  it("is refused to a tenant without the Finance module, administrator included", async () => {
    seedOrganization({ crm: true, sales: true, finance: false })
    signIn("admin")
    const before = snapshot()

    expect(await call(endpoint)).toBe("refused")
    expect([fake.state.writes, snapshot()]).toEqual([0, before])
  })

  it("is refused to someone the Finance module was hidden from", async () => {
    signIn("manager", { hiddenModules: ["finance"] })
    expect(await call(endpoint)).toBe("refused")
    expect(fake.state.writes).toBe(0)
  })

  it("is refused without a session", async () => {
    fake.state.session = null
    expect(await call(endpoint)).toBe("refused")
    expect(fake.state.writes).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/*  Approving a payment order                                          */
/* ------------------------------------------------------------------ */

const { POST: approve } = await import("@/app/api/finance/payment-orders/[id]/approve/route")
const { POST: reject } = await import("@/app/api/finance/payment-orders/[id]/reject/route")
const { POST: execute } = await import("@/app/api/finance/payment-orders/[id]/execute/route")
const { POST: createOrder } = await import("@/app/api/finance/payment-orders/route")
const { POST: payBill } = await import("@/app/api/finance/payables/[id]/payments/route")
const { PUT: editBill } = await import("@/app/api/finance/payables/[id]/route")

function post(url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

function seedOrder(overrides: Record<string, unknown> = {}) {
  const order = {
    id: "po-1",
    organizationId: ORG,
    orderNumber: "ПП-001",
    counterpartyName: "Acme",
    counterpartyId: null,
    billId: null,
    amount: 500,
    currency: "AZN",
    purpose: "Services",
    paymentMethod: "bank_transfer",
    status: "pending_approval",
    createdBy: "user-admin",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    ...overrides,
  }
  ;(fake.state.tables.paymentOrder ??= []).push(order)
  return order
}
const order = () => fake.state.tables.paymentOrder[0]

describe("approving a payment order", () => {
  it.each(["viewer", "sales", "support", "ticketing", "member"] as const)(
    "%s is refused and the order stays as it was",
    async (role) => {
      seedOrder()
      signIn(role)
      const before = snapshot()

      const res = await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))

      expect(res.status).toBe(403)
      expect(snapshot()).toEqual(before)
      expect(order()).toMatchObject({ status: "pending_approval", approvedBy: null, approvedAt: null })
    },
  )

  it.each(["manager", "admin"] as const)("%s approves, and the order says who did", async (role) => {
    seedOrder()
    signIn(role)

    const res = await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(order()).toMatchObject({ status: "approved", approvedBy: `user-${role}` })
    expect(order().approvedAt).toBeInstanceOf(Date)
    expect(json.data).toMatchObject({ id: "po-1", status: "approved", approvedBy: `user-${role}` })
  })

  it("does not approve twice", async () => {
    seedOrder()
    signIn("admin")
    await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))

    signIn("manager")
    const res = await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))

    expect(res.status).toBe(400)
    expect(order().approvedBy).toBe("user-admin")
  })

  it("does not overwrite a rejection that got there first", async () => {
    seedOrder()
    signIn("manager")
    // The other person's rejection lands after this request read the order
    // and before it writes.
    fake.state.beforeNextWrite = () => {
      Object.assign(order(), { status: "rejected", rejectionReason: "Budget exceeded" })
    }

    const res = await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))

    expect(res.status).toBe(409)
    expect(order()).toMatchObject({ status: "rejected", rejectionReason: "Budget exceeded", approvedBy: null })
  })

  it("cannot reach another organization's order", async () => {
    seedOrder({ organizationId: OTHER_ORG })
    signIn("admin")

    const res = await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))

    expect(res.status).toBe(404)
    expect(order()).toMatchObject({ status: "pending_approval", approvedBy: null })
  })

  it("a tenant without the Finance module cannot approve", async () => {
    seedOrganization({ crm: true, finance: false })
    seedOrder()
    signIn("admin")

    const res = await approve(post("/api/finance/payment-orders/po-1/approve"), idParams("po-1"))

    expect(res.status).toBe(403)
    expect((await res.json()).message).toContain('Module "finance" is not enabled')
    expect(order()).toMatchObject({ status: "pending_approval", approvedBy: null })
  })
})

describe("rejecting a payment order", () => {
  it("a viewer is refused; a manager rejects with a reason", async () => {
    seedOrder()
    signIn("viewer")
    const refused = await reject(post("/api/finance/payment-orders/po-1/reject", { reason: "No budget" }), idParams("po-1"))
    expect(refused.status).toBe(403)
    expect(order().status).toBe("pending_approval")

    signIn("manager")
    const res = await reject(post("/api/finance/payment-orders/po-1/reject", { reason: "No budget" }), idParams("po-1"))
    expect(res.status).toBe(200)
    expect(order()).toMatchObject({ status: "rejected", rejectionReason: "No budget" })
  })

  it("does not overwrite an approval that got there first", async () => {
    seedOrder()
    signIn("manager")
    fake.state.beforeNextWrite = () => {
      Object.assign(order(), { status: "approved", approvedBy: "user-admin" })
    }

    const res = await reject(post("/api/finance/payment-orders/po-1/reject", { reason: "No budget" }), idParams("po-1"))

    expect(res.status).toBe(409)
    expect(order()).toMatchObject({ status: "approved", approvedBy: "user-admin", rejectionReason: null })
  })
})

describe("creating a payment order", () => {
  it("records who created it", async () => {
    signIn("manager")
    const res = await createOrder(post("/api/finance/payment-orders", {
      counterpartyName: "Acme", amount: "1500.50", purpose: "Rent",
    }))

    expect(res.status).toBe(201)
    expect(order()).toMatchObject({ amount: 1500.5, createdBy: "user-manager", organizationId: ORG })
  })

  it.each(["12abc", "-500", "0", "1e3", "abc"])("refuses the amount %s and creates nothing", async (amount) => {
    signIn("admin")
    const res = await createOrder(post("/api/finance/payment-orders", {
      counterpartyName: "Acme", amount, purpose: "Rent",
    }))

    expect(res.status).toBe(400)
    expect(fake.state.tables.paymentOrder ?? []).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/*  Paying a vendor bill                                               */
/* ------------------------------------------------------------------ */

function seedBill(overrides: Record<string, unknown> = {}) {
  const bill = {
    id: "bill-1",
    organizationId: ORG,
    billNumber: "B-001",
    vendorName: "Landlord LLC",
    vendorId: null,
    category: "rent",
    status: "pending",
    totalAmount: new Prisma.Decimal("100"),
    paidAmount: new Prisma.Decimal("0"),
    balanceDue: new Prisma.Decimal("100"),
    currency: "AZN",
    paidAt: null,
    ...overrides,
  }
  ;(fake.state.tables.bill ??= []).push(bill)
  return bill
}
const bill = () => fake.state.tables.bill[0]
const payments = () => fake.state.tables.billPayment ?? []
const registry = () => fake.state.tables.paymentRegistryEntry ?? []
const money = (value: unknown) => new Prisma.Decimal(String(value)).toFixed(4)

async function pay(amount: unknown, billId = "bill-1") {
  return payBill(post(`/api/finance/payables/${billId}/payments`, { amount }), idParams(billId))
}

describe("paying a vendor bill", () => {
  it.each(["viewer", "sales", "support", "ticketing", "member"] as const)(
    "%s is refused; no payment, no registry entry, the bill untouched",
    async (role) => {
      seedBill()
      signIn(role)
      const before = snapshot()

      const res = await pay(40)

      expect(res.status).toBe(403)
      expect(snapshot()).toEqual(before)
      expect([payments(), registry()]).toEqual([[], []])
    },
  )

  it("a manager records a payment: the row, the bill's totals and the registry agree", async () => {
    seedBill()
    signIn("manager")

    const res = await pay(40)

    expect(res.status).toBe(201)
    expect(payments()).toHaveLength(1)
    expect(payments()[0]).toMatchObject({ billId: "bill-1", organizationId: ORG, createdBy: "user-manager" })
    expect(money(payments()[0].amount)).toBe("40.0000")
    expect([money(bill().paidAmount), money(bill().balanceDue), bill().status]).toEqual(["40.0000", "60.0000", "partially_paid"])
    expect(registry()).toHaveLength(1)
    expect(registry()[0]).toMatchObject({
      sourceType: "bill_payment", sourceId: payments()[0].id, billId: "bill-1", amount: 40, createdBy: "user-manager",
    })
  })

  it("adds up exactly: 0.1 and 0.2 make 0.3, not 0.30000000000000004", async () => {
    seedBill({ totalAmount: new Prisma.Decimal("0.3"), balanceDue: new Prisma.Decimal("0.3") })
    signIn("admin")

    await pay(0.1)
    await pay(0.2)

    // Compared as the exact value, not rounded for display: the old float sum
    // was 0.30000000000000004, which left the bill "partially paid" for ever
    // by four quadrillionths.
    expect(new Prisma.Decimal(String(bill().paidAmount)).equals("0.3")).toBe(true)
    expect(new Prisma.Decimal(String(bill().balanceDue)).isZero()).toBe(true)
    expect(bill().status).toBe("paid")
    expect(bill().paidAt).toBeInstanceOf(Date)
  })

  it("three payments of 33.33 leave exactly 0.01 owed", async () => {
    seedBill()
    signIn("admin")

    await pay("33.33")
    await pay("33.33")
    await pay("33.33")

    expect([money(bill().paidAmount), money(bill().balanceDue), bill().status]).toEqual(["99.9900", "0.0100", "partially_paid"])
  })

  it("a payment larger than the debt settles the bill and never shows a negative balance", async () => {
    seedBill()
    signIn("admin")

    await pay(150)

    expect([money(bill().paidAmount), money(bill().balanceDue), bill().status]).toEqual(["150.0000", "0.0000", "paid"])
  })

  it.each(["12abc", "-500", 0, -1, "1e3", "abc", "", 1.23456, "1,000"])(
    "refuses the amount %j and records nothing",
    async (amount) => {
      seedBill()
      signIn("admin")
      const before = snapshot()

      const res = await pay(amount)

      expect(res.status).toBe(400)
      expect(snapshot()).toEqual(before)
    },
  )

  it("when the last write fails, the payment is not left behind", async () => {
    seedBill()
    signIn("admin")
    const before = snapshot()
    fake.state.failOn = "paymentRegistryEntry.create"

    await expect(pay(40)).rejects.toThrow("simulated failure")

    // The payment row and the bill update both happened before the failure.
    // They are gone again: one transaction, not three writes.
    expect(snapshot()).toEqual(before)
    expect([payments(), registry()]).toEqual([[], []])
    expect([money(bill().paidAmount), bill().status]).toEqual(["0.0000", "pending"])
  })

  it("does not record a payment against another organization's bill", async () => {
    seedBill({ organizationId: OTHER_ORG })
    signIn("admin")
    const before = snapshot()

    const res = await pay(40)

    expect(res.status).toBe(404)
    expect(snapshot()).toEqual(before)
  })

  it("does not record a payment against a bill that does not exist", async () => {
    signIn("admin")

    const res = await pay(40, "no-such-bill")

    expect(res.status).toBe(404)
    expect([payments(), registry()]).toEqual([[], []])
  })
})

describe("correcting a bill's total", () => {
  it("keeps what was already paid", async () => {
    seedBill({ paidAmount: new Prisma.Decimal("400"), totalAmount: new Prisma.Decimal("1000"), balanceDue: new Prisma.Decimal("600"), status: "partially_paid" })
    signIn("manager")

    const res = await editBill(
      new NextRequest("http://localhost/api/finance/payables/bill-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ totalAmount: 1200 }),
      }),
      idParams("bill-1"),
    )

    expect(res.status).toBe(200)
    expect([money(bill().totalAmount), money(bill().paidAmount), money(bill().balanceDue)]).toEqual(["1200.0000", "400.0000", "800.0000"])
  })
})

/* ------------------------------------------------------------------ */
/*  Executing an approved order                                        */
/* ------------------------------------------------------------------ */

describe("executing a payment order", () => {
  it("a viewer is refused and nothing is paid", async () => {
    seedBill()
    seedOrder({ status: "approved", billId: "bill-1", amount: 40 })
    signIn("viewer")
    const before = snapshot()

    const res = await execute(post("/api/finance/payment-orders/po-1/execute"), idParams("po-1"))

    expect(res.status).toBe(403)
    expect(snapshot()).toEqual(before)
  })

  it("pays the linked bill once: order, payment, bill and registry move together", async () => {
    seedBill()
    seedOrder({ status: "approved", billId: "bill-1", amount: 40 })
    signIn("manager")

    const res = await execute(post("/api/finance/payment-orders/po-1/execute"), idParams("po-1"))

    expect(res.status).toBe(200)
    expect(order().status).toBe("executed")
    expect(payments()).toHaveLength(1)
    expect(payments()[0]).toMatchObject({ billId: "bill-1", reference: "ПП-001", createdBy: "user-manager" })
    expect([money(bill().paidAmount), money(bill().balanceDue), bill().status]).toEqual(["40.0000", "60.0000", "partially_paid"])
    expect(registry()).toHaveLength(1)
    expect(registry()[0]).toMatchObject({ sourceType: "payment_order", sourceId: "po-1", createdBy: "user-manager" })

    const again = await execute(post("/api/finance/payment-orders/po-1/execute"), idParams("po-1"))
    expect(again.status).toBe(400)
    expect(payments()).toHaveLength(1)
    expect(money(bill().paidAmount)).toBe("40.0000")
  })

  it("two requests at once pay the bill once", async () => {
    seedBill()
    seedOrder({ status: "approved", billId: "bill-1", amount: 40 })
    signIn("manager")
    // The other request's transaction commits between this one's read of the
    // order and its own claim on it.
    fake.state.beforeNextWrite = () => {
      order().status = "executed"
    }

    const res = await execute(post("/api/finance/payment-orders/po-1/execute"), idParams("po-1"))

    expect(res.status).toBe(409)
    expect([payments(), registry()]).toEqual([[], []])
    expect(money(bill().paidAmount)).toBe("0.0000")
  })

  it("when the bill is gone, the order stays approved and nothing is recorded", async () => {
    seedOrder({ status: "approved", billId: "bill-deleted", amount: 40 })
    signIn("admin")

    const res = await execute(post("/api/finance/payment-orders/po-1/execute"), idParams("po-1"))

    expect(res.status).toBe(409)
    expect(order()).toMatchObject({ status: "approved", executedAt: null })
    expect([payments(), registry()]).toEqual([[], []])
  })

  it("when the registry write fails, the order is not left executed", async () => {
    seedBill()
    seedOrder({ status: "approved", billId: "bill-1", amount: 40 })
    signIn("admin")
    fake.state.failOn = "paymentRegistryEntry.create"

    await expect(execute(post("/api/finance/payment-orders/po-1/execute"), idParams("po-1"))).rejects.toThrow("simulated failure")

    expect(order().status).toBe("approved")
    expect(payments()).toEqual([])
    expect(money(bill().paidAmount)).toBe("0.0000")
  })
})
