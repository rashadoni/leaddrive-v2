/**
 * The import of a coexistence number's WhatsApp Business app (lib/whatsapp-history-import) on a real
 * Postgres, connected as an application role without BYPASSRLS, with the tables the import writes
 * under FORCE ROW LEVEL SECURITY and the partial unique indexes the live webhook relies on — so
 * every write runs under `runWithTenant`, exactly as in production.
 *
 * What it proves, each against the real code that would otherwise act:
 *  - The webhook takes `smb_app_state_sync` and `history` through the real route: contacts matched by
 *    phone without duplicates, chats written with their own time, nothing unread.
 *  - The import sets nothing in motion. After it, the real deferred booking turn and the real
 *    autonomous inbox sweep are run over the same database with their reply injected as a spy: they
 *    answer the one LIVE message planted as a control, and none of the imported ones — not even a
 *    customer's question from five minutes before the number was connected. Meta's 24-hour window
 *    stays shut for imported messages. No other table of the schema gains a row: no notification,
 *    ticket, activity, audit, event or AI log. No request leaves for Meta or anyone else.
 *  - A redelivered webhook and a chunk processed twice add nothing; a message that already came
 *    live is not stored twice.
 *  - A refusal to share history (Meta 2593109) is recorded and reads as «declined».
 *  - Another organization sees none of it.
 *
 * Set WHATSAPP_HISTORY_IMPORT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   WHATSAPP_HISTORY_IMPORT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («WhatsApp history
 * import database gate»), where `WHATSAPP_HISTORY_IMPORT_DB_GATE=required` turns a missing URL into
 * a failure.
 */
import { spawnSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { PrismaClient, type Prisma as PrismaTypes } from "@prisma/client"

const adminUrl = process.env.WHATSAPP_HISTORY_IMPORT_TEST_DATABASE_URL
if (!adminUrl && process.env.WHATSAPP_HISTORY_IMPORT_DB_GATE === "required") {
  throw new Error("WHATSAPP_HISTORY_IMPORT_TEST_DATABASE_URL is required by the WhatsApp history import database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.WHATSAPP_HISTORY_IMPORT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `wa_history_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "wa-history-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  process.env.WHATSAPP_APP_SECRET = "wa-history-test-app-secret" // gitleaks:allow — not a secret
  delete process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
  return { name, role, adminDb: db.toString() }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = path.join(ROOT, "prisma/migrations/20261220090000_whatsapp_history_import/migration.sql")
const UNIQUE_INDEXES = [
  "prisma/migrations/20260920160000_meta_inbound_idempotency/migration.sql",
  "prisma/migrations/20261109120000_whatsapp_app_echo_idempotency/migration.sql",
]
const RLS_TABLES = ["channel_messages", "social_conversations", "contacts", "channel_configs"]

const ORG = "org-wa-history"
const OTHER = "org-wa-history-other"
const CHANNEL = "cfg-wa-coexistence"
const PHONE_NUMBER_ID = "109876543210987"
const BUSINESS = "994512060838"
const AYSEL = "994501112233" // in the CRM already, with a live conversation
const LEYLA = "994552223344" // in the app's address book only
const KAMAL = "994703334455" // wrote once, in nobody's address book
const CONTROL = "994990001122" // a LIVE customer: the control the automations must answer

// Now, to the second. The number was connected two minutes ago.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const unix = (date: Date) => String(Math.floor(date.getTime() / 1000))

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "wa-history-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

const rlsPolicy = (table: string) => `
ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "${table}"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`

// ─── what Meta sends ──────────────────────────────────────────────────────────

const metadata = { display_phone_number: `+994 51 206 08 38`, phone_number_id: PHONE_NUMBER_ID }
const envelope = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba-1", changes: [{ field, value: { messaging_product: "whatsapp", metadata, ...value } }] }],
})
const fromCustomer = (phone: string, id: string, at: Date, body: string) => ({
  from: phone, from_user_id: `AZ.${phone}`, id, timestamp: unix(at), type: "text", text: { body }, history_context: { status: "READ" },
})
const fromBusiness = (phone: string, id: string, at: Date, body: string) => ({
  from: BUSINESS, to: phone, id, timestamp: unix(at), type: "text", text: { body }, history_context: { status: "DELIVERED" },
})

const CONTACTS = envelope("smb_app_state_sync", {
  state_sync: [
    { type: "contact", contact: { full_name: "Aysel Məmmədova", first_name: "Aysel", phone_number: AYSEL, user_id: "AZ.1" }, action: "add", metadata: { timestamp: unix(ago(300 * DAY)) } },
    { type: "contact", contact: { full_name: "Leyla Həsənova", first_name: "Leyla", phone_number: LEYLA, user_id: "AZ.2" }, action: "add", metadata: { timestamp: unix(ago(40 * DAY)) } },
    { type: "contact", contact: { phone_number: "994559998877", user_id: "AZ.3" }, action: "remove", metadata: { timestamp: unix(ago(DAY)) } },
  ],
})

// Phase 1 (days 1–90): an old exchange with Aysel and the one-off from Kamal's past.
const HISTORY_OLD = envelope("history", {
  history: [{
    metadata: { phase: 1, chunk_order: 1, progress: 55 },
    threads: [
      { id: AYSEL, context: { wa_id: AYSEL, user_id: `AZ.${AYSEL}` }, messages: [
        fromCustomer(AYSEL, "wamid.A1", ago(80 * DAY), "Salam, manikür neçəyədir?"),
        fromBusiness(AYSEL, "wamid.A2", ago(80 * DAY - 5 * MIN), "25 AZN"),
        { from: AYSEL, from_user_id: `AZ.${AYSEL}`, id: "wamid.A3", timestamp: unix(ago(80 * DAY - 6 * MIN)), type: "reaction", reaction: { emoji: "👍" } },
        { from: AYSEL, from_user_id: `AZ.${AYSEL}`, id: "wamid.A4", timestamp: unix(ago(79 * DAY)), type: "media_placeholder" },
      ] },
    ],
  }],
})

// Phase 0 (the last day): a question five minutes before the connection, and one from yesterday.
const HISTORY_RECENT = envelope("history", {
  history: [{
    metadata: { phase: 0, chunk_order: 1, progress: 100 },
    threads: [
      { id: LEYLA, context: { wa_id: LEYLA, user_id: `AZ.${LEYLA}` }, messages: [
        fromBusiness(LEYLA, "wamid.L1", ago(20 * HOUR), "Sabah gözləyirik!"),
        fromCustomer(LEYLA, "wamid.L2", ago(5 * MIN), "Sabah 11:00 olar?"),
      ] },
      { id: KAMAL, context: { wa_id: KAMAL, user_id: `AZ.${KAMAL}`, username: "kamal.az" }, messages: [
        fromCustomer(KAMAL, "wamid.K1", ago(19 * HOUR), "Hello, are you open on Sunday?"),
      ] },
      // Already in the CRM: it arrived through the live webhook too.
      { id: AYSEL, context: { wa_id: AYSEL, user_id: `AZ.${AYSEL}` }, messages: [
        fromCustomer(AYSEL, "wamid.LIVE1", ago(3 * DAY), "Cümə günü yeriniz var?"),
      ] },
    ],
  }],
})

const DECLINED = envelope("history", {
  history: [{ errors: [{ code: 2593109, title: "History sync is turned off by the business from the WhatsApp Business App", message: "History sync is turned off by the business from the WhatsApp Business App", error_data: { details: "History sharing is turned off by the business" } }] }],
})

;(scratch ? describe : describe.skip)("WhatsApp coexistence import on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let admin!: PrismaClient
  let rls!: typeof import("@/lib/rls-context")
  let route!: typeof import("@/app/api/v1/webhooks/whatsapp/route")
  let status!: typeof import("@/lib/whatsapp-history-import/status")
  let createdDb = false
  let createdRole = false
  let before: Map<string, number>
  const outbound: string[] = []
  const realFetch = globalThis.fetch

  async function deliver(payload: unknown) {
    const { NextRequest } = await import("next/server")
    const body = JSON.stringify(payload)
    const signature = "sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET!).update(body).digest("hex")
    const res = await route.POST(new NextRequest("http://localhost/api/v1/webhooks/whatsapp", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    }))
    expect(res.status).toBe(200)
  }

  async function tableCounts(): Promise<Map<string, number>> {
    const rows = await admin.$queryRawUnsafe<Array<{ table_name: string; n: number }>>(`
      SELECT table_name::text AS table_name,
             (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)
    return new Map(rows.map((row) => [row.table_name, Number(row.n)]))
  }

  const tenant = <T>(fn: () => Promise<T>) => rls.runWithTenant(ORG, fn)

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'wa-history-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    // The import's table and column as production gets them — from their migration, with RLS —
    // the live webhook's partial unique indexes, and tenant isolation on every table it writes.
    sql(scratch!.adminDb, [
      `DROP TABLE "whatsapp_history_chunks"; ALTER TABLE "channel_messages" DROP COLUMN "historyImportedAt";`,
      readFileSync(MIGRATION, "utf8"),
      ...UNIQUE_INDEXES.map((file) => readFileSync(path.join(ROOT, file), "utf8")),
      ...RLS_TABLES.map(rlsPolicy),
      `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`,
    ].join("\n"))

    admin = new PrismaClient<PrismaTypes.PrismaClientOptions>({ datasources: { db: { url: scratch!.adminDb } } })
    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    route = await import("@/app/api/v1/webhooks/whatsapp/route")
    status = await import("@/lib/whatsapp-history-import/status")

    await rls.runWithRlsBypass(async () => {
      for (const id of [ORG, OTHER]) {
        await prisma.organization.create({ data: { id, name: id, slug: id, features: ["aiAutoReply"], maxContacts: 500 } })
      }
      await prisma.channelConfig.create({
        data: {
          id: CHANNEL, organizationId: ORG, channelType: "whatsapp", configName: "Lead Drive", isActive: true,
          phoneNumberId: PHONE_NUMBER_ID, accessToken: "token-not-used", businessAccountId: "waba-1",
          settings: {
            embeddedSignup: true, coexistence: true, displayPhoneNumber: "+994 51 206 08 38",
            onboardedAt: ago(2 * MIN).toISOString(), replyMode: "ai",
            historyImport: { contacts: { requestedAt: ago(2 * MIN).toISOString(), requestId: "r1" }, history: { requestedAt: ago(2 * MIN).toISOString(), requestId: "r2" } },
          },
        },
      })
      await prisma.aiAgentConfig.create({
        data: { organizationId: ORG, configName: "Inbox", agentType: "inbox", isActive: true, autonomousBacklogEnabled: true, autonomousLookbackDays: 30 } as never,
      })
      // Aysel is a customer already: a contact and a conversation the live webhook made three days ago,
      // answered from the CRM since.
      await prisma.contact.create({ data: { id: "contact-aysel", organizationId: ORG, fullName: "WhatsApp +994501112233", phone: `+${AYSEL}`, source: "whatsapp", createdAt: ago(3 * DAY) } })
      await prisma.socialConversation.create({
        data: { id: "conv-aysel", organizationId: ORG, platform: "whatsapp", externalId: AYSEL, channelConfigId: CHANNEL, contactId: "contact-aysel", contactName: "Aysel", lastMessage: "Bəli, var", lastMessageAt: ago(3 * DAY - 10 * MIN), status: "open" },
      })
      await prisma.channelMessage.create({ data: { id: "msg-aysel-live", organizationId: ORG, channelConfigId: CHANNEL, direction: "inbound", channelType: "whatsapp", contactId: "contact-aysel", conversationId: "conv-aysel", from: "Aysel", to: "system", body: "Cümə günü yeriniz var?", status: "read", externalId: "wamid.LIVE1", deferredTurnAt: ago(3 * DAY), metadata: { waPhone: AYSEL, waMessageId: "wamid.LIVE1" }, createdAt: ago(3 * DAY) } })
      await prisma.channelMessage.create({ data: { id: "msg-aysel-reply", organizationId: ORG, channelConfigId: CHANNEL, direction: "outbound", channelType: "whatsapp", contactId: "contact-aysel", conversationId: "conv-aysel", from: PHONE_NUMBER_ID, to: AYSEL, body: "Bəli, var", status: "read", metadata: { authorName: "Operator" }, createdAt: ago(3 * DAY - 10 * MIN) } })
      // The control: a customer who wrote LIVE five minutes ago and has had no answer. Both automations
      // must answer exactly this one — otherwise their silence on the imported chats proves nothing.
      await prisma.socialConversation.create({
        data: { id: "conv-control", organizationId: ORG, platform: "whatsapp", externalId: CONTROL, channelConfigId: CHANNEL, contactName: "Control", lastMessage: "Salam?", lastMessageAt: ago(5 * MIN), status: "open", unreadCount: 1 },
      })
      await prisma.channelMessage.create({ data: { id: "msg-control", organizationId: ORG, channelConfigId: CHANNEL, direction: "inbound", channelType: "whatsapp", conversationId: "conv-control", from: "Control", to: "system", body: "Salam? Qiymətlər nədir?", status: "delivered", externalId: "wamid.CONTROL", metadata: { waPhone: CONTROL, waMessageId: "wamid.CONTROL" }, createdAt: ago(5 * MIN) } })
    })

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      outbound.push(String(input instanceof Request ? input.url : input))
      throw new Error("no network in this test")
    }) as typeof fetch
    // The organization's data key is made on its first tenant scope (lib/crypto/tenant-data-keys);
    // production organizations have theirs long before a number is connected.
    await rls.runWithTenant(ORG, () => prisma.contact.count())
    before = await tableCounts()
  }, 300_000)

  afterAll(async () => {
    globalThis.fetch = realFetch
    await prisma?.$disconnect().catch(() => {})
    await admin?.$disconnect().catch(() => {})
    if (createdDb) sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
  })

  it("imports contacts and chats through the real webhook, with their own time and nothing unread", async () => {
    await deliver(CONTACTS)
    await deliver(HISTORY_OLD)
    await deliver(HISTORY_RECENT)

    await tenant(async () => {
      const chunks: Array<{ kind: string; status: string; payload: unknown }> = await prisma.whatsAppHistoryChunk.findMany({ where: { channelConfigId: CHANNEL } })
      expect(chunks.map((c) => [c.kind, c.status, c.payload]).sort()).toEqual([["contacts", "done", null], ["history", "done", null], ["history", "done", null]])

      // Contacts: Aysel matched (and given her name), Leyla created, the removal ignored.
      const contacts: Array<{ phone: string | null; fullName: string; createdAt: Date; id: string }> = await prisma.contact.findMany({ where: { organizationId: ORG }, orderBy: { phone: "asc" } })
      expect(contacts.map((c) => [c.phone, c.fullName])).toEqual([[`+${AYSEL}`, "Aysel Məmmədova"], [`+${LEYLA}`, "Leyla Həsənova"]])
      const leyla = contacts.find((c) => c.phone === `+${LEYLA}`)!
      expect(leyla.createdAt.getTime()).toBeLessThan(ago(30 * DAY).getTime())

      // Chats: one new conversation per new thread, the existing one reused, nothing unread.
      type Conversation = { id: string; externalId: string; lastMessage: string | null; lastMessageAt: Date; unreadCount: number; contactId: string | null; contactName: string }
      const conversations: Conversation[] = await prisma.socialConversation.findMany({ where: { organizationId: ORG }, orderBy: { externalId: "asc" } })
      expect(conversations.map((c) => c.externalId)).toEqual([AYSEL, LEYLA, KAMAL, CONTROL].sort())
      const byKey = new Map(conversations.map((c) => [c.externalId, c]))
      expect(byKey.get(AYSEL)!.id).toBe("conv-aysel")
      // History is older than the live exchange, so Aysel's list line did not move back in time.
      expect(byKey.get(AYSEL)!.lastMessage).toBe("Bəli, var")
      expect(byKey.get(LEYLA)!).toMatchObject({ unreadCount: 0, contactId: leyla.id, contactName: "Leyla Həsənova", lastMessage: "Sabah 11:00 olar?" })
      expect(byKey.get(LEYLA)!.lastMessageAt.getTime()).toBe(ago(5 * MIN).getTime())
      expect(byKey.get(KAMAL)!).toMatchObject({ unreadCount: 0, contactId: null, contactName: "kamal.az" })

      const imported: Array<{ externalId: string | null; direction: string; status: string; createdAt: Date; body: string; deferredTurnAt: Date | null }> = await prisma.channelMessage.findMany({ where: { organizationId: ORG, historyImportedAt: { not: null } }, orderBy: { createdAt: "asc" } })
      expect(imported.map((m) => [m.externalId, m.direction, m.status])).toEqual([
        ["wamid.A1", "inbound", "read"],
        ["wamid.A2", "outbound", "delivered"],
        ["wamid.A4", "inbound", "read"],
        ["wamid.L1", "outbound", "delivered"],
        ["wamid.K1", "inbound", "read"],
        ["wamid.L2", "inbound", "read"],
      ])
      // The message's own time on the phone, not the time the webhook came.
      expect(imported.find((m) => m.externalId === "wamid.A1")!.createdAt.getTime()).toBe(ago(80 * DAY).getTime())
      expect(imported.find((m) => m.externalId === "wamid.A4")!.body).toBe("[Медиафайл]")
      // Every imported customer message is already "taken care of" for the deferred booking turn.
      expect(imported.filter((m) => m.direction === "inbound").every((m) => m.deferredTurnAt !== null)).toBe(true)
      // The message that already came live is there once.
      expect(await prisma.channelMessage.count({ where: { organizationId: ORG, externalId: "wamid.LIVE1" } })).toBe(1)

      const view = await status.historyImportStatus(ORG, CHANNEL)
      expect(view).toMatchObject({
        state: "done",
        contacts: { received: 3, created: 1, matched: 1 },
        history: { progress: 100, conversations: 3, messages: 6, declined: false },
      })
    })
  }, 120_000)

  it("counts the import screen from the rows themselves, under the tenant's own scope", async () => {
    const detail = await tenant(() => status.historyImportDetail(ORG, CHANNEL))
    expect(detail).toMatchObject({
      state: "done",
      phone: "connected",
      displayPhoneNumber: "+994 51 206 08 38",
      counts: { conversations: 3, messages: 6, media: 1, mediaFiles: 0 },
      newContacts: { total: 1, shown: [{ name: "Leyla Həsənova" }] },
    })
    // Every imported message lands in the month of its own date.
    expect(detail!.months.reduce((sum, m) => sum + m.messages, 0)).toBe(6)
    expect(detail!.months.map((m) => m.month)).toEqual([...new Set([ago(80 * DAY), ago(79 * DAY), ago(20 * HOUR), ago(5 * MIN)].map((d) => d.toISOString().slice(0, 7)))].sort())
    // Aysel's conversation was there before; the history went into it, not into a second one.
    expect(detail!.feed).toHaveLength(3)
    expect(detail!.feed.map((f) => f.conversationId)).toContain("conv-aysel")

    // The inbox card: on a channel this person may see, and not on one hidden from them.
    expect(await tenant(() => status.inboxHistoryImports(ORG, () => true, NOW))).toEqual([
      expect.objectContaining({ channelId: CHANNEL, state: "done", progress: 100, conversations: 3, contacts: 2 }),
    ])
    expect(await tenant(() => status.inboxHistoryImports(ORG, (id) => id !== CHANNEL, NOW))).toEqual([])
  })

  it("adds no row to any other table and sends nothing anywhere", async () => {
    const after = await tableCounts()
    const changed = [...after.entries()]
      .filter(([table, n]) => n !== (before.get(table) ?? 0))
      .map(([table, n]) => `${table}: ${before.get(table) ?? 0} → ${n}`)
      .sort()
    expect(changed).toEqual([
      "channel_messages: 3 → 9",
      "contacts: 1 → 2",
      "social_conversations: 2 → 4",
      "whatsapp_history_chunks: 0 → 3",
    ])
    expect(outbound).toEqual([])
  })

  it("leaves the deferred booking turn nothing to answer but the live control", async () => {
    const { runWhatsAppDeferredTurns } = await import("@/lib/booking/whatsapp-deferred-turn")
    const answer = vi.fn(async (_input: { conversationId: string }) => ({ handled: true }))
    const outcome = await runWhatsAppDeferredTurns({ now: NOW, answer })
    // Leyla asked five minutes ago — inside the turn's window — and stays the phone's to answer.
    expect(answer.mock.calls.map(([input]) => input.conversationId)).toEqual(["conv-control"])
    expect(outcome).toMatchObject({ channels: 1, candidates: 1, answered: 1 })
  })

  it("leaves the autonomous inbox sweep nothing to answer but the live control", async () => {
    const { runAutonomousInboxAgent } = await import("@/lib/inbox/autonomous-agent-cron")
    // The number answered without a hold, so the sweep reads every conversation on it.
    await rls.runWithRlsBypass(() => prisma.channelConfig.update({
      where: { id: CHANNEL },
      data: { settings: { embeddedSignup: true, coexistence: true, displayPhoneNumber: "+994 51 206 08 38", onboardedAt: ago(2 * MIN).toISOString(), replyMode: "ai", replyHold: "never" } },
    }))
    const reply = vi.fn(async (_input: { conversationId: string }) => ({ replied: true, escalated: false }))
    const outcome = await rls.runWithRlsBypass(() =>
      runAutonomousInboxAgent(prisma as never, { now: NOW, reply, businessOpen: async () => true }))
    expect(reply.mock.calls.map(([input]) => input.conversationId)).toEqual(["conv-control"])
    expect(outcome.replied).toBe(1)
    expect(outcome.candidates).toBe(4)
  })

  it("keeps Meta's 24-hour window shut for imported messages", async () => {
    const { sendWhatsAppText } = await import("@/lib/whatsapp")
    outbound.length = 0
    // Kamal wrote 20 hours ago — but to the WhatsApp Business app, before the Cloud API had the number.
    const kamal = await tenant(() => sendWhatsAppText({ to: `+${KAMAL}`, body: "Bəli, açığıq", organizationId: ORG, channelConfigId: CHANNEL, skipLog: true }))
    expect(kamal).toMatchObject({ success: false, error: "outside_window_no_template" })
    expect(outbound).toEqual([])
    // The control wrote live five minutes ago: the same reader sees that window open, and the send
    // goes as far as Meta (refused here only because this test has no network).
    const control = await tenant(() => sendWhatsAppText({ to: `+${CONTROL}`, body: "Salam!", organizationId: ORG, channelConfigId: CHANNEL, skipLog: true }))
    expect(control.error).not.toBe("outside_window_no_template")
    expect(outbound.some((url) => url.includes(`/${PHONE_NUMBER_ID}/messages`))).toBe(true)
  })

  it("adds nothing for a redelivered webhook or the same messages arriving again", async () => {
    const counts = await tableCounts()
    // Meta redelivers a webhook it did not get a prompt 2xx for: the same chunk, the same row.
    await deliver(HISTORY_RECENT)
    await deliver(CONTACTS)
    expect(await tableCounts()).toEqual(counts)

    // The same messages in another chunk (a resent chunk under another order number) are a new
    // chunk — and every message in it is one the inbox already has.
    const resent = structuredClone(HISTORY_RECENT) as typeof HISTORY_RECENT
    ;(resent.entry[0].changes[0].value as unknown as { history: Array<{ metadata: { chunk_order: number } }> }).history[0].metadata.chunk_order = 2
    await deliver(resent)
    const again = await tableCounts()
    for (const table of ["channel_messages", "contacts", "social_conversations"]) {
      expect(`${table}: ${again.get(table)}`).toBe(`${table}: ${counts.get(table)}`)
    }
    expect(again.get("whatsapp_history_chunks")).toBe((counts.get("whatsapp_history_chunks") ?? 0) + 1)
    await tenant(async () => {
      const latest = await prisma.whatsAppHistoryChunk.findFirst({ where: { channelConfigId: CHANNEL, chunkOrder: 2 } })
      expect(latest).toMatchObject({ status: "done", result: { imported: 0, duplicates: 4 } })
    })
  })

  it("records a refusal to share history in words the screen can show", async () => {
    await deliver(DECLINED)
    const view = await tenant(() => status.historyImportStatus(ORG, CHANNEL))
    expect(view).toMatchObject({ state: "declined", history: { declined: true } })
  })

  it("shows another organization none of it", async () => {
    await rls.runWithTenant(OTHER, async () => {
      expect(await prisma.whatsAppHistoryChunk.count()).toBe(0)
      expect(await prisma.channelMessage.count()).toBe(0)
      expect(await prisma.socialConversation.count()).toBe(0)
      expect(await prisma.contact.count()).toBe(0)
    })
  })
})
