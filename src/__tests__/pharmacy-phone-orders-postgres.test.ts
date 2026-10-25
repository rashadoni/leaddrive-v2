/**
 * Phone orders on a real Postgres under the application's own role: the list a
 * call saves, what a second save from the same call does, numbering when calls
 * end at the same moment, and the manager's card — with the product's FORCE
 * row-level security policies, so one organization never sees another's.
 *
 * Stood in for: the catalog snapshot (a two-item feed) and the session cookie.
 * Everything else is real — the writer, the routes, the policies and CHECKs.
 *
 * Set PHARMACY_PHONE_ORDERS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55511:5432 postgres:16
 *   PHARMACY_PHONE_ORDERS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55511/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy, where PHARMACY_PHONE_ORDERS_DB_GATE=required makes a missing URL a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.PHARMACY_PHONE_ORDERS_TEST_DATABASE_URL
if (!adminUrl && process.env.PHARMACY_PHONE_ORDERS_DB_GATE === "required") {
  throw new Error("PHARMACY_PHONE_ORDERS_TEST_DATABASE_URL is required by the phone orders database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  const admin = process.env.PHARMACY_PHONE_ORDERS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `phone_orders_${process.pid}`
  const role = `phone_orders_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  process.env.DATABASE_URL = app.toString()
  return { name, role, password, adminScratch: adminScratch.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = "prisma/migrations/20261103090000_pharmacy_phone_orders/migration.sql"
const ZEYTUN = "org-zeytun"
const OTHER = "org-other"
const NOSPA = "11111111-1111-4111-8111-111111111111"
const KETONAL = "22222222-2222-4222-8222-222222222222"
const PHONE = "+994501234567"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
}
const sql = (url: string, statement: string) => prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "phone-orders-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** `db push` builds neither CHECKs nor policies: both come from the migration itself. */
function migrationGuards(): string {
  const migration = readFileSync(path.join(ROOT, MIGRATION), "utf8")
  const checks = [...migration.matchAll(/CONSTRAINT "((pharmacy_phone_order(?:s|_lines))_\w+_check)"\s+CHECK (\([\s\S]*?\))(?:,\n|\n\);)/g)]
  if (checks.length < 9) throw new Error(`phone order CHECKs not found in the migration (${checks.length})`)
  const policies = migration.slice(migration.indexOf(`ALTER TABLE "pharmacy_phone_orders" ENABLE ROW LEVEL SECURITY`))
  if (!policies.includes("FORCE ROW LEVEL SECURITY")) throw new Error("phone order policies not found in the migration")
  return [...checks.map(([, name, table, body]) => `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ${body};`), policies].join("\n")
}

const CATALOG = {
  source: "zeytun-feed", scopeKey: "a".repeat(64), version: "b".repeat(64), observedAt: "2026-10-23T15:34:38.270Z",
  find: (externalId: string) => ({
    [NOSPA]: { externalId: NOSPA, itemCode: "00000009322", name: "Но-шпа 2мл 40 мг № 25", nameAz: "No-şpa 2ml 40 mq № 25", listPrice: { amount: "12.5", per: "qutu" } },
    [KETONAL]: { externalId: KETONAL, itemCode: "00000006612", name: "Кетонал 2 мл № 10", nameAz: null, listPrice: { amount: "9.08", per: "qutu" } },
  } as Record<string, { externalId: string; itemCode: string; name: string; nameAz: string | null; listPrice: { amount: string; per: string } }>)[externalId] ?? null,
}

const json = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method, headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Test)" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

