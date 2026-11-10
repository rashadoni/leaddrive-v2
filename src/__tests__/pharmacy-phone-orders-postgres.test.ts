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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

/** Zeytun's 1C, stood in for at the one door every outbound POST goes through. */
type ErpAnswer = { status: number; json?: unknown } | "no_answer"
const erp = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; body: Record<string, unknown>; authorization: string }>,
  answer: (_url: string, _body: Record<string, unknown>): ErpAnswer => "no_answer",
}))
vi.mock("@/lib/integrations/webhook-url-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/webhook-url-guard")>()
  return { ...actual, postOutboundResource: async (url: string, options: { body: string; headers?: Record<string, string> }) => {
    const body = JSON.parse(options.body) as Record<string, unknown>
    erp.calls.push({ url, body, authorization: options.headers?.Authorization ?? "" })
    const answer = erp.answer(url, body)
    if (answer === "no_answer") throw new Error("outbound_timeout")
    return { ok: answer.status < 300, status: answer.status, url, redirects: 0, bodyBytes: new TextEncoder().encode(JSON.stringify(answer.json ?? {})) }
  } }
})

/**
 * The catalog the voice receipt re-reads before a product goes on a line
 * (phone-order-voice.ts). The screen's picker reads the same snapshot through
 * its own path, which these tests do not reach; this stands in for the snapshot.
 */
vi.mock("@/lib/pharmacy-orders/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pharmacy-orders/orders")>()
  return { ...actual, phoneOrderCatalogItem: async (_db: unknown, _orgId: string, _id: string, externalId: string) => {
    const item = CATALOG.find(externalId)
    if (!item) throw new actual.PhoneOrderError("invalid", 400)
    return { externalId: item.externalId, itemCode: item.itemCode, name: item.nameAz ?? item.name, sourceName: item.name,
      price: item.listPrice ? { amount: item.listPrice.amount, per: item.listPrice.per } : null }
  } }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = "prisma/migrations/20261103090000_pharmacy_phone_orders/migration.sql"
