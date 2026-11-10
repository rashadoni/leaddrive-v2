/**
 * What the client is told when the salon moves or cancels their visit, against
 * a real Postgres.
 *
 * Until 2026-11-10 they were told by one e-mail, and only if they had left an
 * address; a client who booked by phone heard nothing. Worse, a move left the
 * reminder marks alone — they say «this meeting has been reminded», not «this
 * hour has» — so a client already reminded about Tuesday got no reminder for
 * Thursday and came on Tuesday.
 *
 * Proved here on rows rather than on the shape of a call, because both halves
 * are database state the next job reads:
 *  - a move clears the reminder marks, so the day-before and two-hour
 *    reminders are due again for the new time, and the old «I am coming» with
 *    them; a cancellation leaves nothing to remind about;
 *  - a move and a cancellation each queue ONE WhatsApp notice to the client,
 *    and a confirmation or a recorded outcome queues none;
 *  - the message names the new hour on a move and the dropped one on a
 *    cancellation, in the client's own language;
 *  - an organization that does not answer on WhatsApp sends nothing;
 *  - outside Meta's 24 hours without an approved template nothing is sent and
 *    the meeting says so (the card shows it as needing a person), instead of
 *    the notice looking delivered;
 *  - the manager's «do not notify» is honoured.
 *
 * Set BOOKING_CHANGE_NOTICE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55504:5432 postgres:16
 *   BOOKING_CHANGE_NOTICE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55504/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy, where BOOKING_CHANGE_NOTICE_DB_GATE=required turns a missing URL
 * into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.BOOKING_CHANGE_NOTICE_TEST_DATABASE_URL
if (!adminUrl && process.env.BOOKING_CHANGE_NOTICE_DB_GATE === "required") {
  throw new Error("BOOKING_CHANGE_NOTICE_TEST_DATABASE_URL is required by the booking change notice database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "booking-change-notice-test-secret"
  const admin = process.env.BOOKING_CHANGE_NOTICE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `booking_change_notice_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ ok: true, success: true }), renderTemplate: (value: string) => value }))
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  deliverNotificationPush: async () => undefined,
}))

/** The only thing that leaves the building: what WhatsApp was actually asked to send. */
const wa = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[], templates: [] as { to: string; templateName: string; variables: unknown }[], ok: true }))
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppText: async (input: { to: string; body: string }) => { wa.texts.push({ to: input.to, body: input.body }); return { success: wa.ok } },
  sendWhatsAppTemplate: async (input: { to: string; templateName: string; variables: unknown }) => { wa.templates.push(input); return { success: wa.ok } },
  sendWhatsAppButtons: async () => ({ success: true }),
}))

const ROOT = process.cwd()
const ORG = "org-change-notice"
const QUIET_ORG = "org-change-notice-quiet"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "booking-change-notice-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const get = (url: string) => new NextRequest(`http://localhost:3000${url}`, { method: "GET" })
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

function signIn(org: string, role: string) {
  session.current = { user: { id: `${role}-${org}`, organizationId: org, role, email: `${role}@${org}.test`, name: role } }
}

const ALWAYS_OPEN = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [{ start: "09:00", end: "18:00" }]]),
)

const CLIENT_PHONE = "+994 50 111 22 33"
const pgDescribe = scratch ? describe : describe.skip

