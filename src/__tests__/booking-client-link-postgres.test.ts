/**
 * Booking a customer the CRM already has, against a real Postgres.
 *
 * Until 2026-11 the staff form on «Görüşlər və yazılış» typed every customer
 * from scratch and the effect worker filed one more lead for each meeting: the
 * same person five visits deep was five rows. The panel now searches the
 * organization's own contacts and leads, and the meeting is filed on the one
 * that was picked.
 *
 * What is proved here, on rows in a database rather than on the shape of a
 * Prisma call — the search is raw SQL over the digits of a phone number, and a
 * mock would only confirm that we sent what we meant to send:
 *  - a number typed in any format finds the customer whose number is stored in
 *    another one («0501112233» → «+994 50 111 22 33»), and so does a second
 *    number kept on the contact;
 *  - a name and an e-mail find them too, and another organization's customer
 *    never comes back;
 *  - a principal who must not see customer numbers gets no number back AND no
 *    match by number — a typeahead that confirms a number is the masking undone;
 *  - a meeting booked on a contact carries it, files NO new lead, and its task
 *    lands on that contact;
 *  - a meeting booked on a lead reuses that lead instead of making a second;
 *  - a meeting booked for somebody new still files a lead, exactly as before;
 *  - a customer id from another organization is refused and books nothing.
 *
 * Set BOOKING_CLIENT_LINK_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55503:5432 postgres:16
 *   BOOKING_CLIENT_LINK_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55503/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy, where BOOKING_CLIENT_LINK_DB_GATE=required turns a missing URL into
 * a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.BOOKING_CLIENT_LINK_TEST_DATABASE_URL
if (!adminUrl && process.env.BOOKING_CLIENT_LINK_DB_GATE === "required") {
  throw new Error("BOOKING_CLIENT_LINK_TEST_DATABASE_URL is required by the booking client link database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "7".repeat(64)
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "booking-client-link-test-secret"
  const admin = process.env.BOOKING_CLIENT_LINK_TEST_DATABASE_URL
  if (!admin) return null
  const name = `booking_client_link_${process.pid}`
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
// The meeting's own side effects reach the outside world; the projection this
// suite is about does not, and runs in the same drain.
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ ok: true }), renderTemplate: (value: string) => value }))
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  deliverNotificationPush: async () => undefined,
}))

const ROOT = process.cwd()
const ORG = "org-booking-link"
const OTHER_ORG = "org-booking-link-other"
const MASKED_ORG = "org-booking-link-masked"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "booking-client-link-schema-"))
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

/** Open every day, so «tomorrow» is bookable whatever day the suite runs.
 *  Days are keyed "0" (Sunday) … "6"; another key reads as a closed day. */
