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

vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/google-calendar", () => ({
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

/** `db push` builds no CHECKs and no partial indexes; these are lifted from the migration. */
function bookingConstraintsSql(): string {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261101090000_online_booking/migration.sql"), "utf8")
  const partial = sql.match(/CREATE UNIQUE INDEX "bookings_host_start_confirmed_key"[\s\S]*?;/)
  if (!partial) throw new Error("partial unique index not found in the migration")
  const checks = [...sql.matchAll(/CONSTRAINT "(bookings_\w+_check)" CHECK (\(.*\))/g)]
  if (checks.length < 3) throw new Error("booking CHECKs not found in the migration")
  return [partial[0], ...checks.map(([, name, body]) => `ALTER TABLE "bookings" ADD CONSTRAINT "${name}" CHECK ${body.replace(/,$/, "")};`)].join("\n")
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
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let pageGet!: typeof import("@/app/api/v1/public/booking/[slug]/route").GET
  let pagePost!: typeof import("@/app/api/v1/public/booking/[slug]/route").POST
  let cancelGet!: typeof import("@/app/api/v1/public/booking/cancel/[token]/route").GET
  let cancelPost!: typeof import("@/app/api/v1/public/booking/cancel/[token]/route").POST
  let settingsGet!: typeof import("@/app/api/v1/booking-pages/route").GET
  let settingsPost!: typeof import("@/app/api/v1/booking-pages/route").POST
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, bookingConstraintsSql())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    const pub = await import("@/app/api/v1/public/booking/[slug]/route")
    pageGet = pub.GET
    pagePost = pub.POST
    const cancel = await import("@/app/api/v1/public/booking/cancel/[token]/route")
    cancelGet = cancel.GET
    cancelPost = cancel.POST
    const settings = await import("@/app/api/v1/booking-pages/route")
    settingsGet = settings.GET
    settingsPost = settings.POST
    await bypass(async () => {
      for (const id of [ORG, OTHER_ORG]) {
        await prisma.organization.create({ data: { id, name: `Org ${id}`, slug: id, modules: { crm: true, settings: true }, settings: { timezone: "Asia/Baku" } } })
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
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    mail.sent = []
    signIn("admin")
  })

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

  const book = (slug: string, startsAt: string, name = "Müştəri") =>
    pagePost(json("POST", `/api/v1/public/booking/${slug}`, { startsAt, name, phone: "+994 50 123 45 67", email: "client@example.test", note: "Qiymətlər" }), slugParams(slug))

  /**
   * A slot a few days ahead, away from the notice period. A host's busy time
   * is shared by all their pages, so a test that needs a host free passes an
   * index the other tests do not use.
   */
  async function someSlot(slug: string, index = 4) {
    const { body } = await view(slug)
    return body.data.days.at(-1).slots[index].startsAt as string
  }

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
})
