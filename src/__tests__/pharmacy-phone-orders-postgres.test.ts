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
import { Prisma, type PrismaClient } from "@prisma/client"
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
const COMPANIES_MIGRATION = "prisma/migrations/20261106090000_pharmacy_companies/migration.sql"
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
    // The shared-number identification widens the CHECK (its own migration).
    sql(scratch!.adminScratch, readFileSync(path.join(ROOT, "prisma/migrations/20261104100000_pharmacy_phone_orders_shared_number/migration.sql"), "utf8"))
    // Pharmacies as companies: the register-key CHECK and the manager's identification, from that migration.
    const companies = readFileSync(path.join(ROOT, COMPANIES_MIGRATION), "utf8")
    const keyCheck = companies.match(/ALTER TABLE "companies" ADD CONSTRAINT "companies_external_key_check"[\s\S]*?;/)
    const identification = companies.slice(companies.indexOf(`ALTER TABLE "pharmacy_phone_orders" DROP CONSTRAINT`))
    if (!keyCheck || !identification.includes("manager_selected")) throw new Error("pharmacy company guards not found in the migration")
    sql(scratch!.adminScratch, `${keyCheck[0]}\n${identification}`)
    // companies is under the same FORCE policy in production (an older migration).
    sql(scratch!.adminScratch, `ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON "companies"
        USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
        WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`)
    sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)
    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    await admin.organization.createMany({ data: [
      { id: ZEYTUN, name: "Zeytun Pharma", slug: "zeytun", modules: { mtm: true, sales: true }, features: ["mtm", "sales", "pharmacy_phone_orders"] },
      { id: OTHER, name: "Other", slug: "other", modules: { mtm: true, sales: true }, features: ["mtm", "sales"] },
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
    await admin.company.deleteMany({})
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

  // Owner, 2026-10-28: «станция досылает заказ, если CRM не ответила».
  it("keeps the call's newest list against a late or repeated send, and never a manager's change after the call", async () => {
    const send = (seq: number, lines: Parameters<typeof save>[1]["lines"], afterCall = false) => save(app as unknown as PrismaClient, {
      organizationId: ZEYTUN, providerCallId: callId(3), callStartedAt: "2026-10-24T06:42:00.000Z",
      callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG, lines, seq, afterCall })
    const lines = async () => (await admin.pharmacyPhoneOrderLine.findMany({ orderBy: { position: "asc" } })).map(line => [line.spokenText, line.quantity])
    await send(2, LIST)
    // An older save that arrives later, and the same save again, change nothing.
    expect(await send(1, [LIST[0]])).toMatchObject({ status: "saved", changed: false, total: "125.00", notFound: [LIST[2].spoken] })
    expect(await send(2, LIST)).toMatchObject({ status: "saved", changed: false })
    expect(await lines()).toHaveLength(3)
    // The end of the call already told everyone; the station delivers a longer list after it.
    await admin.pharmacyPhoneOrder.updateMany({ data: { managerNotice: { status: "sent" }, pharmacyReceipt: { status: "sent" } } })
    expect(await send(3, [{ ...LIST[0], quantity: 15 }, LIST[1], LIST[2]], true)).toMatchObject({ status: "saved", changed: true, revision: 2, total: "187.50" })
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(3) }, include: { lines: { orderBy: { position: "asc" } } } })
    expect([order.managerNotice, order.pharmacyReceipt, order.stationSeq, order.stationRevision]).toEqual([null, null, 3, 2])
    // A manager changes it; a later delivery for the same call leaves the change alone.
    expect((await patch(order.id, { action: "set_quantity", revision: 2, lineId: order.lines[0].id, quantity: 4 })).status).toBe(200)
    expect(await send(4, [LIST[0]], true)).toEqual({ status: "already_reviewed", number: order.number })
    expect(await lines()).toEqual([[LIST[0].spoken, 4], [LIST[1].spoken, 5], [LIST[2].spoken, 3]])
    // An order saved only after its call is created as usual.
    const created = await save(app as unknown as PrismaClient, { organizationId: ZEYTUN, providerCallId: callId(5),
      callStartedAt: "2026-10-24T06:42:00.000Z", callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG,
      lines: LIST, seq: 1, afterCall: true })
    expect(created).toMatchObject({ status: "saved", created: true, number: order.number + 1 })
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
    await admin.organization.update({ where: { id: OTHER }, data: { features: ["mtm", "sales", "pharmacy_phone_orders"] } })
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

  it("keeps the 1C pharmacy a number named, and refuses an identification it does not know", async () => {
    const saved = await save(app as unknown as PrismaClient, {
      organizationId: ZEYTUN, providerCallId: callId(6), callStartedAt: "2026-10-24T06:42:00.000Z", callerPhoneE164: PHONE,
      identification: "phone_shared", pharmacyName: "Nur Aptek", pharmacyGuid: "55555555-6666-4777-8888-999999999999",
      pharmacyAddress: "Bakı, Yasamal", catalog: CATALOG, lines: [LIST[0]],
    })
    expect(saved.status).toBe("saved")
    const row = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(6) } })
    expect(row).toMatchObject({ pharmacyIdentification: "phone_shared", pharmacyName: "Nur Aptek",
      pharmacyGuid: "55555555-6666-4777-8888-999999999999", pharmacyAddress: "Bakı, Yasamal" })
    await expect(admin.pharmacyPhoneOrder.update({ where: { id: row.id }, data: { pharmacyIdentification: "guessed" } })).rejects.toThrow()
  })

  it("records a rejection with its reason", async () => {
    await saveCall(5, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(5) } })
    const rejected = await (await patch(order.id, { action: "reject", revision: 1, reason: "Dublikat" })).json()
    expect(rejected.data).toMatchObject({ status: "rejected", rejectedBy: "Nigar", rejectReason: "Dublikat" })
    // The status CHECKs hold the pair together in the database too.
    await expect(admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { rejectedAt: null } })).rejects.toThrow()
  })

  /* ─── Pharmacies from 1C as companies ─────────────────────────────── */

  const GUID = (n: number) => `${String(n).padStart(8, "0")}-aaaa-4bbb-8ccc-dddddddddddd`
  const pharmacyRows = (count: number, rename: Record<number, string> = {}) => Array.from({ length: count }, (_, i) => ({
    guid: GUID(i + 1), name: rename[i + 1] ?? `Aptek ${i + 1}`, address: `Küçə ${i + 1}`, city: "Bakı",
    // The first two share the caller's number, as 107 numbers do in Zeytun's list.
    phone: i < 2 ? PHONE : `+99450222${String(i).padStart(4, "0")}`,
  }))
  const T1 = new Date("2026-10-26T06:22:08.000Z")
  const T2 = new Date("2026-10-26T07:22:08.000Z")
  const T3 = new Date("2026-10-26T08:22:08.000Z")
  const T4 = new Date("2026-10-26T09:22:08.000Z")
  async function sync(rows: ReturnType<typeof pharmacyRows>, at: Date) {
    const { syncPharmacyCompanies } = await import("@/lib/pharmacy-orders/pharmacy-companies")
    return syncPharmacyCompanies(app as unknown as PrismaClient, ZEYTUN, rows, at)
  }
  const companyId = async (guid: string) => (await admin.company.findFirstOrThrow({ where: { externalId: guid } })).id

  it("loads 1C's pharmacies as companies, changes only what 1C owns, and keeps a closed one", async () => {
    expect(await sync(pharmacyRows(30), T1)).toMatchObject({ created: 30, updated: 0, removed: 0 })
    const first = await admin.company.findFirstOrThrow({ where: { externalId: GUID(1) } })
    expect(first).toMatchObject({ organizationId: ZEYTUN, name: "Aptek 1", address: "Küçə 1", city: "Bakı", phone: PHONE,
      status: "active", externalSource: "zeytun_1c", externalSyncedAt: T1, externalRemovedAt: null })
    // What the CRM keeps on top of 1C.
    await admin.company.update({ where: { id: first.id }, data: { description: "Sifarişi Aynur qəbul edir", category: "partner", managerId: "user-zeytun" } })
    // The same list again changes nothing.
    expect(await sync(pharmacyRows(30), T1)).toEqual({ created: 0, updated: 0, removed: 0, returned: 0, removalsHeld: 0, linkedOrders: 0 })
    // 1C renamed one pharmacy and closed another.
    expect(await sync(pharmacyRows(29, { 1: "Aptek Bir" }), T2)).toMatchObject({ created: 0, updated: 1, removed: 1 })
    expect(await admin.company.findFirstOrThrow({ where: { id: first.id } })).toMatchObject({ name: "Aptek Bir", externalSyncedAt: T2,
      description: "Sifarişi Aynur qəbul edir", category: "partner", managerId: "user-zeytun" })
    expect(await admin.company.findFirstOrThrow({ where: { externalId: GUID(30) } })).toMatchObject({ status: "inactive", externalRemovedAt: T2 })
    expect(await admin.company.count()).toBe(30)
    // It reopened.
    expect(await sync(pharmacyRows(30, { 1: "Aptek Bir" }), T3)).toMatchObject({ returned: 1, removed: 0 })
    expect(await admin.company.findFirstOrThrow({ where: { externalId: GUID(30) } })).toMatchObject({ status: "active", externalRemovedAt: null })
    // A list that suddenly lacks more than twenty pharmacies (and a fifth) is not believed.
    expect(await sync(pharmacyRows(9, { 1: "Aptek Bir" }), T4)).toMatchObject({ removed: 0, removalsHeld: 21 })
    expect(await admin.company.count({ where: { externalRemovedAt: { not: null } } })).toBe(0)
    // Another organization sees none of them; a read without any context is stopped before the database.
    const { runWithTenant } = await import("@/lib/rls-context")
    expect(await runWithTenant(OTHER, () => app.company.count())).toBe(0)
    await expect(app.company.count()).rejects.toThrow("RLS-GUARD")
    // Half a register key is refused by the database.
    await expect(admin.company.create({ data: { organizationId: ZEYTUN, name: "x", externalSource: "zeytun_1c" } })).rejects.toThrow()
  })

  it("links a call's order to its pharmacy, and an order taken before the list was loaded", async () => {
    const shared = { organizationId: ZEYTUN, callStartedAt: "2026-10-24T06:42:00.000Z", callerPhoneE164: PHONE,
      identification: "phone_unique" as const, pharmacyName: "Aptek 3", pharmacyGuid: GUID(3), catalog: CATALOG, lines: [LIST[0]] }
    await save(app as unknown as PrismaClient, { ...shared, providerCallId: callId(20) })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(20) } })).companyId).toBeNull()
    expect(await sync(pharmacyRows(30), T1)).toMatchObject({ created: 30, linkedOrders: 1 })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(20) } })).companyId).toBe(await companyId(GUID(3)))
    await save(app as unknown as PrismaClient, { ...shared, providerCallId: callId(21) })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(21) } })).companyId).toBe(await companyId(GUID(3)))
  })

  it("lets a manager name the pharmacy of a shared number, and lists the pharmacies with their orders", async () => {
    await sync(pharmacyRows(30), T1)
    // The number has two pharmacies; the caller named one, the agent could not tell which.
    await save(app as unknown as PrismaClient, { organizationId: ZEYTUN, providerCallId: callId(30), callStartedAt: "2026-10-24T06:42:00.000Z",
      callerPhoneE164: PHONE, identification: "named_on_call", pharmacyName: "Aptek 2", catalog: CATALOG, lines: [LIST[0]] })
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(30) } })
    const { GET: candidatesRoute } = await import("@/app/api/v1/pharmacy-orders/[id]/pharmacies/route")
    const byPhone = (await (await candidatesRoute(json("GET", `/api/v1/pharmacy-orders/${order.id}/pharmacies`), params(order.id))).json()).data
    expect(byPhone).toMatchObject({ spoken: "Aptek 2", byPhone: true })
    expect(byPhone.candidates.map((c: { name: string; fitsWords: boolean }) => [c.name, c.fitsWords])).toEqual([["Aptek 1", false], ["Aptek 2", true]])
    const searched = (await (await candidatesRoute(json("GET", `/api/v1/pharmacy-orders/${order.id}/pharmacies?q=Aptek%2017`), params(order.id))).json()).data
    expect(searched.candidates.map((c: { name: string }) => c.name)).toEqual(["Aptek 17"])

    const target = await companyId(GUID(2))
    const named = await (await patch(order.id, { action: "set_pharmacy", revision: 1, companyId: target })).json()
    expect(named.data.pharmacy).toMatchObject({ identification: "manager_selected", name: "Aptek 2", company: { id: target, name: "Aptek 2" } })
    // A card still on revision 1 does not overwrite it; a company of no pharmacy register is refused.
    expect((await patch(order.id, { action: "set_pharmacy", revision: 1, companyId: await companyId(GUID(1)) })).status).toBe(409)
    const plain = await admin.company.create({ data: { organizationId: ZEYTUN, name: "Not a pharmacy" } })
    expect((await patch(order.id, { action: "set_pharmacy", revision: 2, companyId: plain.id })).status).toBe(400)

    const { GET: pharmaciesRoute } = await import("@/app/api/v1/pharmacy-orders/pharmacies/route")
    const listed = (await (await pharmaciesRoute(json("GET", "/api/v1/pharmacy-orders/pharmacies"))).json()).data
    expect(listed.counts).toEqual({ all: 30, ordered: 1, dormant: 0, shared: 2, removed: 0 })
    expect(listed.rows[0]).toMatchObject({ name: "Aptek 2", sharedWith: 2, monthOrders: 1, monthTotal: "125.00" })
    expect(listed.syncedAt).toBe(T1.toISOString())
    // Forty days on, the same pharmacy is the one to call.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } })
    const later = (await (await pharmaciesRoute(json("GET", "/api/v1/pharmacy-orders/pharmacies?filter=dormant"))).json()).data
    expect(later.counts).toMatchObject({ ordered: 0, dormant: 1 })
    expect(later.rows).toHaveLength(1)
    expect(later.rows[0]).toMatchObject({ name: "Aptek 2", daysSinceOrder: 40 })

    const { GET: companyOrdersRoute } = await import("@/app/api/v1/companies/[id]/phone-orders/route")
    const tab = (await (await companyOrdersRoute(json("GET", `/api/v1/companies/${target}/phone-orders`), params(target))).json()).data
    expect(tab).toMatchObject({ monthOrders: 0, orders: [{ label: "TS-1001", total: "125.00" }] })
  })

  it("serves every pharmacy through the paged route under tenant RLS", async () => {
    await sync(pharmacyRows(243), T1)
    const { GET: pharmaciesRoute } = await import("@/app/api/v1/pharmacy-orders/pharmacies/route")
    const pages = []
    for (let page = 1; page <= 3; page++) {
      const response = await pharmaciesRoute(json("GET", `/api/v1/pharmacy-orders/pharmacies?page=${page}`))
      expect(response.status).toBe(200)
      pages.push((await response.json()).data)
    }
    expect(pages.map(page => page.rows.length)).toEqual([100, 100, 43])
    for (const [index, page] of pages.entries()) {
      expect(page).toMatchObject({ page: index + 1, pageSize: 100, totalPages: 3, total: 243, counts: { all: 243 } })
    }
    const ids = pages.flatMap(page => page.rows.map((row: { id: string }) => row.id))
    expect(new Set(ids).size).toBe(243)
    expect([...ids].sort()).toEqual((await admin.company.findMany({ where: { organizationId: ZEYTUN }, select: { id: true } })).map(row => row.id).sort())
    const searched = (await (await pharmaciesRoute(json("GET", "/api/v1/pharmacy-orders/pharmacies?q=Aptek%20243&page=3"))).json()).data
    expect(searched).toMatchObject({ page: 1, total: 1, totalPages: 1, rows: [{ name: "Aptek 243" }] })
    const invalid = (await (await pharmaciesRoute(json("GET", "/api/v1/pharmacy-orders/pharmacies?page=NaN"))).json()).data
    expect(invalid).toMatchObject({ page: 1, total: 243 })
    const { runWithTenant } = await import("@/lib/rls-context")
    const { listPharmacies } = await import("@/lib/pharmacy-orders/pharmacy-companies")
    expect(await runWithTenant(OTHER, () => listPharmacies(app as unknown as PrismaClient, OTHER, { filter: "all", q: "", page: 3 })))
      .toMatchObject({ total: 0, page: 1, rows: [] })
  })

  it("keeps what 1C owns out of the company form, and does not delete a 1C pharmacy", async () => {
    await admin.organization.update({ where: { id: ZEYTUN }, data: { modules: { mtm: true, crm: true } } })
    await sync(pharmacyRows(3), T1)
    const id = await companyId(GUID(1))
    const companyRoute = await import("@/app/api/v1/companies/[id]/route")
    const put = (body: Record<string, unknown>) => companyRoute.PUT(json("PUT", `/api/v1/companies/${id}`, body), params(id))
    const renamed = await put({ name: "Renamed", description: "x" })
    expect(renamed.status).toBe(409)
    expect(await renamed.json()).toMatchObject({ code: "SOURCE_MANAGED", fields: ["name"] })
    // The form sends 1C's values back unchanged with the CRM's own fields: that saves.
    expect((await put({ name: "Aptek 1", phone: PHONE, address: "Küçə 1", city: "Bakı", description: "Qeyd", managerId: "user-zeytun" })).status).toBe(200)
    expect(await admin.company.findFirstOrThrow({ where: { id } })).toMatchObject({ name: "Aptek 1", description: "Qeyd", managerId: "user-zeytun" })
    // A manager from another organization is not a manager here.
    expect((await put({ managerId: "user-other" })).status).toBe(400)
    expect((await companyRoute.DELETE(json("DELETE", `/api/v1/companies/${id}`), params(id))).status).toBe(409)
    expect(await admin.company.count({ where: { id } })).toBe(1)
  })

  it("tells the managers of a new order on WhatsApp once, and records how it went", async () => {
    const { notifyManagersOfPhoneOrder } = await import("@/lib/pharmacy-orders/manager-notice")
    await saveCall(40, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(40) } })
    const sender = async () => ({ id: "ch", organizationId: ZEYTUN, accessToken: "token", phoneNumberId: "pn1",
      businessAccountId: null, verifyToken: null, appSecret: null, displayName: null })
    const sent: Array<{ url: string; body: { to: string; template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } } }> = []
    const fetchOk = (async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
    }) as unknown as typeof fetch
    const notify = (deps: Parameters<typeof notifyManagersOfPhoneOrder>[3]) => notifyManagersOfPhoneOrder(app as unknown as PrismaClient, ZEYTUN, order.id, deps)

    // No number set: nothing is sent, and the card says why.
    expect(await notify({ fetch: fetchOk, sender })).toMatchObject({ status: "no_recipient" })
    expect(sent).toHaveLength(0)
    // Once recorded, a second save of the call does not try again.
    expect(await notify({ fetch: fetchOk, sender })).toBeNull()

    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { managerNotice: Prisma.DbNull } })
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: { pharmacyPhoneOrders: { managerWhatsApp: ["+994501112233", "+994552223344"] } } } })
    expect(await notify({ fetch: fetchOk, sender })).toMatchObject({ status: "sent", sent: 2, messageIds: ["wamid.1", "wamid.2"] })
    expect(sent.map(item => item.body.to)).toEqual(["994501112233", "994552223344"])
    expect(sent[0].url).toContain("/pn1/messages")
    expect(sent[0].body.template.name).toBe("phone_order_new")
    // Order number, pharmacy and total in the text; the button opens this order's card.
    expect(sent[0].body.template.components[0].parameters.map(item => item.text)).toEqual(["TS-1001", "—", "125.00"])
    expect(sent[0].body.template.components[1].parameters[0].text).toBe(order.id)
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).managerNotice).toMatchObject({ status: "sent", sent: 2 })
    expect(await notify({ fetch: fetchOk, sender })).toBeNull()
    expect(sent).toHaveLength(2)

    // Meta refuses one number: the notice is failed with Meta's code, never its text.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { managerNotice: Prisma.DbNull } })
    let calls = 0
    const fetchHalf = (async () => ++calls === 1
      ? new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 131026, message: "Message undeliverable to +994552223344" } }), { status: 400 })) as unknown as typeof fetch
    const failed = await notify({ fetch: fetchHalf, sender })
    expect(failed).toEqual(expect.objectContaining({ status: "failed", error: "meta_131026", sent: 1 }))
    expect(JSON.stringify(await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } }))).not.toContain("552223344")

    // No WhatsApp channel: not connected.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { managerNotice: Prisma.DbNull } })
    expect(await notify({ fetch: fetchOk, sender: async () => null })).toMatchObject({ status: "not_connected" })
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: {} } })
  })

  // Owner, 2026-10-27: a long order must not be lost. The agent saves the list
  // after every line, so the managers hear of it when the call is over, and
  // the card does not change while the agent is still writing it.
  it("tells the managers and sends the pharmacy its list when the call is over, and keeps the card shut while the call still runs", async () => {
    const { announceCallOrder } = await import("@/lib/pharmacy-orders/manager-notice")
    await saveCall(41, LIST.slice(0, 1))
    await saveCall(41, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(41) } })
    const call = await admin.callLog.create({ data: { organizationId: ZEYTUN, direction: "inbound", fromNumber: PHONE, toNumber: "+994125550000",
      provider: "asterisk", providerCallId: callId(41), callMode: "ai", status: "in-progress", wasAnswered: true, startedAt: new Date() } })

    // Still on the line: the manager's change would be overwritten by the next save.
    const running = await patch(order.id, { action: "reject", reason: "dublikat", revision: order.revision })
    expect(running.status).toBe(409)
    expect(await running.json()).toMatchObject({ error: "call_in_progress" })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).status).toBe("pending_review")

    await admin.callLog.update({ where: { id: call.id }, data: { status: "completed", endedAt: new Date() } })
    const sender = async () => ({ id: "ch", organizationId: ZEYTUN, accessToken: "token", phoneNumberId: "pn1",
      businessAccountId: null, verifyToken: null, appSecret: null, displayName: null })
    const sent: Array<{ to: string; template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } }> = []
    const fetchOk = (async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
    }) as unknown as typeof fetch
    const announce = (orgId: string, id: string) => announceCallOrder(app as unknown as PrismaClient, orgId, id, { fetch: fetchOk, sender })
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: { pharmacyPhoneOrders: { managerWhatsApp: ["+994501112233"] } } } })
    // The whole list, once: the managers get the call's final total, the
    // pharmacy every line on the number it called from — a found line by its
    // catalog name, a line still to be found in the caller's words.
    expect(await announce(ZEYTUN, callId(41))).toEqual({
      manager: expect.objectContaining({ status: "sent", sent: 1 }),
      pharmacy: expect.objectContaining({ status: "sent", messageId: "wamid.2" }),
    })
    const texts = (index: number) => sent[index].template.components[0].parameters.map(item => item.text)
    expect(sent.map(message => [message.template.name, message.to])).toEqual([["phone_order_new", "994501112233"], ["phone_order_received", PHONE.slice(1)]])
    expect(texts(0)).toEqual(["TS-1001", "—", "125.00"])
    expect(texts(1)).toEqual(["TS-1001",
      "No-şpa 2ml 40 mq № 25 — 10 qutu; Кетонал 2 мл № 10 — 5 ədəd; fluimusil altı yüz, üç qutu (yoxlanılır) — 3 qutu", "125.00"])
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).pharmacyReceipt).toMatchObject({ status: "sent" })
    expect(await announce(ZEYTUN, callId(41))).toEqual({ manager: null, pharmacy: null })
    // A call that left no order, and another organization's call id, send nothing.
    expect(await announce(ZEYTUN, callId(42))).toBeNull()
    expect(await announce(OTHER, callId(41))).toBeNull()
    expect(sent).toHaveLength(2)

    // Over: the manager decides as before.
    const done = await patch(order.id, { action: "reject", reason: "dublikat", revision: order.revision })
    expect(done.status).toBe(200)
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: {} } })
    await admin.callLog.deleteMany({})
  })

  // TS-1005, 2026-10-29: Meta accepted both messages, then refused them (131042) and the card said "sent".
  it("turns a notice Meta refused after accepting it into failed, with Meta's code", async () => {
    const { recordPhoneOrderMessageFailure } = await import("@/lib/pharmacy-orders/manager-notice")
    await saveCall(43, LIST)
    await admin.pharmacyPhoneOrder.updateMany({ where: { providerCallId: callId(43) }, data: {
      managerNotice: { status: "sent", at: "2026-10-29T13:14:48.775Z", sent: 1, messageIds: ["wamid.M"] },
      pharmacyReceipt: { status: "sent", at: "2026-10-29T13:14:49.477Z", messageId: "wamid.R" } } })
    const at = new Date("2026-10-29T13:14:59.000Z")
    // Another organization's webhook, or a message no order sent, changes nothing.
    expect(await recordPhoneOrderMessageFailure(app as unknown as PrismaClient, OTHER, "wamid.M", 131042, at)).toBe(0)
    expect(await recordPhoneOrderMessageFailure(app as unknown as PrismaClient, ZEYTUN, "wamid.other", 131042, at)).toBe(0)
    expect(await recordPhoneOrderMessageFailure(app as unknown as PrismaClient, ZEYTUN, "wamid.M", 131042, at)).toBe(1)
    expect(await recordPhoneOrderMessageFailure(app as unknown as PrismaClient, ZEYTUN, "wamid.R", 131042, at)).toBe(1)
    const row = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(43) } })
    expect(row.managerNotice).toEqual({ status: "failed", at: at.toISOString(), error: "meta_131042", sent: 0 })
    expect(row.pharmacyReceipt).toEqual({ status: "failed", at: at.toISOString(), error: "meta_131042" })
  })

  // Owner, 2026-10-29: the order as a PDF like Zeytun's 1C printout, «если точно уверен, что это не будет маркетинговое».
  it("sends the order as a 1C-named PDF only while Meta holds the template for utility, and the plain list otherwise", async () => {
    const { sendPharmacyReceipt, notifyPharmacyOfDecision } = await import("@/lib/pharmacy-orders/manager-notice")
    await saveCall(52, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(52) },
      include: { lines: { orderBy: { position: "asc" } } } })
    // The name exactly as 1C has it travels with the line.
    expect(order.lines.map(line => line.sourceName)).toEqual(["Но-шпа 2мл 40 мг № 25", "Кетонал 2 мл № 10", null])
    const sender = (waba: string) => async () => ({ id: "ch", organizationId: ZEYTUN, accessToken: "token", phoneNumberId: "pn1",
      businessAccountId: waba, verifyToken: null, appSecret: null, displayName: null })
    const meta = (category: string, upload = true) => {
      const calls: Array<{ url: string; body: unknown }> = []
      const doFetch = (async (url: string, init?: { body?: unknown }) => {
        calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body })
        if (url.includes("/message_templates")) return new Response(JSON.stringify({ data: [
          { name: new URL(url).searchParams.get("name"), language: "az", status: "APPROVED", category }] }), { status: 200 })
        if (url.endsWith("/media")) return upload ? new Response(JSON.stringify({ id: "media-1" }), { status: 200 }) : new Response("{}", { status: 500 })
        return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 })
      }) as unknown as typeof fetch
      return { calls, doFetch }
    }
    const sent = (calls: Array<{ url: string; body: unknown }>) =>
      calls.filter(call => call.url.endsWith("/messages")).map(call => call.body as { template: { name: string; components: Array<{ type: string; parameters: unknown[] }> } })

    // Utility: the PDF goes, uploaded to WhatsApp, with the number and the total in the text.
    const utility = meta("UTILITY")
    expect(await sendPharmacyReceipt(app as unknown as PrismaClient, ZEYTUN, order.id, { fetch: utility.doFetch, sender: sender("waba-u") }))
      .toMatchObject({ status: "sent", format: "pdf" })
    const upload = utility.calls.find(call => call.url.endsWith("/media"))!.body as FormData
    const file = upload.get("file") as File
    // The upload's own name is ASCII; the pharmacy sees the message's filename.
    expect([upload.get("type"), file.name, file.size > 1000]).toEqual(["application/pdf", "Sifaris-TS-1001.pdf", true])
    expect(new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer())).startsWith("%PDF")).toBe(true)
    expect(sent(utility.calls)).toHaveLength(1)
    expect(sent(utility.calls)[0].template.name).toBe("phone_order_received_pdf")
    expect(sent(utility.calls)[0].template.components).toEqual([
      { type: "header", parameters: [{ type: "document", document: { id: "media-1", filename: "Sifariş TS-1001.pdf" } }] },
      { type: "body", parameters: [{ type: "text", text: "TS-1001" }, { type: "text", text: "125.00" }] }])

    // Meta moved it to marketing: no PDF, the plain utility list instead.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { pharmacyReceipt: Prisma.DbNull } })
    const marketing = meta("MARKETING")
    expect(await sendPharmacyReceipt(app as unknown as PrismaClient, ZEYTUN, order.id, { fetch: marketing.doFetch, sender: sender("waba-m") }))
      .toMatchObject({ status: "sent", pdfSkipped: "not_utility" })
    expect(marketing.calls.some(call => call.url.endsWith("/media"))).toBe(false)
    expect(sent(marketing.calls).map(body => body.template.name)).toEqual(["phone_order_received"])

    // The file does not upload: the plain confirmation, never a message without its file.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { status: "confirmed", confirmedAt: new Date(), confirmedById: "user-zeytun" } })
    const broken = meta("UTILITY", false)
    expect(await notifyPharmacyOfDecision(app as unknown as PrismaClient, ZEYTUN, order.id, { fetch: broken.doFetch, sender: sender("waba-b") }))
      .toMatchObject({ status: "sent", kind: "confirmed", pdfSkipped: "upload_failed" })
    expect(sent(broken.calls).map(body => body.template.name)).toEqual(["phone_order_confirmed"])

    // Utility again: the confirmed order goes as its PDF.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { pharmacyNotice: Prisma.DbNull } })
    const confirmed = meta("UTILITY")
    expect(await notifyPharmacyOfDecision(app as unknown as PrismaClient, ZEYTUN, order.id, { fetch: confirmed.doFetch, sender: sender("waba-c") }))
      .toMatchObject({ status: "sent", kind: "confirmed", format: "pdf" })
    expect(sent(confirmed.calls).map(body => body.template.name)).toEqual(["phone_order_confirmed_pdf"])

    // Meta took the PDF, then refused it on the webhook: the plain confirmation goes, once, and the card says why.
    const { recordPhoneOrderMessageFailure } = await import("@/lib/pharmacy-orders/manager-notice")
    const pdfId = ((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).pharmacyNotice as { messageId: string }).messageId
    const fallback = meta("UTILITY")
    const at = new Date("2026-10-30T09:00:00.000Z")
    const refuse = () => recordPhoneOrderMessageFailure(app as unknown as PrismaClient, ZEYTUN, pdfId, 131053, at,
      { fetch: fallback.doFetch, sender: sender("waba-c") })
    expect(await refuse()).toBe(1)
    expect(await refuse()).toBe(0)
    expect(sent(fallback.calls).map(body => body.template.name)).toEqual(["phone_order_confirmed"])
    expect(fallback.calls.some(call => call.url.endsWith("/media"))).toBe(false)
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).pharmacyNotice)
      .toMatchObject({ status: "sent", kind: "confirmed", pdfSkipped: "meta_131053", at: at.toISOString() })
  })

  it("tells the pharmacy of the manager's decision once, on the number it called from", async () => {
    const { notifyPharmacyOfDecision } = await import("@/lib/pharmacy-orders/manager-notice")
    await saveCall(50, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(50) } })
    const sender = async () => ({ id: "ch", organizationId: ZEYTUN, accessToken: "token", phoneNumberId: "pn1",
      businessAccountId: null, verifyToken: null, appSecret: null, displayName: null })
    const sent: Array<{ to: string; template: { name: string; components: Array<{ type: string; parameters: Array<{ text: string }> }> } }> = []
    const fetchOk = (async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
    }) as unknown as typeof fetch
    const notify = (deps: Parameters<typeof notifyPharmacyOfDecision>[3]) => notifyPharmacyOfDecision(app as unknown as PrismaClient, ZEYTUN, order.id, deps)

    // Still waiting for review: nothing to tell.
    expect(await notify({ fetch: fetchOk, sender })).toBeNull()
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { status: "confirmed", confirmedAt: new Date(), confirmedById: "user-zeytun" } })
    expect(await notify({ fetch: fetchOk, sender })).toMatchObject({ status: "sent", kind: "confirmed", messageId: "wamid.1" })
    expect(sent[0].to).toBe(PHONE.slice(1))
    expect(sent[0].template.name).toBe("phone_order_confirmed")
    expect(sent[0].template.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "TS-1001" }, { type: "text", text: "125.00" }] }])
    // Once only.
    expect(await notify({ fetch: fetchOk, sender })).toBeNull()
    expect(sent).toHaveLength(1)

    // A refusal carries the manager's reason on one line, as Meta requires.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { status: "rejected", confirmedAt: null, confirmedById: null,
      rejectedAt: new Date(), rejectedById: "user-zeytun", rejectReason: "Anbarda\n\nyoxdur\t  hələ", pharmacyNotice: Prisma.DbNull } })
    expect(await notify({ fetch: fetchOk, sender })).toMatchObject({ status: "sent", kind: "rejected" })
    expect(sent[1].template.name).toBe("phone_order_rejected")
    expect(sent[1].template.components[0].parameters.map(item => item.text)).toEqual(["TS-1001", "Anbarda yoxdur hələ"])

    // Meta refuses: failed, with its code only.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { pharmacyNotice: Prisma.DbNull } })
    const fetchRefused = (async () => new Response(JSON.stringify({ error: { code: 131026, message: `Undeliverable to ${PHONE}` } }), { status: 400 })) as unknown as typeof fetch
    expect(await notify({ fetch: fetchRefused, sender })).toMatchObject({ status: "failed", error: "meta_131026" })
    expect(JSON.stringify((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).pharmacyNotice)).not.toContain("501234567")

    // No WhatsApp channel.
    await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { pharmacyNotice: Prisma.DbNull } })
    expect(await notify({ fetch: fetchOk, sender: async () => null })).toMatchObject({ status: "not_connected", kind: "rejected" })
  })
})