const ALWAYS_OPEN = Object.fromEntries(
  ["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [{ start: "09:00", end: "18:00" }]]),
)

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("booking a customer the CRM already has", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let clientsGet!: typeof import("@/app/api/v1/bookings/clients/route").GET
  let availabilityGet!: typeof import("@/app/api/v1/bookings/availability/route").GET
  let bookingsPost!: typeof import("@/app/api/v1/bookings/route").POST
  let drainEffects!: typeof import("@/lib/booking/effect-worker").drainBookingEffects
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let elvinContactId = ""
  let gunelLeadId = ""
  let theirContactId = ""
  let maskedContactId = ""
  let nextKey = 0

  /** What the panel offers while `query` is typed. */
  const search = async (query: string) => {
    const res = await clientsGet(get(`/api/v1/bookings/clients?q=${encodeURIComponent(query)}`))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    return body.data.items as { type: string; id: string; name: string; phone: string | null; email: string | null }[]
  }
  const names = async (query: string) => (await search(query)).map((item) => item.name)

  /** A free time on the first day that has one, as the panel reads it. */
  async function freeSlot(pageId: string, dayOffset = 1) {
    const day = new Date(Date.now() + dayOffset * 86400_000).toISOString().slice(0, 10)
    const res = await availabilityGet(get(`/api/v1/bookings/availability?pageId=${pageId}&day=${day}`))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    const slots = body.data.days.flatMap((item: { slots: { startsAt: string }[] }) => item.slots)
    expect(slots.length, `no free slot on ${day}`).toBeGreaterThan(0)
    return slots
  }

  /** Books through the real route, as the panel does, and returns the answer. */
  async function book(pageId: string, startsAt: string, fields: Record<string, unknown>) {
    nextKey += 1
    const res = await bookingsPost(post("/api/v1/bookings", {
      pageId,
      startsAt,
      idempotencyKey: `booking-client-link-${nextKey}-${"k".repeat(16)}`,
      recoverySecret: `${"s".repeat(40)}${nextKey}`,
      locale: "az",
      ...fields,
    }))
    return { status: res.status, body: await res.json() }
  }

  const leadCount = () => bypass(() => prisma.lead.count({ where: { organizationId: ORG } }))
  /** As the cron runs it: the worker drains one tenant inside its own scope. */
  const drain = async (org: string) => { for (let pass = 0; pass < 8; pass += 1) await tenant(org, () => drainEffects(org, 20)) }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    // `db push` writes the schema, not the migrations: a default that only the
    // migration SQL declares is missing here, and the event platform inserts
    // its aggregate head with raw SQL that relies on it.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env,
      `ALTER TABLE "event_aggregate_heads" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`)
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    clientsGet = (await import("@/app/api/v1/bookings/clients/route")).GET
    availabilityGet = (await import("@/app/api/v1/bookings/availability/route")).GET
    bookingsPost = (await import("@/app/api/v1/bookings/route")).POST
    drainEffects = (await import("@/lib/booking/effect-worker")).drainBookingEffects
    tenant = (await import("@/lib/rls-context")).runWithTenant

    await bypass(async () => {
      for (const [id, slug, settings] of [
        [ORG, "booking-link", { timezone: "Asia/Baku" }],
        [OTHER_ORG, "booking-link-other", { timezone: "Asia/Baku" }],
        [MASKED_ORG, "booking-link-masked", { timezone: "Asia/Baku", hideCustomerPhoneForOperators: true }],
      ] as const) {
        await prisma.organization.create({ data: { id, name: slug, slug, modules: { crm: true, sales: true }, settings } })
        for (const role of ["admin", "sales", "support"]) {
          await prisma.user.create({ data: { id: `${role}-${id}`, organizationId: id, email: `${role}@${id}.test`, name: role, passwordHash: "-", role } })
        }
        await prisma.bookingPage.create({ data: {
          id: `page-${id}`, organizationId: id, slug: `${slug}-consult`, title: "Konsultasiya",
          durationMinutes: 30, minNoticeMinutes: 60, maxDaysAhead: 14, hostIds: [`admin-${id}`], weekly: ALWAYS_OPEN,
        } })
      }

      // The customer the receptionist knows by voice: his number is stored in
      // the international form, and he keeps a second, local one.
      elvinContactId = (await prisma.contact.create({ data: {
        organizationId: ORG, fullName: "Elvin Əliyev", phone: "+994 50 111 22 33",
        phones: ["(055) 987-65-43"], email: "elvin@zeytun.az",
      } })).id
      await prisma.contact.create({ data: { organizationId: ORG, fullName: "Elvin Quliyev", phone: "+994703035510" } })
      await prisma.contact.create({ data: { organizationId: ORG, fullName: "Köhnə müştəri", phone: "+994 50 111 22 33", isActive: false } })
      gunelLeadId = (await prisma.lead.create({ data: {
        organizationId: ORG, contactName: "Günel Məmmədova", phone: "0554401802", email: "gunel@example.az", source: "instagram",
      } })).id
      await prisma.lead.create({ data: { organizationId: ORG, contactName: "Artıq müştəri", phone: "+994 50 111 22 33", status: "converted" } })
      theirContactId = (await prisma.contact.create({ data: { organizationId: OTHER_ORG, fullName: "Elvin Başqası", phone: "+994 50 111 22 33" } })).id
      maskedContactId = (await prisma.contact.create({ data: { organizationId: MASKED_ORG, fullName: "Elvin Gizli", phone: "+994 50 111 22 33" } })).id
    })
  }, 240_000)

  beforeEach(() => { signIn(ORG, "admin") })

  describe("the search under the name and the phone field", () => {
    it("finds the customer by a number typed in another format than the stored one", async () => {
      // Stored «+994 50 111 22 33»; the receptionist types what the caller says.
      expect(await names("0501112233")).toContain("Elvin Əliyev")
      expect(await names("+994 50 111 22 33")).toContain("Elvin Əliyev")
      expect(await names("994501112233")).toContain("Elvin Əliyev")
      expect(await names("50 111 22 33")).toContain("Elvin Əliyev")
    })

    it("finds them by a second number kept on the contact", async () => {
      expect(await names("0559876543")).toContain("Elvin Əliyev")
    })

    it("finds a lead by its number and by name, and tells the two kinds apart", async () => {
      const byNumber = await search("994554401802")
      expect(byNumber.map((item) => item.name)).toContain("Günel Məmmədova")
      expect(byNumber.find((item) => item.name === "Günel Məmmədova")?.type).toBe("lead")
      const byName = await search("Günel")
      expect(byName.find((item) => item.name === "Günel Məmmədova")?.id).toBe(gunelLeadId)
      expect((await search("Elvin Ə")).find((item) => item.name === "Elvin Əliyev")?.type).toBe("contact")
    })

    it("finds them by name and by e-mail, and answers nothing to one letter", async () => {
      expect(await names("elvin")).toContain("Elvin Əliyev")
      expect(await names("elvin@zeytun")).toContain("Elvin Əliyev")
      expect(await search("E")).toEqual([])
    })

    it("never offers another organization's customer, an archived one, or a converted lead", async () => {
      const found = await search("0501112233")
      expect(found.map((item) => item.id)).not.toContain(theirContactId)
      expect(found.map((item) => item.name)).not.toContain("Köhnə müştəri")
      expect(found.map((item) => item.name)).not.toContain("Artıq müştəri")
    })

    it("offers at most what the panel draws, so the list never has to scroll", async () => {
      expect((await search("Elvin")).length).toBeLessThanOrEqual(5)
    })

    it("offers no leads to a role that may not read them", async () => {
      // Support answers the phone and books; the lead list is not theirs.
      signIn(ORG, "support")
      const found = await search("0501112233")
      expect(found.map((item) => item.name)).toContain("Elvin Əliyev")
      expect(found.every((item) => item.type === "contact")).toBe(true)
      expect((await search("Günel")).map((item) => item.name)).not.toContain("Günel Məmmədova")
    })

    it("hands a principal who may not see numbers neither the number nor a match by it", async () => {
      signIn(MASKED_ORG, "sales")
      const byName = await search("Elvin Gizli")
      expect(byName.map((item) => item.id)).toContain(maskedContactId)
      expect(byName[0].phone).toBeNull()
      expect(await search("0501112233")).toEqual([])
    })
  })

  describe("the meeting that comes out of it", () => {
    it("is filed on the chosen contact and does not add a lead for them", async () => {
      const before = await leadCount()
      const slot = (await freeSlot(`page-${ORG}`))[0]
      const created = await book(`page-${ORG}`, slot.startsAt, {
        name: "Elvin Əliyev", phone: "+994 50 111 22 33", email: "elvin@zeytun.az",
        client: { type: "contact", id: elvinContactId },
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)

      await drain(ORG)
      const row = await bypass(() => prisma.booking.findFirstOrThrow({ where: { id: created.body.data.id } }))
      expect(row.contactId).toBe(elvinContactId)
      expect(row.leadId).toBeNull()
      expect(await leadCount()).toBe(before)

      const task = await bypass(() => prisma.task.findFirstOrThrow({ where: { organizationId: ORG, id: row.taskId! } }))
      expect(task.relatedType).toBe("contact")
      expect(task.relatedId).toBe(elvinContactId)
    })

    it("reuses the chosen lead instead of making a second one", async () => {
      const before = await leadCount()
      const slot = (await freeSlot(`page-${ORG}`, 2))[0]
      const created = await book(`page-${ORG}`, slot.startsAt, {
        name: "Günel Məmmədova", phone: "0554401802",
        client: { type: "lead", id: gunelLeadId },
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)

      await drain(ORG)
      const row = await bypass(() => prisma.booking.findFirstOrThrow({ where: { id: created.body.data.id } }))
      expect(row.leadId).toBe(gunelLeadId)
      expect(row.contactId).toBeNull()
      expect(await leadCount()).toBe(before)
    })

    it("still files a lead for a customer nobody picked — a new caller is written down as before", async () => {
      const before = await leadCount()
      const slot = (await freeSlot(`page-${ORG}`, 3))[0]
      const created = await book(`page-${ORG}`, slot.startsAt, { name: "Təzə Zəng", phone: "+994 55 000 11 22" })
      expect(created.status, JSON.stringify(created.body)).toBe(201)

      await drain(ORG)
      const row = await bypass(() => prisma.booking.findFirstOrThrow({ where: { id: created.body.data.id } }))
      expect(row.leadId).not.toBeNull()
      expect(row.contactId).toBeNull()
      expect(await leadCount()).toBe(before + 1)
      const lead = await bypass(() => prisma.lead.findFirstOrThrow({ where: { id: row.leadId! } }))
      expect(lead.contactName).toBe("Təzə Zəng")
    })

    it("refuses to file the meeting on a record the booker may not read", async () => {
      const slot = (await freeSlot(`page-${ORG}`, 5))[0]
      const before = await bypass(() => prisma.booking.count({ where: { organizationId: ORG } }))
      signIn(ORG, "support")
      const created = await book(`page-${ORG}`, slot.startsAt, {
        name: "Günel Məmmədova", phone: "0554401802",
        client: { type: "lead", id: gunelLeadId },
      })
      expect(created.status).toBe(403)
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG } }))).toBe(before)
    })

    it("refuses a customer id from another organization and books nothing", async () => {
      const slot = (await freeSlot(`page-${ORG}`, 4))[0]
      const before = await bypass(() => prisma.booking.count({ where: { organizationId: ORG } }))
      const created = await book(`page-${ORG}`, slot.startsAt, {
        name: "Elvin Başqası", phone: "+994 50 111 22 33",
        client: { type: "contact", id: theirContactId },
      })
      expect(created.status).toBe(404)
      expect(created.body.code).toBe("CLIENT_NOT_FOUND")
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG } }))).toBe(before)
    })
  })
})
