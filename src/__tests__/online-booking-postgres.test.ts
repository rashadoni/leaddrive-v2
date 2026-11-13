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
  process.env.CRON_SECRET = process.env.CRON_SECRET || "online-booking-test-cron-secret"
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
const calendar = vi.hoisted(() => ({ update: vi.fn(), insert: vi.fn(), remove: vi.fn(), list: vi.fn(async () => ({ data: { accessRole: "owner", items: [] } })) }))
const outlook = vi.hoisted(() => ({
  events: vi.fn(async () => [] as { id: string; start: Date; end: Date; subject: string | null }[]),
  create: vi.fn(async () => "graph-event-1"),
  update: vi.fn(async () => ({ missing: false })),
  remove: vi.fn(async () => {}),
  byTransaction: vi.fn(async () => null as string | null),
}))
const whatsapp = vi.hoisted(() => ({
  buttons: [] as { body: string; footer?: string | null; buttons: { id: string; title: string }[]; conversationId?: string | null }[],
  lists: [] as { body: string; footer?: string | null; buttonLabel: string; sectionTitle?: string | null; rows: { id: string; title: string; description?: string | null }[]; sections?: { title: string; rowIds: string[] }[]; conversationId?: string | null }[],
  texts: [] as { message: string; conversationId?: string | null }[],
  /** Forms sent inside WhatsApp (Flows): what travelled in `data` is the offer. */
  flows: [] as { body: string; footer?: string | null; flowId: string; flowToken: string; cta: string; screen: string; data: Record<string, unknown>; conversationId?: string | null }[],
  /** Set for one send to play a provider that refuses interactive lists. */
  listFails: false,
}))

vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/calendar/microsoft", () => ({
  microsoftAccessToken: vi.fn(async () => "synthetic-outlook-token"),
  microsoftEvents: outlook.events,
  createMicrosoftEvent: outlook.create,
  updateMicrosoftEvent: outlook.update,
  deleteMicrosoftEvent: outlook.remove,
  microsoftEventByTransaction: outlook.byTransaction,
  microsoftCalendarConfigured: vi.fn(() => true),
  microsoftAuthorizeUrl: vi.fn(() => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"),
  exchangeMicrosoftCode: vi.fn(),
  microsoftIdentity: vi.fn(async () => "salon@contoso.test"),
}))
vi.mock("@/lib/google-calendar", () => ({
  getGoogleCalendarClient: vi.fn(async () => ({ events: { update: calendar.update, insert: calendar.insert, delete: calendar.remove, list: calendar.list } })),
  listBusyIntervals: vi.fn(async () => null),
  createCalendarEvent: vi.fn(async () => { throw new Error("Google Calendar not connected") }),
  deleteCalendarEvent: vi.fn(async () => {}),
}))
// The booking agent's two senders; everything else of the module stays real.
vi.mock("@/lib/whatsapp", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp")>()),
  sendWhatsAppButtons: vi.fn(async (input: { body: string; footer?: string | null; buttons: { id: string; title: string }[]; conversationId?: string | null }) => {
    whatsapp.buttons.push({ body: input.body, footer: input.footer, buttons: input.buttons, conversationId: input.conversationId })
    return { success: true, messageId: `wamid.${whatsapp.buttons.length}` }
  }),
  sendWhatsAppList: vi.fn(async (input: { body: string; footer?: string | null; buttonLabel: string; sectionTitle?: string | null; rows: { id: string; title: string; description?: string | null }[]; sections?: { title: string; rowIds: string[] }[]; conversationId?: string | null }) => {
    if (whatsapp.listFails) {
      whatsapp.listFails = false
      return { success: false, error: "interactive lists are not supported here" }
    }
    whatsapp.lists.push({ body: input.body, footer: input.footer, buttonLabel: input.buttonLabel, sectionTitle: input.sectionTitle, rows: input.rows, sections: input.sections, conversationId: input.conversationId })
    return { success: true, messageId: `wamid.list.${whatsapp.lists.length}` }
  }),
  sendWhatsAppFlow: vi.fn(async (input: { body: string; footer?: string | null; flowId: string; flowToken: string; cta: string; screen: string; data: Record<string, unknown>; conversationId?: string | null }) => {
    whatsapp.flows.push({ ...input })
    return { success: true, messageId: `wamid.flow.${whatsapp.flows.length}` }
  }),
  sendWhatsAppMessage: vi.fn(async (input: { message: string; conversationId?: string | null }) => {
    whatsapp.texts.push({ message: input.message, conversationId: input.conversationId })
    return { success: true, messageId: `wamid.text.${whatsapp.texts.length}` }
  }),
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
/** A scheduler call, carrying the secret the real trigger script sends. */
const cronJson = () => new NextRequest("http://localhost:3000/api/cron/booking-reminders", {
  method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
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
  let pageDelete!: typeof import("@/app/api/v1/booking-pages/[id]/route").DELETE
  let settingsPatch!: typeof import("@/app/api/v1/booking-pages/[id]/route").PATCH
  let meetingsGet!: typeof import("@/app/api/v1/bookings/route").GET
  let meetingGet!: typeof import("@/app/api/v1/bookings/[id]/route").GET
  let taskLinkGet!: typeof import("@/app/api/v1/bookings/task-link/route").GET
  let actionsPost!: typeof import("@/app/api/v1/bookings/[id]/actions/route").POST
  let grantsPut!: typeof import("@/app/api/v1/bookings/coordinators/route").PUT
  let drain!: typeof import("@/lib/booking/effect-worker").drainBookingEffects
  let bookingTurn!: typeof import("@/lib/booking/whatsapp-agent").handleWhatsAppBookingTurn
  let reviewOffer!: typeof import("@/lib/booking/whatsapp-agent").reviewPendingOffer
  let OFFERS_PER_LIST!: number
  let remindersPost!: typeof import("@/app/api/cron/booking-reminders/route").POST
  let requestsGet!: typeof import("@/app/api/v1/bookings/requests/route").GET
  let requestsPost!: typeof import("@/app/api/v1/bookings/requests/route").POST
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
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
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `DROP TABLE IF EXISTS booking_resources, booking_reminders, booking_offers, booking_change_notes, booking_integration_bindings, booking_secrets, booking_coordinator_grants, bookings, booking_pages CASCADE;`)
    for (const migration of ["20261101090000_online_booking", "20261102090000_booking_workspace", "20261102100000_booking_commands", "20261120090000_booking_page_price_category", "20261121090000_booking_offers", "20261122090000_booking_offer_review", "20261123090000_booking_reminders", "20261129090000_booking_page_host_variants", "20261130090000_booking_page_add_ons", "20261201090000_booking_page_photo", "20261202090000_booking_page_capacity", "20261203090000_booking_deposit", "20261211090000_booking_contact_link", "20261215090000_booking_resources", "20261215090100_booking_resource_columns", "20261215090200_booking_chair_uniqueness"]) {
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
      UPDATE booking_pages SET "bufferMinutes"=21 WHERE id='legacy-buffer-page';
      UPDATE booking_pages SET "bufferMinutes"=20 WHERE id='legacy-buffer-page';
      DO $$ BEGIN
        IF (SELECT version FROM booking_pages WHERE id='legacy-buffer-page') <> 2 THEN
          RAISE EXCEPTION 'Old page writer evaded the expansion version check';
        END IF;
      END $$;
      INSERT INTO bookings (id, "organizationId", "bookingPageId", "hostUserId", "startsAt", "endsAt", name, phone, "cancelTokenHash", "updatedAt")
      VALUES ('expansion-zero-probe', '${ORG}', 'legacy-buffer-page', '${HOST_A}', '2035-01-02 08:00:00', '2035-01-02 08:30:00', 'Legacy probe', '+994500000009', '${"a".repeat(64)}', CURRENT_TIMESTAMP);
      DO $$ BEGIN
        IF (SELECT "bufferBefore" FROM bookings WHERE id='expansion-zero-probe') <> 20 THEN
          RAISE EXCEPTION 'Expand legacy writer lost its page buffer';
        END IF;
      END $$;
      DELETE FROM bookings WHERE id='expansion-zero-probe';
    `)
    // Removing a never-canonical row within its transaction is compatible;
    // visiting any positive version before deletion must still roll back in A.
    for (const mutations of [
      `UPDATE bookings SET version=1 WHERE id='legacy-buffer-booking'; DELETE FROM bookings WHERE id='legacy-buffer-booking';`,
      `UPDATE bookings SET version=1 WHERE id='legacy-buffer-booking'; UPDATE bookings SET version=0 WHERE id='legacy-buffer-booking'; DELETE FROM bookings WHERE id='legacy-buffer-booking';`,
    ]) {
      expect(() => prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env,
        `BEGIN; ${mutations} COMMIT;`)).toThrow(/Booking disappeared|canonical booking cannot|cannot be deleted/i)
    }
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM bookings WHERE id='legacy-buffer-booking' AND version=0)
           OR EXISTS (SELECT 1 FROM bookings WHERE id='expansion-zero-probe') THEN
          RAISE EXCEPTION 'Expand deletion compatibility or canonical rollback failed';
        END IF;
      END $$;
    `)
    // B uses the same schema/functions as A. The single global mode transition
    // is permanent and guarded; it does not require another schema profile.
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env,
      "BEGIN; SET LOCAL app.booking_workspace_artifact_sha = '" + "a".repeat(40) + "';\n"
      + readFileSync(path.join(ROOT, "scripts/booking/activate-workspace.sql"), "utf8") + "\nCOMMIT;")

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
    settingsPatch = (await import("@/app/api/v1/booking-pages/[id]/route")).PATCH
    pageDelete = (await import("@/app/api/v1/booking-pages/[id]/route")).DELETE
    meetingsGet = (await import("@/app/api/v1/bookings/route")).GET
    meetingGet = (await import("@/app/api/v1/bookings/[id]/route")).GET
    taskLinkGet = (await import("@/app/api/v1/bookings/task-link/route")).GET
    actionsPost = (await import("@/app/api/v1/bookings/[id]/actions/route")).POST
    grantsPut = (await import("@/app/api/v1/bookings/coordinators/route")).PUT
    drain = (await import("@/lib/booking/effect-worker")).drainBookingEffects
    bookingTurn = (await import("@/lib/booking/whatsapp-agent")).handleWhatsAppBookingTurn
    reviewOffer = (await import("@/lib/booking/whatsapp-agent")).reviewPendingOffer
    OFFERS_PER_LIST = (await import("@/lib/booking/whatsapp-agent")).OFFERS_PER_LIST
    remindersPost = (await import("@/app/api/cron/booking-reminders/route")).POST
    requestsGet = (await import("@/app/api/v1/bookings/requests/route")).GET
    requestsPost = (await import("@/app/api/v1/bookings/requests/route")).POST
    tenant = (await import("@/lib/rls-context")).runWithTenant

  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(async () => {
    mail.sent = []
    whatsapp.buttons = []
    whatsapp.lists = []
    whatsapp.flows = []
    whatsapp.listFails = false
    // Offers hold a master's hours until they expire, and one menu holds eight
    // of them. Left standing, they are the previous test's holds eating this
    // test's day — every case here starts from a free board.
    await bypass(() => prisma.bookingOffer.updateMany({ where: { organizationId: ORG, status: "offered" }, data: { status: "superseded" } }))
    whatsapp.texts = []
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

  /** Book a named chair — a master or a room — the way the public page does. */
  async function bookOn(slug: string, startsAt: string, hostUserId: string) {
    const response = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, {
      idempotencyKey: randomUUID(), recoverySecret: randomUUID(), startsAt, hostUserId,
      name: "Müştəri", phone: "+994 50 123 45 67", email: "client@example.test", note: "",
    }), slugParams(slug))
    if (response.status === 201) await bypass(() => drain(ORG, 50))
    return response
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

  it("an expired sign-in-only Google account is not a calendar connection or an effect destination", async () => {
    const account = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google", providerAccountId: randomUUID(), access_token: "synthetic-expired", expires_at: 1, scope: "openid email profile" } }))
    try {
      const { calendarAccount } = await import("@/lib/google-calendar-account")
      expect(await bypass(() => calendarAccount(prisma, HOST_A))).toBeNull()
      const slug = await newPage()
      const response = await book(slug, await someSlot(slug, 28))
      expect(response.status, await response.clone().text()).toBe(201)
      const id = (await response.json()).data.id
      expect(await bypass(() => prisma.bookingIntegrationBinding.count({ where: { bookingId: id } }))).toBe(0)
      await bypass(() => drain(ORG, 50))
    } finally { await bypass(() => prisma.account.delete({ where: { id: account.id } })) }
  })

  it("fresh consent retires the old immutable credential generation and preserves SSO and historical binding identity", async () => {
    const { replaceCalendarConnection } = await import("@/lib/google-calendar-connection")
    const sso = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google", providerAccountId: randomUUID(), scope: "openid email profile" } }))
    const previous = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google-calendar", providerAccountId: randomUUID(), access_token: "synthetic-old", refresh_token: "synthetic-old-refresh" } }))
    let currentId: string | null = null
    try {
      const slug = await newPage()
      const page = await bypass(() => prisma.bookingPage.findUniqueOrThrow({ where: { slug } }))
      const row = await legacyFixture((tx) => tx.booking.create({ data: { organizationId: ORG, bookingPageId: page.id, hostUserId: HOST_A, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 88200000), name: "Synthetic connection generation", phone: "+994500000008", cancelTokenHash: randomUUID(), googleEventId: "old-generation-event" } }))
      const binding = await bypass(() => prisma.bookingIntegrationBinding.create({ data: { organizationId: ORG, bookingId: row.id, hostUserId: HOST_A, accountId: previous.id, generation: "legacy", providerEventId: "old-generation-event", desiredVersion: 0, state: "synced" } }))
      const current = await bypass(() => prisma.$transaction((tx) => replaceCalendarConnection(tx, ORG, HOST_A, { access_token: "synthetic-new-access", expiry_date: Date.now() + 3600000 }, "verified-new-primary")))
      currentId = current.id
      expect(current.id).not.toBe(previous.id)
      expect(current.refresh_token).toBeNull()
      const same = await bypass(() => prisma.$transaction((tx) => replaceCalendarConnection(tx, ORG, HOST_A, { access_token: "synthetic-renewed", refresh_token: "synthetic-new-refresh" }, "verified-new-primary")))
      const renewed = await bypass(() => prisma.$transaction((tx) => replaceCalendarConnection(tx, ORG, HOST_A, { access_token: "synthetic-renewed-again" }, "verified-new-primary")))
      expect(same.id).toBe(current.id)
      expect(renewed.id).toBe(current.id)
      expect(renewed.refresh_token).toBe("synthetic-new-refresh")
      expect(await bypass(() => prisma.account.findUnique({ where: { id: previous.id } }))).toBeNull()
      expect(await bypass(() => prisma.account.findUnique({ where: { id: sso.id } }))).not.toBeNull()
      expect(await bypass(() => prisma.bookingIntegrationBinding.findUniqueOrThrow({ where: { id: binding.id } }))).toMatchObject({ accountId: previous.id, providerEventId: "old-generation-event", state: "reconciliation_required" })
    } finally { await bypass(() => prisma.account.deleteMany({ where: { id: { in: [sso.id, previous.id, ...(currentId ? [currentId] : [])] } } })) }
  })

  it("a legacy event with no recorded credential identity is never assigned to the current calendar", async () => {
    const account = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google-calendar", providerAccountId: randomUUID(), access_token: "synthetic-current" } }))
    try {
      const slug = await newPage()
      const page = await bypass(() => prisma.bookingPage.findUniqueOrThrow({ where: { slug } }))
      const row = await legacyFixture((tx) => tx.booking.create({ data: { organizationId: ORG, bookingPageId: page.id, hostUserId: HOST_A, startsAt: new Date("2020-03-01T05:00:00Z"), endsAt: new Date("2020-03-01T05:30:00Z"), name: "Unproven legacy identity", phone: "+994500000009", cancelTokenHash: randomUUID(), googleEventId: "unverified-legacy-event" } }))
      calendar.update.mockClear(); calendar.insert.mockClear(); calendar.remove.mockClear()
      const response = await actionsPost(json("POST", `/api/v1/bookings/${row.id}/actions`, { operation: "outcome", outcome: "completed", version: 0, notifyCustomer: false, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id: row.id }) })
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await bypass(() => prisma.bookingIntegrationBinding.findFirstOrThrow({ where: { bookingId: row.id } }))).toMatchObject({ accountId: "unavailable", state: "reconciliation_required", providerEventId: "unverified-legacy-event", desiredState: "present" })
      await bypass(() => drain(ORG, 50))
      expect(calendar.update).not.toHaveBeenCalled()
      expect(calendar.insert).not.toHaveBeenCalled()
      expect(calendar.remove).not.toHaveBeenCalled()
    } finally { await bypass(() => prisma.account.delete({ where: { id: account.id } })) }
  })

  it("a connection changed during availability cannot be adopted as an unchecked booking destination", async () => {
    const google = await import("@/lib/google-calendar")
    const { replaceCalendarConnection } = await import("@/lib/google-calendar-connection")
    const previous = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google-calendar", providerAccountId: randomUUID(), access_token: "synthetic-old" } }))
    let currentId: string | null = null
    try {
      const slug = await newPage()
      const startsAt = await someSlot(slug, 30)
      vi.mocked(google.listBusyIntervals).mockImplementationOnce(async () => {
        const current = await bypass(() => prisma.$transaction((tx) => replaceCalendarConnection(tx, ORG, HOST_A, { access_token: "synthetic-new-access" }, "verified-other-primary")))
        currentId = current.id
        return []
      })
      const response = await book(slug, startsAt)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: "AVAILABILITY_CHANGED" })
      expect(await bypass(() => prisma.booking.count({ where: { bookingPage: { slug } } }))).toBe(0)
    } finally {
      vi.mocked(google.listBusyIntervals).mockResolvedValue(null)
      await bypass(() => prisma.account.deleteMany({ where: { id: { in: [previous.id, ...(currentId ? [currentId] : [])] } } }))
    }
  })

  it("an hour taken in Outlook leaves the page, and the meeting lands on every calendar the host connected", async () => {
    const outlookAccount = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "microsoft-calendar", providerAccountId: randomUUID(), access_token: "synthetic-outlook", refresh_token: "synthetic-outlook-refresh" } }))
    const googleAccount = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "google-calendar", providerAccountId: randomUUID(), access_token: "synthetic-google" } }))
    try {
      const slug = await newPage()
      const taken = await someSlot(slug, 32)
      outlook.events.mockResolvedValue([{ id: "outlook-busy", start: new Date(taken), end: new Date(Date.parse(taken) + 30 * 60_000), subject: "Planerka" }])
      const after = await view(slug)
      expect(after.body.data.days.flatMap((day: { slots: { startsAt: string }[] }) => day.slots.map((slot) => slot.startsAt))).not.toContain(taken)

      outlook.events.mockResolvedValue([])
      outlook.create.mockClear(); outlook.update.mockClear(); calendar.update.mockClear()
      const response = await book(slug, await someSlot(slug, 33))
      expect(response.status, await response.clone().text()).toBe(201)
      const id = (await response.json()).data.id
      const bindings = await bypass(() => prisma.bookingIntegrationBinding.findMany({ where: { bookingId: id } }))
      expect(bindings).toHaveLength(2)
      const toOutlook = bindings.find((binding) => binding.accountId === outlookAccount.id)!
      const toGoogle = bindings.find((binding) => binding.accountId === googleAccount.id)!
      // Graph hands out the id, so the binding learns it only after the write.
      expect(outlook.create.mock.calls[0][2]).toBe(toOutlook.generation)
      expect(toOutlook).toMatchObject({ providerEventId: "graph-event-1", state: "synced" })
      expect(toGoogle).toMatchObject({ state: "synced" })
      expect(calendar.update).toHaveBeenCalled()
      // The legacy column stays what it says it is: the Google event.
      expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))).googleEventId).toBe(toGoogle.providerEventId)
    } finally {
      outlook.events.mockResolvedValue([])
      await bypass(() => prisma.account.deleteMany({ where: { id: { in: [outlookAccount.id, googleAccount.id] } } }))
    }
  })

  it("a create whose answer was lost does not put the same visit in Outlook twice", async () => {
    const account = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "microsoft-calendar", providerAccountId: randomUUID(), access_token: "synthetic-outlook" } }))
    try {
      outlook.create.mockClear(); outlook.update.mockClear()
      // Microsoft already has the event from the attempt whose answer never
      // arrived, and says so when asked by the transaction identifier.
      outlook.byTransaction.mockResolvedValue("graph-event-from-lost-answer")
      const slug = await newPage()
      const response = await book(slug, await someSlot(slug, 34))
      expect(response.status, await response.clone().text()).toBe(201)
      const id = (await response.json()).data.id
      expect(outlook.create).not.toHaveBeenCalled()
      expect(outlook.update.mock.calls[0][1]).toBe("graph-event-from-lost-answer")
      expect(await bypass(() => prisma.bookingIntegrationBinding.findFirstOrThrow({ where: { bookingId: id } }))).toMatchObject({ providerEventId: "graph-event-from-lost-answer", state: "synced" })
    } finally {
      outlook.byTransaction.mockResolvedValue(null)
      await bypass(() => prisma.account.deleteMany({ where: { id: account.id } }))
    }
  })

  it("what an hour is taken by goes only to the person whose calendar it is", async () => {
    const account = await bypass(() => prisma.account.create({ data: { userId: HOST_A, type: "oauth", provider: "microsoft-calendar", providerAccountId: randomUUID(), access_token: "synthetic-outlook" } }))
    try {
      const externalGet = (await import("@/app/api/v1/bookings/external-events/route")).GET
      const start = new Date(Date.now() + 36 * 3600_000)
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).format(start)
      outlook.events.mockResolvedValue([{ id: "outlook-busy", start, end: new Date(start.getTime() + 3600_000), subject: "Dişçi" }])
      const ask = () => externalGet(json("GET", `/api/v1/bookings/external-events?hostId=${HOST_A}&day=${day}`))

      session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Leyla" } }
      const own = await ask()
      expect(own.status, await own.clone().text()).toBe(200)
      expect((await own.json()).data.events).toEqual([{ start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString(), provider: "microsoft", title: "Dişçi" }])

      // An administrator may see that the hour is gone — the free slots say
      // as much already — but a private calendar's subject is not theirs.
      signIn("admin")
      const foreign = await ask()
      expect(foreign.status).toBe(200)
      expect((await foreign.json()).data.events).toEqual([{ start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString(), provider: "microsoft", title: null }])

      // A colleague with no claim on this host's day is refused outright.
      session.current = { user: { id: HOST_B, organizationId: ORG, role: "manager", email: "b@example.test", name: "Aysel" } }
      expect((await ask()).status).toBe(403)
    } finally {
      outlook.events.mockResolvedValue([])
      signIn("admin")
      await bypass(() => prisma.account.deleteMany({ where: { id: account.id } }))
    }
  })

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

  it.each(["UTC", "Europe/Berlin", "Asia/Baku", "America/New_York"])(
    "projects the booked meeting when the database default timezone is %s",
    async (timezone) => {
      const slug = await newPage()
      const startsAt = await someSlot(slug, 20)
      // Create while the scratch DB is in UTC. Only the real background
      // worker runs against the changed database default below.
      const response = await pagePost(json("POST", `/api/v1/public/booking/${slug}`, {
        idempotencyKey: randomUUID(), recoverySecret: randomUUID(), startsAt,
        name: `Timezone worker ${timezone}`, phone: "+994500000007",
      }), slugParams(slug))
      expect(response.status, await response.clone().text()).toBe(201)
      const { data: { id } } = await response.json()
      const before = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
      expect(before).toMatchObject({ leadId: null, taskId: null })

      try {
        // This changes only this suite's newly created disposable database.
        // Reconnect so the actual Prisma pool inherits its default TimeZone;
        // setting a session variable on one arbitrary pool connection is not
        // a reliable reproduction of the production worker configuration.
        prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env,
          `ALTER DATABASE "${scratch!.name}" SET timezone TO '${timezone}';`)
        await prisma.$disconnect()
        const { PrismaClient: RawPrismaClient } = await import("@prisma/client")
        const probe = new RawPrismaClient({ datasourceUrl: scratch!.url })
        try {
          expect(await probe.$queryRawUnsafe<Array<{ TimeZone: string }>>("SHOW TimeZone"))
            .toEqual([{ TimeZone: timezone }])
        } finally { await probe.$disconnect() }
        await bypass(() => drain(ORG, 50))
      } finally {
        prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env,
          `ALTER DATABASE "${scratch!.name}" SET timezone TO 'UTC';`)
        await prisma.$disconnect()
      }

      const effects = await bypass(() => prisma.effectOutbox.findMany({
        where: { organizationId: ORG, effectType: "booking.project", payload: { path: ["bookingId"], equals: id } },
        select: { status: true, lastError: true },
      }))
      expect(effects).toEqual([{ status: "succeeded", lastError: null }])
      const after = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
      expect(after.leadId).not.toBeNull()
      expect(after.taskId).not.toBeNull()
      expect(await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: after.taskId! } })))
        .toMatchObject({ assignedTo: HOST_A, status: "pending", relatedId: after.leadId })
    },
  )

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

  it("a host's own working days cut the page's hours, and a time outside them is refused", async () => {
    const slug = await newPage()
    const outside = await someSlot(slug)
    const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baku" }).format(new Date(iso))
    expect(clock(outside)).not.toMatch(/^10:/)

    // The page is open all day; Leyla is there for one hour. Free time is the
    // intersection, and the page must not offer what she cannot take.
    await bypass(() => prisma.bookingHostSchedule.create({ data: {
      organizationId: ORG, userId: HOST_A,
      weekly: Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [{ start: "10:00", end: "11:00" }]])),
    } }))
    const limited = (await view(slug)).body.data.days.flatMap((day: { slots: { startsAt: string }[] }) => day.slots.map((slot) => slot.startsAt))
    expect(limited.length).toBeGreaterThan(0)
    for (const startsAt of limited) expect(clock(startsAt)).toMatch(/^10:(00|30)$/)
    expect(limited).not.toContain(outside)

    // And the check that actually protects the day: a stale page cannot book
    // an hour the host does not work.
    expect((await book(slug, outside)).status).toBe(409)

    // No row means the page's hours, exactly as before schedules existed.
    await bypass(() => prisma.bookingHostSchedule.deleteMany({ where: { organizationId: ORG, userId: HOST_A } }))
    const restored = (await view(slug)).body.data.days.flatMap((day: { slots: { startsAt: string }[] }) => day.slots)
    expect(restored.length).toBeGreaterThan(limited.length)
  })

  it("a service carries a price, a group and a cycle, and the meeting keeps the price the client agreed to", async () => {
    // The currency is the organization's own and the form never sends one:
    // «25» typed in a salon that works in manats must not become dollars.
    await bypass(() => prisma.organization.update({ where: { id: ORG }, data: { settings: { timezone: "Asia/Baku", invoice: { defaultCurrency: "AZN" } } } }))
    try {
      const slug = await newPage({ price: 25.5, category: " Saç ", repeatCycleDays: 28 })
      const body = (over: Record<string, unknown> = {}) => ({
        title: "Tanışlıq", slug, description: null, durationMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 60,
        maxDaysAhead: 3, locationType: "online", locationText: null, hostIds: [HOST_A], weekly: ALL_DAY, isActive: true, ...over,
      })
      const list = await (await settingsGet(json("GET", "/api/v1/booking-pages"))).json()
      const row = list.data.pages.find((page: { slug: string }) => page.slug === slug)
      // A string, because Decimal is not JSON — and trimmed, because « Saç »
      // and «Saç» must not become two groups.
      expect(typeof row.price).toBe("string")
      expect([Number(row.price), row.priceCurrency, row.category, row.repeatCycleDays]).toEqual([25.5, "AZN", "Saç", 28])

      // The customer reads the price before agreeing to it.
      const offered = (await view(slug)).body.data.page
      expect([Number(offered.price), offered.priceCurrency]).toEqual([25.5, "AZN"])

      const startsAt = await someSlot(slug, 9)
      const created = await book(slug, startsAt)
      expect(created.status, await created.clone().text()).toBe(201)
      const id = (await created.json()).data.id

      // The salon raises the price. The meeting already made still says what
      // the client agreed to, and still carries its cycle.
      const raised = await settingsPatch(json("PATCH", `/api/v1/booking-pages/${row.id}`, body({ price: 40, category: "Saç", repeatCycleDays: 28 })), { params: Promise.resolve({ id: row.id }) })
      expect(raised.status, await raised.clone().text()).toBe(200)
      const card = (await (await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).json()).data
      expect([Number(card.bookingPage.price), card.bookingPage.priceCurrency, card.bookingPage.repeatCycleDays]).toEqual([25.5, "AZN", 28])

      // A cleared price leaves no currency behind, and a nonsense cycle is refused.
      const cleared = await settingsPatch(json("PATCH", `/api/v1/booking-pages/${row.id}`, body({ price: null, category: null, repeatCycleDays: null })), { params: Promise.resolve({ id: row.id }) })
      expect(cleared.status, await cleared.clone().text()).toBe(200)
      const after = await bypass(() => prisma.bookingPage.findFirst({ where: { id: row.id }, select: { price: true, priceCurrency: true, category: true, repeatCycleDays: true } }))
      expect([after!.price, after!.priceCurrency, after!.category, after!.repeatCycleDays]).toEqual([null, null, null, null])
      const silly = await settingsPatch(json("PATCH", `/api/v1/booking-pages/${row.id}`, body({ repeatCycleDays: 4000 })), { params: Promise.resolve({ id: row.id }) })
      expect(silly.status).toBe(400)
    } finally {
      await bypass(() => prisma.organization.update({ where: { id: ORG }, data: { settings: { timezone: "Asia/Baku" } } }))
    }
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
    await expect(bypass(() => prisma.booking.update({ where: { id }, data: { version: 0 } })))
      .rejects.toThrow(/canonical booking cannot return to legacy version zero/i)
    // The same permanent function guards A and B; activation never relaxes it.
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

  it("task navigation obeys real own/team/tenant scope and revoked grants", async () => {
    const slug = await newPage({ hostIds: [HOST_B] })
    const response = await book(slug, await someSlot(slug, 18))
    expect(response.status).toBe(201)
    const id = (await response.json()).data.id
    const row = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(row.taskId).toBeTruthy()
    const before = await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: row.taskId! } }))
    const taskRoutes = await import("@/app/api/v1/tasks/[id]/route")
    const params = { params: Promise.resolve({ id: row.taskId! }) }
    const edit = await taskRoutes.PATCH(json("PATCH", `/api/v1/tasks/${row.taskId}`, { title: "Must not overwrite meeting" }), params)
    expect(edit.status).toBe(409)
    expect((await edit.json()).code).toBe("BOOKING_MANAGED_TASK")
    const remove = await taskRoutes.DELETE(json("DELETE", `/api/v1/tasks/${row.taskId}`), params)
    expect(remove.status).toBe(409)
    expect((await remove.json()).code).toBe("BOOKING_MANAGED_TASK")
    const preserved = await bypass(() => prisma.task.findUniqueOrThrow({ where: { id: row.taskId! } }))
    expect(preserved.title).toBe(before.title)
    expect(preserved.deletedAt).toBeNull()
    const request = () => json("GET", `/api/v1/bookings/task-link?taskId=${encodeURIComponent(row.taskId!)}`)
    const asHostA = () => { session.current = { user: { id: HOST_A, organizationId: ORG, role: "manager", email: "a@example.test", name: "Staff" } } }
    asHostA()
    expect((await (await taskLinkGet(request())).json()).data).toBeNull()
    signIn("admin")
    expect((await grantsPut(json("PUT", "/api/v1/bookings/coordinators", { coordinatorUserId: HOST_A, hostIds: [HOST_B], canManage: false }))).status).toBe(200)
    asHostA()
    const visible = await taskLinkGet(request())
    expect(visible.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await visible.json()).toEqual({ success: true, data: { bookingId: id } })
    signIn("admin")
    await grantsPut(json("PUT", "/api/v1/bookings/coordinators", { coordinatorUserId: HOST_A, hostIds: [], canManage: false }))
    asHostA()
    expect((await (await taskLinkGet(request())).json()).data).toBeNull()
    signIn("admin", OTHER_ORG)
    expect((await (await taskLinkGet(request())).json()).data).toBeNull()
    await bypass(() => prisma.user.create({ data: { id: `user-viewer-${ORG}`, organizationId: ORG, email: "viewer-booking@example.test", name: "Viewer", passwordHash: "-", role: "viewer" } }))
    signIn("viewer")
    expect((await taskLinkGet(request())).status).toBe(403)
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

  /**
   * The deposit is money, and the only thing the CRM does with it is say what
   * happened. So this is about what the record REFUSES: a second press, a
   * refund of money the late cancellation left with the salon, and a card
   * payment landing on a visit a manager already marked by hand.
   */
  it("a deposit is marked once by hand, and a late card payment does not re-mark it", async () => {
    const { applyDepositPaymentInTx } = await import("@/lib/booking/deposit-checkout")
    const slug = await newPage({ price: 40, depositPercent: 25, depositFreeHours: 24 })
    const id = (await (await book(slug, await someSlot(slug, 22))).json()).data.id
    const booked = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(booked.depositStatus).toBe("awaiting")
    expect(Number(booked.depositAmount)).toBe(10)

    const press = (version: number, deposit: string) => actionsPost(
      json("POST", `/api/v1/bookings/${id}/actions`, { operation: "deposit", deposit, version, idempotencyKey: randomUUID() }),
      { params: Promise.resolve({ id }) },
    )
    const marked = await press(booked.version, "paid")
    expect(marked.status, await marked.clone().text()).toBe(200)
    const paid = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(paid.depositStatus).toBe("paid")
    expect(paid.depositPaidAt).toBeInstanceOf(Date)
    expect(paid.version).toBe(booked.version + 1)
    expect((await bypass(() => prisma.domainEvent.findMany({ where: { organizationId: ORG, aggregateType: "booking", aggregateId: id } }))).map((event) => event.eventType))
      .toContain("sales.booking-deposit-paid.v1")

    // The same button again, at the version it now has: refused, not re-stamped.
    expect((await press(paid.version, "paid")).status).toBe(409)
    // The customer's card arrives a minute after the manager said «received».
    // The payment is real and stays recorded as an intent; the meeting keeps
    // the mark it already has, and gains no second «paid» in its history.
    const late = await bypass(() => prisma.$transaction((tx) => applyDepositPaymentInTx(tx, { orgId: ORG, bookingId: id, paidAt: new Date() })))
    expect(late).toBe("already")
    const unchanged = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(unchanged.version).toBe(paid.version)
    expect(unchanged.depositPaidAt).toEqual(paid.depositPaidAt)

    // Cancelled in time, so the salon owes it back — and may say it sent it,
    // exactly once.
    const cancelled = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "cancel", version: unchanged.version, notifyCustomer: false, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })
    expect(cancelled.status, await cancelled.clone().text()).toBe(200)
    const owed = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(owed.depositStatus).toBe("refund_due")
    expect((await press(owed.version, "paid")).status).toBe(409)
    expect((await press(owed.version, "refunded")).status).toBe(200)
    const returned = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(returned.depositStatus).toBe("refunded")
    expect((await press(returned.version, "refunded")).status).toBe(409)
  })

  /**
   * «Kept» is the whole reason a deposit exists: cancel too late and the hour
   * is gone. A card on the meeting must not be able to hand it back.
   */
  it("a deposit kept by a late cancellation cannot be returned from the card", async () => {
    const slug = await newPage({ price: 40, depositAmount: 15, depositFreeHours: 720 })
    const id = (await (await book(slug, await someSlot(slug, 24))).json()).data.id
    const booked = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    const marked = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "deposit", deposit: "paid", version: booked.version, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })
    expect(marked.status, await marked.clone().text()).toBe(200)
    const paid = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    // 720 free hours is further ahead than this meeting is, so cancelling now
    // is «late» by the service's own rule.
    const cancelled = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "cancel", version: paid.version, notifyCustomer: false, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })
    expect(cancelled.status, await cancelled.clone().text()).toBe(200)
    const kept = await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))
    expect(kept.depositStatus).toBe("kept")
    const refund = await actionsPost(json("POST", `/api/v1/bookings/${id}/actions`, { operation: "deposit", deposit: "refunded", version: kept.version, idempotencyKey: randomUUID() }), { params: Promise.resolve({ id }) })
    expect(refund.status).toBe(409)
    expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id } }))).depositStatus).toBe("kept")
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

  it("deletes a service nothing points at, and refuses one that has meetings", async () => {
    // The owner, looking at a test page left by a role test: «вот например ты
    // тестовое создал, как его удалить?» (2026-11-12). Deleting is for a
    // service nothing points at; one with meetings is switched off instead,
    // because its name, its length and its price are what those meetings say
    // they were.
    // A host's busy time is shared by all their pages, so this takes the one
    // the room tests leave alone, in a window of its own.
    const spare = await newPage({ title: "Silinəcək", hostIds: [HOST_B] })
    const spareRow = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug: spare } }))
    const used = await newPage({ title: "Silinməyəcək", hostIds: [HOST_B] })
    const usedRow = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug: used } }))
    expect((await book(used, await slotWithin(used, 26 * 3600_000, 30 * 3600_000))).status).toBe(201)

    const remove = (id: string) => pageDelete(json("DELETE", `/api/v1/booking-pages/${id}`), { params: Promise.resolve({ id }) })
    expect((await remove(spareRow.id)).status).toBe(200)
    expect(await bypass(() => prisma.bookingPage.count({ where: { id: spareRow.id } }))).toBe(0)

    const refused = await remove(usedRow.id)
    expect(refused.status).toBe(409)
    expect((await refused.json()).code).toBe("PAGE_IN_USE")
    expect(await bypass(() => prisma.bookingPage.count({ where: { id: usedRow.id } }))).toBe(1)

    // And the list says which is which, so the screen can offer the button
    // only where it works.
    const listed = (await (await settingsGet(json("GET", "/api/v1/booking-pages"))).json()).data.pages as { id: string; everBooked: boolean }[]
    expect(listed.find((page) => page.id === usedRow.id)?.everBooked).toBe(true)
  })

  it("shows the name the CRM has for that number, and keeps the one the client gave", async () => {
    // A meeting keeps the name the customer typed — or the one their WhatsApp
    // profile carries, set years ago. When the CRM already knows the number,
    // the salon reads its own name for them (owner, 2026-11-12: «если в CRM
    // имя контакта добавлено, то пусть отображает имя»). Matched on digits:
    // «+994 50 123 45 67» and «0501234567» are one person.
    const slug = await newPage({ title: "Tanışlıq", hostIds: [HOST_B] })
    const at = await slotWithin(slug, 30 * 3600_000, 34 * 3600_000)
    expect((await book(slug, at, "Nigar")).status).toBe(201)
    await bypass(() => prisma.contact.create({ data: {
      organizationId: ORG, fullName: "Rəşad Rəhimov", phone: "0501234567",
    } }))

    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    const list = await meetingsGet(json("GET", `/api/v1/bookings?page=${page.id}&limit=50`))
    const items = (await list.json()).data.items as { name: string; bookedName: string; phone: string }[]
    const mine = items.find((item) => item.phone.replace(/\D/g, "").endsWith("501234567"))!

    expect(mine.name).toBe("Rəşad Rəhimov")
    // And what they called themselves is not lost: the salon can still see
    // whom the form was filled in by.
    expect(mine.bookedName).toBe("Nigar")
  })

  // ─── Rooms, chairs, machines (src/lib/booking/book.ts, bookableChairs) ────

  it("a room is a chair of its own: two rooms do not block each other, and neither blocks their owner", async () => {
    // The module was built for salons, so everything bookable was a master.
    // A coworking books rooms and nobody does them (owner, 2026-11-12), and
    // a room that was a fake employee would take a seat in the plan and could
    // sign in. What has to be true for a room to be a chair at all:
    //
    //   • two rooms on one service are two chairs — booking one leaves the
    //     other free at the same minute;
    //   • a room's meeting belongs to the room, so the master who owns it in
    //     the record is still free then — the whole reason rooms exist;
    //   • a room switched off stops being offered and keeps its meetings.
    const rooms = await Promise.all(["Otaq 1", "Otaq 2"].map((name) => bypass(() =>
      prisma.bookingResource.create({ data: { organizationId: ORG, name }, select: { id: true, name: true } }))))
    const slug = await newPage({ title: "Toplantı", durationMinutes: 60, hostIds: [HOST_A], resourceIds: rooms.map((room) => room.id) })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    const at = await slotWithin(slug, 36 * 3600_000, 96 * 3600_000)

    // The same minute is free on both rooms: two rooms are two chairs.
    const first = await bookOn(slug, at, rooms[0].id)
    expect(first.status, await first.clone().text()).toBe(201)
    const second = await bookOn(slug, at, rooms[1].id)
    expect(second.status, await second.clone().text()).toBe(201)

    const meetings = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" }, orderBy: { createdAt: "asc" } }))
    expect(meetings).toHaveLength(2)
    expect(meetings.map((meeting) => meeting.resourceId)).toEqual([rooms[0].id, rooms[1].id])
    // A meeting on a room still belongs to a master in the record — the column
    // has pointed at a user since the first release — and that master is the
    // service's own first one.
    expect(new Set(meetings.map((meeting) => meeting.hostUserId))).toEqual(new Set([HOST_A]))
    // And his own day is untouched: the service he actually gives is free at
    // that very minute, which is the whole reason rooms exist.
    const ownService = await newPage({ title: "Məsləhət", durationMinutes: 60, hostIds: [HOST_A] })
    const onHost = await bookOn(ownService, at, HOST_A)
    expect(onHost.status, await onHost.clone().text()).toBe(201)

    // The same room at the same minute is taken, as a master would be.
    const again = await bookOn(slug, at, rooms[0].id)
    expect(again.status).toBe(409)

    // Switched off, it stops being offered — and keeps the meeting it holds.
    await bypass(() => prisma.bookingResource.update({ where: { id: rooms[1].id }, data: { isActive: false } }))
    const { body } = await view(slug)
    expect(JSON.stringify(body.data)).not.toContain(rooms[1].id)
    expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG, resourceId: rooms[1].id, status: "confirmed" } }))).toBe(1)
  })

  it("the wall screen stands a room's meeting in the room's column, and the settings name whose meetings a narrowed screen leaves out", async () => {
    // Two things the owner found on the same morning (2026-11-13), standing at
    // the monitor with a booking he knew existed: the screen was empty, and
    // nothing said why. It was narrowed to four masters and the visit was with
    // a fifth. And an office that books rooms wants a column per ROOM — while
    // the record files a room's meeting under the service's first master, who
    // is not in it. So, on real rows:
    //
    //   • a meeting booked on a room is in the room's column and NOT in the
    //     column of the master it is filed under;
    //   • a screen narrowed to some chairs shows only theirs;
    //   • the settings count what a screen holds that day and name whose
    //     meetings it leaves out.
    const { boardByToken, boardLinksToday } = await import("@/lib/booking/board")
    // Its own people and its own room: nobody else's day stands in this one.
    const owner = `user-wall-owner-${ORG}`
    const other = `user-wall-other-${ORG}`
    await bypass(() => prisma.user.createMany({ data: [
      { id: owner, organizationId: ORG, email: `${owner}@example.test`, name: "Aysel", passwordHash: "-", role: "manager" },
      { id: other, organizationId: ORG, email: `${other}@example.test`, name: "Leyla", passwordHash: "-", role: "manager" },
    ] }))
    const room = await bypass(() => prisma.bookingResource.create({ data: { organizationId: ORG, name: "Otaq A" }, select: { id: true } }))
    const roomSlug = await newPage({ title: "İclas otağı", durationMinutes: 60, hostIds: [owner], resourceIds: [room.id] })
    const cutSlug = await newPage({ title: "Saç kəsimi", durationMinutes: 60, hostIds: [other] })
    const at = await slotWithin(roomSlug, 36 * 3600_000, 60 * 3600_000)
    const onRoom = await bookOn(roomSlug, at, room.id)
    expect(onRoom.status, await onRoom.clone().text()).toBe(201)
    const onOther = await bookOn(cutSlug, at, other)
    expect(onOther.status, await onOther.clone().text()).toBe(201)
    // The record itself still files the room's meeting under the owner — that
    // is the trap the screen has to step over.
    expect((await bypass(() => prisma.booking.findFirstOrThrow({ where: { organizationId: ORG, resourceId: room.id } }))).hostUserId).toBe(owner)

    const narrowed = { id: "wall-narrowed", token: `wall-narrowed-${"n".repeat(24)}`, hostIds: [owner, room.id] }
    const everyone = { id: "wall-everyone", token: `wall-everyone-${"e".repeat(24)}`, hostIds: [] as string[] }
    await bypass(() => prisma.bookingBoardLink.createMany({ data: [narrowed, everyone].map((link) => ({
      ...link, organizationId: ORG, title: "ZAL1", columns: 2, createdBy: owner,
    })) }))
    const thatDay = new Date(at)

    const board = await boardByToken(narrowed.token, thatDay)
    expect(board?.hosts.map((column) => ({ name: column.hostName, room: column.room === true, meetings: column.meetings.map((meeting) => meeting.service) }))).toEqual([
      // Aysel is free: the room's meeting is not hers, whatever the record says.
      { name: "Aysel", room: false, meetings: [] },
      { name: "Otaq A", room: true, meetings: ["İclas otağı"] },
    ])
    // Still a name and a service and nothing else of the client.
    expect(Object.keys(board!.hosts[1].meetings[0]).sort()).toEqual(["end", "hostId", "id", "name", "service", "start"])
    expect(JSON.stringify(board)).not.toContain("50 123")

    // Nobody chosen: every chair with a meeting that day gets a column, the
    // room as a room — and the owner gets none, because she has no meeting.
    const whole = await boardByToken(everyone.token, thatDay)
    expect(whole?.hosts.find((column) => column.hostId === room.id)).toMatchObject({ hostName: "Otaq A", room: true })
    expect(whole?.hosts.find((column) => column.hostId === other)?.meetings.map((meeting) => meeting.service)).toEqual(["Saç kəsimi"])
    expect(whole?.hosts.some((column) => column.hostId === owner)).toBe(false)

    // What the settings say about that day, read under the tenant's own scope.
    const today = await tenant(ORG, () => boardLinksToday(ORG, [narrowed, everyone], thatDay))
    expect(today.get(narrowed.id)?.shown).toBe(1)
    expect(today.get(narrowed.id)?.elsewhere).toContainEqual({ name: "Leyla", count: 1 })
    expect(today.get(narrowed.id)?.elsewhere.some((item) => item.name === "Otaq A" || item.name === "Aysel")).toBe(false)
    // A screen that leaves nobody out has nothing to explain.
    expect(today.get(everyone.id)?.elsewhere).toEqual([])
    expect(today.get(everyone.id)?.shown).toBeGreaterThanOrEqual(2)

    // And the settings API carries it, and takes a room for a column.
    const boards = await import("@/app/api/v1/booking-pages/board/route")
    const listed = await boards.GET(json("GET", "/api/v1/booking-pages/board"))
    const links = (await listed.json()).data.links as { id: string; today: { shown: number; elsewhere: unknown[] } }[]
    expect(links.find((link) => link.id === narrowed.id)?.today).toEqual({ shown: expect.any(Number), elsewhere: expect.any(Array) })
    const made = await boards.POST(json("POST", "/api/v1/booking-pages/board", { title: "Otaqlar", hostIds: [room.id], columns: 1 }))
    expect(made.status, await made.clone().text()).toBe(201)
    // A screen of rooms alone: the room's meeting is found through the room,
    // not through the master it is filed under — she is not on this screen.
    const roomsOnly = await bypass(() => prisma.bookingBoardLink.findFirstOrThrow({ where: { organizationId: ORG, title: "Otaqlar" } }))
    const office = await boardByToken(roomsOnly.token, thatDay)
    expect(office?.hosts.map((column) => [column.hostName, column.meetings.map((meeting) => meeting.service)])).toEqual([["Otaq A", ["İclas otağı"]]])
    // …but never somebody else's: a screen is not a way to read another tenant's day.
    const foreign = await boards.POST(json("POST", "/api/v1/booking-pages/board", { title: "Özgə", hostIds: ["room-of-nobody"], columns: 1 }))
    expect(foreign.status).toBe(400)
  })

  it("a room keeps its own hours: it is booked inside them and refused outside", async () => {
    // A room with no hours of its own is open whenever the service is, exactly
    // like a master without a schedule. One that has them is the narrower of
    // the two — a meeting room in a building that closes at six.
    const room = await bypass(() => prisma.bookingResource.create({
      data: { organizationId: ORG, name: "Otaq 3", weekly: { "1": [{ start: "10:00", end: "11:00" }], "2": [{ start: "10:00", end: "11:00" }], "3": [{ start: "10:00", end: "11:00" }], "4": [{ start: "10:00", end: "11:00" }], "5": [{ start: "10:00", end: "11:00" }], "6": [{ start: "10:00", end: "11:00" }], "0": [{ start: "10:00", end: "11:00" }] } },
      select: { id: true },
    }))
    const slug = await newPage({ title: "Otaq 3 üçün", durationMinutes: 30, hostIds: [HOST_B], resourceIds: [room.id] })
    const { body } = await view(slug)
    const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baku" }).format(new Date(iso))
    const ahead = (iso: string) => Date.parse(iso) - Date.now() > 36 * 3600_000
    const times = (body.data.days as { slots: { startsAt: string }[] }[])
      .flatMap((day) => day.slots.map((slot) => slot.startsAt)).filter(ahead)
    // A service booked in a room is offered for the room's hours and nothing
    // else: its master's wide-open day is bookkeeping, not an offer.
    expect(times.length).toBeGreaterThan(0)
    for (const time of times) expect(clock(time), time).toMatch(/^10:(00|30)$/)
    const inside = times[0]
    // Three in the afternoon: inside the master's day, outside the room's.
    const outside = new Date(Date.parse(inside) + 5 * 3600_000).toISOString()

    expect((await bookOn(slug, inside, room.id)).status).toBe(201)
    // Outside its hour the room is simply not a free chair — and a service
    // booked in rooms is not booked on its bookkeeping master either.
    expect((await bookOn(slug, outside, room.id)).status).toBe(409)
    expect((await bookOn(slug, outside, HOST_B)).status).toBe(409)
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    const meetings = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
    expect(meetings.map((meeting) => meeting.resourceId)).toEqual([room.id])
  })

  // ─── WhatsApp booking (src/lib/booking/whatsapp-agent.ts) ─────────────────
  // The model is a stand-in that answers with a fixed decision; everything it
  // decides about is real — the free time, the holds, the booking, the locks.

  /** A model that answers every turn with this one decision. */
  const decides = (input: Record<string, unknown>) => {
    const create = vi.fn(async () => ({ content: [{ type: "tool_use", id: "toolu_test", name: "booking_turn", input }], usage: { input_tokens: 40, output_tokens: 12 } }))
    return { messages: { create } } as unknown as Parameters<typeof bookingTurn>[0]["client"] & { messages: { create: typeof create } }
  }

  async function withWhatsAppBooking(run: () => Promise<void>, extra: Record<string, unknown> = {}) {
    const before = await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: ORG }, select: { settings: true } }))
    const { bookingWhatsApp, ...rest } = extra as { bookingWhatsApp?: unknown }
    const booking = bookingWhatsApp === null
      // The salon books cheap services itself and brings the dear ones to a person.
      ? { mode: "book", channelConfigId: null, rules: { maxPrice: 50 } }
      // Anything else given is the rest of the setting — `flowId`, say, which
      // is what decides whether a client is sent a form or a list.
      : { mode: "book", channelConfigId: null, ...(bookingWhatsApp && typeof bookingWhatsApp === "object" ? bookingWhatsApp : {}) }
    await bypass(() => prisma.organization.update({ where: { id: ORG }, data: { settings: { ...(before.settings as Record<string, unknown>), ...rest, bookingWhatsApp: booking } } }))
    try {
      await run()
    } finally {
      await bypass(() => prisma.organization.update({ where: { id: ORG }, data: { settings: before.settings as GeneratedPrisma.InputJsonValue } }))
    }
  }

  const turnIn = (conversationId: string, over: Partial<Parameters<typeof bookingTurn>[0]>) => tenant(ORG, () => bookingTurn({
    organizationId: ORG, channelConfigId: "channel-wa", conversationId, waPhone: "994551234567", senderName: "Nigar",
    text: "Sabah saç kəsiminə yazılmaq olar?", replyId: null, ...over,
  }))
  /** Only the digits, the way WhatsApp names a number. */
  const phoneDigitsOf = (value: string) => value.replace(/\D/g, "")

  /** A slot the page offers whose start falls in the window asked for. */
  async function slotWithin(slug: string, fromMs: number, toMs: number) {
    const { body } = await view(slug)
    const now = Date.now()
    for (const day of body.data.days as { slots: { startsAt: string }[] }[]) {
      for (const slot of day.slots) {
        const ahead = Date.parse(slot.startsAt) - now
        if (ahead >= fromMs && ahead <= toMs) return slot.startsAt
      }
    }
    throw new Error("the page offers no slot in the window the reminder needs")
  }

  /** A WhatsApp conversation with one inbound message, as the webhook leaves it. */
  async function conversationWith(waPhone: string, name: string, body: string) {
    const conversation = await bypass(() => prisma.socialConversation.create({ data: {
      organizationId: ORG, platform: "whatsapp", externalId: `wa-${randomUUID()}`, contactName: name,
    } }))
    await bypass(() => prisma.channelMessage.create({ data: {
      organizationId: ORG, channelType: "whatsapp", direction: "inbound", from: name, to: "system",
      body, status: "delivered", conversationId: conversation.id, metadata: { waPhone },
    } }))
    return conversation.id
  }

  const offersOf = (conversationId: string, status?: string) => bypass(() => prisma.bookingOffer.findMany({
    where: { conversationId, ...(status ? { status } : {}) }, orderBy: { startsAt: "asc" },
  }))
  const offeredTimes = async (slug: string) => (await view(slug)).body.data.days
    .flatMap((day: { slots: { startsAt: string }[] }) => day.slots.map((slot) => slot.startsAt)) as string[]

  it("WhatsApp: with the switch off nothing answers, and the message goes on to the inbox", async () => {
    const slug = await newPage({ title: "Saç kəsimi" })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    const model = decides({ action: "offer", language: "az", serviceId: page.id })
    expect(await turnIn(`conv-${randomUUID()}`, { client: model })).toEqual({ handled: false })
    expect(model.messages.create).not.toHaveBeenCalled()
    expect(whatsapp.buttons).toHaveLength(0)
  })

  it("WhatsApp: the client's words become a menu of held times, and one tap books exactly one of them", async () => {
    // The salon works in manats, so the service is created inside the block
    // that sets the currency — the page stamps it when it is saved.
    await withWhatsAppBooking(async () => {
      const slug = await newPage({ title: "Saç kəsimi", durationMinutes: 45, price: 25 })
      const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
      const before = await offeredTimes(slug)
      const conversation = `conv-${randomUUID()}`
      expect(await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })).toEqual({ handled: true })

      // A menu of held times, one row each: the time on the first line, the
      // master on the second — the row the three-button message could not hold.
      const message = whatsapp.lists.at(-1)!
      expect(message.conversationId).toBe(conversation)
      // The price too: a Decimal handed straight to the label reads as nothing.
      expect(message.body).toMatch(/Saç kəsimi, 45 dəq, 25 ₼/)
      // The times are IN the message, not only behind the button: a client who
      // opens WhatsApp reads «12:30, 13:30 or 14:30 — which suits you?» and
      // answers. The body used to end on «Boş vaxtlar:» with nothing after it.
      expect(message.body).not.toMatch(/(vaxtlar|Boş vaxtlar):\s*$/)
      expect(message.body.trimEnd().endsWith("Hansı sizə uyğundur?"), message.body).toBe(true)
      // Three at most, and a sentence: the clock alone, joined by «və ya», with
      // the day written once above them. Six times with the date repeated on
      // each was four lines on a phone (owner, 2026-11-11).
      const spoken = message.body.split("\n").find((line) => /\d{1,2}:\d{2}/.test(line))!
      expect(spoken, message.body).toMatch(/^[^0-9]*\d{1,2}:\d{2}(, \d{1,2}:\d{2})*( və ya \d{1,2}:\d{2})?$/)
      expect(spoken.match(/\d{1,2}:\d{2}/g)!.length).toBeLessThanOrEqual(3)
      expect(message.body).toContain(message.rows[0].title.replace(/^\d+\.\d+ /, ""))
      expect(message.footer).toBe("Vaxt 15 dəqiqə sizin üçün saxlanılır")
      expect(message.buttonLabel).toBe("Vaxt seçin")
      expect(message.rows.length).toBeGreaterThan(3)
      // Eight times at most, plus «another day» — WhatsApp stops a list at ten.
      expect(message.rows.length).toBeLessThanOrEqual(OFFERS_PER_LIST + 1)
      expect(message.rows.length).toBeLessThanOrEqual(10)
      // The sheet is grouped by day, so the row is the clock alone even when the
      // times run into tomorrow, and the date is the heading above them.
      expect(message.sections!.length).toBeGreaterThan(0)
      expect(message.sections!.flatMap((section) => section.rowIds).sort())
        .toEqual(message.rows.map((row) => row.id).sort())
      // The last row is the rest of the calendar: a client who wants next week
      // could only get there by typing a date, which nobody told them about
      // (owner, 2026-11-11). It sits under no day, so its section has no title.
      const other = message.rows.at(-1)!
      expect(other.title).toBe("Başqa gün")
      expect(message.sections!.at(-1)).toMatchObject({ title: "", rowIds: [other.id] })
      expect(other.id.startsWith("bk:")).toBe(false)
      for (const section of message.sections!) {
        expect(section.title.length).toBeLessThanOrEqual(24)
        expect(section.title).not.toMatch(/\d{1,2}:\d{2}/)
      }
      for (const row of message.rows.slice(0, -1)) {
        expect(row.id).toMatch(/^bk:/)
        expect(row.title).toMatch(/^\d{1,2}:\d{2}$/)
        expect(row.title.length).toBeLessThanOrEqual(24)
        // The name lives on the second line now, not inside the time.
        expect(row.description, "the row names the master").toBeTruthy()
        expect(row.title).not.toContain(row.description)
      }
      const offers = await offersOf(conversation)
      // Every held time is a row, and every row but the last is a held time.
      expect(offers.map((offer) => `bk:${offer.id}`).sort())
        .toEqual(message.rows.slice(0, -1).map((row) => row.id).sort())
      expect(new Set(offers.map((offer) => offer.status))).toEqual(new Set(["offered"]))
      // Every time offered is one the page itself offered a moment ago:
      // the agent has no other source of time.
      for (const offer of offers) expect(before).toContain(offer.startsAt.toISOString())

      // Held: the public page stops offering them, and cannot book one.
      const during = await offeredTimes(slug)
      for (const offer of offers) expect(during).not.toContain(offer.startsAt.toISOString())
      expect((await book(slug, offers[0].startsAt.toISOString())).status).toBe(409)

      // The client taps the second time — twice, as people do.
      const tapped = offers[1]
      const tap = () => turnIn(conversation, { replyId: `bk:${tapped.id}`, text: message.rows[1].title })
      expect(await tap()).toEqual({ handled: true })
      expect(await tap()).toEqual({ handled: true })

      const meetings = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
      expect(meetings).toHaveLength(1)
      expect(meetings[0]).toMatchObject({ hostUserId: tapped.hostUserId, source: "whatsapp", name: "Nigar", phone: "+994551234567" })
      expect(meetings[0].startsAt.toISOString()).toBe(tapped.startsAt.toISOString())
      // One confirmation, carrying both the link that cancels it and the two
      // taps a client actually makes next. The buttons are the reminder's own,
      // so one handler answers them whether they came from here or from the
      // reminder a day later.
      expect(whatsapp.texts).toHaveLength(0)
      const confirmation = whatsapp.buttons.at(-1)!
      expect(confirmation.body).toMatch(/^Yazıldınız ✅/)
      expect(confirmation.body).toMatch(/Leyla/)
      expect(confirmation.body).toMatch(/https:\/\/app\.example\.test\/book\/cancel\/[\w-]{20,}/)
      expect(confirmation.buttons.map((button) => button.id)).toEqual([
        `rm:move:${meetings[0].id}`, `rm:cancel:${meetings[0].id}`,
      ])

      // Every time not chosen is free again the moment the client chose — all of
      // them, not the two a three-button message used to hold.
      const after = await offersOf(conversation)
      expect(after.find((offer) => offer.id === tapped.id)).toMatchObject({ status: "booked", bookingId: meetings[0].id })
      const others = after.filter((offer) => offer.id !== tapped.id)
      // Rows are the times plus «another day»; held chairs are the times alone.
      expect(others.length).toBe(message.rows.length - 2)
      expect(others.map((offer) => offer.status)).toEqual(others.map(() => "superseded"))
      const released = await offeredTimes(slug)
      for (const offer of after.filter((item) => item.id !== tapped.id)) expect(released).toContain(offer.startsAt.toISOString())
      expect(released).not.toContain(tapped.startsAt.toISOString())

      // The salon reads the meeting back without opening the conversation.
      const id = meetings[0].id
      const card = (await (await meetingGet(json("GET", `/api/v1/bookings/${id}`), { params: Promise.resolve({ id }) })).json()).data
      expect(card.source).toBe("whatsapp")
      expect(card.whatsapp).toEqual({
        asked: "Sabah saç kəsiminə yazılmaq olar?",
        offered: offers.map((offer) => offer.startsAt.toISOString()),
        chosen: tapped.startsAt.toISOString(),
      })
    }, { invoice: { defaultCurrency: "AZN" } })
  })

  it("WhatsApp: a number whose provider refuses the menu still gets three times as buttons", async () => {
    // Interactive lists are a Cloud API feature; a channel that cannot render
    // one must not leave the client with no way to answer at all. The fallback
    // is the message that worked before the menu: the three nearest times.
    const slug = await newPage({ title: "Saç yuma", durationMinutes: 30 })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      const conversation = `conv-${randomUUID()}`
      whatsapp.listFails = true
      expect(await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })).toEqual({ handled: true })

      expect(whatsapp.lists).toHaveLength(0)
      const message = whatsapp.buttons.at(-1)!
      expect(message.buttons).toHaveLength(3)
      for (const button of message.buttons) expect(button.title.length).toBeLessThanOrEqual(20)
      // The times held are still the whole menu — the buttons show the first
      // three of them, and a tap on any one books.
      const offers = await offersOf(conversation)
      expect(offers.length).toBeGreaterThan(3)
      expect(offers.map((offer) => `bk:${offer.id}`)).toEqual(expect.arrayContaining(message.buttons.map((button) => button.id)))
    })
  })

  it("WhatsApp: a number with a published form is sent a week of days, and books what comes back", async () => {
    // The owner asked for Telegram's forms inside WhatsApp (2026-11-11:
    // «telegram намного красивее можно оформлять формы»), and then for the
    // most that form can hold (2026-11-12: «выжми максимум»). What is checked
    // here is the whole round trip, because every part of it is a place the
    // form could be shown and still book nothing:
    //
    //   • the form goes out INSTEAD of the menu, and only for a number whose
    //     form is published — `flowId` is written by the publish step alone;
    //   • it carries a WEEK of days, the first being the day the message is
    //     about, and only that day's times are HELD: a week of held chairs
    //     would lock the whole salon because one client opened a form;
    //   • every day slot the published form declares has times in it, because
    //     a data key the screen declares and the message omits is a form that
    //     does not open at all;
    //   • a submitted form books — the time that was held, or one that was
    //     not — and the name and note the client typed reach the meeting.
    const slug = await newPage({ title: "Saç kəsimi", durationMinutes: 45 })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      const conversation = `conv-${randomUUID()}`
      expect(await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })).toEqual({ handled: true })

      // The form, and not the menu as well: two messages for one answer is
      // two things to tap and one of them stale.
      expect(whatsapp.lists).toHaveLength(0)
      expect(whatsapp.buttons).toHaveLength(0)
      const form = whatsapp.flows.at(-1)!
      expect(form.flowId).toBe("flow-published-1")
      expect(form.conversationId).toBe(conversation)
      expect(form.screen).toBe("BOOK")
      // Ours, handed back untouched inside the submission: the only thing in it
      // that says which conversation the form was opened from.
      expect(form.flowToken).toBe(`bkflow:${conversation}`)
      // The times are still in the message itself: the form is one tap away,
      // and a client reading WhatsApp sees them without taking it.
      expect(form.body).toMatch(/Saç kəsimi, 45 dəq/)
      expect(form.data.service).toBe("Saç kəsimi")
      expect(form.data.details).toMatch(/45 dəq/)
      expect(form.data.client).toBe("Nigar")
      // No picture on this service: the image is hidden, never absent.
      expect(form.data.has_photo).toBe(false)
      expect(typeof form.data.photo).toBe("string")
      expect((form.data.photo as string).length).toBeGreaterThan(0)

      const days = form.data.days as { id: string; title: string }[]
      expect(days.length).toBeGreaterThan(1)
      expect(days.map((day) => day.id)).toEqual(days.map((ignored, index) => `d${index}`))
      for (const day of days) expect(day.title, JSON.stringify(day)).toBeTruthy()
      expect(form.data.day_init).toBe("d0")

      const timesOf = (index: number) => form.data[`t${index}`] as { id: string; title: string; description: string }[]
      // Every slot the form declares is filled, even past the last day found.
      for (let index = 0; index < 7; index += 1) expect(timesOf(index).length, `t${index}`).toBeGreaterThan(0)
      // Meta draws an item with no second line as a blank row, so every one
      // has one — the master when there is a name, the day otherwise.
      for (let index = 0; index < days.length; index += 1) {
        for (const time of timesOf(index)) {
          expect(time.title, JSON.stringify(time)).toMatch(/^\d{1,2}:\d{2}$/)
          expect(time.description, JSON.stringify(time)).toBeTruthy()
        }
      }

      // The first day is the held one: its times are this conversation's
      // offers, and the public page stops offering them.
      const offers = await offersOf(conversation, "offered")
      expect(offers.length).toBeGreaterThan(3)
      // Held times come first and are exactly this conversation's offers —
      // however many days the offered times themselves ran over.
      const inDay = days.map((ignored, index) => timesOf(index))
      const heldDays = inDay.filter((times) => times.every((time) => time.id.startsWith("bk:")))
      expect(heldDays.length).toBeGreaterThan(0)
      expect(heldDays.flat().map((time) => time.id).sort()).toEqual(offers.map((offer) => `bk:${offer.id}`).sort())
      expect(inDay.slice(0, heldDays.length)).toEqual(heldDays)
      const during = await offeredTimes(slug)
      for (const offer of offers) expect(during).not.toContain(offer.startsAt.toISOString())
      // The days after them are free times nobody is holding.
      const laterIndex = heldDays.length
      const later = inDay[laterIndex]
      expect(later.every((time) => time.id.startsWith(`bkt:${page.id}:`)), JSON.stringify(later)).toBe(true)
      for (const time of later) expect(during).toContain(time.id.split(":").slice(3).join(":"))

      // The client picks the first time, types a name over the one WhatsApp
      // knows and leaves a note. That arrives as `nfm_reply`: one JSON string.
      const { flowTap } = await import("@/lib/booking/whatsapp-flow")
      const submission = (answers: Record<string, unknown>) => flowTap({
        type: "nfm_reply",
        nfm_reply: { response_json: JSON.stringify({ flow_token: form.flowToken, ...answers }), body: "Sent", name: "flow" },
      })!
      const held = submission({ day: "d0", t0: timesOf(0)[0].id, client: "Günel", note: "Rəngə də baxaq" })
      expect(held.replyId).toBe(timesOf(0)[0].id)
      expect(await turnIn(conversation, { replyId: held.replyId, senderName: held.name!, note: held.note!, text: "[Форма: Günel]" })).toEqual({ handled: true })

      const meetings = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" }, orderBy: { createdAt: "asc" } }))
      expect(meetings).toHaveLength(1)
      expect(meetings[0]).toMatchObject({ source: "whatsapp", name: "Günel", phone: "+994551234567", note: "Rəngə də baxaq" })
      expect(meetings[0].startsAt.toISOString()).toBe(offers[0].startsAt.toISOString())
      // Confirmed the way every booking is, with the two taps that follow it.
      expect(whatsapp.buttons.at(-1)!.body).toMatch(/^Yazıldınız ✅/)

      // A time from another day — one nobody was holding — books just the
      // same, and leaves the same kind of meeting behind.
      const free = submission({ day: `d${laterIndex}`, [`t${laterIndex}`]: later[0].id, client: "Günel" })
      expect(await turnIn(conversation, { replyId: free.replyId, senderName: free.name!, text: "[Форма: Günel]" })).toEqual({ handled: true })
      const both = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" }, orderBy: { startsAt: "asc" } }))
      expect(both).toHaveLength(2)
      expect(both[1].startsAt.toISOString()).toBe(later[0].id.split(":").slice(3).join(":"))
      expect(await offeredTimes(slug)).not.toContain(both[1].startsAt.toISOString())

      // A form closed on a day without a time is still an answer: that day's
      // times come back. What «d2» meant is known only to the message that
      // offered the week, so it is read from the offer it was sent with.
      const lastDay = `d${days.length - 1}`
      const dayOnly = submission({ day: lastDay, client: "Günel" })
      expect(dayOnly.replyId).toBe(`bkds:${lastDay}`)
      expect(await turnIn(conversation, { replyId: dayOnly.replyId, text: "" })).toEqual({ handled: true })
      const again = whatsapp.flows.at(-1)!
      expect((again.data.days as { title: string }[])[0].title).toBe(days[days.length - 1].title)
    }, { bookingWhatsApp: { flowId: "flow-published-1" } })
  })

  it("WhatsApp: the form's own dropdowns ask again instead of booking the wrong thing", async () => {
    // The owner, seeing the first form: «если несколько услуг будет, такую
    // форму тоже сделай — чтоб выбрал внутри, дальше время и мастера, или же
    // без мастера» (2026-11-12). Neither dropdown can filter the times on
    // screen: a published form has no way to ask us for another service's
    // day. So what they do is ask again — and what matters is that they never
    // book the thing the client just said they did not want.
    const cutSlug = await newPage({ title: "Saç kəsimi", durationMinutes: 45, hostIds: [HOST_A, HOST_B] })
    const colourSlug = await newPage({ title: "Rəng", durationMinutes: 60, hostIds: [HOST_A] })
    const cut = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug: cutSlug } }))
    const colour = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug: colourSlug } }))
    await withWhatsAppBooking(async () => {
      const conversation = `conv-${randomUUID()}`
      expect(await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: cut.id }) })).toEqual({ handled: true })

      const form = whatsapp.flows.at(-1)!
      // Both lists are there, and both say what the form was sent for.
      expect(form.data.has_services).toBe(true)
      expect((form.data.services as { id: string }[]).map((item) => item.id)).toEqual(expect.arrayContaining([cut.id, colour.id]))
      expect(form.data.service_init).toBe(cut.id)
      expect(form.data.has_hosts).toBe(true)
      expect((form.data.hosts as { id: string }[])[0].id).toBe("any")
      expect(form.data.host_init).toBe("any")

      const time = (form.data.t0 as { id: string }[])[0].id
      const submit = (answers: Record<string, unknown>) => {
        const reply = { flow_token: form.flowToken, day: "d0", t0: time, client: "Günel", service: cut.id, host: "any", ...answers }
        return turnIn(conversation, {
          replyId: (reply.t0 as string) || `bkds:${reply.day}`,
          senderName: "Günel",
          text: "[Форма]",
          form: { serviceId: reply.service as string, hostId: reply.host as string },
        })
      }

      // Another service: the times on screen belong to a 45-minute haircut,
      // and nothing about them is true for an hour of colouring.
      expect(await submit({ service: colour.id })).toEqual({ handled: true })
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG, status: "confirmed", bookingPageId: { in: [cut.id, colour.id] } } }))).toBe(0)
      const again = whatsapp.flows.at(-1)!
      expect(again.data.service).toBe("Rəng")
      expect(again.data.service_init).toBe(colour.id)
      expect(again.data.details).toMatch(/60 dəq/)

      // A master, and the moment the client already picked: that very time
      // with that master, not a second question.
      const colourForm = again
      const colourTime = (colourForm.data.t0 as { id: string }[])[0].id
      expect(await turnIn(conversation, {
        replyId: colourTime, senderName: "Günel", text: "[Форма]",
        form: { serviceId: colour.id, hostId: HOST_A },
      })).toEqual({ handled: true })
      const booked = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: colour.id, status: "confirmed" } }))
      expect(booked).toHaveLength(1)
      expect(booked[0].hostUserId).toBe(HOST_A)
    }, { bookingWhatsApp: { flowId: "flow-published-1" } })
  })

  it("WhatsApp: a coworking books a room in the form, and two rooms are two chairs", async () => {
    // The last piece of «бронировать комнаты»: the client picks the room in
    // the same form they pick the day and the time, and the meeting lands on
    // the room — not on the master who owns it in the record.
    const rooms = await Promise.all(["Zal A", "Zal B"].map((name) => bypass(() =>
      prisma.bookingResource.create({ data: { organizationId: ORG, name }, select: { id: true, name: true } }))))
    const slug = await newPage({ title: "Toplantı otağı", durationMinutes: 60, hostIds: [HOST_A], resourceIds: rooms.map((room) => room.id) })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      const conversation = `conv-${randomUUID()}`
      expect(await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })).toEqual({ handled: true })

      // The second dropdown is the rooms, and ONLY the rooms: a service with
      // rooms is booked in them, and the master who owns their bookings in
      // the record is not a chair anybody is offered.
      const form = whatsapp.flows.at(-1)!
      const chairs = (form.data.hosts as { id: string; title: string }[]).filter((chair) => chair.id !== "any")
      expect(chairs.map((chair) => chair.id).sort()).toEqual(rooms.map((room) => room.id).sort())

      // Every held time names a room, and the times are the rooms' own.
      const offers = await offersOf(conversation, "offered")
      expect(offers.length).toBeGreaterThan(0)
      expect(offers.every((offer) => rooms.some((room) => room.id === offer.resourceId))).toBe(true)
      // The column that must hold a user holds the service's own master.
      expect(new Set(offers.map((offer) => offer.hostUserId))).toEqual(new Set([HOST_A]))

      const times = form.data.t0 as { id: string; description: string }[]
      expect(times.length).toBeGreaterThan(0)
      // The second line names the room, which is the only thing a client of a
      // coworking has to tell two free hours apart.
      expect(times.every((time) => rooms.some((room) => room.name === time.description))).toBe(true)

      // Booking one leaves the other free at the same minute: two rooms are
      // two chairs, and the form offers both.
      const first = offers[0]
      expect(await turnIn(conversation, { replyId: `bk:${first.id}`, text: "[Форма]" })).toEqual({ handled: true })
      const meeting = await bypass(() => prisma.booking.findFirstOrThrow({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
      expect(meeting.resourceId).toBe(first.resourceId)
      expect(meeting.hostUserId).toBe(HOST_A)
      const other = rooms.find((room) => room.id !== first.resourceId)!
      const sameMinute = `bkt:${page.id}:${other.id}:${first.startsAt.toISOString()}`
      expect(await turnIn(`conv-${randomUUID()}`, { replyId: sameMinute, text: "[Форма]" })).toEqual({ handled: true })
      const both = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
      expect(both).toHaveLength(2)
      expect(new Set(both.map((row) => row.resourceId))).toEqual(new Set(rooms.map((room) => room.id)))
      expect(new Set(both.map((row) => row.startsAt.toISOString()))).toEqual(new Set([first.startsAt.toISOString()]))
    }, { bookingWhatsApp: { flowId: "flow-published-1" } })
  })

  it("WhatsApp: a number without a published form is sent the menu, exactly as before", async () => {
    // The fallback is not a detail: every number had the menu until today, and
    // a form belongs only to an account that published one. A number that
    // forgot its form (the «use the list again» button) must land here too.
    const slug = await newPage({ title: "Saç yuma", durationMinutes: 30 })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      const conversation = `conv-${randomUUID()}`
      expect(await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })).toEqual({ handled: true })
      expect(whatsapp.flows).toHaveLength(0)
      expect(whatsapp.lists.at(-1)!.rows.at(-1)!.title).toBe("Başqa gün")
    })
  })

  it("WhatsApp: a held time is never offered to a second conversation, and is free again once the hold runs out", async () => {
    const slug = await newPage({ title: "Manikür", durationMinutes: 40, maxDaysAhead: 2 })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      const first = `conv-${randomUUID()}`
      const second = `conv-${randomUUID()}`
      const ask = (conversationId: string) => turnIn(conversationId, { text: "Завтра маникюр можно?", client: decides({ action: "offer", language: "ru", serviceId: page.id }) })
      await ask(first)
      await ask(second)
      expect(whatsapp.lists.at(-1)!.body).toMatch(/Manikür, 40 мин/)
      const firstOffers = await offersOf(first)
      const secondOffers = await offersOf(second)
      expect(firstOffers.length).toBeGreaterThan(3)
      expect(secondOffers).toHaveLength(firstOffers.length)
      const sameChair = (left: { hostUserId: string; startsAt: Date }, right: { hostUserId: string; startsAt: Date }) =>
        left.hostUserId === right.hostUserId && left.startsAt.getTime() === right.startsAt.getTime()
      for (const offer of secondOffers) expect(firstOffers.some((held) => sameChair(held, offer))).toBe(false)

      // The first client went quiet: once their hold runs out, the second
      // client's next question may be offered those times.
      await bypass(() => prisma.bookingOffer.updateMany({ where: { conversationId: first }, data: { expiresAt: new Date(Date.now() - 1000) } }))
      await ask(second)
      const again = await offersOf(second, "offered")
      expect(again).toHaveLength(secondOffers.length)
      expect(again.some((offer) => firstOffers.some((held) => sameChair(held, offer)))).toBe(true)
      // And asking again released the second client's own earlier times.
      expect((await offersOf(second, "superseded")).length).toBe(secondOffers.length)
    })
  })

  it("WhatsApp: a tap on a time someone took meanwhile gets new times, not an error and not a second meeting", async () => {
    const slug = await newPage({ title: "Boyama", durationMinutes: 90, maxDaysAhead: 2 })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      const conversation = `conv-${randomUUID()}`
      await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })
      const [first] = await offersOf(conversation)
      // The client is slow, the hold runs out, and the time goes on the web.
      await bypass(() => prisma.bookingOffer.updateMany({ where: { conversationId: conversation }, data: { expiresAt: new Date(Date.now() - 1000) } }))
      expect((await book(slug, first.startsAt.toISOString(), "Veb müştəri")).status).toBe(201)

      expect(await turnIn(conversation, { replyId: `bk:${first.id}`, text: "10:00 · Leyla" })).toEqual({ handled: true })
      const retry = whatsapp.lists.at(-1)!
      expect(retry.body).toMatch(/^Bu vaxtı indicə tutdular\./)
      expect(retry.rows.length).toBeGreaterThan(0)
      expect(await bypass(() => prisma.bookingOffer.findUniqueOrThrow({ where: { id: first.id } }))).toMatchObject({ status: "taken", bookingId: null })
      const fresh = await offersOf(conversation, "offered")
      expect(fresh.length).toBe(retry.rows.length - 1)
      for (const offer of fresh) expect(offer.startsAt.getTime()).not.toBe(first.startsAt.getTime())
      expect(whatsapp.texts).toHaveLength(0)
      const meetings = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
      expect(meetings.map((meeting) => meeting.source)).toEqual(["public_link"])
    })
  })

  it("WhatsApp: a question about something else is left to the inbox, and a tap from another conversation books nothing", async () => {
    const slug = await newPage({ title: "Pedikür" })
    const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
    await withWhatsAppBooking(async () => {
      expect(await turnIn(`conv-${randomUUID()}`, { text: "Endirim var?", client: decides({ action: "not_booking" }) })).toEqual({ handled: false })
      // A decision naming a service that does not exist is no decision.
      expect(await turnIn(`conv-${randomUUID()}`, { client: decides({ action: "offer", language: "az", serviceId: "invented-service" }) })).toEqual({ handled: false })
      expect(whatsapp.buttons).toHaveLength(0)
      expect(whatsapp.lists).toHaveLength(0)

      const owner = `conv-${randomUUID()}`
      await turnIn(owner, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })
      const [offer] = await offersOf(owner)
      expect(await turnIn(`conv-${randomUUID()}`, { replyId: `bk:${offer.id}`, text: "11:00 · Leyla" })).toEqual({ handled: false })
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG, bookingPageId: page.id } }))).toBe(0)
    })
  })

  it("WhatsApp: outside the salon's rules the time is held, and only «Подтвердить» makes it a meeting", async () => {
    await withWhatsAppBooking(async () => {
      const slug = await newPage({ title: "Boyama", durationMinutes: 60, price: 60, maxDaysAhead: 2 })
      const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
      const conversation = await conversationWith("994551234567", "Nigar", "Boyama olar?")

      await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })
      const [offer] = await offersOf(conversation)
      expect(await turnIn(conversation, { replyId: `bk:${offer.id}`, text: "11:30" })).toEqual({ handled: true })

      // Held, not booked: the client is told so, and no meeting exists yet.
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG, bookingPageId: page.id } }))).toBe(0)
      expect(await bypass(() => prisma.bookingOffer.findUniqueOrThrow({ where: { id: offer.id } }))).toMatchObject({ status: "pending", reviewReason: "price", bookingId: null })
      expect(whatsapp.texts.at(-1)!.message).toMatch(/^Vaxtı sizin üçün saxladıq/)
      // And the chair is still held: the public page will not give it away.
      expect((await book(slug, offer.startsAt.toISOString())).status).toBe(409)

      // The administrator sees why, in the words of the rule that stopped it.
      signIn("admin")
      const queue = (await (await requestsGet(json("GET", "/api/v1/bookings/requests"))).json()).data.requests
      const row = queue.find((item: { id: string }) => item.id === offer.id)
      expect(row).toMatchObject({ reason: "price", hostName: "Leyla", asked: "Sabah saç kəsiminə yazılmaq olar?" })
      expect(row.client).toMatchObject({ name: "Nigar", phone: "+994551234567" })
      expect(row.service).toMatchObject({ title: "Boyama", durationMinutes: 60 })

      // «Подтвердить» books exactly that time and tells the client.
      const approved = await requestsPost(json("POST", "/api/v1/bookings/requests", { id: offer.id, approve: true }))
      expect(approved.status).toBe(200)
      const meetings = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
      expect(meetings).toHaveLength(1)
      expect(meetings[0]).toMatchObject({ source: "whatsapp", name: "Nigar", phone: "+994551234567" })
      expect(meetings[0].startsAt.toISOString()).toBe(offer.startsAt.toISOString())
      expect(whatsapp.texts.at(-1)!.message).toMatch(/^Təsdiqləndi ✅/)
      expect(await bypass(() => prisma.bookingOffer.findUniqueOrThrow({ where: { id: offer.id } }))).toMatchObject({ status: "booked", bookingId: meetings[0].id })
      // A second press changes nothing and does not write a second meeting.
      expect((await requestsPost(json("POST", "/api/v1/bookings/requests", { id: offer.id, approve: true }))).status).toBe(404)
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG, bookingPageId: page.id } }))).toBe(1)
    }, { bookingWhatsApp: null })
  })

  it("WhatsApp: «Отклонить» lets the chair go and says so, and inside the rules nothing waits at all", async () => {
    await withWhatsAppBooking(async () => {
      const slug = await newPage({ title: "Keratin", durationMinutes: 60, price: 150, maxDaysAhead: 2 })
      const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
      const conversation = await conversationWith("994551110022", "Aysel", "Keratin?")
      await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })
      const [offer] = await offersOf(conversation)
      await turnIn(conversation, { replyId: `bk:${offer.id}`, text: "tap" })

      signIn("admin")
      expect((await requestsPost(json("POST", "/api/v1/bookings/requests", { id: offer.id, approve: false }))).status).toBe(200)
      expect(await bypass(() => prisma.bookingOffer.findUniqueOrThrow({ where: { id: offer.id } }))).toMatchObject({ status: "declined", bookingId: null })
      expect(whatsapp.texts.at(-1)!.message).toMatch(/təsdiqləyə bilmədik/)
      expect(await bypass(() => prisma.booking.count({ where: { organizationId: ORG, bookingPageId: page.id } }))).toBe(0)
      // The time is free again for everyone.
      expect((await book(slug, offer.startsAt.toISOString())).status).toBe(201)
    }, { bookingWhatsApp: null })

    // The same service, now inside the rules: booked at once, nothing queued.
    await withWhatsAppBooking(async () => {
      const slug = await newPage({ title: "Saç yuma", durationMinutes: 30, price: 10, maxDaysAhead: 2 })
      const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
      const conversation = `conv-${randomUUID()}`
      await turnIn(conversation, { client: decides({ action: "offer", language: "az", serviceId: page.id }) })
      const [offer] = await offersOf(conversation)
      await turnIn(conversation, { replyId: `bk:${offer.id}`, text: "tap" })
      expect(await bypass(() => prisma.bookingOffer.findUniqueOrThrow({ where: { id: offer.id } }))).toMatchObject({ status: "booked", reviewReason: null })
      signIn("admin")
      const queue = (await (await requestsGet(json("GET", "/api/v1/bookings/requests"))).json()).data.requests
      expect(queue.some((item: { id: string }) => item.id === offer.id)).toBe(false)
    }, { bookingWhatsApp: null })
  })

  it("WhatsApp: the day-before reminder goes out once, with three buttons, and «coming» is recorded", async () => {
    await withWhatsAppBooking(async () => {
      const slug = await newPage({ title: "Manikür", durationMinutes: 30, maxDaysAhead: 2 })
      // A meeting a day out, booked the ordinary way — the database refuses a
      // row written around its canonical event, and the client's own message
      // keeps Meta's window open, so the reminder may be text with buttons.
      const startsAt = await slotWithin(slug, 18 * 3600_000, 24 * 3600_000)
      expect((await book(slug, startsAt, "Günel")).status).toBe(201)
      const booking = await bypass(() => prisma.booking.findFirstOrThrow({ where: { organizationId: ORG, startsAt: new Date(startsAt) } }))
      const conversation = await conversationWith(phoneDigitsOf(booking.phone), "Günel", "Sabah manikür?")

      expect((await remindersPost(cronJson())).status).toBe(200)
      // This meeting's reminder, not whichever one the cron sent last: the run
      // reminds every meeting that is due, and another test's chair can be due
      // in the same minute.
      const reminder = whatsapp.buttons.find((message) => message.buttons.some((button) => button.id === `rm:confirm:${booking.id}`))!
      expect(reminder, "a reminder for this meeting").toBeTruthy()
      expect(reminder.body).toMatch(/Manikür/)
      expect(reminder.buttons.map((button) => button.id)).toEqual([
        `rm:confirm:${booking.id}`, `rm:move:${booking.id}`, `rm:cancel:${booking.id}`,
      ])
      const marked = await bypass(() => prisma.bookingReminder.findUniqueOrThrow({ where: { bookingId: booking.id } }))
      expect(marked.remindedDayAt).not.toBeNull()

      // A second run says nothing more: the meeting is already reminded.
      whatsapp.buttons = []
      expect((await remindersPost(cronJson())).status).toBe(200)
      expect(whatsapp.buttons).toHaveLength(0)

      // «Gəlirəm» is recorded on the meeting and thanked for.
      expect(await turnIn(conversation, { waPhone: phoneDigitsOf(booking.phone), replyId: `rm:confirm:${booking.id}`, text: "Gəlirəm" })).toEqual({ handled: true })
      const confirmed = await bypass(() => prisma.bookingReminder.findUniqueOrThrow({ where: { bookingId: booking.id } }))
      expect(confirmed.clientConfirmedAt).not.toBeNull()
      expect(confirmed.clientConfirmedVia).toBe("whatsapp")
      expect(whatsapp.texts.at(-1)!.message).toBe("Gözləyirik ✅")

      // Another client's phone cannot answer for this meeting.
      expect(await turnIn(conversation, { waPhone: "994500000001", replyId: `rm:cancel:${booking.id}`, text: "Ləğv" })).toEqual({ handled: false })
      expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))).status).toBe("confirmed")
    })
  })

  it("WhatsApp: «Ləğv etmək» frees the chair at once, and «vaxtı dəyişmək» moves the meeting only when a new time is taken", async () => {
    await withWhatsAppBooking(async () => {
      // A master of this scenario's own, two hours' notice, and the tap takes
      // the LAST time offered rather than the first.
      //
      // All three are about one thing: the time this test books must not be a
      // time anything else in the file is arguing over. Shared with the other
      // scenarios, the master's day fills up as the file runs, the move offers
      // land on whatever is left — late in the evening in Baku that is the
      // edge of the notice window — and the same tap sometimes booked and
      // sometimes did not. The deploy gate for all of main went red on it
      // twice on 2026-11-12, at 21:11 and 21:46 Baku.
      const host = `user-move-${randomUUID()}`
      await bypass(() => prisma.user.create({ data: { id: host, organizationId: ORG, email: `${host}@example.test`, name: "Sevinc", passwordHash: "-", role: "manager" } }))
      const slug = await newPage({ title: "Saç kəsimi", durationMinutes: 30, maxDaysAhead: 2, minNoticeMinutes: 120, hostIds: [host] })
      const page = await bypass(() => prisma.bookingPage.findFirstOrThrow({ where: { slug } }))
      const make = async (index: number) => {
        const startsAt = await someSlot(slug, index)
        expect((await book(slug, startsAt, "Aytən")).status).toBe(201)
        return bypass(() => prisma.booking.findFirstOrThrow({ where: { organizationId: ORG, startsAt: new Date(startsAt) } }))
      }
      const first = await make(6)
      const conversation = await conversationWith(phoneDigitsOf(first.phone), "Aytən", "Saç kəsimi")
      const phone = phoneDigitsOf(first.phone)

      // Cancel: the meeting goes, and the client is told plainly.
      expect(await turnIn(conversation, { waPhone: phone, replyId: `rm:cancel:${first.id}`, text: "Ləğv" })).toEqual({ handled: true })
      expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id: first.id } }))).status).toBe("cancelled")
      expect(whatsapp.texts.at(-1)!.message).toMatch(/ləğv edildi/)

      // Move: new times arrive, and the old meeting stands until one is taken.
      const second = await make(7)
      expect(await turnIn(conversation, { waPhone: phone, replyId: `rm:move:${second.id}`, text: "Dəyişmək" })).toEqual({ handled: true })
      const offers = await offersOf(conversation, "offered")
      expect(offers.length).toBeGreaterThan(0)
      for (const offer of offers) expect(offer.replacesBookingId).toBe(second.id)
      expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id: second.id } }))).status).toBe("confirmed")

      const taken = offers.at(-1)!
      await turnIn(conversation, { waPhone: phone, replyId: `bk:${taken.id}`, text: "tap" })
      expect((await bypass(() => prisma.booking.findUniqueOrThrow({ where: { id: second.id } }))).status).toBe("cancelled")
      const moved = await bypass(() => prisma.booking.findMany({ where: { organizationId: ORG, bookingPageId: page.id, status: "confirmed" } }))
      expect(moved).toHaveLength(1)
      expect(moved[0].startsAt.toISOString()).toBe(taken.startsAt.toISOString())
    })
  })

  it("FORCE RLS keeps one organization's offered times from another", async () => {
    const at = new Date(Date.now() + 86400_000)
    await bypass(() => prisma.bookingOffer.createMany({ data: [ORG, OTHER_ORG].map((organizationId) => ({
      organizationId, conversationId: `conv-rls-${organizationId}`, bookingPageId: "page-rls", hostUserId: HOST_A,
      startsAt: at, endsAt: new Date(at.getTime() + 1800_000), expiresAt: new Date(Date.now() + 900_000),
    })) }))
    const role = `offer_reader_${randomUUID().replaceAll("-", "")}`
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON booking_offers TO "${role}";`)
    try {
      const visible = await bypass(() => prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`)
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'off', true), set_config('app.org_id', ${ORG}, true)`
        return tx.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM booking_offers`
      }))
      expect(visible.length).toBeGreaterThan(0)
      expect(new Set(visible.map((row) => row.organizationId))).toEqual(new Set([ORG]))
    } finally {
      prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, `REVOKE ALL ON booking_offers FROM "${role}"; REVOKE USAGE ON SCHEMA public FROM "${role}"; DROP ROLE "${role}";`)
    }
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

  /**
   * The answering assistant's view of the company. The booking agent acts only
   * on a request for a time and hands everything else to the general reply,
   * which read only the knowledge base — so «how much is it» had no answer in a
   * product where the owner had typed the price into the service itself.
   */
  describe("what the assistant may say about the services", () => {
    // Its own organisation: this suite leaves dozens of services behind, and
    // the block deliberately carries only the first twelve.
    const SHOP = "org-service-facts"
    /** An organisation that takes no bookings at all — OTHER_ORG has services of its own. */
    const QUIET = "org-no-services"
    const page = (over: Record<string, unknown> = {}) => bypass(() => prisma.bookingPage.create({
      data: {
        organizationId: SHOP, title: "Saç kəsimi", slug: `facts-${++sequence}`, durationMinutes: 45,
        bufferMinutes: 0, minNoticeMinutes: 0, maxDaysAhead: 7, locationType: "office",
        locationText: "Bakı, Nizami 203", hostIds: [], weekly: ALL_DAY, isActive: true,
        price: 25, priceCurrency: "AZN", ...over,
      },
    }))

    beforeAll(async () => {
      await bypass(() => prisma.organization.createMany({
        data: [
          { id: SHOP, name: "Salon", slug: SHOP, modules: { crm: true }, settings: { timezone: "Asia/Baku" } },
          { id: QUIET, name: "Dükan", slug: QUIET, modules: { crm: true }, settings: { timezone: "Asia/Baku" } },
        ],
      }))
    })

    it("names the price, the length and the place the organisation saved", async () => {
      const { serviceFactsBlock } = await import("@/lib/booking/service-facts")
      await page()

      const block = await bypass(() => serviceFactsBlock(SHOP, "az"))
      expect(block).toContain("Saç kəsimi")
      expect(block).toContain("45 dəq")
      expect(block).toContain("25")
      expect(block).toContain("Bakı, Nizami 203")
    })

    it("forbids naming a time, because only the booking agent sees the schedule", async () => {
      // Without this line the assistant, now holding a service list, invents
      // «come tomorrow at ten» — a promise nothing in the schedule backs.
      const { serviceFactsBlock } = await import("@/lib/booking/service-facts")
      const block = await bypass(() => serviceFactsBlock(SHOP, "ru"))
      expect(block).toContain("время не назначай")
      expect(block).toContain("Свободное время тебе неизвестно")
    })

    it("leaves a closed service out", async () => {
      const { serviceFactsBlock } = await import("@/lib/booking/service-facts")
      await page({ title: "Köhnə xidmət", isActive: false })
      expect(await bypass(() => serviceFactsBlock(SHOP, "az"))).not.toContain("Köhnə xidmət")
    })

    it("says nothing at all when the organisation publishes no service", async () => {
      // A company that does not take bookings must not get a heading with
      // nothing under it: an empty list reads as «we offer nothing».
      const { serviceFactsBlock } = await import("@/lib/booking/service-facts")
      expect(await bypass(() => serviceFactsBlock(QUIET, "az"))).toBe("")
    })
  })

})
