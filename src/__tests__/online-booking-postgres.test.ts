/**
 * Online booking against a real Postgres: the public page, a booking, its
 * cancellation, and the settings API.
 *
 * Stood in for: Google Calendar (no calendar connected) and outgoing e-mail.
 * Everything else is real — the routes, the RLS wrappers, the transaction
 * with its per-host advisory lock, the partial unique index.
 *
 * What only a database can show:
 *  - eight customers pressing «Book» on the same time get one meeting;
 *  - two pages of the same host, whose meetings overlap but start at
 *    different times (a 60-minute and a 30-minute one), still give one
 *    meeting — the unique index cannot see that, the lock must;
 *  - a booked time leaves the page and comes back when cancelled.
 *
 * Set ONLINE_BOOKING_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55500:5432 postgres:16
 *   ONLINE_BOOKING_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55500/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Online booking database gate»), where
 * `ONLINE_BOOKING_DB_GATE=required` turns a missing URL into a failure.
 */
import type { Prisma as GeneratedPrisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.ONLINE_BOOKING_TEST_DATABASE_URL
if (!adminUrl && process.env.ONLINE_BOOKING_DB_GATE === "required") {
  throw new Error("ONLINE_BOOKING_TEST_DATABASE_URL is required by the online booking database gate")
}

const scratch = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test"
  const admin = process.env.ONLINE_BOOKING_TEST_DATABASE_URL
  if (!admin) return null
  const name = `online_booking_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[] }))
const calendar = vi.hoisted(() => ({ update: vi.fn(), insert: vi.fn(), remove: vi.fn() }))

vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/google-calendar", () => ({
  getGoogleCalendarClient: vi.fn(async () => ({ events: { update: calendar.update, insert: calendar.insert, delete: calendar.remove } })),
  listBusyIntervals: vi.fn(async () => null),
  createCalendarEvent: vi.fn(async () => { throw new Error("Google Calendar not connected") }),
  deleteCalendarEvent: vi.fn(async () => {}),
}))
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async (input: { to: string; subject: string }) => {
    mail.sent.push({ to: input.to, subject: input.subject })
    return { success: true }
  }),
}))

const ROOT = process.cwd()
const ORG = "org-booking"
const OTHER_ORG = "org-booking-other"
const HOST_A = "user-host-a"
const HOST_B = "user-host-b"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "online-booking-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

function signIn(role: string, organizationId = ORG) {
  session.current = { user: { id: `user-${role}-${organizationId}`, organizationId, role, email: `${role}@example.com`, name: role } }
}

const json = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
})
const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) })
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) })

/** Every day, around the clock — so the suite finds free time whenever it runs. */
const ALL_DAY = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [{ start: "00:00", end: "23:30" }]]))

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("online booking on a real Postgres", () => {
  let prisma!: PrismaClient
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let pageGet!: typeof import("@/app/api/v1/public/booking/[slug]/route").GET
  let pagePost!: typeof import("@/app/api/v1/public/booking/[slug]/route").POST
  let cancelGet!: typeof import("@/app/api/v1/public/booking/cancel/[token]/route").GET
  let cancelPost!: typeof import("@/app/api/v1/public/booking/cancel/[token]/route").POST
  let settingsGet!: typeof import("@/app/api/v1/booking-pages/route").GET
  let settingsPost!: typeof import("@/app/api/v1/booking-pages/route").POST
  let meetingsGet!: typeof import("@/app/api/v1/bookings/route").GET
  let meetingGet!: typeof import("@/app/api/v1/bookings/[id]/route").GET
  let actionsPost!: typeof import("@/app/api/v1/bookings/[id]/actions/route").POST
  let grantsPut!: typeof import("@/app/api/v1/bookings/coordinators/route").PUT
  let drain!: typeof import("@/lib/booking/effect-worker").drainBookingEffects
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma as PrismaClient
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    await bypass(async () => {
      for (const id of [ORG, OTHER_ORG]) {
        await prisma.organization.create({ data: { id, name: `Org ${id}`, slug: id, modules: { crm: true, sales: true, settings: true }, settings: { timezone: "Asia/Baku" } } })
      }
      await prisma.user.createMany({
        data: [
          { id: HOST_A, organizationId: ORG, email: "a@example.test", name: "Leyla", passwordHash: "-", role: "manager" },
          { id: HOST_B, organizationId: ORG, email: "b@example.test", name: "Anar", passwordHash: "-", role: "manager" },
          { id: `user-admin-${ORG}`, organizationId: ORG, email: "admin@example.test", name: "Admin", passwordHash: "-", role: "admin" },
          { id: `user-admin-${OTHER_ORG}`, organizationId: OTHER_ORG, email: "admin2@example.test", name: "Admin 2", passwordHash: "-", role: "admin" },
        ],
      })
    })
    // Only in this newly created scratch DB: replace the empty booking subset
    // with its original schema, then apply both actual forward migrations.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `DROP TABLE IF EXISTS booking_change_notes, booking_integration_bindings, booking_secrets, booking_coordinator_grants, bookings, booking_pages CASCADE;`)
    for (const migration of ["20261101090000_online_booking", "20261102090000_booking_workspace", "20261102100000_booking_commands"]) {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, readFileSync(path.join(ROOT, `prisma/migrations/${migration}/migration.sql`), "utf8"))
      if (migration === "20261101090000_online_booking") {
        prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `
          INSERT INTO booking_pages (id, "organizationId", slug, title, "bufferMinutes", "hostIds", weekly, "updatedAt")
          VALUES ('legacy-buffer-page', '${ORG}', 'legacy-buffer-test', 'Legacy buffer', 20, ARRAY['${HOST_A}'], '${JSON.stringify(ALL_DAY)}'::jsonb, CURRENT_TIMESTAMP);
          INSERT INTO bookings (id, "organizationId", "bookingPageId", "hostUserId", "startsAt", "endsAt", name, phone, "cancelTokenHash", "updatedAt")
          VALUES ('legacy-buffer-booking', '${ORG}', 'legacy-buffer-page', '${HOST_A}', '2035-01-01 08:00:00', '2035-01-01 08:30:00', 'Legacy client', '+994500000006', '${"f".repeat(64)}', CURRENT_TIMESTAMP);
        `)
      }
    }
    // Prove the expand release still accepts never-canonical legacy writes.
    // Then test backend A against the exact future B enforcement contract.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `
      UPDATE bookings SET name = name WHERE id = 'legacy-buffer-booking';
      INSERT INTO bookings (id, "organizationId", "bookingPageId", "hostUserId", "startsAt", "endsAt", name, phone, "cancelTokenHash", "updatedAt")
      VALUES ('expansion-zero-probe', '${ORG}', 'legacy-buffer-page', '${HOST_A}', '2035-01-02 08:00:00', '2035-01-02 08:30:00', 'Legacy probe', '+994500000009', '${"a".repeat(64)}', CURRENT_TIMESTAMP);
      DELETE FROM bookings WHERE id='expansion-zero-probe';
    `)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env,
      readFileSync(path.join(ROOT, "scripts/ci/fixtures/booking-enforcement/migration.sql"), "utf8"))

    // Run the actual canonical ledger DDL, including attempt/state/append-only guards.
    // These tables are dropped only in this scratch database, before canonical events/effects exist.
    const foundation = readFileSync(path.join(ROOT, "prisma/migrations/20260901090000_event_platform_foundation/migration.sql"), "utf8")
    const tables = [...foundation.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => `"${match[1]}"`)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `DROP TABLE IF EXISTS ${tables.join(",")} CASCADE;`)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leaddrive_effect_operator') THEN CREATE ROLE leaddrive_effect_operator NOLOGIN; END IF; END $$;`)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, foundation)
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `ALTER TABLE booking_change_notes ADD CONSTRAINT booking_notes_event_test_fkey FOREIGN KEY ("organizationId", "eventId") REFERENCES domain_events("organizationId", id) ON DELETE CASCADE;`)

    const pub = await import("@/app/api/v1/public/booking/[slug]/route")
    pageGet = pub.GET
    pagePost = pub.POST
    const cancel = await import("@/app/api/v1/public/booking/cancel/[token]/route")
    cancelGet = cancel.GET
    cancelPost = cancel.POST
    const settings = await import("@/app/api/v1/booking-pages/route")
    settingsGet = settings.GET
    settingsPost = settings.POST
    meetingsGet = (await import("@/app/api/v1/bookings/route")).GET
    meetingGet = (await import("@/app/api/v1/bookings/[id]/route")).GET
    actionsPost = (await import("@/app/api/v1/bookings/[id]/actions/route")).POST
    grantsPut = (await import("@/app/api/v1/bookings/coordinators/route")).PUT
    drain = (await import("@/lib/booking/effect-worker")).drainBookingEffects

  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    mail.sent = []
    signIn("admin")
  })

  async function legacyFixture<T>(write: (tx: GeneratedPrisma.TransactionClient) => Promise<T>): Promise<T> {
    // Represent rows that already existed before the cutover, only in scratch.
    return bypass(() => prisma.$transaction(async (tx: GeneratedPrisma.TransactionClient) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'")
      return write(tx)
    }))
  }

  async function newPage(over: Record<string, unknown> = {}) {
    const slug = `page-${++sequence}`
    const res = await settingsPost(json("POST", "/api/v1/booking-pages", {
      title: "Tanışlıq", slug, description: null, durationMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 60,
      maxDaysAhead: 3, locationType: "online", locationText: null, hostIds: [HOST_A], weekly: ALL_DAY, isActive: true, ...over,
    }))
    expect(res.status, await res.clone().text()).toBe(201)
    return slug
  }

  async function view(slug: string) {
    const res = await pageGet(json("GET", `/api/v1/public/booking/${slug}`), slugParams(slug))
    return { status: res.status, body: await res.json() }
  }

  async function book(slug: string, startsAt: string, name = "Müştəri") {
    const response = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, { idempotencyKey: randomUUID(), recoverySecret: randomUUID(), startsAt, name, phone: "+994 50 123 45 67", email: "client@example.test", note: "Qiymətlər" }), slugParams(slug))
    // The HTTP response does not await providers. Exercise the persisted worker explicitly.
    if (response.status === 201) await bypass(() => drain(ORG, 50))
    return response
  }

  /**
   * A slot a few days ahead, away from the notice period. A host's busy time
   * is shared by all their pages, so a test that needs a host free passes an
   * index the other tests do not use.
   */
  async function someSlot(slug: string, index = 4) {
    const { body } = await view(slug)
    return body.data.days.at(-1).slots[index].startsAt as string
  }

  it("the actual forward migration preserves the known legacy buffer without inventing history", async () => {
    const row = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id: "legacy-buffer-booking" } }))
    expect(row).toMatchObject({ version: 0, snapshot: null, bufferBefore: 20, bufferAfter: 20 })
    const { assertBookingInterval } = await import("@/lib/booking/commands")
    const check = (end: string) => bypass(() => prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${ORG}:${HOST_A}`}))`
      return assertBookingInterval(tx, ORG, HOST_A, new Date("2035-01-01T07:10Z"), new Date(end), 0)
    }))
    await expect(check("2035-01-01T07:50Z")).rejects.toMatchObject({ code: "SLOT_TAKEN" })
    await expect(check("2035-01-01T07:40Z")).resolves.toBeUndefined()
  })

  it("shows the page with free times, without saying who is free", async () => {
    const slug = await newPage()
    const { status, body } = await view(slug)

    expect(status).toBe(200)
    expect(body.data.page).toMatchObject({ title: "Tanışlıq", hostNames: ["Leyla"], timezone: "Asia/Baku", durationMinutes: 30 })
    expect(body.data.days.length).toBeGreaterThan(0)
    expect(body.data.days[0].slots[0].hostIds).toEqual([])
  })

  it("books: the meeting, the host's task, a lead and the customer's e-mail", async () => {
    const slug = await newPage()
    const startsAt = await someSlot(slug)

    const res = await book(slug, startsAt)
    expect(res.status).toBe(201)
    const data = (await res.json()).data
    expect(data).toMatchObject({ startsAt, hostName: "Leyla" })
    expect(data.cancelUrl).toMatch(/^https:\/\/app\.example\.test\/book\/cancel\/[\w-]{20,}$/)

    const booking = await bypass(() => prisma.booking.findFirstOrThrow({ where: { startsAt: new Date(startsAt) } }))
    expect(booking).toMatchObject({ hostUserId: HOST_A, status: "confirmed", name: "Müştəri", organizationId: ORG })
    const task = await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: booking.taskId! } }))
    expect(task).toMatchObject({ assignedTo: HOST_A, relatedType: "lead", relatedId: booking.leadId })
    expect(task.dueDate?.toISOString()).toBe(startsAt)
    const lead = await bypass(() => prisma.lead.findUniqueOrThrow({ where: { id: booking.leadId! } }))
    expect(lead).toMatchObject({ contactName: "Müştəri", source: `booking:${slug}`, assignedTo: HOST_A })
    expect(mail.sent.some((item) => item.to === "client@example.test")).toBe(true)

    // The time is gone from the page.
    const after = await view(slug)
    const offered = after.body.data.days.flatMap((day: { slots: { startsAt: string }[] }) => day.slots.map((slot) => slot.startsAt))
    expect(offered).not.toContain(startsAt)
  })

  it("eight customers on the same time get one meeting", async () => {
    const slug = await newPage()
    const startsAt = await someSlot(slug)

    const responses = await Promise.all(Array.from({ length: 8 }, (_, n) => book(slug, startsAt, `Müştəri ${n}`)))

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409])
    expect(await bypass(() => prisma.booking.count({ where: { startsAt: new Date(startsAt), status: "confirmed" } }))).toBe(1)
  })

  it("two pages of one host: overlapping meetings that start apart still give one", async () => {
    const hour = await newPage({ durationMinutes: 60 })
    const half = await newPage({ durationMinutes: 30 })
    const { body } = await view(hour)
    const tenOClock = body.data.days.at(-1).slots[3].startsAt as string // a 60-minute slot
    const halfPast = new Date(new Date(tenOClock).getTime() + 30 * 60_000).toISOString()

    const responses = await Promise.all([book(hour, tenOClock, "Bir saat"), book(half, halfPast, "Yarım saat")])

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409])
    const meetings = await bypass(() => prisma.booking.findMany({ where: { hostUserId: HOST_A, status: "confirmed", startsAt: { gte: new Date(tenOClock), lt: new Date(halfPast) } } }))
    expect(meetings.length + (await bypass(() => prisma.booking.count({ where: { hostUserId: HOST_A, status: "confirmed", startsAt: new Date(halfPast) } })))).toBe(1)
  })

  it("with two hosts, the same time is given to both, one each", async () => {
    const slug = await newPage({ hostIds: [HOST_A, HOST_B] })
    const startsAt = await someSlot(slug, 30)

    const responses = await Promise.all([book(slug, startsAt, "Birinci"), book(slug, startsAt, "İkinci")])

    expect(responses.map((res) => res.status)).toEqual([201, 201])
    const hosts = await bypass(() => prisma.booking.findMany({ where: { startsAt: new Date(startsAt), status: "confirmed", bookingPage: { slug } }, select: { hostUserId: true } }))
    expect(hosts.map((row: { hostUserId: string }) => row.hostUserId).sort()).toEqual([HOST_A, HOST_B])
  })

  it("cancels by the customer's link: the time comes back, the task is cancelled, twice is harmless", async () => {
    const slug = await newPage()
    const startsAt = await someSlot(slug)
    const data = (await (await book(slug, startsAt)).json()).data
    const token = data.cancelUrl.split("/").at(-1)

    const shown = await (await cancelGet(json("GET", `/api/v1/public/booking/cancel/${token}`), tokenParams(token))).json()
    expect(shown.data).toMatchObject({ status: "confirmed", startsAt, hostName: "Leyla", past: false })

    const first = await cancelPost(json("POST", `/api/v1/public/booking/cancel/${token}`), tokenParams(token))
    await bypass(() => drain(ORG, 50))
    const second = await cancelPost(json("POST", `/api/v1/public/booking/cancel/${token}`), tokenParams(token))
    expect([first.status, second.status]).toEqual([200, 200])

    const booking = await bypass(() => prisma.booking.findFirstOrThrow({ where: { startsAt: new Date(startsAt), bookingPage: { slug } } }))
    expect(booking.status).toBe("cancelled")
    expect(booking.cancelledAt).toBeInstanceOf(Date)
    expect((await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: booking.taskId! } }))).status).toBe("cancelled")
    const after = await view(slug)
    const offered = after.body.data.days.flatMap((day: { slots: { startsAt: string }[] }) => day.slots.map((slot) => slot.startsAt))
    expect(offered).toContain(startsAt)
  })

  it("refuses a time the page does not offer, and a bot-filled form", async () => {
    const slug = await newPage()
    const odd = new Date(new Date(await someSlot(slug)).getTime() + 7 * 60_000).toISOString()

    expect((await book(slug, odd)).status).toBe(409)
    const bot = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, { startsAt: await someSlot(slug), name: "Bot", phone: "+994501234567", website: "http://spam" }), slugParams(slug))
    expect(bot.status).toBe(400)
  })

  it("a closed page and an unknown link are not found", async () => {
    const slug = await newPage({ isActive: false })
    expect((await view(slug)).status).toBe(404)
    expect((await view("no-such-page")).status).toBe(404)
  })

  it("settings: a link is unique across organizations, hosts must be the organization's, hours must make sense", async () => {
    const slug = await newPage()
    signIn("admin", OTHER_ORG)
    const base = { title: "X", description: null, durationMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 60, maxDaysAhead: 3, locationType: "office", locationText: null, weekly: ALL_DAY, isActive: true }

    const taken = await settingsPost(json("POST", "/api/v1/booking-pages", { ...base, slug, hostIds: [`user-admin-${OTHER_ORG}`] }))
    const foreignHost = await settingsPost(json("POST", "/api/v1/booking-pages", { ...base, slug: "other-org-page", hostIds: [HOST_A] }))
    const badHours = await settingsPost(json("POST", "/api/v1/booking-pages", { ...base, slug: "other-org-page", hostIds: [`user-admin-${OTHER_ORG}`], weekly: { "1": [{ start: "18:00", end: "09:00" }] } }))

    expect([taken.status, (await taken.json()).code]).toEqual([409, "SLUG_TAKEN"])
    expect([foreignHost.status, (await foreignHost.json()).code]).toEqual([400, "HOSTS_REQUIRED"])
    expect([badHours.status, (await badHours.json()).code]).toEqual([400, "INVALID_HOURS"])

    // The other organization's list does not show this one's pages.
    const list = await (await settingsGet(json("GET", "/api/v1/booking-pages"))).json()
    expect(list.data.pages).toEqual([])
  })

  it("a lost response and concurrent retry reserve once and protect confirmation with a recovery secret", async () => {
    const slug = await newPage({ hostIds: [HOST_A, HOST_B] })
    const startsAt = await someSlot(slug, 12)
    const payload = { startsAt, name: "Retry client", phone: "+994501000001", idempotencyKey: randomUUID(), recoverySecret: randomUUID() }
    const responses = await Promise.all(Array.from({ length: 8 }, () => pagePost(json("POST", `/api/v1/public/booking/${slug}`, payload), slugParams(slug))))
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(201))
    const receipts = await Promise.all(responses.map((response) => response.json()))
    expect(new Set(receipts.map((body) => body.data.id)).size).toBe(1)
    expect(new Set(receipts.map((body) => body.data.cancelUrl)).size).toBe(1)
    const id = receipts[0].data.id
    const booking = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(booking.version).toBe(1)
    expect(booking.taskId).toBeNull()
    expect((await (await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).json()).data.id).toBe(id)
    const badSecret = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, { ...payload, recoverySecret: randomUUID() }), slugParams(slug))
    expect(badSecret.status).toBe(403)
    const conflict = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, { ...payload, name: "Different request" }), slugParams(slug))
    expect(conflict.status).toBe(409)
    await bypass(() => drain(ORG, 50))
    const once = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    await bypass(() => drain(ORG, 50))
    const twice = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(twice.taskId).toBe(once.taskId)
    expect(twice.leadId).toBe(once.leadId)
    const head = await bypass(() => prisma.eventAggregateHead.findUniqueOrThrow({ where: { organizationId_aggregateType_aggregateId: { organizationId: ORG, aggregateType: "booking", aggregateId: id } } }))
    expect(Number(head.currentVersion)).toBe(once.version)
  })

  it("recovers a committed response after the page closes and keeps the original meeting conditions", async () => {
    const slug = await newPage({ title: "Original meeting", locationText: "Original address" })
    const startsAt = await someSlot(slug, 13)
    const payload = { startsAt, name: "Snapshot client", phone: "+994501000002", idempotencyKey: randomUUID(), recoverySecret: randomUUID() }
    const first = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, payload), slugParams(slug))
    expect(first.status).toBe(201)
    const saved = (await first.json()).data
    await bypass(() => prisma.bookingPage.update({ where: { slug }, data: { title: "New title", locationText: "New address", isActive: false, version: { increment: 1 } } }))
    const repeated = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, payload), slugParams(slug))
    expect(repeated.status).toBe(201)
    expect((await repeated.json()).data).toEqual(saved)
    const token = saved.cancelUrl.split("/").at(-1)
    const details = await cancelGet(json("GET", `/api/v1/public/booking/cancel/${token}`), tokenParams(token))
    const view = (await details.json()).data
    expect(view.page.title).toBe("Original meeting")
    expect(view.page.locationText).toBe("Original address")
    const newRequest = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, { ...payload, idempotencyKey: randomUUID() }), slugParams(slug))
    expect(newRequest.status).toBe(404)
  })

  it("paginates beyond 200 records and counts the entire filtered calendar day", async () => {
    const slug = await newPage()
    const page = await bypass(() => prisma.bookingPage.findUniqueOrThrow({ where: { slug } }))
    const start = new Date("2030-01-15T08:00:00Z")
    await legacyFixture((tx) => tx.booking.createMany({ data: Array.from({ length: 211 }, (_, index) => ({
      id: `pagination-${index.toString().padStart(4, "0")}`, organizationId: ORG, bookingPageId: page.id, hostUserId: HOST_A,
      startsAt: start, endsAt: new Date(start.getTime() + 1800000), name: "Calendar pagination client", phone: "+994501000003", status: "cancelled", cancelledAt: new Date(), cancelTokenHash: randomUUID(),
    })) }))
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const filter: URLSearchParams = new URLSearchParams({ page: page.id, limit: "100", ...(cursor ? { cursor } : {}) })
      const response: Response = await meetingsGet(json("GET", `/api/v1/bookings?${filter}`))
      expect(response.status).toBe(200)
      const data: { items: { id: string }[]; nextCursor: string | null } = (await response.json()).data
      ids.push(...data.items.map((row: { id: string }) => row.id)); cursor = data.nextCursor
    } while (cursor)
    expect(ids).toHaveLength(211)
    expect(new Set(ids).size).toBe(211)
    const calendarGet = (await import("@/app/api/v1/bookings/calendar/route")).GET
    const filter = new URLSearchParams({ page: page.id, from: "2030-01-15T00:00:00Z", to: "2030-01-16T00:00:00Z" })
    const response = await calendarGet(json("GET", `/api/v1/bookings/calendar?${filter}`))
    expect(response.status).toBe(200)
    expect((await response.json()).data.days).toEqual([{ day: "2030-01-15", count: 211 }])
  })

  it("the database rejects old and direct writers that bypass canonical events", async () => {
    const slug = await newPage()
    const response = await book(slug, await someSlot(slug, 22))
    const id = (await response.json()).data.id
    await expect(bypass(() => prisma.booking.update({ where: { id }, data: { status: "no_show" } }))).rejects.toThrow()
    await expect(bypass(() => prisma.booking.update({ where: { id }, data: { name: "Changed outside command" } }))).rejects.toThrow()
    const original = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(original.status).toBe("confirmed")
    const foreignTask = await bypass(() => prisma.task.create({ data: { organizationId: OTHER_ORG, title: "Foreign task" } }))
    const foreignLead = await bypass(() => prisma.lead.create({ data: { organizationId: OTHER_ORG, contactName: "Foreign lead" } }))
    await expect(bypass(() => prisma.booking.update({ where: { id }, data: { taskId: foreignTask.id } }))).rejects.toThrow()
    await expect(bypass(() => prisma.booking.update({ where: { id }, data: { leadId: foreignLead.id } }))).rejects.toThrow()
    await expect(bypass(() => prisma.booking.create({ data: {
      organizationId: ORG, bookingPageId: original.bookingPageId, hostUserId: HOST_A,
      startsAt: new Date("2031-01-01T08:00Z"), endsAt: new Date("2031-01-01T08:30Z"),
      name: "Old writer", phone: "+994501000005", cancelTokenHash: randomUUID(),
    } }))).rejects.toThrow()
  })

  it("the expansion accepts a legacy writer but never downgrades an existing canonical booking", async () => {
    const slug = await newPage()
    const response = await book(slug, await someSlot(slug, 23))
    const id = (await response.json()).data.id
    const original = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    const expansion = readFileSync(path.join(ROOT, "prisma/migrations/20261102100000_booking_commands/migration.sql"), "utf8")
    const start = expansion.indexOf("CREATE FUNCTION booking_managed_task_guard_fn()")
    const end = expansion.indexOf("\nCREATE CONSTRAINT TRIGGER booking_event_head_guard", start)
    const functions = expansion.slice(start, end).replaceAll("CREATE FUNCTION ", "CREATE OR REPLACE FUNCTION ")
      .replace("CREATE TRIGGER booking_managed_task_guard BEFORE UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION booking_managed_task_guard_fn();", "")
    await expect(bypass(() => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(functions)
      await tx.booking.create({ data: { organizationId: ORG, bookingPageId: original.bookingPageId, hostUserId: HOST_A,
        startsAt: new Date("2038-01-01T08:00Z"), endsAt: new Date("2038-01-01T08:30Z"),
        name: "Expand-only legacy", phone: "+994501000006", cancelTokenHash: randomUUID() } })
      await tx.booking.update({ where: { id }, data: { version: 0 } })
    }))).rejects.toThrow(/canonical booking cannot return to legacy version zero/i)
    // The failed transaction also rolls back the temporary function replacement.
    expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))).version).toBe(original.version)
  })

  it("a manual create returns no customer capability and cannot replay after coordinator access is revoked", async () => {
    const slug = await newPage({ hostIds: [HOST_B] })
    const startsAt = await someSlot(slug, 15)
    const page = await bypass(() => prisma.bookingPage.findUniqueOrThrow({ where: { slug } }))
    await grantsPut(json("PUT", "/api/v1/bookings/coordinators", { coordinatorUserId: HOST_A, hostIds: [HOST_B], canManage: true }))
    session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Leyla" } }
    const createPost = (await import("@/app/api/v1/bookings/route")).POST
    const input = { pageId: page.id, startsAt, name: "Staff-created client", phone: "+994501000004", idempotencyKey: randomUUID(), recoverySecret: randomUUID() }
    const response = await createPost(json("POST", "/api/v1/bookings", input))
    expect(response.status, await response.clone().text()).toBe(201)
    const data = (await response.json()).data
    expect(data.cancelUrl).toBeUndefined()
    expect(data.secretId).toBeUndefined()
    const replay = await createPost(json("POST", "/api/v1/bookings", input))
    expect((await replay.json()).data.id).toBe(data.id)
    signIn("admin")
    await grantsPut(json("PUT", "/api/v1/bookings/coordinators", { coordinatorUserId: HOST_A, hostIds: [], canManage: false }))
    session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Leyla" } }
    expect((await createPost(json("POST", "/api/v1/bookings", input))).status).toBe(404)
  })

  it("own and explicit team scope apply to list, forged host filters, details and revoked grants", async () => {
    const slug = await newPage({ hostIds: [HOST_B] })
    const response = await book(slug, await someSlot(slug, 14))
    expect(response.status).toBe(201)
    const id = (await response.json()).data.id
    const row = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Leyla" } }
    const own = await (await meetingsGet(json("GET", `/api/v1/bookings?page=${row.bookingPageId}&host=${HOST_B}`))).json()
    expect(own.data.items).toEqual([])
    expect((await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).status).toBe(404)
    signIn("admin")
    expect((await grantsPut(json("PUT", "/api/v1/bookings/coordinators", { coordinatorUserId: HOST_A, hostIds: [HOST_B], canManage: false }))).status).toBe(200)
    session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Leyla" } }
    const shared = await (await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).json()
    expect(shared.data.id).toBe(id)
    expect(shared.data.canManage).toBe(false)
    expect(shared.data.cancelTokenHash).toBeUndefined()
    expect(shared.data.secretId).toBeUndefined()
    const denied = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "cancel", version: row.version, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })
    expect(denied.status).toBe(403)
    signIn("admin")
    await grantsPut(json("PUT", "/api/v1/bookings/coordinators", { coordinatorUserId: HOST_A, hostIds: [], canManage: false }))
    session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Leyla" } }
    expect((await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).status).toBe(404)
    signIn("admin", OTHER_ORG)
    expect((await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).status).toBe(404)
  })

  it("cancel and move races keep one version, preserve a closed page's cancellation and protect the task mirror", async () => {
    const slug = await newPage()
    const booked = await book(slug, await someSlot(slug, 16))
    const id = (await booked.json()).data.id
    const row = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    await expect(bypass(() => prisma.task.update({ where: { id: row.taskId! }, data: { dueDate: new Date() } }))).rejects.toThrow()
    await bypass(() => prisma.bookingPage.update({ where: { id: row.bookingPageId }, data: { isActive: false } }))
    const requests = await Promise.all(Array.from({ length: 2 }, () => actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "cancel", version: row.version, reason: "Plans changed", idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })))
    expect(requests.map((result) => result.status).sort()).toEqual([200, 409])
    await bypass(() => drain(ORG, 50))
    const updated = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(updated.status).toBe("cancelled")
    expect(updated.version).toBe(row.version + 1)
    expect((await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: row.taskId! } }))).status).toBe("cancelled")
    expect(await bypass(() => prisma.bookingChangeNote.count({ where: { bookingId: id } }))).toBe(1)
  })


  it("reschedules in place, reassigns its mirror and bootstraps a legacy outcome without inventing its creation history", async () => {
    const slug = await newPage()
    const result = await book(slug, await someSlot(slug, 18))
    const id = (await result.json()).data.id
    const before = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    await bypass(() => prisma.bookingPage.update({ where: { id: before.bookingPageId }, data: { hostIds: [HOST_A, HOST_B], version: { increment: 1 } } }))
    const targetSlug = await newPage({ hostIds: [HOST_B] })
    const startsAt = await someSlot(targetSlug, 20)
    const request = { operation: "reschedule", version: before.version, hostUserId: HOST_B, startsAt, idempotencyKey: randomUUID(), notifyCustomer: false }
    const moved = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, request), { params: Promise.resolve({ id }) })
    expect(moved.status, await moved.clone().text()).toBe(200)
    const replay = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, request), { params: Promise.resolve({ id }) })
    expect(await replay.json()).toEqual(await moved.json())
    await bypass(() => drain(ORG, 50))
    const after = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(after.id).toBe(before.id)
    expect(after.taskId).toBe(before.taskId)
    expect(after.hostUserId).toBe(HOST_B)
    expect(after.version).toBe(before.version + 1)
    const task = await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: after.taskId! } }))
    expect(task.assignedTo).toBe(HOST_B)
    expect(task.dueDate).toEqual(new Date(startsAt))
    const legacy = await legacyFixture((tx) => tx.booking.create({ data: { organizationId: ORG, bookingPageId: before.bookingPageId, hostUserId: HOST_A, startsAt: new Date("2020-01-01T05:00:00Z"), endsAt: new Date("2020-01-01T05:30:00Z"), name: "Legacy client", phone: "+994501000002", cancelTokenHash: randomUUID() } }))
    const recorded = await actionsPost(json("POST", `/api/v1/bookings/${legacy.id}/actions`, { operation: "outcome", version: 0, outcome: "completed", note: "Synthetic meeting outcome", idempotencyKey: randomUUID() }), { params: Promise.resolve({ id: legacy.id }) })
    expect(recorded.status, await recorded.clone().text()).toBe(200)
    const actual = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id: legacy.id } }))
    expect(actual).toMatchObject({ status: "completed", version: 2, source: "legacy", outcomeNote: "Synthetic meeting outcome" })
    const events = await bypass(() => prisma.domainEvent.findMany({ where: { organizationId: ORG, aggregateType: "booking", aggregateId: legacy.id }, orderBy: { aggregateVersion: "asc" } }))
    expect(events.map((event) => event.eventType)).toEqual(["sales.booking-imported.v1", "sales.booking-completed.v1"])
  })

  it("recording a past outcome retains the historical calendar binding after reconnecting Google", async () => {
    const slug = await newPage()
    const page = await bypass(() => prisma.bookingPage.findUniqueOrThrow({ where: { slug } }))
    const previous = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google", providerAccountId: "historical-outcome-account", access_token: "synthetic" } }))
    const current = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google-calendar", providerAccountId: "reconnected-outcome-account", access_token: "synthetic" } }))
    try {
      const row = await legacyFixture((tx) => tx.booking.create({ data: { organizationId: ORG, bookingPageId: page.id, hostUserId: HOST_A, startsAt: new Date("2020-02-01T05:00:00Z"), endsAt: new Date("2020-02-01T05:30:00Z"), name: "Historical calendar client", phone: "+994500000007", cancelTokenHash: randomUUID(), googleEventId: "historical-outcome-event" } }))
      const binding = await bypass(() => prisma.bookingIntegrationBinding.create({ data: { organizationId: ORG, bookingId: row.id, hostUserId: HOST_A, accountId: previous.id, generation: "legacy", providerEventId: "historical-outcome-event", desiredVersion: 0, desiredState: "present" } }))
      const response = await actionsPost(json("POST", `/api/v1/bookings/${row.id}/actions`, { operation: "outcome", outcome: "completed", version: 0, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id: row.id }) })
      expect(response.status, await response.clone().text()).toBe(200)
      const after = await bypass(() => prisma.bookingIntegrationBinding.findUniqueOrThrow({ where: { id: binding.id } }))
      expect(after).toMatchObject({ accountId: previous.id, desiredState: "present", desiredVersion: 2 })
      expect(await bypass(() => prisma.bookingIntegrationBinding.count({ where: { bookingId: row.id } }))).toBe(1)
    } finally {
      await bypass(() => prisma.account.deleteMany({ where: { id: { in: [previous.id, current.id] } } }))
    }
  })

  it("an unknown calendar create is never retried, while cancellation remains visible and a reviewed reconciliation permits cleanup", async () => {
    const account = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google-calendar", providerAccountId: "synthetic-booking-account", access_token: "synthetic-test-token" } }))
    calendar.update.mockRejectedValue({ code: 404 })
    calendar.insert.mockRejectedValue(new Error("synthetic timeout after provider accepted"))
    calendar.remove.mockResolvedValue({ data: {} })
    try {
      const slug = await newPage()
      const payload = { startsAt: await someSlot(slug, 22), name: "Unknown result", phone: "+994501000003", idempotencyKey: randomUUID(), recoverySecret: randomUUID() }
      const response = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, payload), slugParams(slug))
      expect(response.status, await response.clone().text()).toBe(201)
      const id = (await response.json()).data.id
      await bypass(() => drain(ORG, 50))
      const effect = await bypass(() => prisma.effectOutbox.findFirstOrThrow({ where: { organizationId: ORG, effectType: "booking.calendar", payload: { path: ["bookingId"], equals: id } } }))
      expect(effect.status).toBe("reconciliation_required")
      expect(calendar.insert).toHaveBeenCalledTimes(1)
      await bypass(() => drain(ORG, 50))
      expect(calendar.insert).toHaveBeenCalledTimes(1)
      const row = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
      const cancelled = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "cancel", version: row.version, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })
      expect(cancelled.status).toBe(200)
      await bypass(() => drain(ORG, 50))
      expect(calendar.remove).not.toHaveBeenCalled()
      const context = await import("@/lib/rls-context")
      await context.runWithTenant(ORG, () => prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE leaddrive_effect_operator")
        await tx.effectReconciliation.create({ data: { organizationId: ORG, effectId: effect.id, attemptNumber: effect.attemptCount, decision: "dead", reason: "Provider readback verified the created event; latest cancellation must delete it", evidence: { providerState: "present", synthetic: true } } })
        await tx.effectOutbox.update({ where: { id: effect.id }, data: { status: "dead", completedAt: new Date() } })
      }))
      // A blocked dependent intent is deferred to the next cron minute. Make
      // that pending tick due without sleeping or retrying the unknown attempt.
      await bypass(() => prisma.effectOutbox.updateMany({ where: { organizationId: ORG, effectType: "booking.calendar", status: "pending", payload: { path: ["bookingId"], equals: id } }, data: { availableAt: new Date(0) } }))
      await bypass(() => drain(ORG, 50))
      expect(calendar.insert).toHaveBeenCalledTimes(1)
      expect(calendar.remove).toHaveBeenCalledTimes(1)
      expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))).status).toBe("cancelled")
    } finally { await bypass(() => prisma.account.delete({ where: { id: account.id } })) }
  })

  it("FORCE RLS hides another tenant from a real unprivileged connection identity", async () => {
    signIn("admin", OTHER_ORG)
    const slug = await newPage({ hostIds: [`user-admin-${OTHER_ORG}`] })
    const response = await book(slug, await someSlot(slug, 2))
    expect(response.status).toBe(201)
    const role = `booking_reader_${randomUUID().replaceAll("-", "")}`
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON bookings TO "${role}";`)
    try {
      const visible = await bypass(() => prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'off', true), set_config('app.org_id', ${ORG}, true)`
        return tx.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM bookings`
      }))
      expect(visible.length).toBeGreaterThan(0)
      expect(new Set(visible.map((row) => row.organizationId))).toEqual(new Set([ORG]))
    } finally {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `REVOKE ALL ON bookings FROM "${role}"; REVOKE USAGE ON SCHEMA public FROM "${role}"; DROP ROLE "${role}";`)
    }
  })

})