const COMPANIES_MIGRATION = "prisma/migrations/20261106090000_pharmacy_companies/migration.sql"
const NAMED_MATCHED_MIGRATION = "prisma/migrations/20261126090000_pharmacy_phone_orders_named_matched/migration.sql"
const WAITLIST_MIGRATION = "prisma/migrations/20261127090000_pharmacy_waitlist/migration.sql"
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
    // 1C gives no price for it: found, but nothing to price it with.
    [KETONAL]: { externalId: KETONAL, itemCode: "00000006612", name: "Кетонал 2 мл № 10", nameAz: null, listPrice: null },
  } as Record<string, { externalId: string; itemCode: string; name: string; nameAz: string | null; listPrice: { amount: string; per: string } | null }>)[externalId] ?? null,
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
    // A 1C pharmacy matched to the words said, not the number (named_matched): its own migration.
    sql(scratch!.adminScratch, readFileSync(path.join(ROOT, NAMED_MATCHED_MIGRATION), "utf8"))
    // The waiting list: its CHECKs and its policy, from its own migration.
    const waitlist = readFileSync(path.join(ROOT, WAITLIST_MIGRATION), "utf8")
    const waitlistChecks = [...waitlist.matchAll(/CONSTRAINT "(pharmacy_waitlist_items_\w+_check)" CHECK (\([\s\S]*?\))(?:,\n|\n\);)/g)]
    const waitlistPolicy = waitlist.slice(waitlist.indexOf(`ALTER TABLE "pharmacy_waitlist_items" ENABLE ROW LEVEL SECURITY`))
    if (waitlistChecks.length !== 2 || !waitlistPolicy.includes("FORCE ROW LEVEL SECURITY")) throw new Error("waiting list guards not found in the migration")
    sql(scratch!.adminScratch, [...waitlistChecks.map(([, name, body]) => `ALTER TABLE "pharmacy_waitlist_items" ADD CONSTRAINT "${name}" CHECK ${body};`),
      waitlistPolicy].join("\n"))
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
    await admin.pharmacyWaitlistItem.deleteMany({})
    await admin.pharmacyPhoneOrder.deleteMany({})
    await admin.company.deleteMany({})
    await admin.systemJobCursor.deleteMany({})
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

  it("keeps the caller's words, prices only from 1C's price, and stores the number encrypted", async () => {
    const saved = await saveCall(1, LIST)
    expect(saved).toMatchObject({ status: "saved", number: 1001, created: true, total: "125.00",
      unpriced: ["ketanol beş ədəd"], notFound: ["fluimusil altı yüz, üç qutu"] })
    const row = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(1) }, include: { lines: { orderBy: { position: "asc" } } } })
    expect(row.organizationId).toBe(ZEYTUN)
    expect(row.callerPhone).not.toContain("501234567")
    expect(row.lines.map(line => [line.status, line.productName, line.quantity, line.unit, line.unitPrice?.toFixed(2) ?? null, line.lineTotal?.toFixed(2) ?? null])).toEqual([
      ["resolved", "No-şpa 2ml 40 mq № 25", 10, "qutu", "12.50", "125.00"],
      // No price in 1C: not priced by a guess.
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

  // Owner's queue 2026-11-06, task 1b: the call ended without the final save; its transcript adds what the order lacks.
  it("adds the transcript's missing lines to an unfinished order, leaves its own lines and tells everyone again", async () => {
    const { recoveredOrderLines, TRANSCRIPT_LINE_MARK } = await import("@/lib/voice-agent/pharmacy/zeytun-transcript-recovery")
    await save(app as unknown as PrismaClient, { organizationId: ZEYTUN, providerCallId: callId(6), callStartedAt: "2026-10-24T06:42:00.000Z",
      callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG, lines: LIST.slice(0, 2), seq: 2 })
    await admin.pharmacyPhoneOrder.updateMany({ where: { providerCallId: callId(6) }, data: { managerNotice: { status: "sent" } } })
    const held = await admin.pharmacyPhoneOrderLine.findMany({ where: { order: { providerCallId: callId(6) } }, orderBy: { position: "asc" } })
    const merged = recoveredOrderLines(held, [{ name: "Noşpa ampula", quantity: 10, unit: "qutu" },
      { name: "Smekta", quantity: 4, unit: "qutu" }], () => null)
    expect(merged).toHaveLength(3)
    const saved = await save(app as unknown as PrismaClient, { organizationId: ZEYTUN, providerCallId: callId(6),
      callStartedAt: "2026-10-24T06:42:00.000Z", callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG, lines: merged!, afterCall: true })
    expect(saved).toMatchObject({ status: "saved", changed: true, notFound: [`Smekta 4 qutu${TRANSCRIPT_LINE_MARK}`] })
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(6) }, include: { lines: { orderBy: { position: "asc" } } } })
    expect(order.lines.map(line => [line.spokenText, line.quantity, line.externalId, line.status])).toEqual([
      [LIST[0].spoken, 10, NOSPA, "resolved"], [LIST[1].spoken, 5, KETONAL, "resolved"], [`Smekta 4 qutu${TRANSCRIPT_LINE_MARK}`, 4, null, "not_found"]])
    expect([order.managerNotice, order.finishedOnCallAt]).toEqual([null, null])
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

  // Owner, 2026-11-03 («товаров 9к»): the line learns names from what the managers let through.
  it("reads the caller's words and the final product of confirmed orders only, under the organization's RLS", async () => {
    const { confirmedPhoneOrderLines } = await import("@/lib/voice-agent/pharmacy/phone-orders")
    const read = (organizationId: string, since = new Date("2026-01-01T00:00:00Z")) =>
      confirmedPhoneOrderLines(app as unknown as PrismaClient, { organizationId, catalogScopeKey: CATALOG.scopeKey, since, limit: 100 })
    await saveCall(20, LIST)
    await saveCall(21, LIST)
    const [confirmed, pending] = await Promise.all([callId(20), callId(21)].map(providerCallId =>
      admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId }, include: { lines: { orderBy: { position: "asc" } } } })))
    // The manager took "ketanol beş ədəd" for No-şpa, then confirmed.
    await admin.pharmacyPhoneOrderLine.update({ where: { id: confirmed.lines[1].id }, data: { externalId: NOSPA } })
    await admin.pharmacyPhoneOrder.update({ where: { id: confirmed.id }, data: { status: "confirmed", confirmedAt: new Date("2026-11-03T12:00:00Z") } })
    expect(pending.status).toBe("pending_review")
    // Unresolved lines and the order still waiting for a manager teach nothing.
    expect((await read(ZEYTUN)).sort((a, b) => a.spoken.localeCompare(b.spoken))).toEqual([
      { spoken: "ketanol beş ədəd", externalId: NOSPA },
      { spoken: "noşpa ampula, on qutu", externalId: NOSPA },
    ])
    // Older than asked, another catalog, another organization: nothing.
    expect(await read(ZEYTUN, new Date("2026-11-04T00:00:00Z"))).toEqual([])
    expect(await confirmedPhoneOrderLines(app as unknown as PrismaClient,
      { organizationId: ZEYTUN, catalogScopeKey: "c".repeat(64), since: new Date(0), limit: 100 })).toEqual([])
    expect(await read(OTHER)).toEqual([])
    // Hints: every resolved line the line wrote, confirmed or not (owner's call 2026-11-03).
    const { orderedPhoneOrderProducts } = await import("@/lib/voice-agent/pharmacy/phone-orders")
    const ordered = await orderedPhoneOrderProducts(app as unknown as PrismaClient,
      { organizationId: ZEYTUN, catalogScopeKey: CATALOG.scopeKey, since: new Date("2026-01-01T00:00:00Z"), limit: 100 })
    expect([...ordered].sort()).toEqual([KETONAL, NOSPA, NOSPA, NOSPA].sort())
    expect(await orderedPhoneOrderProducts(app as unknown as PrismaClient,
      { organizationId: OTHER, catalogScopeKey: CATALOG.scopeKey, since: new Date(0), limit: 100 })).toEqual([])
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

  // Owner, 2026-11-04: «как обычно» — the line offers the pharmacy's last confirmed order again.
  it("reads the last confirmed order of the call's own pharmacy only, by the day it was ordered", async () => {
    const { lastPharmacyOrder, historyCandidates } = await import("@/lib/voice-agent/pharmacy/zeytun-pharmacy-history")
    const [ZAFAR, NUR, NEW] = [GUID(71), GUID(72), GUID(73)]
    await admin.company.createMany({ data: [
      { organizationId: ZEYTUN, name: "Zəfər Aptek", externalSource: "zeytun_1c", externalId: ZAFAR },
      { organizationId: ZEYTUN, name: "Nur Aptek", externalSource: "zeytun_1c", externalId: NUR },
      { organizationId: ZEYTUN, name: "Yeni Aptek", externalSource: "zeytun_1c", externalId: NEW },
      // The same 1C GUID in another organization is another company.
      { organizationId: OTHER, name: "Zəfər Aptek", externalSource: "zeytun_1c", externalId: ZAFAR },
    ] })
    const order = async (n: number, at: string, pharmacyGuid: string | null, status: "confirmed" | "rejected" | "pending_review",
      lines: Parameters<typeof save>[1]["lines"] = [LIST[0], LIST[1]], organizationId = ZEYTUN, confirmedAt = at) => {
      await save(app as unknown as PrismaClient, { organizationId, providerCallId: callId(n), callStartedAt: at, callerPhoneE164: PHONE,
        catalog: CATALOG, lines, ...(pharmacyGuid ? { identification: "phone_unique" as const, pharmacyName: "Aptek", pharmacyGuid }
          : { identification: "named_on_call" as const, pharmacyName: "Başqa aptek" }) })
      if (status !== "pending_review") {
        await admin.pharmacyPhoneOrder.updateMany({ where: { organizationId, providerCallId: callId(n) },
          data: status === "confirmed" ? { status, confirmedAt: new Date(confirmedAt) } : { status, rejectedAt: new Date(at) } })
      }
      return (await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { organizationId, providerCallId: callId(n) } })).number
    }
    // Ordered 20 October, confirmed only on 30 October: the 28 October order is still the later one.
    await order(70, "2026-10-20T07:00:00.000Z", ZAFAR, "confirmed", [LIST[0]], ZEYTUN, "2026-10-30T09:00:00.000Z")
    const last = await order(71, "2026-10-28T07:00:00.000Z", ZAFAR, "confirmed", [{ ...LIST[0], quantity: 15 }, LIST[1], LIST[2]])
    // Newer, but nobody confirmed it — or a manager rejected it.
    await order(72, "2026-11-01T07:00:00.000Z", ZAFAR, "pending_review")
    await order(73, "2026-11-02T07:00:00.000Z", ZAFAR, "rejected")
    // Another pharmacy of the same organization, and the same pharmacy's GUID in another organization, newest of all.
    const nur = await order(74, "2026-11-03T07:00:00.000Z", NUR, "confirmed",
      Array.from({ length: 12 }, (_, i) => ({ ...LIST[0], quantity: i + 1 })))
    const other = await order(75, "2026-11-04T07:00:00.000Z", ZAFAR, "confirmed", [LIST[1]], OTHER)
    const read = (providerCallId: string, numberPharmacyGuid: string | null, organizationId = ZEYTUN) =>
      lastPharmacyOrder(app as unknown as PrismaClient, { organizationId, providerCallId, numberPharmacyGuid })

    // Before the first save: the pharmacy the caller's number alone belongs to.
    const zafar = await read(callId(79), ZAFAR)
    expect(zafar).toEqual({ status: "found", number: last, orderedAt: "2026-10-28", lineCount: 3, lines: [
      { externalId: NOSPA, name: "No-şpa 2ml 40 mq № 25", quantity: 15, unit: "qutu" },
      { externalId: KETONAL, name: "Кетонал 2 мл № 10", quantity: 5, unit: "ədəd" },
    ] })
    // Once the call has an order, its pharmacy decides, not the number.
    await order(76, "2026-11-04T08:00:00.000Z", NUR, "pending_review")
    expect(await read(callId(76), ZAFAR)).toMatchObject({ status: "found", number: nur, lineCount: 12 })
    expect(((await read(callId(76), ZAFAR)) as { lines: unknown[] }).lines).toHaveLength(10)
    // The caller named another pharmacy than the number's: there is none to read.
    await order(77, "2026-11-04T08:00:00.000Z", null, "pending_review")
    expect(await read(callId(77), ZAFAR)).toEqual({ status: "pharmacy_unknown" })
    expect(await read(callId(78), null)).toEqual({ status: "pharmacy_unknown" })
    // A pharmacy without a confirmed order.
    expect(await read(callId(78), NEW)).toEqual({ status: "none" })
    // The other organization reads its own order of that GUID, never Zeytun's.
    expect(await read(callId(79), ZAFAR, OTHER)).toMatchObject({ status: "found", number: other, lineCount: 1,
      lines: [{ externalId: KETONAL, quantity: 5, unit: "ədəd" }] })
    // Today's catalog no longer has Ketonal: offered as unavailable, so the agent proposes a substitute.
    const today = (id: string) => id === NOSPA ? { externalId: NOSPA, name: "Но-шпа", listPrice: { amount: "13", per: "qutu" } } : null
    expect(historyCandidates((zafar as { lines: Parameters<typeof historyCandidates>[0] }).lines, today)).toEqual([
      { externalId: NOSPA, name: "Но-шпа", listPrice: { amount: "13", per: "qutu" }, ordered: { quantity: 15, unit: "qutu" } },
      { externalId: KETONAL, name: "Кетонал 2 мл № 10", ordered: { quantity: 5, unit: "ədəd" }, unavailable: true },
    ])
  })

  // Owner, 2026-11-04: «слух по истории аптеки» — what the calling pharmacy orders, for its call only.
  it("reads the calling pharmacy's confirmed products, never another's, nor one matched only to the words said", async () => {
    const { callPharmacy } = await import("@/lib/voice-agent/pharmacy/zeytun-pharmacy-history")
    const { confirmedOrdersSource } = await import("@/lib/voice-agent/pharmacy/zeytun-pharmacy-assortment")
    const [YASAMAL, NEAR] = [GUID(81), GUID(82)]
    await admin.company.createMany({ data: [
      { organizationId: ZEYTUN, name: "92 Yasamal", externalSource: "zeytun_1c", externalId: YASAMAL },
      { organizationId: ZEYTUN, name: "93 Yasamal", externalSource: "zeytun_1c", externalId: NEAR },
      { organizationId: OTHER, name: "92 Yasamal", externalSource: "zeytun_1c", externalId: YASAMAL },
    ] })
    const order = async (n: number, pharmacyGuid: string, identification: "phone_unique" | "named_matched", lines: Parameters<typeof save>[1]["lines"],
      status: "confirmed" | "pending_review" = "confirmed", organizationId = ZEYTUN) => {
      await save(app as unknown as PrismaClient, { organizationId, providerCallId: callId(n), callStartedAt: "2026-10-28T07:00:00.000Z",
        callerPhoneE164: PHONE, catalog: CATALOG, lines, identification, pharmacyName: "Aptek", pharmacyGuid })
      if (status === "confirmed") await admin.pharmacyPhoneOrder.updateMany({ where: { organizationId, providerCallId: callId(n) },
        data: { status, confirmedAt: new Date("2026-10-30T09:00:00.000Z") } })
    }
    // Ketonal twice, No-şpa once: the most ordered first. Unconfirmed, another pharmacy's, another organization's: not counted.
    await order(80, YASAMAL, "phone_unique", [LIST[1], LIST[0]])
    await order(81, YASAMAL, "phone_unique", [LIST[1], LIST[2]])
    await order(82, YASAMAL, "phone_unique", [LIST[0]], "pending_review")
    await order(83, NEAR, "phone_unique", [LIST[0], LIST[0]])
    await order(84, YASAMAL, "phone_unique", [LIST[0]], "confirmed", OTHER)
    const source = confirmedOrdersSource(app as unknown as PrismaClient, () => Date.parse("2026-11-04T12:00:00.000Z"))
    const products = async (providerCallId: string, numberPharmacyGuid: string | null, organizationId = ZEYTUN) => {
      const { pharmacy } = await callPharmacy(app as unknown as PrismaClient, { organizationId, providerCallId, numberPharmacyGuid })
      return pharmacy ? source.products({ organizationId, catalogScopeKey: CATALOG.scopeKey, pharmacy }) : null
    }
    // Before the first save: the number's pharmacy.
    expect(await products(callId(89), YASAMAL)).toEqual([KETONAL, NOSPA])
    expect(await products(callId(89), null)).toBeNull()
    expect(await products(callId(89), YASAMAL, OTHER)).toEqual([NOSPA])
    // The call's order named 93 Yasamal by the words alone: no pharmacy, no list — and no `history:` either.
    await order(85, NEAR, "named_matched", [LIST[1]], "pending_review")
    expect(await products(callId(85), YASAMAL)).toBeNull()
    const { lastPharmacyOrder } = await import("@/lib/voice-agent/pharmacy/zeytun-pharmacy-history")
    expect(await lastPharmacyOrder(app as unknown as PrismaClient, { organizationId: ZEYTUN, providerCallId: callId(85), numberPharmacyGuid: YASAMAL }))
      .toEqual({ status: "pharmacy_unknown" })
    // It is still the 1C pharmacy on the order, for the manager to check and send to 1C.
    expect(await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(85) } })).toMatchObject({
      pharmacyIdentification: "named_matched", pharmacyGuid: NEAR, companyId: (await admin.company.findFirstOrThrow({
        where: { organizationId: ZEYTUN, externalId: NEAR } })).id })
  })

  // Owner's queue task 10 (2026-11-07): the line calls the pharmacy back once the product it waited for is in stock.
  it("calls one pharmacy back about what arrived, only when switched on and inside voice hours, never twice", async () => {
    const waitlist = await import("@/lib/voice-agent/pharmacy/zeytun-waitlist")
    const { placeWaitlistCallback, CALLBACK_MARKER } = await import("@/lib/voice-agent/pharmacy/zeytun-waitlist-callback")
    const db = app as unknown as PrismaClient
    const [YASAMAL, SOLD] = [GUID(95), "44444444-4444-4444-8444-444444444444"]
    const channel = await admin.channelConfig.create({ data: { organizationId: ZEYTUN, channelType: "voip", configName: "Zeytun line",
      phoneNumber: "+994120000000", isActive: true, settings: { provider: "asterisk" } } })
    const grant = { id: "grant-line", organizationId: ZEYTUN, channelConfigId: channel.id, orderOrganizationId: ZEYTUN }
    const dials: { toNumber: string; correlationId: string }[] = []
    const dial = async (input: { toNumber: string; correlationId: string }) => { dials.push(input); return { success: true } }
    const now = new Date("2026-11-03T08:00:00.000Z") // Tuesday 12:00 in Baku
    await save(db, { organizationId: ZEYTUN, providerCallId: callId(95), callStartedAt: "2026-11-01T07:00:00.000Z", callerPhoneE164: PHONE,
      catalog: CATALOG, lines: [{ quantity: 5, unit: "qutu", spoken: "Adefa beş qutu" }], identification: "phone_unique",
      pharmacyName: "92 Yasamal", pharmacyGuid: YASAMAL })
    await waitlist.recordCallWaitlist(db, { organizationId: ZEYTUN, providerCallId: callId(95), catalogScopeKey: CATALOG.scopeKey,
      lines: [{ externalId: SOLD, itemCode: "00000001111", productName: "Adefa № 30", spokenText: "Adefa beş qutu", quantity: 5, unit: "qutu" }] })
    await admin.pharmacyWaitlistItem.updateMany({ where: { externalId: SOLD }, data: { arrivedAt: new Date("2026-11-03T06:00:00.000Z") } })
    // Off by default; then outside voice hours (none configured is closed).
    expect(await placeWaitlistCallback({ db, grant, dial, now })).toEqual({ status: "off" })
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: { pharmacyPhoneOrders: { waitlistCallback: { enabled: true } } } } })
    expect(await placeWaitlistCallback({ db, grant, dial, now })).toEqual({ status: "outside_hours" })
    const day = { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] }
    await admin.businessHours.create({ data: { organizationId: ZEYTUN, channelType: "voice", timezone: "Asia/Baku", isActive: true,
      schedule: { mon: day, tue: day, wed: day, thu: day, fri: day } } })
    const placed = await placeWaitlistCallback({ db, grant, dial, now })
    expect(placed).toMatchObject({ status: "placed", items: 1 })
    // The pharmacy's own number, from the order; the record first, with the marker the line's pilot reads.
    expect(dials).toEqual([expect.objectContaining({ toNumber: PHONE, correlationId: placed.providerCallId })])
    const record = await admin.callLog.findFirstOrThrow({ where: { providerCallId: placed.providerCallId } })
    expect(record).toMatchObject({ organizationId: ZEYTUN, channelConfigId: channel.id, direction: "outbound", callMode: "ai", targetPhoneE164: PHONE })
    expect((record.consentAudit as Record<string, unknown>)[CALLBACK_MARKER]).toMatchObject({ grantId: "grant-line", pharmacyGuid: YASAMAL,
      items: [{ externalId: SOLD, name: "Adefa № 30" }], test: false })
    expect(await admin.pharmacyWaitlistItem.findFirstOrThrow({ where: { externalId: SOLD } })).toMatchObject({
      callbackCallId: placed.providerCallId, callbackStatus: "placed" })
    // One call at a time; once over, nothing left to call about: never twice.
    expect(await placeWaitlistCallback({ db, grant, dial, now })).toEqual({ status: "busy" })
    await admin.callLog.updateMany({ where: { providerCallId: placed.providerCallId }, data: { endedAt: now, status: "completed" } })
    expect(await placeWaitlistCallback({ db, grant, dial, now })).toEqual({ status: "nothing_due" })
    expect(dials).toHaveLength(1)
  })

  // Owner's client, 2026-11-06: a sold-out product the pharmacy still wants waits for it; its next call hears of it first.
  it("keeps a pharmacy's sold-out products on its waiting list and offers them, then its own products, when 1C has them again", async () => {
    const waitlist = await import("@/lib/voice-agent/pharmacy/zeytun-waitlist")
    const db = app as unknown as PrismaClient
    const [YASAMAL, SOLD] = [GUID(91), "33333333-3333-4333-8333-333333333333"]
    await admin.company.createMany({ data: [
      { organizationId: ZEYTUN, name: "92 Yasamal", externalSource: "zeytun_1c", externalId: YASAMAL },
      { organizationId: OTHER, name: "92 Yasamal", externalSource: "zeytun_1c", externalId: YASAMAL },
    ] })
    const withSold = { ...CATALOG, find: (id: string) => id === SOLD
      ? { externalId: SOLD, itemCode: "00000001111", name: "Адефа № 30", nameAz: null, listPrice: { amount: "8.1", per: "qutu" } } : CATALOG.find(id) }
    const order = (n: number, at: string, lines: Parameters<typeof save>[1]["lines"], catalog = CATALOG, organizationId = ZEYTUN) =>
      save(db, { organizationId, providerCallId: callId(n), callStartedAt: at, callerPhoneE164: PHONE, catalog, lines,
        identification: "phone_unique", pharmacyName: "92 Yasamal", pharmacyGuid: YASAMAL })
    const soldLine = { externalId: SOLD, itemCode: "00000001111", productName: "Адефа № 30", spokenText: "Adefa beş qutu", quantity: 5, unit: "qutu" }
    // No-şpa confirmed long ago: the pharmacy orders it.
    await order(90, "2026-10-28T07:00:00.000Z", [LIST[0]])
    await admin.pharmacyPhoneOrder.updateMany({ where: { providerCallId: callId(90) }, data: { status: "confirmed", confirmedAt: new Date("2026-10-29T09:00:00.000Z") } })
    // On 1 November Adefa was sold out: the order keeps the words, the waiting list its 1C id.
    const saved = await order(91, "2026-11-01T07:00:00.000Z", [{ externalId: SOLD, quantity: 5, unit: "qutu", spoken: "Adefa beş qutu" }])
    expect(saved).toMatchObject({ status: "saved", notFound: ["Adefa beş qutu"] })
    await waitlist.recordCallWaitlist(db, { organizationId: ZEYTUN, providerCallId: callId(91), catalogScopeKey: CATALOG.scopeKey, lines: [soldLine] })
    await waitlist.recordCallWaitlist(db, { organizationId: OTHER, providerCallId: callId(91), catalogScopeKey: CATALOG.scopeKey, lines: [soldLine] })
    const company = await admin.company.findFirstOrThrow({ where: { organizationId: ZEYTUN, externalId: YASAMAL } })
    expect(await admin.pharmacyWaitlistItem.findMany({ where: { organizationId: ZEYTUN } })).toEqual([expect.objectContaining({
      externalId: SOLD, quantity: 5, orderId: saved.status === "saved" ? saved.orderId : null, companyId: company.id, pharmacyGuid: YASAMAL,
      pharmacyName: "92 Yasamal", arrivedAt: null })])
    // The caller took it back, then wanted it again: the list follows the call's latest save.
    await waitlist.recordCallWaitlist(db, { organizationId: ZEYTUN, providerCallId: callId(91), catalogScopeKey: CATALOG.scopeKey, lines: [] })
    expect(await admin.pharmacyWaitlistItem.count({ where: { organizationId: ZEYTUN } })).toBe(0)
    await waitlist.recordCallWaitlist(db, { organizationId: ZEYTUN, providerCallId: callId(91), catalogScopeKey: CATALOG.scopeKey, lines: [soldLine] })
    // Row-level security: each organization sees its own row only.
    expect((await waitlist.listWaitlist(db, ZEYTUN)).map(row => [row.state, row.productName, row.orderNumber]))
      .toEqual([["waiting", "Адефа № 30", saved.status === "saved" ? saved.number : null]])
    expect(await waitlist.listWaitlist(db, OTHER)).toHaveLength(1)

    // The refresh finds it in 1C again.
    expect(await waitlist.markWaitlistArrivals(db, { organizationId: ZEYTUN, catalogScopeKey: CATALOG.scopeKey, inStock: id => id === SOLD,
      now: new Date("2026-11-05T08:00:00.000Z") })).toBe(1)
    expect(await waitlist.markWaitlistArrivals(db, { organizationId: ZEYTUN, catalogScopeKey: CATALOG.scopeKey, inStock: () => true })).toBe(0)
    expect((await waitlist.listWaitlist(db, ZEYTUN))[0]).toMatchObject({ state: "arrived", arrivedAt: "2026-11-05T08:00:00.000Z" })

    // The pharmacy calls on 6 November: what it waited for first, then No-şpa, back since its last call.
    const names: Record<string, string> = { [SOLD]: "Adefa № 30", [NOSPA]: "No-şpa 2ml 40 mq № 25" }
    const offers = (providerCallId: string, numberPharmacyGuid: string | null, organizationId = ZEYTUN) => waitlist.pharmacyArrivals(db, {
      organizationId, providerCallId, callStartedAt: "2026-11-06T09:00:00.000Z", numberPharmacyGuid, catalogScopeKey: CATALOG.scopeKey,
      arrived: [{ externalId: NOSPA, arrivedAt: "2026-11-05T08:00:00.000Z", goneAt: "2026-11-02T08:00:00.000Z" },
        { externalId: KETONAL, arrivedAt: "2026-11-05T08:00:00.000Z", goneAt: null }],
      inStock: id => names[id] ? { name: names[id] } : null, now: Date.parse("2026-11-06T09:00:00.000Z") })
    expect(await offers(callId(92), YASAMAL)).toEqual([{ externalId: SOLD, name: "Adefa № 30", waited: true },
      { externalId: NOSPA, name: "No-şpa 2ml 40 mq № 25", waited: false }])
    // No pharmacy for the number: nothing. Another organization never sees this one's list (its own row names no pharmacy).
    expect(await offers(callId(92), null)).toEqual([])
    expect(await offers(callId(92), YASAMAL, OTHER)).toEqual([])

    // It ordered Adefa on that call: the list says so, and the next call is not offered it again.
    await order(92, "2026-11-06T09:00:00.000Z", [{ externalId: SOLD, quantity: 5, unit: "qutu", spoken: "Adefa beş qutu" }], withSold)
    expect((await waitlist.listWaitlist(db, ZEYTUN))[0]).toMatchObject({ state: "ordered" })
    expect((await waitlist.pharmacyArrivals(db, { organizationId: ZEYTUN, providerCallId: callId(93), callStartedAt: "2026-11-07T09:00:00.000Z",
      numberPharmacyGuid: YASAMAL, catalogScopeKey: CATALOG.scopeKey, arrived: [], inStock: id => names[id] ? { name: names[id] } : null,
      now: Date.parse("2026-11-07T09:00:00.000Z") })).map(offer => offer.externalId)).toEqual([])

    // A manager takes a row off the list through the API; another organization's row is not found.
    const row = await admin.pharmacyWaitlistItem.findFirstOrThrow({ where: { organizationId: ZEYTUN } })
    const other = await admin.pharmacyWaitlistItem.findFirstOrThrow({ where: { organizationId: OTHER } })
    const route = await import("@/app/api/v1/pharmacy-orders/waitlist/[id]/route")
    const dismiss = (id: string) => route.PATCH(json("PATCH", `/api/v1/pharmacy-orders/waitlist/${id}`, { dismissed: true }), params(id))
    expect((await dismiss(row.id)).status).toBe(200)
    expect((await dismiss(other.id)).status).toBe(404)
    expect(await admin.pharmacyWaitlistItem.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ dismissedAt: null })
    const listed = await (await import("@/app/api/v1/pharmacy-orders/waitlist/route")).GET(json("GET", "/api/v1/pharmacy-orders/waitlist"))
    expect(((await listed.json()) as { data: { state: string }[] }).data.map(item => item.state)).toEqual(["dismissed"])
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

  it("does not rewrite a pharmacy 1C sent unchanged, and still shows when 1C last confirmed each one", async () => {
    // 2026-11-09: the hourly list rewrote all 1144 of Zeytun's pharmacies only to
    // move externalSyncedAt — ~230 thousand updates a week. xmin is the row version.
    await admin.organization.update({ where: { id: ZEYTUN }, data: { modules: { mtm: true, crm: true } } })
    const versions = async () => new Map((await admin.$queryRaw<{ externalId: string; xmin: string }[]>`
      SELECT "externalId", xmin::text AS xmin FROM "companies" WHERE "externalSource" = 'zeytun_1c'`).map(row => [row.externalId, row.xmin]))
    const rewritten = (before: Map<string, string>, after: Map<string, string>) => [...after].filter(([guid, v]) => before.get(guid) !== v).map(([guid]) => guid).sort()
    const { GET: pharmaciesRoute } = await import("@/app/api/v1/pharmacy-orders/pharmacies/route")
    const companyRoute = await import("@/app/api/v1/companies/[id]/route")
    const listSyncedAt = async () => (await (await pharmaciesRoute(json("GET", "/api/v1/pharmacy-orders/pharmacies"))).json()).data.syncedAt
    const cardSyncedAt = async (guid: string) => {
      const id = await companyId(guid)
      return (await (await companyRoute.GET(json("GET", `/api/v1/companies/${id}`), params(id))).json()).data.externalSyncedAt
    }

    await sync(pharmacyRows(30), T1)
    const loaded = await versions()
    // The next hour's list, 1C unchanged: not one company row is written.
    expect(await sync(pharmacyRows(30), T2)).toEqual({ created: 0, updated: 0, removed: 0, returned: 0, removalsHeld: 0, linkedOrders: 0 })
    expect(rewritten(loaded, await versions())).toEqual([])
    // The screens still say 1C confirmed them at T2.
    expect(await listSyncedAt()).toBe(T2.toISOString())
    expect(await cardSyncedAt(GUID(5))).toBe(T2.toISOString())

    // 1C renamed one and closed another: only those two rows are written.
    const before = await versions()
    expect(await sync(pharmacyRows(29, { 1: "Aptek Bir" }), T3)).toMatchObject({ updated: 1, removed: 1 })
    expect(rewritten(before, await versions())).toEqual([GUID(1), GUID(30)].sort())
    expect(await cardSyncedAt(GUID(1))).toBe(T3.toISOString())
    expect(await cardSyncedAt(GUID(5))).toBe(T3.toISOString())
    // The closed one was last seen in the T2 list, not when it was created.
    expect(await admin.company.findFirstOrThrow({ where: { externalId: GUID(30) } })).toMatchObject({ externalSyncedAt: T2, externalRemovedAt: T3 })
    expect(await cardSyncedAt(GUID(30))).toBe(T2.toISOString())

    // A list too short to trust: the listed ones were seen at T4, the held ones only at T3.
    expect(await sync(pharmacyRows(7, { 1: "Aptek Bir" }), T4)).toMatchObject({ removed: 0, removalsHeld: 22 })
    expect(await cardSyncedAt(GUID(5))).toBe(T4.toISOString())
    expect(await cardSyncedAt(GUID(20))).toBe(T3.toISOString())
    expect(await listSyncedAt()).toBe(T4.toISOString())
    // An older list read late does not take the time back.
    await sync(pharmacyRows(29, { 1: "Aptek Bir" }), T1)
    expect(await cardSyncedAt(GUID(20))).toBe(T3.toISOString())
    expect(await admin.systemJobCursor.findUniqueOrThrow({ where: { name: `pharmacy-companies-list:${ZEYTUN}` } })).toMatchObject({ cursor: T3.toISOString() })
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
    // The caller confirmed the order: the agent's last save is final (the same lines).
    await save(app as unknown as PrismaClient, { organizationId: ZEYTUN, providerCallId: callId(41), callStartedAt: "2026-10-24T06:42:00.000Z",
      callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG, lines: LIST, final: true })
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(41) } })
    expect(order.finishedOnCallAt).not.toBeNull()
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

  // Owner's call 2026-11-03: he hung up mid-order, annoyed, and the pharmacy got
  // "your order is received" on WhatsApp as if he had ordered.
  it("sends the pharmacy nothing for a call that broke off, and its list once the final save arrives", async () => {
    const { announceCallOrder } = await import("@/lib/pharmacy-orders/manager-notice")
    const send = (seq: number, extra: { final?: boolean; afterCall?: boolean } = {}) => save(app as unknown as PrismaClient, {
      organizationId: ZEYTUN, providerCallId: callId(61), callStartedAt: "2026-10-24T06:42:00.000Z",
      callerPhoneE164: PHONE, identification: "test_call", catalog: CATALOG, lines: LIST.slice(0, 2), seq, ...extra })
    await send(1)
    await send(2)
    const sender = async () => ({ id: "ch", organizationId: ZEYTUN, accessToken: "token", phoneNumberId: "pn1",
      businessAccountId: null, verifyToken: null, appSecret: null, displayName: null })
    const sent: Array<{ to: string; template: { name: string } }> = []
    const fetchOk = (async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 })
    }) as unknown as typeof fetch
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: { pharmacyPhoneOrders: { managerWhatsApp: ["+994501112233"] } } } })
    const announce = () => announceCallOrder(app as unknown as PrismaClient, ZEYTUN, callId(61), { fetch: fetchOk, sender })
    // The call broke off: the managers have the list to look at, the pharmacy hears nothing.
    expect(await announce()).toEqual({ manager: expect.objectContaining({ status: "sent" }), pharmacy: null })
    expect(sent.map(message => message.template.name)).toEqual(["phone_order_new"])
    // «Слать с пометкой»: the managers read that the call broke off before a confirmation.
    const notice = sent[0] as unknown as { template: { components: Array<{ parameters: Array<{ text: string }> }> } }
    expect(notice.template.components[0].parameters[0].text).toBe("TS-1001 (zəng yarımçıq qaldı, sifariş təsdiqlənməyib)")
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(61) } })
    expect([order.finishedOnCallAt, order.pharmacyReceipt]).toEqual([null, null])
    // The final save the station still held arrives after the call, behind a later seq: the order is finished then.
    await send(4)
    expect(await send(3, { final: true, afterCall: true })).toMatchObject({ status: "saved", changed: false })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).finishedOnCallAt).not.toBeNull()
    expect((await announce())?.pharmacy).toMatchObject({ status: "sent" })
    expect(sent.map(message => message.template.name)).toEqual(["phone_order_new", "phone_order_received"])
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: {} } })
  })

  // Owner's call 2026-10-31: asked to cancel, the agent said goodbye and the order went to the managers.
  it("cancels the call's order for the pharmacy: no later save, no WhatsApp, and never what a manager decided", async () => {
    const { cancelPhoneOrderFromCall } = await import("@/lib/voice-agent/pharmacy/phone-orders")
    const { announceCallOrder } = await import("@/lib/pharmacy-orders/manager-notice")
    const cancel = (orgId: string, n: number, seq?: number) =>
      cancelPhoneOrderFromCall(app as unknown as PrismaClient, { organizationId: orgId, providerCallId: callId(n), seq })
    await saveCall(51, LIST)
    expect(await cancel(ZEYTUN, 51, 4)).toEqual({ status: "cancelled", number: 1001 })
    const row = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(51) } })
    expect([row.status, row.rejectReason, row.rejectedById, row.stationSeq]).toEqual(["rejected", "caller_cancelled", null, 4])
    expect(row.rejectedAt).not.toBeNull()
    // A save of the call that arrives later (the station's spool, a reply in flight) changes nothing.
    expect(await saveCall(51, [LIST[0]])).toEqual({ status: "already_reviewed", number: 1001 })
    expect(await admin.pharmacyPhoneOrderLine.count({ where: { orderId: row.id } })).toBe(3)
    // Asked again, it is still the pharmacy's cancel.
    expect(await cancel(ZEYTUN, 51)).toEqual({ status: "cancelled", number: 1001 })
    // The end of the call tells nobody.
    const sent: unknown[] = []
    const fetchAny = (async (_url: string, init: { body: string }) => {
      sent.push(init.body)
      return new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 })
    }) as unknown as typeof fetch
    const sender = async () => ({ id: "ch", organizationId: ZEYTUN, accessToken: "token", phoneNumberId: "pn1",
      businessAccountId: null, verifyToken: null, appSecret: null, displayName: null })
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: { pharmacyPhoneOrders: { managerWhatsApp: ["+994501112233"] } } } })
    expect(await announceCallOrder(app as unknown as PrismaClient, ZEYTUN, callId(51), { fetch: fetchAny, sender })).toBeNull()
    expect(sent).toEqual([])
    await admin.organization.update({ where: { id: ZEYTUN }, data: { settings: {} } })
    // A call without an order has nothing to cancel, and nothing is created.
    expect(await cancel(ZEYTUN, 52)).toEqual({ status: "cancelled", number: null })
    expect(await admin.pharmacyPhoneOrder.count({ where: { providerCallId: callId(52) } })).toBe(0)
    // What a manager decided stays, and another organization reaches nothing of Zeytun's.
    await saveCall(53, LIST)
    await admin.pharmacyPhoneOrder.updateMany({ where: { providerCallId: callId(53) },
      data: { status: "confirmed", confirmedAt: new Date(), confirmedById: "user-zeytun" } })
    expect(await cancel(ZEYTUN, 53)).toEqual({ status: "already_reviewed", number: 1002 })
    expect(await cancel(OTHER, 53)).toEqual({ status: "cancelled", number: null })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(53) } })).status).toBe("confirmed")
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

  // Owner, 2026-10-30: the manager downloads the same PDF from the card, to forward it by hand.
  it("lets the manager download the order's PDF, and nobody else's", async () => {
    const { GET: pdfRoute } = await import("@/app/api/v1/pharmacy-orders/[id]/export/pdf/route")
    await saveCall(53, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(53) } })
    const response = await pdfRoute(json("GET", `/api/v1/pharmacy-orders/${order.id}/export/pdf`), params(order.id))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("Sifariş TS-1001.pdf")}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-")
    // An order of another organization is not found, even by its id and with the feature on.
    await admin.organization.update({ where: { id: OTHER }, data: { features: ["mtm", "sales", "pharmacy_phone_orders"] } })
    session.current = { user: { id: "user-other", organizationId: OTHER, role: "admin", email: "a@other.test", name: "Other" } }
    expect((await pdfRoute(json("GET", `/api/v1/pharmacy-orders/${order.id}/export/pdf`), params(order.id))).status).toBe(404)
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

  /* ─── Zeytun's 1C takes the confirmed order ───────────────────────── */

  const WAREHOUSE = "33333333-4444-4555-8666-777777777777"
  const PHARMACY = "55555555-6666-4777-8888-999999999999"
  const CREATE = "https://1c.zeytun.test/hs/orders/CreateOrder"
  const STATUS = "https://1c.zeytun.test/hs/orders/OrderStatus"
  const BALANCES = { organizationId: ZEYTUN, endpoint: "https://1c.zeytun.test/hs/AvailableBalances", username: "crm", password: "catalog-pw",
    request: { GUID: "44444444-5555-4666-8777-888888888888", METRO: false, Warehouse: WAREHOUSE } }
  /** The private directory beside the line's grant, as on the host: 0700, files 0600. */
  async function withErp(orders: Record<string, unknown> | null, run: (scopeKey: string) => Promise<void>) {
    const { zeytunBalanceScopeKey } = await import("@/lib/voice-agent/pharmacy/zeytun-balance-client")
    const directory = mkdtempSync(path.join(tmpdir(), "zeytun-erp-"))
    writeFileSync(path.join(directory, "zeytun-1c-connection.json"), JSON.stringify(BALANCES), { mode: 0o600 })
    if (orders) writeFileSync(path.join(directory, "zeytun-1c-orders.json"), JSON.stringify(orders), { mode: 0o600 })
    process.env.ZEYTUN_INBOUND_PILOT_FILE = path.join(directory, "inbound-grant.json")
    erp.calls.length = 0
    try { await run(zeytunBalanceScopeKey(BALANCES)) } finally {
      delete process.env.ZEYTUN_INBOUND_PILOT_FILE
      erp.answer = () => "no_answer"
      rmSync(directory, { recursive: true, force: true })
    }
  }
  const ORDERS = { organizationId: ZEYTUN, createEndpoint: CREATE, statusEndpoint: STATUS, username: "crm-orders", password: "orders-pw" }
  const saveForErp = (n: number, scopeKey: string, lines: Parameters<typeof save>[1]["lines"]) => save(app as unknown as PrismaClient, {
    organizationId: ZEYTUN, providerCallId: callId(n), callStartedAt: "2026-10-24T06:42:00.000Z", callerPhoneE164: PHONE,
    identification: "phone_unique", pharmacyName: "Nur Aptek", pharmacyGuid: PHARMACY, pharmacyAddress: "Bakı, Yasamal",
    catalog: { ...CATALOG, scopeKey }, lines,
  })
  const opened = async (id: string) => (await (await card.GET(json("GET", `/api/v1/pharmacy-orders/${id}`), params(id))).json()).data

  // Owner, 2026-10-30: «давай с нашей стороны сделаем» — confirm sends the order to 1C.
  it("confirms an order only once 1C has written it, shows a refusal line by line, and records what the manager changed", async () => {
    await withErp(ORDERS, async scopeKey => {
      await saveForErp(60, scopeKey, [LIST[0], LIST[1]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(60) }, include: { lines: { orderBy: { position: "asc" } } } })
      expect((await opened(order.id)).erp).toMatchObject({ connection: "on", state: null })

      // Five pieces of a product 1C sells by the box cannot go: 1C posts what it gets.
      const unit = await patch(order.id, { action: "confirm", revision: 1 })
      expect([unit.status, (await unit.json()).error]).toEqual([400, "erp_unit"])
      expect(erp.calls).toHaveLength(0)
      expect((await patch(order.id, { action: "remove_line", revision: 1, lineId: order.lines[1].id })).status).toBe(200)
      expect((await patch(order.id, { action: "set_quantity", revision: 2, lineId: order.lines[0].id, quantity: 12 })).status).toBe(200)

      // 1C refuses and writes nothing: the order waits, with each line's reason.
      erp.answer = () => ({ status: 200, json: { code: 1, Ошибки: [{ Код: "нет_остатка", Номенклатура: NOSPA.toUpperCase(), Текст: "Qalıq 8" }] } })
      const refused = (await (await patch(order.id, { action: "confirm", revision: 3 })).json()).data
      expect(refused).toMatchObject({ status: "pending_review", confirmedAt: null,
        erp: { state: "refused", errors: [{ code: "нет_остатка", position: 1, text: "Qalıq 8" }] } })
      expect(erp.calls).toHaveLength(1)
      expect(erp.calls[0]).toEqual({ url: CREATE, authorization: `Basic ${Buffer.from("crm-orders:orders-pw").toString("base64")}`, body: {
        ВнешнийИД: order.id, ВнешнийНомер: "TS-1001", GUID: PHARMACY, METRO: false, Warehouse: WAREHOUSE, Дата: "20261024104200",
        Комментарий: "Телефонный заказ TS-1001. Подтвердил: Nigar", Товары: [{ Номенклатура: NOSPA, Количество: 12, Цена: 12.5 }] } })
      expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).pharmacyNotice).toBeNull()

      // The manager fixes the line and confirms again; 1C writes its own price.
      expect((await patch(order.id, { action: "set_quantity", revision: refused.revision, lineId: order.lines[0].id, quantity: 8 })).status).toBe(200)
      erp.answer = () => ({ status: 200, json: { code: 0, data: { Создан: true,
        Документ: { Guid: "doc-1", Номер: "ЗК-000123", Дата: "20261030120000", Сумма: 98.4 },
        Товары: [{ Номенклатура: NOSPA, Количество: 8, Цена: 12.3, Сумма: 98.4 }] } } })
      const confirmed = (await (await patch(order.id, { action: "confirm", revision: refused.revision + 1 })).json()).data
      expect(confirmed).toMatchObject({ status: "confirmed", confirmedBy: "Nigar", edits: 3, erp: { state: "created",
        document: { guid: "doc-1", number: "ЗК-000123", total: "98.40", existing: false },
        differences: [{ position: 1, sentQuantity: 8, quantity: 8, sentPrice: "12.5000", price: "12.30" }] } })
      expect(erp.calls).toHaveLength(2)
      const row = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })
      expect((row.managerEdits as Array<Record<string, unknown>>).map(edit => [edit.action, edit.position, edit.from, edit.to, edit.by])).toEqual([
        ["remove_line", 2, KETONAL, undefined, "user-zeytun"], ["set_quantity", 1, 10, 12, "user-zeytun"], ["set_quantity", 1, 12, 8, "user-zeytun"]])
      // Confirmed in 1C: nothing changes it any more.
      expect((await patch(order.id, { action: "set_quantity", revision: confirmed.revision, lineId: order.lines[0].id, quantity: 1 })).status).toBe(409)
    })
  })

  it("never writes an order twice: after no clear answer it freezes the order and asks 1C before anything else", async () => {
    await withErp(ORDERS, async scopeKey => {
      await saveForErp(61, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(61) }, include: { lines: true } })
      // The create times out and 1C does not have it yet: maybe still on its way.
      erp.answer = url => url === CREATE ? "no_answer" : { status: 200, json: { code: 0, data: { Найден: false } } }
      const unknown = (await (await patch(order.id, { action: "confirm", revision: 1 })).json()).data
      expect(unknown).toMatchObject({ status: "pending_review", erp: { state: "unknown", error: "no_answer" } })
      expect(erp.calls.map(call => call.url)).toEqual([CREATE, STATUS])
      expect(erp.calls[1].body).toEqual({ ВнешнийИД: order.id })
      // Frozen: the lines 1C may hold are not changed, and the order is not rejected behind 1C's back.
      for (const action of [{ action: "set_quantity", lineId: order.lines[0].id, quantity: 3 }, { action: "reject", reason: "Dublikat" }]) {
        const response = await patch(order.id, { ...action, revision: unknown.revision })
        expect([response.status, (await response.json()).error]).toEqual([409, "erp_pending"])
      }
      // A late save from the call does not change the lines under 1C either.
      expect(await saveForErp(61, scopeKey, [{ ...LIST[0], quantity: 99 }])).toMatchObject({ status: "already_reviewed" })
      expect((await admin.pharmacyPhoneOrderLine.findFirstOrThrow({ where: { orderId: order.id } })).quantity).toBe(10)
      // Without the connection nobody can ask 1C, so the order is not confirmed in CRM alone.
      const file = path.join(path.dirname(process.env.ZEYTUN_INBOUND_PILOT_FILE!), "zeytun-1c-orders.json")
      const connection = readFileSync(file)
      rmSync(file)
      const offline = await patch(order.id, { action: "confirm", revision: unknown.revision })
      expect([offline.status, (await offline.json()).error]).toEqual([503, "erp_unavailable"])
      writeFileSync(file, connection, { mode: 0o600 })
      // The next click asks first: 1C has it, so nothing is created again.
      erp.answer = url => url === STATUS ? { status: 200, json: { code: 0, data: { Найден: true, Документ: { Guid: "doc-2", Номер: "ЗК-000124" } } } }
        : { status: 500 }
      const settled = (await (await patch(order.id, { action: "confirm", revision: unknown.revision })).json()).data
      expect(settled).toMatchObject({ status: "confirmed", erp: { state: "created", document: { number: "ЗК-000124", existing: true }, differences: [] } })
      expect(erp.calls.map(call => call.url)).toEqual([CREATE, STATUS, STATUS])

      // A send in flight is not doubled by a second click; one its process left behind is asked about.
      await saveForErp(62, scopeKey, [LIST[0]])
      const other = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(62) } })
      await admin.pharmacyPhoneOrder.update({ where: { id: other.id }, data: { erpState: "sending", erpAttemptAt: new Date() } })
      expect((await (await patch(other.id, { action: "confirm", revision: 1 })).json()).error).toBe("erp_pending")
      await admin.pharmacyPhoneOrder.update({ where: { id: other.id }, data: { erpAttemptAt: new Date(Date.now() - 5 * 60_000) } })
      erp.answer = url => url === STATUS ? { status: 200, json: { code: 0, data: { Найден: false } } }
        : { status: 200, json: { code: 0, data: { Создан: true, Документ: { Guid: "doc-3", Номер: "ЗК-000125" } } } }
      expect((await (await patch(other.id, { action: "confirm", revision: 1 })).json()).data).toMatchObject({ status: "confirmed",
        erp: { document: { number: "ЗК-000125" } } })
      expect(erp.calls.slice(3).map(call => call.url)).toEqual([STATUS, CREATE])
    })
  })

  it("does not quietly skip 1C when its connection is set up wrongly, and works as before without one", async () => {
    // Plain HTTP: the document is posted on arrival, so the method is called over HTTPS only.
    await withErp({ ...ORDERS, createEndpoint: "http://1c.zeytun.test/hs/orders/CreateOrder" }, async scopeKey => {
      await saveForErp(63, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(63) } })
      expect((await opened(order.id)).erp.connection).toBe("broken")
      const response = await patch(order.id, { action: "confirm", revision: 1 })
      expect([response.status, (await response.json()).error]).toEqual([503, "erp_unavailable"])
      expect(erp.calls).toHaveLength(0)
    })
    // A wrong login is a refusal that wrote nothing, not a "maybe".
    await withErp(ORDERS, async scopeKey => {
      await saveForErp(64, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(64) } })
      erp.answer = () => ({ status: 401 })
      expect((await (await patch(order.id, { action: "confirm", revision: 1 })).json()).data).toMatchObject({ status: "pending_review",
        erp: { state: "refused", errors: [{ code: "http_401", position: null }] } })
    })
    // No order connection: «Подтвердить» confirms in CRM alone, as before.
    await withErp(null, async scopeKey => {
      await saveForErp(65, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(65) } })
      expect((await (await patch(order.id, { action: "confirm", revision: 1 })).json()).data).toMatchObject({ status: "confirmed",
        erp: { connection: "off", state: null } })
      expect(erp.calls).toHaveLength(0)
    })
  })

  /* ─── The same work by voice (этап 5, owner 2026-11-10) ───────────── */

  /** What the voice receipt does on «Подтвердить»: the command inside its own transaction, effects after commit. */
  async function byVoice(actionType: Parameters<typeof import("@/lib/crm-commands/phone-order/phone-order-voice").runVoicePhoneOrderCommand>[1],
    payload: Record<string, unknown>) {
    const { runVoicePhoneOrderCommand } = await import("@/lib/crm-commands/phone-order/phone-order-voice")
    const { runWithTenant } = await import("@/lib/rls-context")
    const effects: Array<() => void | Promise<void>> = []
    const actor = { organizationId: ZEYTUN, userId: "user-zeytun", role: "admin" as const, source: "voice" as const }
    const result = await runWithTenant(ZEYTUN, () => app.$transaction(tx =>
      runVoicePhoneOrderCommand(actor, actionType, payload, { transaction: tx, postCommitEffects: effects })))
    return { result, effects }
  }

  it("changes a line by voice under the order's revision, and a draft the order outgrew writes nothing", async () => {
    await saveCall(70, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(70) }, include: { lines: { orderBy: { position: "asc" } } } })
    // The third line was never found: by voice the manager puts No-şpa on it and sets the count.
    const nospa = CATALOG.find(NOSPA)!
    await byVoice("update_phone_order_line", { orderId: order.id, revision: 1, lineId: order.lines[2].id, quantity: 2,
      externalId: NOSPA, itemCode: nospa.itemCode, productName: nospa.nameAz, sourceName: nospa.name, unitPrice: "12.5" })
    const after = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id }, include: { lines: { orderBy: { position: "asc" } } } })
    expect([after.revision, after.totalAmount?.toFixed(2)]).toEqual([3, "150.00"])
    expect([after.lines[2].status, after.lines[2].externalId, after.lines[2].quantity, after.lines[2].lineTotal?.toFixed(2)])
      .toEqual(["resolved", NOSPA, 2, "25.00"])
    expect((after.managerEdits as Array<Record<string, unknown>>).map(edit => [edit.action, edit.position, edit.by]))
      .toEqual([["pick_product", 3, "user-zeytun"], ["set_quantity", 3, "user-zeytun"]])

    // The receipt was prepared at revision 1; the order is at 3 now. Nothing is written.
    await expect(byVoice("update_phone_order_line", { orderId: order.id, revision: 1, lineId: order.lines[0].id, quantity: 99 }))
      .rejects.toMatchObject({ code: "STALE_WRITE", status: 409 })
    // A price the receipt showed that 1C no longer has: refused, not written at today's price.
    await expect(byVoice("update_phone_order_line", { orderId: order.id, revision: 3, lineId: order.lines[0].id,
      externalId: NOSPA, itemCode: nospa.itemCode, productName: nospa.nameAz, sourceName: nospa.name, unitPrice: "11.0" }))
      .rejects.toMatchObject({ code: "STALE_WRITE" })
    expect((await admin.pharmacyPhoneOrderLine.findFirstOrThrow({ where: { id: order.lines[0].id } })).quantity).toBe(10)
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).revision).toBe(3)

    // Add and remove a line, as the card does.
    await byVoice("add_phone_order_line", { orderId: order.id, revision: 3, externalId: NOSPA, itemCode: nospa.itemCode,
      productName: nospa.nameAz, sourceName: nospa.name, unitPrice: "12.5", quantity: 1, unit: "qutu" })
    await byVoice("remove_phone_order_line", { orderId: order.id, revision: 4, lineId: order.lines[1].id })
    const lines = await admin.pharmacyPhoneOrderLine.findMany({ where: { orderId: order.id }, orderBy: { position: "asc" } })
    expect(lines.map(line => [line.position, line.externalId, line.quantity])).toEqual([[1, NOSPA, 10], [3, NOSPA, 2], [4, NOSPA, 1]])
  })

  it("does not change an order by voice while its call is on the line, nor one of another organization", async () => {
    await saveCall(71, LIST)
    const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(71) }, include: { lines: true } })
    await admin.callLog.create({ data: { organizationId: ZEYTUN, provider: "asterisk", providerCallId: callId(71), direction: "inbound",
      fromNumber: PHONE, toNumber: "+994120000000", status: "in_progress", startedAt: new Date() } })
    await expect(byVoice("remove_phone_order_line", { orderId: order.id, revision: 1, lineId: order.lines[0].id }))
      .rejects.toMatchObject({ code: "CONFLICT", safeDetails: { reason: "call_in_progress" } })
    await admin.callLog.deleteMany({})
    const { runVoicePhoneOrderCommand } = await import("@/lib/crm-commands/phone-order/phone-order-voice")
    const { runWithTenant } = await import("@/lib/rls-context")
    await expect(runWithTenant(OTHER, () => app.$transaction(tx => runVoicePhoneOrderCommand(
      { organizationId: OTHER, userId: "user-other", role: "admin", source: "voice" }, "confirm_phone_order",
      { orderId: order.id, revision: 1 }, { transaction: tx, postCommitEffects: [] })))).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).revision).toBe(1)
  })

  it("confirms by voice without 1C in the receipt's transaction, and tells the pharmacy only after it commits", async () => {
    await withErp(null, async scopeKey => {
      await saveForErp(72, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(72) } })
      const { effects } = await byVoice("confirm_phone_order", { orderId: order.id, revision: 1 })
      expect(await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).toMatchObject({
        status: "confirmed", confirmedById: "user-zeytun", erpState: null, pharmacyNotice: null })
      // The WhatsApp to the pharmacy waits for the commit: one effect, not yet run.
      expect(effects).toHaveLength(1)
      const { finishVoicePhoneOrderConfirm } = await import("@/lib/crm-commands/phone-order/phone-order-voice")
      const { runWithTenant } = await import("@/lib/rls-context")
      expect(await runWithTenant(ZEYTUN, () => finishVoicePhoneOrderConfirm(ZEYTUN, "user-zeytun", order.id))).toEqual({ erp: "none" })
    })
  })

  it("claims the 1C send with the receipt, sends it after the commit, and a rolled-back receipt claims nothing", async () => {
    await withErp(ORDERS, async scopeKey => {
      await saveForErp(73, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(73) } })
      const { runVoicePhoneOrderCommand, finishVoicePhoneOrderConfirm } = await import("@/lib/crm-commands/phone-order/phone-order-voice")
      const { runWithTenant } = await import("@/lib/rls-context")

      // The receipt's transaction fails after the claim (its own result could not be stored): the order stays untouched.
      await expect(runWithTenant(ZEYTUN, () => app.$transaction(async tx => {
        await runVoicePhoneOrderCommand({ organizationId: ZEYTUN, userId: "user-zeytun", role: "admin", source: "voice" },
          "confirm_phone_order", { orderId: order.id, revision: 1 }, { transaction: tx, postCommitEffects: [] })
        throw new Error("receipt result lost")
      }))).rejects.toThrow("receipt result lost")
      expect(await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).toMatchObject({ erpState: null, revision: 1 })
      expect(erp.calls).toHaveLength(0)

      // The receipt commits: the order is claimed, nothing sent yet, the screen cannot send it a second time.
      const { effects } = await byVoice("confirm_phone_order", { orderId: order.id, revision: 1 })
      expect(effects).toHaveLength(0)
      const claimed = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })
      expect([claimed.status, claimed.erpState, claimed.revision]).toEqual(["pending_review", "sending", 2])
      expect(erp.calls).toHaveLength(0)
      expect((await (await patch(order.id, { action: "confirm", revision: 2 })).json()).error).toBe("erp_pending")

      // After the commit: 1C is asked first, then writes the document; the order is confirmed by the voice user.
      erp.answer = url => url === STATUS ? { status: 200, json: { code: 0, data: { Найден: false } } }
        : { status: 200, json: { code: 0, data: { Создан: true, Документ: { Guid: "doc-v", Номер: "ЗК-000200" } } } }
      expect(await runWithTenant(ZEYTUN, () => finishVoicePhoneOrderConfirm(ZEYTUN, "user-zeytun", order.id)))
        .toEqual({ erp: "created", document: expect.objectContaining({ number: "ЗК-000200" }) })
      expect(erp.calls.map(call => call.url)).toEqual([STATUS, CREATE])
      expect(await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).toMatchObject({
        status: "confirmed", erpState: "created", confirmedById: "user-zeytun" })
      // A second finish (a replayed receipt) sends nothing more.
      expect(await runWithTenant(ZEYTUN, () => finishVoicePhoneOrderConfirm(ZEYTUN, "user-zeytun", order.id)))
        .toMatchObject({ erp: "created" })
      expect(erp.calls).toHaveLength(2)
    })
  })

  it("does not reject by voice an order 1C may already hold", async () => {
    await withErp(ORDERS, async scopeKey => {
      await saveForErp(74, scopeKey, [LIST[0]])
      const order = await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { providerCallId: callId(74) } })
      await admin.pharmacyPhoneOrder.update({ where: { id: order.id }, data: { erpState: "unknown" } })
      await expect(byVoice("reject_phone_order", { orderId: order.id, revision: 1, reason: "Dublikat" }))
        .rejects.toMatchObject({ code: "CONFLICT", safeDetails: { reason: "erp_pending" } })
      expect((await admin.pharmacyPhoneOrder.findFirstOrThrow({ where: { id: order.id } })).status).toBe("pending_review")
    })
  })
})
