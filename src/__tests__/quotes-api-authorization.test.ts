/**
 * Who may read, create, change and delete a quote (КП), checked on the routes.
 *
 * Until 2026-11-17 `/api/v1/quotes` and `/api/v1/quotes/[id]` were wrapped in
 * `withRls`. Its role check (path → `offers` via ROUTE_MODULE_MAP, method →
 * action) already held the matrix below — this file passes on that code except
 * for one case: the per-person module mask. A person from whom the admin hid
 * Sales still read and edited quotes through the API. They now go through
 * `withRlsAuth("offers", …)`, which reads the mask on every request, and the
 * scope no longer depends on the path map.
 *
 * Nothing about authorization is mocked: the real `requireAuth` runs with the
 * real role matrix and the real module gate. Only the session (`@/lib/auth`)
 * and the database are stand-ins, and the database keeps rows — "a refused
 * request changed nothing" is read off the quote rows themselves.
 *
 * The expectation is written by hand (as in finance-api-authorization.test.ts):
 * a table derived from checkPermission would only prove the matrix agrees with
 * itself.
 */
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ALL_ROLES, type Role } from "@/lib/permissions"

const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  const state = {
    tables: {} as Record<string, Row[]>,
    seq: 0,
    session: null as Row | null,
  }
  const plain = (v: any) => v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)
  const matches = (row: Row, where: Row | undefined) =>
    Object.entries(where ?? {}).every(([key, value]) => {
      if (value === undefined || key === "OR" || key === "AND" || key === "NOT") return true
      if (plain(value)) {
        if ("in" in value) return value.in.includes(row[key])
        return true
      }
      return row[key] === value
    })

  function model(name: string) {
    const rows = () => (state.tables[name] ??= [])
    const find = (where: Row | undefined) => rows().find((row) => matches(row, where))
    return {
      findFirst: async (args: Row = {}) => { const row = find(args.where); return row ? { ...row } : null },
      findUnique: async (args: Row = {}) => { const row = find(args.where); return row ? { ...row } : null },
      findMany: async (args: Row = {}) => rows().filter((row) => matches(row, args.where)).map((row) => ({ ...row })),
      count: async (args: Row = {}) => rows().filter((row) => matches(row, args.where)).length,
      create: async (args: Row) => {
        const row = { id: `${name}-${++state.seq}`, createdAt: new Date(), ...args.data }
        rows().push(row)
        return { ...row }
      },
      createMany: async (args: Row) => {
        for (const data of args.data) rows().push({ id: `${name}-${++state.seq}`, ...data })
        return { count: args.data.length }
      },
      update: async (args: Row) => {
        const row = find(args.where)
        if (!row) throw Object.assign(new Error("Record to update not found"), { code: "P2025" })
        for (const [key, value] of Object.entries(args.data ?? {})) if (!plain(value)) row[key] = value
        return { ...row }
      },
      updateMany: async () => ({ count: 0 }),
      upsert: async (args: Row) => ({ ...args.create }),
      delete: async (args: Row) => {
        const index = rows().findIndex((row) => matches(row, args.where))
        if (index === -1) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" })
        return rows().splice(index, 1)[0]
      },
      deleteMany: async (args: Row = {}) => {
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
        return async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))
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
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))

const ORG = "org-1"
const QUOTE = "quote-1"
type Act = "read" | "write" | "delete"

/**
 * The product rule. Reading: everyone the matrix lets read offers (procurement
 * and finance read what was quoted; viewer and reviewer read everything they
 * may). Writing: the sales side. Deleting: an administrator only, as for
 * contracts — manager and sales lost it on 2026-11-17; an organization gives
 * it back per role with «Tam» in the roles table.
 */
const MAY: Record<Act, readonly Role[]> = {
  read: ["superadmin", "admin", "manager", "sales", "procurement", "finance", "viewer", "reviewer"],
  write: ["superadmin", "admin", "manager", "sales"],
  delete: ["superadmin", "admin"],
}

function signIn(role: Role) {
  fake.state.session = {
    user: { id: `user-${role}`, organizationId: ORG, role, email: `${role}@example.com`, name: role },
  }
}

function seed(modules: Record<string, boolean> = { crm: true, sales: true }) {
  fake.state.tables = {
    organization: [{ id: ORG, isActive: true, plan: "enterprise", addons: [], features: [], modules, name: "Org", settings: {} }],
    quote: [{
      id: QUOTE,
      organizationId: ORG,
      quoteNumber: "Q-1",
      version: 1,
      status: "draft",
      currency: "AZN",
      subtotal: "100",
      discountAmount: "0",
      discountPct: null,
      totalAmount: "100",
      notes: "original",
      rejectedReason: null,
      dealId: null,
      createdBy: "user-admin",
      lineItems: [],
    }],
  }
}

const quoteRows = () => JSON.parse(JSON.stringify(fake.state.tables.quote ?? []))

beforeEach(() => {
  fake.state.seq = 0
  fake.state.session = null
  seed()
})

/* ------------------------------------------------------------------ */
/*  Every handler under /api/v1/quotes                                 */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, "../app/api/v1/quotes")
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === "route.ts") out.push(full)
  }
  return out
}

interface Endpoint {
  label: string
  url: string
  method: (typeof METHODS)[number]
  act: Act
  handler: (req: NextRequest, ctx: unknown) => Promise<Response>
}