describe.skipIf(!scratch)("phone orders on a real Postgres under row-level security", () => {
  let admin!: PrismaClient
  let app!: typeof import("@/lib/prisma").prisma
  let save!: typeof import("@/lib/voice-agent/pharmacy/phone-orders").savePhoneOrderFromCall
  let list!: typeof import("@/app/api/v1/pharmacy-orders/route").GET
  let card!: typeof import("@/app/api/v1/pharmacy-orders/[id]/route")

  beforeAll(async () => {
    sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    sql(scratch!.adminScratch, migrationGuards())
    sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)
    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    await admin.organization.createMany({ data: [
      { id: ZEYTUN, name: "Zeytun Pharma", slug: "zeytun", modules: { mtm: true }, features: ["mtm", "pharmacy_phone_orders"] },
      { id: OTHER, name: "Other", slug: "other", modules: { mtm: true }, features: ["mtm"] },
    ] })
    await admin.user.createMany({ data: [
      { id: "user-zeytun", organizationId: ZEYTUN, email: "manager@zeytun.test", name: "Nigar", passwordHash: "-", role: "admin" },
      { id: "user-other", organizationId: OTHER, email: "admin@other.test", name: "Other", passwordHash: "-", role: "admin" },
    ] })
    app = (await import("@/lib/prisma")).prisma
    save = (await import("@/lib/voice-agent/pharmacy/phone-orders")).savePhoneOrderFromCall
    list = (await import("@/app/api/v1/pharmacy-orders/route")).GET
    card = await import("@/app/api/v1/pharmacy-orders/[id]/route")
  }, 300_000)

  afterAll(async () => {
    await app?.$disconnect()
    await admin?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  beforeEach(async () => {
    await admin.pharmacyPhoneOrder.deleteMany({})
    session.current = { user: { id: "user-zeytun", organizationId: ZEYTUN, role: "admin", email: "manager@zeytun.test", name: "Nigar" } }
  })

  const callId = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`
  const saveCall = (n: number, lines: Parameters<typeof save>[1]["lines"]) => save(app as unknown as PrismaClient, {
    organizationId: ZEYTUN, providerCallId: callId(n), callStartedAt: "2026-10-24T06:42:00.000Z",
    callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG, lines,
  })
  const LIST = [
    { externalId: NOSPA, quantity: 10, unit: "qutu", spoken: "noşpa ampula, on qutu" },
    { externalId: KETONAL, quantity: 5, unit: "ədəd", spoken: "ketanol beş ədəd" },
    { quantity: 3, unit: "qutu", spoken: "fluimusil altı yüz, üç qutu" },
  ]
  const params = (id: string) => ({ params: Promise.resolve({ id }) })
  async function patch(id: string, body: Record<string, unknown>) {
    return card.PATCH(json("PATCH", `/api/v1/pharmacy-orders/${id}`, body), params(id))
  }

  it("keeps the caller's words, prices only in the price's unit, and stores the number encrypted", async () => {
    const saved = await saveCall(1, LIST)
    expect(saved).toMatchObject({ status: "saved", number: 1001, created: true, total: "125.00",
      unpriced: ["ketanol beş ədəd"], notFound: ["fluimusil altı yüz, üç qutu"] })
    const row = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(1) }, include: { lines: { orderBy: { position: "asc" } } } })
    expect(row.organizationId).toBe(ZEYTUN)
    expect(row.callerPhone).not.toContain("501234567")
    expect(row.lines.map(line => [line.status, line.productName, line.quantity, line.unit, line.unitPrice?.toFixed(2) ?? null, line.lineTotal?.toFixed(2) ?? null])).toEqual([
      ["resolved", "No-şpa 2ml 40 mq № 25", 10, "qutu", "12.50", "125.00"],
      // The price is per box; five pieces are not priced by a guess.
      ["resolved", "Кетонал 2 мл № 10", 5, "ədəd", null, null],
      ["not_found", null, 3, "qutu", null, null],
    ])
    expect(row.lines.every(line => line.organizationId === ZEYTUN)).toBe(true)
  })

  it("replaces the lines on a second save from the same call, and leaves a decided order alone", async () => {
    await saveCall(2, LIST)
    expect(await saveCall(2, LIST)).toMatchObject({ number: 1001, revision: 1, changed: false })
    const corrected = await saveCall(2, [{ ...LIST[0], quantity: 15 }])
    expect(corrected).toMatchObject({ status: "saved", number: 1001, revision: 2, created: false, changed: true, total: "187.50" })
    expect(await admin.pharmacyPhoneOrderLine.count()).toBe(1)
    await admin.pharmacyPhoneOrder.updateMany({ data: { status: "confirmed", confirmedAt: new Date(), confirmedById: "user-zeytun" } })
    expect(await saveCall(2, LIST)).toEqual({ status: "already_reviewed", number: 1001 })
    expect(await admin.pharmacyPhoneOrderLine.count()).toBe(1)
  })

  it("numbers eight calls that end at once without a gap or a repeat", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => saveCall(10 + i, [LIST[0]])))
    const numbers = results.map(result => result.number).sort()
    expect(numbers).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008])
  })

  it("never shows one organization's orders to another, and the database refuses a line under another organization", async () => {
    await saveCall(3, LIST)
    const raw = await app.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pharmacy_phone_orders`
    expect(Number(raw[0].count)).toBe(0)
    session.current = { user: { id: "user-other", organizationId: OTHER, role: "admin", email: "admin@other.test", name: "Other" } }
    // The other organization has no phone orders feature: the list is not there at all.
    expect((await list(json("GET", "/api/v1/pharmacy-orders"))).status).toBe(404)
    await admin.organization.update({ where: { id: OTHER }, data: { features: ["mtm", "pharmacy_phone_orders"] } })
    const listed = await (await list(json("GET", "/api/v1/pharmacy-orders"))).json()
    expect(listed.data).toEqual([])
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(3) } })
    expect((await card.GET(json("GET", `/api/v1/pharmacy-orders/${order.id}`), params(order.id))).status).toBe(404)
    expect((await patch(order.id, { action: "confirm", revision: 1 })).status).toBe(404)
    const { runWithTenant } = await import("@/lib/rls-context")
    await expect(runWithTenant(OTHER, () => app.pharmacyPhoneOrderLine.create({ data: {
      organizationId: ZEYTUN, orderId: order.id, position: 9, status: "not_found", spokenText: "x", quantity: 1, unit: "qutu",
    } }))).rejects.toThrow()
  })

  it("lets the manager fix a line, refuses a stale card, and confirms only a fully resolved order", async () => {
    await saveCall(4, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(4) }, include: { lines: { orderBy: { position: "asc" } } } })
    const opened = await (await card.GET(json("GET", `/api/v1/pharmacy-orders/${order.id}`), params(order.id))).json()
    expect(opened.data).toMatchObject({ label: "TS-1001", status: "pending_review", callerPhone: PHONE, total: "125.00" })
    // Unresolved lines block the confirmation.
    expect((await patch(order.id, { action: "confirm", revision: 1 })).status).toBe(400)
    const quantity = await (await patch(order.id, { action: "set_quantity", revision: 1, lineId: order.lines[0].id, quantity: 4 })).json()
    expect(quantity.data).toMatchObject({ revision: 2, total: "50.00" })
    // A card still on revision 1 does not overwrite that change.
    expect((await patch(order.id, { action: "set_quantity", revision: 1, lineId: order.lines[0].id, quantity: 9 })).status).toBe(409)
    expect((await patch(order.id, { action: "remove_line", revision: 2, lineId: order.lines[2].id })).status).toBe(200)
    const confirmed = await (await patch(order.id, { action: "confirm", revision: 3 })).json()
    expect(confirmed.data).toMatchObject({ status: "confirmed", confirmedBy: "Nigar", total: "50.00" })
    expect((await patch(order.id, { action: "remove_line", revision: 4, lineId: order.lines[1].id })).status).toBe(409)
  })

  it("records a rejection with its reason", async () => {
    await saveCall(5, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(5) } })
    const rejected = await (await patch(order.id, { action: "reject", revision: 1, reason: "Dublikat" })).json()
    expect(rejected.data).toMatchObject({ status: "rejected", rejectedBy: "Nigar", rejectReason: "Dublikat" })
    // The status CHECKs hold the pair together in the database too.
    await expect(admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { rejectedAt: null } })).rejects.toThrow()
  })
})