pgDescribe("telling the client their visit moved or is off", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let availabilityGet!: typeof import("@/app/api/v1/bookings/availability/route").GET
  let bookingsPost!: typeof import("@/app/api/v1/bookings/route").POST
  let actionsPost!: typeof import("@/app/api/v1/bookings/[id]/actions/route").POST
  let drainEffects!: typeof import("@/lib/booking/effect-worker").drainBookingEffects
  let nextKey = 0

  const drain = async (org: string) => { for (let pass = 0; pass < 8; pass += 1) await tenant(org, () => drainEffects(org, 20)) }

  async function freeSlots(org: string, dayOffset: number) {
    const day = new Date(Date.now() + dayOffset * 86400_000).toISOString().slice(0, 10)
    const res = await availabilityGet(get(`/api/v1/bookings/availability?pageId=page-${org}&day=${day}`))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    const slots = body.data.days.flatMap((item: { slots: { startsAt: string }[] }) => item.slots)
    expect(slots.length, `no free slot on ${day}`).toBeGreaterThan(0)
    return slots as { startsAt: string }[]
  }

  /** A confirmed meeting for this organization, drained of its creation effects. */
  async function bookMeeting(org: string, dayOffset: number, locale = "az") {
    nextKey += 1
    const slot = (await freeSlots(org, dayOffset))[0]
    const res = await bookingsPost(post("/api/v1/bookings", {
      pageId: `page-${org}`, startsAt: slot.startsAt, locale,
      idempotencyKey: `change-notice-${nextKey}-${"k".repeat(16)}`,
      recoverySecret: `${"s".repeat(40)}${nextKey}`,
      name: "Günel", phone: CLIENT_PHONE,
    }))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(201)
    await drain(org)
    wa.texts.length = 0; wa.templates.length = 0
    return body.data.id as string
  }

  const version = (id: string) => bypass(() => prisma.booking.findFirstOrThrow({ where: { id }, select: { version: true } })).then((row) => row.version)

  async function command(org: string, id: string, input: Record<string, unknown>) {
    nextKey += 1
    const res = await actionsPost(
      post(`/api/v1/bookings/${id}/actions`, { version: await version(id), idempotencyKey: `cmd-${nextKey}-${"k".repeat(16)}`, ...input }),
      { params: Promise.resolve({ id }) } as never,
    )
    return { status: res.status, body: await res.json() }
  }

  const noticeEffects = (id: string) => bypass(() => prisma.effectOutbox.findMany({
    where: { effectType: "booking.customer-whatsapp", payload: { path: ["bookingId"], equals: id } },
    select: { status: true, lastError: true, providerResult: true },
  }))

  /** What the reminder job would see: the marks that say a reminder went out. */
  const reminderMarks = (id: string) => bypass(() => prisma.bookingReminder.findMany({ where: { bookingId: id } }))

  /** Meta's 24 hours: open while the client has written, shut once they have not. */
  const openWindow = (org: string) => bypass(() => prisma.channelMessage.create({ data: {
    organizationId: org, channelType: "whatsapp", direction: "inbound",
    from: CLIENT_PHONE.replace(/\D/g, ""), to: "994000000000", body: "salam",
    metadata: { waPhone: CLIENT_PHONE.replace(/\D/g, "") },
  } }))
  const shutWindow = () => bypass(() => prisma.channelMessage.deleteMany({}))

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env,
      `ALTER TABLE "event_aggregate_heads" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`)
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    tenant = (await import("@/lib/rls-context")).runWithTenant
    availabilityGet = (await import("@/app/api/v1/bookings/availability/route")).GET
    bookingsPost = (await import("@/app/api/v1/bookings/route")).POST
    actionsPost = (await import("@/app/api/v1/bookings/[id]/actions/route")).POST
    drainEffects = (await import("@/lib/booking/effect-worker")).drainBookingEffects

    await bypass(async () => {
      for (const [id, slug, mode] of [[ORG, "change-notice", "book"], [QUIET_ORG, "change-notice-quiet", "off"]] as const) {
        await prisma.organization.create({ data: {
          id, name: slug, slug, modules: { crm: true, sales: true },
          settings: { timezone: "Asia/Baku", bookingWhatsApp: { mode, channelConfigId: null } },
        } })
        await prisma.user.create({ data: { id: `admin-${id}`, organizationId: id, email: `admin@${id}.test`, name: "Leyla", passwordHash: "-", role: "admin" } })
        await prisma.bookingPage.create({ data: {
          id: `page-${id}`, organizationId: id, slug: `${slug}-consult`, title: "Konsultasiya",
          durationMinutes: 30, minNoticeMinutes: 60, maxDaysAhead: 30, hostIds: [`admin-${id}`], weekly: ALWAYS_OPEN,
        } })
      }
    })
  }, 240_000)

  beforeEach(() => {
    signIn(ORG, "admin")
    wa.texts.length = 0
    wa.templates.length = 0
    wa.ok = true
  })

  describe("a move", () => {
    it("starts the reminders over, so the client is reminded about the new hour", async () => {
      const id = await bookMeeting(ORG, 3)
      // As the job leaves it once the day-before reminder has gone out, and
      // once the client has answered «I am coming» — about the old hour.
      await bypass(() => prisma.bookingReminder.create({ data: { organizationId: ORG, bookingId: id, remindedDayAt: new Date(), clientConfirmedAt: new Date() } }))
      expect(await reminderMarks(id)).toHaveLength(1)

      const moved = (await freeSlots(ORG, 5))[0]
      const result = await command(ORG, id, { operation: "reschedule", startsAt: moved.startsAt })
      expect(result.status, JSON.stringify(result.body)).toBe(200)

      expect(await reminderMarks(id)).toEqual([])
      const row = await bypass(() => prisma.booking.findFirstOrThrow({ where: { id } }))
      expect(row.startsAt.toISOString()).toBe(new Date(moved.startsAt).toISOString())
    })

    it("tells the client the new hour on WhatsApp", async () => {
      const id = await bookMeeting(ORG, 6)
      await openWindow(ORG)
      const moved = (await freeSlots(ORG, 7))[0]
      await command(ORG, id, { operation: "reschedule", startsAt: moved.startsAt })
      await drain(ORG)

      expect(wa.texts).toHaveLength(1)
      expect(wa.texts[0].to).toBe(CLIENT_PHONE)
      expect(wa.texts[0].body).toContain("Görüşünüzün vaxtı dəyişdi")
      expect(wa.texts[0].body).toContain("Yeni vaxt")
      // The hour that now stands, not the one it was booked for.
      const clock = new Date(moved.startsAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", hour12: false })
      expect(wa.texts[0].body).toContain(clock)
      expect((await noticeEffects(id)).map((row) => row.status)).toEqual(["succeeded"])
    })
  })

  describe("a cancellation", () => {
    it("tells the client it is off, in their own language, and leaves nothing to remind about", async () => {
      const id = await bookMeeting(ORG, 8, "ru")
      await openWindow(ORG)
      await bypass(() => prisma.bookingReminder.create({ data: { organizationId: ORG, bookingId: id, remindedDayAt: new Date() } }))
      const result = await command(ORG, id, { operation: "cancel", reason: "" })
      expect(result.status, JSON.stringify(result.body)).toBe(200)
      await drain(ORG)

      expect(wa.texts).toHaveLength(1)
      expect(wa.texts[0].body).toContain("Ваша встреча отменена")
      // A cancelled meeting is not a reminder candidate at all (the job takes
      // confirmed ones), so its marks may stay as they are.
      expect(await bypass(() => prisma.booking.findFirstOrThrow({ where: { id }, select: { status: true } }))).toEqual({ status: "cancelled" })
    })
  })

  describe("what does not reach the client", () => {
    it("says nothing on a booking that was merely confirmed", async () => {
      const id = await bookMeeting(ORG, 9)
      expect(wa.texts).toHaveLength(0)
      expect(await noticeEffects(id)).toEqual([])
    })

    it("says nothing when the manager unticked «notify the client»", async () => {
      const id = await bookMeeting(ORG, 10)
      await command(ORG, id, { operation: "cancel", reason: "", notifyCustomer: false })
      await drain(ORG)
      expect(wa.texts).toHaveLength(0)
      expect(await noticeEffects(id)).toEqual([])
    })

    it("says nothing back to a client who cancelled it themselves", async () => {
      // Their own link, or the «Ləğv etmək» button on a reminder: that
      // conversation has already answered them. The agent also cancels the old
      // meeting when it moves one — «booked» and «cancelled» together is worse
      // than silence.
      const id = await bookMeeting(ORG, 14)
      await openWindow(ORG)
      const { cancelStoredBooking } = await import("@/lib/booking/commands")
      expect(await tenant(ORG, () => cancelStoredBooking(ORG, id))).toBe("cancelled")
      await drain(ORG)
      expect(wa.texts).toHaveLength(0)
      expect(await noticeEffects(id)).toEqual([])
    })

    it("says nothing for an organization that does not answer on WhatsApp", async () => {
      signIn(QUIET_ORG, "admin")
      const id = await bookMeeting(QUIET_ORG, 3)
      await command(QUIET_ORG, id, { operation: "cancel", reason: "" })
      await drain(QUIET_ORG)
      expect(wa.texts).toHaveLength(0)
      expect(wa.templates).toHaveLength(0)
      // Queued, then settled as «this organization does not write there» —
      // not left looking delivered, and not left for a person to chase.
      const effects = await noticeEffects(id)
      expect(effects.map((row) => row.status)).toEqual(["succeeded"])
      expect(JSON.stringify(effects[0].providerResult)).toContain("whatsapp_off")
    })
  })

  describe("outside Meta's 24 hours", () => {
    beforeEach(async () => { await shutWindow() })

    it("needs an approved template, and says on the meeting when there is none", async () => {
      const id = await bookMeeting(ORG, 11)
      await command(ORG, id, { operation: "cancel", reason: "" })
      await drain(ORG)
      // Nothing was sent: the client has not written, and no template is named.
      expect(wa.texts).toHaveLength(0)
      expect(wa.templates).toHaveLength(0)
      const effects = await noticeEffects(id)
      expect(effects.map((row) => row.status)).toEqual(["reconciliation_required"])
      expect(effects[0].lastError).not.toBeNull()
    })

    it("sends the named template once the organization has one", async () => {
      await bypass(() => prisma.organization.update({ where: { id: ORG }, data: {
        settings: { timezone: "Asia/Baku", bookingWhatsApp: { mode: "book", channelConfigId: null, cancelTemplate: "salon_visit_cancelled" } },
      } }))
      const id = await bookMeeting(ORG, 12)
      await command(ORG, id, { operation: "cancel", reason: "" })
      await drain(ORG)

      expect(wa.texts).toHaveLength(0)
      expect(wa.templates).toHaveLength(1)
      expect(wa.templates[0].templateName).toBe("salon_visit_cancelled")
      expect((wa.templates[0].variables as string[])[0]).toBe("Günel")
      expect((await noticeEffects(id)).map((row) => row.status)).toEqual(["succeeded"])
    })

    it("sends an ordinary message when the client wrote within the day", async () => {
      const id = await bookMeeting(ORG, 13)
      await openWindow(ORG)
      await command(ORG, id, { operation: "cancel", reason: "" })
      await drain(ORG)

      expect(wa.templates).toHaveLength(0)
      expect(wa.texts).toHaveLength(1)
      expect(wa.texts[0].body).toContain("Görüşünüz ləğv edildi")
    })
  })
})