const endpoints: Endpoint[] = []
for (const file of routeFiles(ROOT).sort()) {
  const route = path.relative(ROOT, file).slice(0, -"/route.ts".length)
  const mod: Record<string, any> = await import(/* @vite-ignore */ file)
  for (const method of METHODS) {
    if (typeof mod[method] !== "function") continue
    endpoints.push({
      label: `${method} /api/v1/quotes/${route}`,
      url: `http://localhost/api/v1/quotes/${route.replace(/\[[^\]]+\]/g, QUOTE)}`,
      method,
      act: method === "GET" ? "read" : method === "DELETE" ? "delete" : "write",
      handler: mod[method],
    })
  }
}

async function send(endpoint: Endpoint, body: unknown = {}): Promise<number> {
  const init: ConstructorParameters<typeof NextRequest>[1] = { method: endpoint.method }
  if (endpoint.method !== "GET" && endpoint.method !== "DELETE") {
    init.headers = { "content-type": "application/json" }
    init.body = JSON.stringify(body)
  }
  try {
    const res = await endpoint.handler(new NextRequest(endpoint.url, init), { params: Promise.resolve({ id: QUOTE }) })
    return res.status
  } catch {
    // The handler was let in and tripped over the stand-in database.
    return 500
  }
}

const refused = (status: number) => status === 401 || status === 403

describe("every quote route asks the role", () => {
  it("finds the routes", () => {
    const labels = endpoints.map((e) => e.label)
    for (const expected of [
      "GET /api/v1/quotes/",
      "POST /api/v1/quotes/",
      "GET /api/v1/quotes/[id]",
      "PATCH /api/v1/quotes/[id]",
      "DELETE /api/v1/quotes/[id]",
      "GET /api/v1/quotes/[id]/pdf",
    ]) {
      expect(labels).toContain(expected)
    }
  })

  it("covers every role", () => {
    expect([...new Set(Object.values(MAY).flat())].every((role) => ALL_ROLES.includes(role))).toBe(true)
  })

  for (const role of ALL_ROLES) {
    it(`${role}: exactly the table, and a refusal changes no quote`, async () => {
      signIn(role)
      for (const endpoint of endpoints) {
        seed()
        const before = quoteRows()
        const status = await send(endpoint)
        const may = MAY[endpoint.act].includes(role)
        expect(refused(status), `${role} ${endpoint.label} → ${status}`).toBe(!may)
        if (!may) expect(quoteRows(), `${role} ${endpoint.label} changed a quote`).toEqual(before)
      }
    })
  }

  it("signed out: refused everywhere", async () => {
    for (const endpoint of endpoints) expect(await send(endpoint), endpoint.label).toBe(401)
  })
})

describe("what an admitted request actually does", () => {
  const find = (label: string) => endpoints.find((e) => e.label === label)!

  it("sales creates a quote and edits it, but cannot delete it", async () => {
    signIn("sales")
    expect(await send(find("POST /api/v1/quotes/"), { quoteNumber: "Q-2" })).toBe(201)
    const created = fake.state.tables.quote.find((q) => q.quoteNumber === "Q-2")
    expect(created).toMatchObject({ organizationId: ORG, status: "draft", createdBy: "user-sales" })

    expect(await send(find("PATCH /api/v1/quotes/[id]"), { notes: "changed by sales" })).toBe(200)
    expect(fake.state.tables.quote.find((q) => q.id === QUOTE)?.notes).toBe("changed by sales")

    expect(await send(find("DELETE /api/v1/quotes/[id]"))).toBe(403)
    expect(fake.state.tables.quote.some((q) => q.id === QUOTE)).toBe(true)
  })

  it("a viewer reads the list and the card, and its edit and delete leave the quote as it was", async () => {
    signIn("viewer")
    expect(await send(find("GET /api/v1/quotes/"))).toBe(200)
    expect(await send(find("GET /api/v1/quotes/[id]"))).toBe(200)
    const before = quoteRows()
    expect(await send(find("POST /api/v1/quotes/"), { quoteNumber: "Q-3" })).toBe(403)
    expect(await send(find("PATCH /api/v1/quotes/[id]"), { notes: "viewer was here" })).toBe(403)
    expect(await send(find("DELETE /api/v1/quotes/[id]"))).toBe(403)
    expect(quoteRows()).toEqual(before)
  })

  it("an admin deletes", async () => {
    signIn("admin")
    expect(await send(find("DELETE /api/v1/quotes/[id]"))).toBe(200)
    expect(fake.state.tables.quote.some((q) => q.id === QUOTE)).toBe(false)
  })

  it("a person from whom the admin hid Sales is refused on every quote route, read included", async () => {
    // What `withRls` never checked: its role check reads the matrix only, and
    // the per-person mask (User.hiddenModules) was left to the proxy's copy in
    // the JWT. requireAuth reads the mask off the user row on every request.
    for (const role of ["manager", "sales", "viewer"] as const) {
      signIn(role)
      fake.state.session!.user.hiddenModules = ["sales"]
      for (const endpoint of endpoints) {
        seed()
        const before = quoteRows()
        expect(refused(await send(endpoint, { quoteNumber: "Q-5", notes: "x" })), `${role} ${endpoint.label}`).toBe(true)
        expect(quoteRows()).toEqual(before)
      }
    }
  })

  it("the sales module still gates: without it even a manager is refused and nothing changes", async () => {
    seed({ crm: true, sales: false })
    signIn("manager")
    for (const endpoint of endpoints) {
      seed({ crm: true, sales: false })
      const before = quoteRows()
      expect(refused(await send(endpoint, { quoteNumber: "Q-4", notes: "x" })), endpoint.label).toBe(true)
      expect(quoteRows()).toEqual(before)
    }
  })
})
