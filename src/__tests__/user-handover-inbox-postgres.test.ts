/**
 * «The manager leaves — the conversations stay» on a real Postgres, connected as an application role
 * without BYPASSRLS, the tables under the standard tenant policy — the real routes, only the browser
 * session stubbed.
 *
 *  - Deleting a user hands his open inbox conversations and website chats to the administrator who
 *    deleted him, in the same transaction as the anonymization (lib/user-work-handover). Closed ones,
 *    the trash, other people's and another organization's stay exactly as they were, and nothing
 *    about a conversation changes but who answers it.
 *  - A conversation is never left without an owner by this: an open conversation nobody is assigned
 *    to is what the AI auto-reply takes.
 *  - The inbox's «Ответственный» filter (lib/inbox/assignee-conversations): the list is the
 *    organization's newest messages, so a conversation nobody wrote in lately is not in it; asked for
 *    one person, the list also holds her open conversations the window missed. The people who hold
 *    conversations are named even when they no longer work here.
 *  - «Hand over all» (`POST /api/v1/inbox/assignees/transfer`): everything one person holds goes to
 *    another in one press — a hundred and more, where a selection carries fifty. It moves exactly
 *    what the filter counted for the person; closed ones, the trash, a number hidden from the
 *    caller and another organization's stay, and the new owner must be somebody who can answer.
 *  - Without the filter, the conversations a WhatsApp history import wrote are in the list too:
 *    months of them arrive at once with their own old dates, and the window held a few dozen of the
 *    hundreds the import screen counted (16.11.2026). Only open ones the import made, on numbers that
 *    imported history, under the caller's own organization and hidden numbers.
 *
 * Set USER_HANDOVER_INBOX_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   USER_HANDOVER_INBOX_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («User handover
 * inbox database gate»), where `USER_HANDOVER_INBOX_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { convMatchesAssignee } from "@/lib/inbox/assignee-filter"

const adminUrl = process.env.USER_HANDOVER_INBOX_TEST_DATABASE_URL
if (!adminUrl && process.env.USER_HANDOVER_INBOX_DB_GATE === "required") {
  throw new Error("USER_HANDOVER_INBOX_TEST_DATABASE_URL is required by the user handover inbox database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.USER_HANDOVER_INBOX_TEST_DATABASE_URL
  if (!admin) return null
  const name = `user_handover_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "user-handover-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  return { name, role, adminDb: db.toString() }
})

/** The browser session the routes see. */
const browser = vi.hoisted(() => ({
  current: null as null | {
    orgId: string; userId: string; role: string; email: string; name: string
    principalType: "session"; hiddenChannelConfigIds?: string[]
  },
}))
vi.mock("@/lib/api-auth", () => {
  const unauthorized = () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  return {
    getOrgId: vi.fn(async () => browser.current?.orgId ?? null),
    getSession: vi.fn(async () => browser.current),
    requireAuth: vi.fn(async () => browser.current ?? unauthorized()),
    requireSessionAuth: vi.fn(async () => browser.current ?? unauthorized()),
    isAuthError: (value: unknown) => value instanceof Response,
    // The module switch is not what this file is about; «Settings» is on.
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn(() => NextResponse.json({ error: "Forbidden" }, { status: 403 })),
  }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = ["social_conversations", "web_chat_sessions", "channel_messages", "conversation_participants", "leads", "tickets", "audit_logs", "whatsapp_history_chunks"]

const ORG = "org-handover"
const OTHER = "org-handover-other"
const ADMIN = "user-ho-admin"
const LEAVER = "user-ho-leaver"
const COLLEAGUE = "user-ho-colleague"
const SELLER = "user-ho-seller" // an admin hid the Instagram page from this one
const OFF = "user-ho-off" // switched off, not deleted — her name is still hers
const GHOST = "user-ho-ghost" // deleted before conversations were handed over
const OTHER_ADMIN = "user-ho-other-admin"
const WA = "cfg-ho-wa"
const IG = "cfg-ho-ig"
const CONTACT = "contact-ho-mail"

const C_OPEN = "conv-ho-open" // WhatsApp, written in today — in the list's window
const C_QUIET = "conv-ho-quiet" // Instagram, last written in a month ago — outside the window
const C_SNOOZED = "conv-ho-snoozed" // open, put off until next week, outside the window
const C_MAIL = "conv-ho-mail" // an e-mail thread's row: platform "inbox", no preview of its own
const C_RESOLVED = "conv-ho-resolved"
const C_ARCHIVED = "conv-ho-archived"
const C_TRASH = "conv-ho-trash"
const C_COLLEAGUE = "conv-ho-colleague"
const C_NOBODY = "conv-ho-nobody" // unassigned — the AI's; also holds the 510 newer messages
const C_OFF = "conv-ho-off"
const C_GHOST = "conv-ho-ghost"
const C_OTHER = "conv-ho-other-org" // another organization's, pointing at the SAME user id
const W_OPEN = "chat-ho-open"
const W_ESCALATED = "chat-ho-escalated"
const W_CLOSED = "chat-ho-closed"
const W_COLLEAGUE = "chat-ho-colleague"
const W_OTHER = "chat-ho-other-org"
const LEAD = "lead-ho-open"
const TICKET = "ticket-ho-open"

const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000)
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000)
const MONTH_AGO = hoursAgo(24 * 30)
const NEXT_WEEK = new Date(NOW.getTime() + 7 * 24 * 3_600_000)

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "user-handover-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

function tenantPolicy(table: string): string {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "${table}"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`
}

type Row = {
  socialConversationId?: string | null
  webChatSessionId?: string | null
  assignedTo?: string | null
  status?: string
  lastMessage: string
  lastChannel: string
  messages: Array<{ id: string }>
  threadConversations?: Array<{ id: string; assignedTo?: string | null }>
  historyImport?: boolean
  unreadCount?: number
  lastMessageAt?: string
}
type Conv = { id: string; assignedTo: string | null; status: string; snoozedUntil: Date | null; folderId: string | null; tags: string[]; deletedAt: Date | null }
type Chat = { id: string; assignedUserId: string | null; status: string; aiPaused: boolean }

;(scratch ? describe : describe.skip)("the manager leaves, the conversations stay — on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let inbox!: typeof import("@/app/api/v1/inbox/route")
  let holders!: typeof import("@/app/api/v1/inbox/assignees/route")
  let transfer!: typeof import("@/app/api/v1/inbox/assignees/transfer/route")
  let history!: typeof import("@/app/api/v1/inbox/thread/route")
  let bulk!: typeof import("@/app/api/v1/inbox/conversations/bulk/route")
  let users!: typeof import("@/app/api/v1/users/[id]/route")
  let createdDb = false
  let createdRole = false

  const as = (orgId: string, userId: string, role = "admin", hiddenChannelConfigIds?: string[]) => {
    browser.current = { orgId, userId, role, email: `${userId}@example.test`, name: userId, principalType: "session", hiddenChannelConfigIds }
  }
  const bypass = <T,>(fn: () => Promise<T>): Promise<T> => rls.runWithRlsBypass(fn) as Promise<T>
  const request = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  })
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })

  async function list(query = ""): Promise<{ rows: Row[]; assignee?: { id: string; more: boolean } }> {
    const res = await inbox.GET(request(`/api/v1/inbox${query}`), undefined as never)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    return { rows: data.conversations as Row[], assignee: data.assignee }
  }
  /** Every stored conversation the rows hold, as a row's own or as one of a customer's channels. */
  const conversationIds = (rows: Row[]) => [...new Set(rows.flatMap((row) => [
    row.socialConversationId,
    ...(row.threadConversations ?? []).map((tc) => tc.id),
  ]).filter((id): id is string => Boolean(id)))].sort()
  const of = (rows: Row[], person: string) => rows.filter((row) => convMatchesAssignee(row, person))

  const conversations = () => bypass<Conv[]>(() => prisma.socialConversation.findMany({
    select: { id: true, assignedTo: true, status: true, snoozedUntil: true, folderId: true, tags: true, deletedAt: true },
    orderBy: { id: "asc" },
  }))
  const chats = () => bypass<Chat[]>(() => prisma.webChatSession.findMany({
    select: { id: true, assignedUserId: true, status: true, aiPaused: true },
    orderBy: { id: "asc" },
  }))
  const owners = async () => Object.fromEntries((await conversations()).map((row) => [row.id, row.assignedTo]))
  const chatOwners = async () => Object.fromEntries((await chats()).map((row) => [row.id, row.assignedUserId]))

  const BEFORE = {
    [C_OPEN]: LEAVER, [C_QUIET]: LEAVER, [C_SNOOZED]: LEAVER, [C_MAIL]: LEAVER,
    [C_RESOLVED]: LEAVER, [C_ARCHIVED]: LEAVER, [C_TRASH]: LEAVER,
    [C_COLLEAGUE]: COLLEAGUE, [C_NOBODY]: null, [C_OFF]: OFF, [C_GHOST]: GHOST, [C_OTHER]: LEAVER,
  }
  const CHATS_BEFORE = { [W_OPEN]: LEAVER, [W_ESCALATED]: LEAVER, [W_CLOSED]: LEAVER, [W_COLLEAGUE]: COLLEAGUE, [W_OTHER]: LEAVER }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'user-handover-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    inbox = await import("@/app/api/v1/inbox/route")
    holders = await import("@/app/api/v1/inbox/assignees/route")
    transfer = await import("@/app/api/v1/inbox/assignees/transfer/route")
    history = await import("@/app/api/v1/inbox/thread/route")
    bulk = await import("@/app/api/v1/inbox/conversations/bulk/route")
    users = await import("@/app/api/v1/users/[id]/route")

    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id } })
      const people: Array<[string, string, string, string, Record<string, unknown>?]> = [
        [ADMIN, ORG, "admin", "Rəşad"],
        [LEAVER, ORG, "sales", "Leyla"],
        [COLLEAGUE, ORG, "sales", "Aysel"],
        [SELLER, ORG, "sales", "Kamran"],
        [OFF, ORG, "sales", "Nigar", { isActive: false }],
        [GHOST, ORG, "sales", "Удалённый пользователь", { isActive: false, anonymizedAt: hoursAgo(24 * 60) }],
        [OTHER_ADMIN, OTHER, "admin", "Başqa şirkət"],
      ]
      for (const [id, organizationId, role, name, extra] of people) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@example.test`, name, role, passwordHash: "x", ...extra } })
      }
      await prisma.channelConfig.createMany({
        data: [
          { id: WA, organizationId: ORG, channelType: "whatsapp", configName: "Mağaza WhatsApp", phoneNumber: "+994121234567" },
          { id: IG, organizationId: ORG, channelType: "instagram", configName: "magaza.baku", pageId: "ig-page" },
        ],
      })
      await prisma.contact.create({ data: { id: CONTACT, organizationId: ORG, fullName: "Tural Əliyev", email: "tural@example.test" } })
      const folder = await prisma.inboxFolder.create({ data: { organizationId: ORG, name: "VIP" } })

      const conv = (id: string, platform: string, externalId: string, assignedTo: string | null, extra: Record<string, unknown> = {}) => ({
        id, organizationId: ORG, platform, externalId, assignedTo, contactName: externalId, lastMessageAt: MONTH_AGO, ...extra,
      })
      await prisma.socialConversation.createMany({
        data: [
          conv(C_OPEN, "whatsapp", "994500000001", LEAVER, { channelConfigId: WA, lastMessageAt: hoursAgo(1), folderId: folder.id, tags: ["vip"] }),
          conv(C_QUIET, "instagram", "ig-quiet", LEAVER, { channelConfigId: IG, contactName: "sevda.h", lastMessage: "Çatdırılma neçəyədir?" }),
          conv(C_SNOOZED, "whatsapp", "994500000002", LEAVER, { channelConfigId: WA, snoozedUntil: NEXT_WEEK, lastMessage: "Gələn həftə yazaram" }),
          conv(C_MAIL, "inbox", `c:${CONTACT}`, LEAVER, { contactId: CONTACT, contactName: "Tural Əliyev", metadata: { channel: "email", ensured: true } }),
          conv(C_RESOLVED, "whatsapp", "994500000003", LEAVER, { channelConfigId: WA, status: "resolved", closedAt: MONTH_AGO }),
          conv(C_ARCHIVED, "whatsapp", "994500000004", LEAVER, { channelConfigId: WA, status: "archived" }),
          conv(C_TRASH, "whatsapp", "994500000005", LEAVER, { channelConfigId: WA, deletedAt: MONTH_AGO, deletedBy: ADMIN }),
          conv(C_COLLEAGUE, "whatsapp", "994500000006", COLLEAGUE, { channelConfigId: WA, lastMessageAt: hoursAgo(1) }),
          conv(C_NOBODY, "whatsapp", "994500000007", null, { channelConfigId: WA, lastMessageAt: hoursAgo(2) }),
          conv(C_OFF, "whatsapp", "994500000008", OFF, { channelConfigId: WA }),
          conv(C_GHOST, "whatsapp", "994500000009", GHOST, { channelConfigId: WA }),
          // Another organization's conversation whose `assignedTo` — a bare string — is the SAME id.
          { ...conv(C_OTHER, "whatsapp", "994500000010", LEAVER), organizationId: OTHER },
        ],
      })
      // Each conversation is another customer: the list groups messages by who wrote them.
      const message = (id: string, conversationId: string, channelType: string, channelConfigId: string | null, direction: "inbound" | "outbound", body: string, createdAt: Date, extra: Record<string, unknown> = {}) => ({
        id, organizationId: ORG, conversationId, channelType, channelConfigId, direction, body, createdAt,
        from: direction === "inbound" ? `customer-${conversationId}` : "business",
        to: direction === "inbound" ? "business" : `customer-${conversationId}`,
        metadata: {}, ...extra,
      })
      await prisma.channelMessage.createMany({
        data: [
          message("m-ho-open-1", C_OPEN, "whatsapp", WA, "inbound", "Salam, sifarişim hazırdır?", hoursAgo(1.5)),
          message("m-ho-open-2", C_OPEN, "whatsapp", WA, "outbound", "Bəli, sabah çatdırırıq", hoursAgo(1)),
          message("m-ho-colleague", C_COLLEAGUE, "whatsapp", WA, "inbound", "Qiymət?", hoursAgo(1)),
          message("m-ho-quiet", C_QUIET, "instagram", IG, "inbound", "Çatdırılma neçəyədir?", MONTH_AGO),
          message("m-ho-snoozed", C_SNOOZED, "whatsapp", WA, "outbound", "Gələn həftə yazaram", MONTH_AGO),
          message("m-ho-mail", C_MAIL, "email", null, "inbound", "Müqavilə layihəsini göndərin", MONTH_AGO, { contactId: CONTACT, from: "tural@example.test" }),
          message("m-ho-resolved", C_RESOLVED, "whatsapp", WA, "inbound", "Təşəkkürlər", MONTH_AGO),
          // The organization kept writing: 510 newer messages push everything a month old out of the
          // list's window (the newest 500) — which is where a manager's quiet conversations really are.
          ...Array.from({ length: 510 }, (_, index) =>
            message(`m-ho-busy-${index}`, C_NOBODY, "whatsapp", WA, "inbound", `Sual ${index}`, new Date(hoursAgo(2).getTime() - index * 60_000))),
        ],
      })
      const chat = (id: string, organizationId: string, assignedUserId: string, status: string, aiPaused: boolean) => ({
        id, organizationId, assignedUserId, status, aiPaused, visitorName: id, lastMessageAt: hoursAgo(3),
      })
      await prisma.webChatSession.createMany({
        data: [
          chat(W_OPEN, ORG, LEAVER, "open", true),
          // The manager switched the AI back on by hand; whose chat it is has nothing to do with that.
          chat(W_ESCALATED, ORG, LEAVER, "escalated", false),
          chat(W_CLOSED, ORG, LEAVER, "closed", true),
          chat(W_COLLEAGUE, ORG, COLLEAGUE, "open", true),
          chat(W_OTHER, OTHER, LEAVER, "open", true),
        ],
      })
      // The work the handover already moved, in the same transaction — it must still move.
      await prisma.lead.create({ data: { id: LEAD, organizationId: ORG, contactName: "Yeni lid", assignedTo: LEAVER } })
      await prisma.ticket.create({ data: { id: TICKET, organizationId: ORG, ticketNumber: "T-1", subject: "Sual", assignedTo: LEAVER } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  it("keeps the tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await bypass(() => prisma.$queryRaw<Array<{ relname: string; forced: boolean }>>`
      SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY(${RLS_TABLES}) ORDER BY relname`)
    expect(tables).toEqual([...RLS_TABLES].sort().map((relname) => ({ relname, forced: true })))
  })

  it("the list alone does not hold a conversation nobody wrote in lately", async () => {
    // The reason the filter cannot be a filter on the screen only.
    as(ORG, ADMIN)
    const { rows, assignee } = await list()
    const hers = conversationIds(of(rows, LEAVER))
    expect(hers).toContain(C_OPEN)
    expect(hers).not.toContain(C_QUIET)
    expect(hers).not.toContain(C_SNOOZED)
    expect(hers).not.toContain(C_MAIL)
    expect(assignee).toBeUndefined()
  })

  it("names everyone who holds open conversations — the people who left included", async () => {
    as(ORG, ADMIN)
    const res = await holders.GET(request("/api/v1/inbox/assignees"), undefined as never)
    expect(res.status).toBe(200)
    const data = ((await res.json()).data as Array<{ id: string; name: string | null; active: boolean; removed: boolean; open: number }>)
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(data).toEqual([
      // One conversation and one website chat.
      { id: COLLEAGUE, name: "Aysel", active: true, removed: false, open: 2 },
      // Deleted before her conversations were handed over: no name, and it is not the placeholder.
      { id: GHOST, name: null, active: false, removed: true, open: 1 },
      // Four open conversations (the snoozed one and the e-mail thread among them) and two website
      // chats. The resolved, the archived, the one in the trash and the closed chat are not work.
      { id: LEAVER, name: "Leyla", active: true, removed: false, open: 6 },
      // Switched off: her name is still hers.
      { id: OFF, name: "Nigar", active: false, removed: false, open: 1 },
    ])

    // Another organization sees its own holders only. Its conversation points at an id that is no
    // user of that organization — held by nobody, and named as such, never as this organization's Leyla.
    as(OTHER, OTHER_ADMIN)
    const other = await (await holders.GET(request("/api/v1/inbox/assignees"), undefined as never)).json()
    expect(other.data).toEqual([{ id: LEAVER, name: null, active: false, removed: true, open: 2 }])
  })

  it("asked for one person, the list also holds her open conversations the window missed", async () => {
    as(ORG, ADMIN)
    const { rows, assignee } = await list(`?assignee=${LEAVER}`)
    const hers = of(rows, LEAVER)
    // Open and snoozed ones — all of them. Closed ones are not dug out of the past, the trash never.
    expect(conversationIds(hers)).toEqual([C_MAIL, C_OPEN, C_QUIET, C_SNOOZED].sort())
    expect(assignee).toEqual({ id: LEAVER, more: false })
    // Her website chats stand in the same list.
    expect(hers.map((row) => row.webChatSessionId).filter(Boolean).sort()).toEqual([W_CLOSED, W_ESCALATED, W_OPEN].sort())

    const quiet = hers.find((row) => row.socialConversationId === C_QUIET)!
    expect(quiet).toMatchObject({ assignedTo: LEAVER, status: "open", lastChannel: "instagram", lastMessage: "Çatdırılma neçəyədir?", messages: [] })
    // An e-mail thread's row keeps neither a preview nor the channel's name: both come from its newest message.
    const mail = hers.find((row) => row.socialConversationId === C_MAIL)!
    expect(mail).toMatchObject({ lastChannel: "email", lastMessage: "Müqavilə layihəsini göndərin", contactName: "Tural Əliyev" })

    // Nobody else's conversation was added: the colleague's, the unassigned one and those of the two
    // who left are in the answer only if the window held them — and none of them is hers.
    expect(conversationIds(of(rows, COLLEAGUE))).toEqual([C_COLLEAGUE])
    expect(conversationIds(rows)).not.toContain(C_GHOST)
    expect(conversationIds(rows)).not.toContain(C_OFF)
    expect(conversationIds(rows)).not.toContain(C_OTHER)
  })

  it("keeps the channel filter, a hidden number and another organization out of what it adds", async () => {
    as(ORG, ADMIN)
    const instagram = await list(`?assignee=${LEAVER}&channel=instagram`)
    expect(conversationIds(of(instagram.rows, LEAVER))).toEqual([C_QUIET])
    const mail = await list(`?assignee=${LEAVER}&channel=email`)
    expect(conversationIds(of(mail.rows, LEAVER))).toEqual([C_MAIL])

    // A seller the admin hid the Instagram page from gets her WhatsApp and mail, not the Instagram one.
    as(ORG, SELLER, "sales", [IG])
    const narrowed = await list(`?assignee=${LEAVER}`)
    expect(conversationIds(of(narrowed.rows, LEAVER))).toEqual([C_MAIL, C_OPEN, C_SNOOZED].sort())

    // The same id asked for in another organization finds only that organization's conversation.
    as(OTHER, OTHER_ADMIN)
    const elsewhere = await list(`?assignee=${LEAVER}`)
    expect(conversationIds(elsewhere.rows)).toEqual([C_OTHER])
  })

  it("a conversation added that way opens: its history is read, though the list held none of it", async () => {
    as(ORG, ADMIN)
    const res = await history.GET(request(`/api/v1/inbox/thread?conversationId=${C_QUIET}`), undefined as never)
    expect(res.status).toBe(200)
    expect((await res.json()).data.messages.map((m: { id: string }) => m.id)).toEqual(["m-ho-quiet"])
  })

  it("hands the conversations found that way to a colleague with the bulk «assign» that already exists", async () => {
    as(ORG, ADMIN)
    const res = await bulk.POST(request("/api/v1/inbox/conversations/bulk", "POST", { action: "assign", ids: [C_QUIET], assignedTo: COLLEAGUE }), undefined as never)
    expect(res.status).toBe(200)
    expect(await owners()).toEqual({ ...BEFORE, [C_QUIET]: COLLEAGUE })
  })

  it("does not let another organization's administrator delete this organization's user", async () => {
    as(OTHER, OTHER_ADMIN)
    const res = await users.DELETE(request(`/api/v1/users/${LEAVER}`, "DELETE"), idCtx(LEAVER))
    expect(res.status).toBe(404)
    expect(await owners()).toEqual({ ...BEFORE, [C_QUIET]: COLLEAGUE })
    expect(await chatOwners()).toEqual(CHATS_BEFORE)
    const leaver = await bypass<{ isActive: boolean; anonymizedAt: Date | null; name: string }>(() => prisma.user.findUniqueOrThrow({ where: { id: LEAVER }, select: { isActive: true, anonymizedAt: true, name: true } }))
    expect(leaver).toEqual({ isActive: true, anonymizedAt: null, name: "Leyla" })
  })

  it("deleting the manager hands his open conversations to the administrator who deleted him", async () => {
    const before = await conversations()
    as(ORG, ADMIN)
    const res = await users.DELETE(request(`/api/v1/users/${LEAVER}`, "DELETE"), idCtx(LEAVER))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Three conversations (today's, the snoozed one, the e-mail thread) and two website chats.
    expect(body.handover).toMatchObject({ conversations: 5, leads: 1, tickets: 1 })

    expect(await owners()).toEqual({
      ...BEFORE,
      [C_OPEN]: ADMIN,
      [C_SNOOZED]: ADMIN,
      [C_MAIL]: ADMIN,
      // Handed to the colleague before the deletion — hers, not swept up with the rest.
      [C_QUIET]: COLLEAGUE,
      // Closed and in the trash: history, left as it was. The unassigned one is still nobody's;
      // other people's are theirs; another organization's is untouched though it names the same id.
    })
    expect(await chatOwners()).toEqual({ ...CHATS_BEFORE, [W_OPEN]: ADMIN, [W_ESCALATED]: ADMIN })

    // Nothing about a conversation changed but who answers it.
    const strip = (rows: Conv[]) => rows.map((row) => ({ ...row, assignedTo: "—" }))
    expect(strip(await conversations())).toEqual(strip(before))
    expect(await chats()).toEqual(expect.arrayContaining([
      { id: W_OPEN, assignedUserId: ADMIN, status: "open", aiPaused: true },
      // The AI the manager had switched back on stays on; the chat is simply someone's again.
      { id: W_ESCALATED, assignedUserId: ADMIN, status: "escalated", aiPaused: false },
      { id: W_CLOSED, assignedUserId: LEAVER, status: "closed", aiPaused: true },
    ]))

    // No open conversation was left to nobody — that is what the AI auto-reply answers.
    const open = (await conversations()).filter((row) => row.status === "open" && !row.deletedAt && row.id !== C_NOBODY)
    expect(open.every((row) => row.assignedTo !== null)).toBe(true)

    // The rest of his work went the same way, in the same transaction, and the account is closed.
    const lead = await bypass<{ assignedTo: string | null }>(() => prisma.lead.findUniqueOrThrow({ where: { id: LEAD }, select: { assignedTo: true } }))
    const ticket = await bypass<{ assignedTo: string | null }>(() => prisma.ticket.findUniqueOrThrow({ where: { id: TICKET }, select: { assignedTo: true } }))
    expect([lead.assignedTo, ticket.assignedTo]).toEqual([ADMIN, ADMIN])
    const leaver = await bypass<{ isActive: boolean; anonymizedAt: Date | null; name: string }>(() => prisma.user.findUniqueOrThrow({ where: { id: LEAVER }, select: { isActive: true, anonymizedAt: true, name: true } }))
    expect(leaver.isActive).toBe(false)
    expect(leaver.anonymizedAt).not.toBeNull()
    expect(leaver.name).not.toBe("Leyla")
  })

  it("afterwards the one who left holds no open conversation, and the administrator finds them under his own name", async () => {
    as(ORG, ADMIN)
    const data = (await (await holders.GET(request("/api/v1/inbox/assignees"), undefined as never)).json()).data as Array<{ id: string }>
    expect(data.map((holder) => holder.id).sort()).toEqual([ADMIN, COLLEAGUE, GHOST, OFF].sort())

    const { rows } = await list(`?assignee=${ADMIN}`)
    expect(conversationIds(of(rows, ADMIN))).toEqual([C_MAIL, C_OPEN, C_SNOOZED].sort())
    // The conversations stranded on an account deleted before today can be found — and so moved — too.
    const stranded = await list(`?assignee=${GHOST}`)
    expect(conversationIds(of(stranded.rows, GHOST))).toEqual([C_GHOST])
  })

  it("deleting the same user again finds nobody and moves nothing", async () => {
    as(ORG, ADMIN)
    const owned = await owners()
    const res = await users.DELETE(request(`/api/v1/users/${LEAVER}`, "DELETE"), idCtx(LEAVER))
    expect(res.status).toBe(404)
    expect(await owners()).toEqual(owned)
  })

  // ── «Hand over all» ────────────────────────────────────────────────────────────────────────────
  // By now: the administrator holds what the deleted manager held, Aysel a WhatsApp and an Instagram
  // conversation and a website chat, the switched-off Nigar and the long-deleted account one each.

  const handOver = (body: unknown) => transfer.POST(request("/api/v1/inbox/assignees/transfer", "POST", body), undefined as never)
  const openCounts = async () => Object.fromEntries(
    ((await (await holders.GET(request("/api/v1/inbox/assignees"), undefined as never)).json()).data as Array<{ id: string; open: number }>)
      .map((holder) => [holder.id, holder.open]),
  )
  const journal = () => bypass<Array<{ organizationId: string; userId: string | null; entityId: string | null; newValue: unknown }>>(() =>
    prisma.auditLog.findMany({
      where: { action: "bulk_update", entityType: "conversation", entityName: { startsWith: "Inbox handover" } },
      select: { organizationId: true, userId: true, entityId: true, newValue: true },
      orderBy: { createdAt: "asc" },
    }))

  it("refuses a new owner who cannot answer — and moves nothing", async () => {
    await bypass(() => prisma.user.create({
      data: { id: "user-ho-reviewer", organizationId: ORG, email: "user-ho-reviewer@example.test", name: "Yoxlayıcı", role: "reviewer", passwordHash: "x" },
    }))
    const owned = await owners()
    const chatsOwned = await chatOwners()
    as(ORG, ADMIN)
    const nobodyToAnswer: Array<[string, unknown]> = [
      ["switched off", { from: GHOST, to: OFF }],
      ["deleted", { from: GHOST, to: LEAVER }],
      ["another organization's administrator", { from: GHOST, to: OTHER_ADMIN }],
      ["an outside reviewer", { from: GHOST, to: "user-ho-reviewer" }],
      ["an id that is no user", { from: GHOST, to: "user-ho-nobody" }],
      ["the same person", { from: ADMIN, to: ADMIN }],
      // «To nobody» does not exist: an open conversation without an owner is what the AI takes.
      ["nobody", { from: GHOST, to: null }],
      ["nobody named", { from: GHOST }],
      ["nobody asked about", { to: COLLEAGUE }],
    ]
    for (const [who, body] of nobodyToAnswer) {
      const res = await handOver(body)
      expect(res.status, who).toBe(400)
    }
    expect(await owners()).toEqual(owned)
    expect(await chatOwners()).toEqual(chatsOwned)
    expect(await journal()).toEqual([])
  })

  it("is not for someone who may only read the inbox", async () => {
    const owned = await owners()
    as(ORG, SELLER, "viewer")
    expect((await handOver({ from: GHOST, to: COLLEAGUE })).status).toBe(403)
    expect(await owners()).toEqual(owned)
  })

  it("leaves a number hidden from the caller alone — to him those conversations are not there", async () => {
    // The seller the admin hid the Instagram page from: he is told Aysel holds two, and two move.
    as(ORG, SELLER, "sales", [IG])
    expect((await openCounts())[COLLEAGUE]).toBe(2)
    const owned = await owners()
    const res = await handOver({ from: COLLEAGUE, to: SELLER })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ conversations: 1, webChats: 1, total: 2 })
    expect(await owners()).toEqual({ ...owned, [C_COLLEAGUE]: SELLER })
    // Her Instagram conversation is still hers.
    expect((await owners())[C_QUIET]).toBe(COLLEAGUE)
    expect((await chatOwners())[W_COLLEAGUE]).toBe(SELLER)
  })

  it("moves only the caller's own organization's conversations, whatever id is named", async () => {
    const owned = await owners()
    as(OTHER, OTHER_ADMIN)
    // This organization's long-deleted account holds an open conversation; the other organization
    // names the same id and finds nothing of its own under it.
    const none = await handOver({ from: GHOST, to: OTHER_ADMIN })
    expect(none.status).toBe(200)
    expect((await none.json()).data).toEqual({ conversations: 0, webChats: 0, total: 0 })
    expect(await owners()).toEqual(owned)

    // The id both organizations use: only the other organization's conversation and chat move.
    const theirs = await handOver({ from: LEAVER, to: OTHER_ADMIN })
    expect((await theirs.json()).data).toEqual({ conversations: 1, webChats: 1, total: 2 })
    expect(await owners()).toEqual({ ...owned, [C_OTHER]: OTHER_ADMIN })
    expect(await chatOwners()).toMatchObject({ [W_OTHER]: OTHER_ADMIN, [W_CLOSED]: LEAVER })
    // What was moved is in that organization's journal, by the one who pressed; a press that moved
    // nothing left no row.
    expect(await journal()).toEqual([
      { organizationId: ORG, userId: SELLER, entityId: COLLEAGUE, newValue: { assignedTo: SELLER, conversations: 1, webChats: 1 } },
      { organizationId: OTHER, userId: OTHER_ADMIN, entityId: LEAVER, newValue: { assignedTo: OTHER_ADMIN, conversations: 1, webChats: 1 } },
    ])
  })

  it("hands over everything a person holds in one press — a hundred and twenty, where a selection carries fifty", async () => {
    // Nigar was switched off with 120 more open conversations nobody wrote in for a month — none of
    // them in the list's window — a snoozed one in a folder among them, one closed, one in the
    // trash, a website chat with the AI switched back on, a closed chat; and another organization
    // has a conversation that names her id.
    const MANY = Array.from({ length: 120 }, (_, index) => `conv-ho-many-${String(index).padStart(3, "0")}`)
    await bypass(async () => {
      const folder = await prisma.inboxFolder.findFirstOrThrow({ where: { organizationId: ORG, name: "VIP" }, select: { id: true } })
      const row = (id: string, index: number, extra: Record<string, unknown> = {}) => ({
        id, organizationId: ORG, platform: "whatsapp", externalId: `99455${String(index).padStart(7, "0")}`, channelConfigId: WA,
        assignedTo: OFF, contactName: id, lastMessageAt: MONTH_AGO, ...extra,
      })
      await prisma.socialConversation.createMany({
        data: [
          ...MANY.map((id, index) => row(id, index, index === 0 ? { snoozedUntil: NEXT_WEEK, folderId: folder.id, tags: ["vip"] } : {})),
          row("conv-ho-many-resolved", 500, { status: "resolved", closedAt: MONTH_AGO }),
          row("conv-ho-many-trash", 501, { deletedAt: MONTH_AGO, deletedBy: ADMIN }),
          { ...row("conv-ho-many-other", 502), organizationId: OTHER, channelConfigId: null },
        ],
      })
      await prisma.webChatSession.createMany({
        data: [
          { id: "chat-ho-many-open", organizationId: ORG, assignedUserId: OFF, status: "open", aiPaused: false, visitorName: "many", lastMessageAt: MONTH_AGO },
          { id: "chat-ho-many-closed", organizationId: ORG, assignedUserId: OFF, status: "closed", aiPaused: true, visitorName: "many", lastMessageAt: MONTH_AGO },
        ],
      })
    })
    as(ORG, ADMIN)
    // What the filter says she holds: the one from before, the 120, and the open website chat.
    const counted = await openCounts()
    expect(counted[OFF]).toBe(122)
    // The selection cannot carry them: the bulk action takes fifty at most.
    const tooMany = await bulk.POST(request("/api/v1/inbox/conversations/bulk", "POST", { action: "assign", ids: MANY, assignedTo: COLLEAGUE }), undefined as never)
    expect(tooMany.status).toBe(400)

    const before = await conversations()
    const owned = await owners()
    const chatsBefore = await chats()
    const res = await handOver({ from: OFF, to: COLLEAGUE })
    expect(res.status).toBe(200)
    // Exactly what the filter counted — the number on the button is the number that moves.
    expect((await res.json()).data).toEqual({ conversations: 121, webChats: 1, total: counted[OFF] })

    expect(await owners()).toEqual({
      ...owned,
      [C_OFF]: COLLEAGUE,
      ...Object.fromEntries(MANY.map((id) => [id, COLLEAGUE])),
      // The closed one, the one in the trash and the other organization's are still under her id.
    })
    expect((await owners())["conv-ho-many-resolved"]).toBe(OFF)
    expect((await owners())["conv-ho-many-trash"]).toBe(OFF)
    expect((await owners())["conv-ho-many-other"]).toBe(OFF)
    // Nothing about a conversation changed but who answers it: the snoozed one is still snoozed, in
    // its folder, with its label.
    const strip = (rows: Conv[]) => rows.map((row) => ({ ...row, assignedTo: "—" }))
    expect(strip(await conversations())).toEqual(strip(before))
    // The website chat moved with the AI as it was — somebody had switched it back on by hand; the
    // closed chat stayed hers.
    const moved = (rows: Chat[]) => rows.map((row) => (row.id === "chat-ho-many-open" ? { ...row, assignedUserId: COLLEAGUE } : row))
    expect(await chats()).toEqual(moved(chatsBefore))
    expect((await chats()).find((row) => row.id === "chat-ho-many-open")).toEqual({ id: "chat-ho-many-open", assignedUserId: COLLEAGUE, status: "open", aiPaused: false })

    // She holds nothing open any more, and Aysel holds her own Instagram conversation and the 122.
    const after = await openCounts()
    expect(after[OFF]).toBeUndefined()
    expect(after[COLLEAGUE]).toBe(123)
    // Aysel finds them under her own name — the ones the list's window never held included.
    const { rows, assignee } = await list(`?assignee=${COLLEAGUE}`)
    expect(conversationIds(of(rows, COLLEAGUE))).toEqual([C_OFF, C_QUIET, ...MANY].sort())
    expect(assignee).toEqual({ id: COLLEAGUE, more: false })
    expect((await journal()).at(-1)).toEqual({
      organizationId: ORG, userId: ADMIN, entityId: OFF, newValue: { assignedTo: COLLEAGUE, conversations: 121, webChats: 1 },
    })
  })

  it("hands over what was stranded on an account deleted long ago, and a second press finds nothing", async () => {
    as(ORG, ADMIN)
    const first = await handOver({ from: GHOST, to: COLLEAGUE })
    expect((await first.json()).data).toEqual({ conversations: 1, webChats: 0, total: 1 })
    expect((await owners())[C_GHOST]).toBe(COLLEAGUE)

    const owned = await owners()
    const rows = (await journal()).length
    const second = await handOver({ from: GHOST, to: ADMIN })
    expect(second.status).toBe(200)
    expect((await second.json()).data).toEqual({ conversations: 0, webChats: 0, total: 0 })
    expect(await owners()).toEqual(owned)
    expect((await journal()).length).toBe(rows)
    // Nobody who left holds an open conversation now.
    expect(Object.keys(await openCounts()).sort()).toEqual([ADMIN, COLLEAGUE, SELLER].sort())
  })

  it("without the filter, the list holds every open conversation a WhatsApp history import wrote", async () => {
    // A number connected with the WhatsApp Business app brings six months of conversations at once,
    // each with its own old date — the window (the newest 500 messages) holds none of them here.
    const OTHER_WA = "cfg-ho-other-wa"
    const IMPORTED = ["conv-ho-imported-1", "conv-ho-imported-2"]
    await bypass(async () => {
      await prisma.channelConfig.create({ data: { id: OTHER_WA, organizationId: OTHER, channelType: "whatsapp", configName: "Başqa nömrə" } })
      await prisma.whatsAppHistoryChunk.createMany({
        data: [
          { organizationId: ORG, channelConfigId: WA, kind: "contacts", fingerprint: "ho-contacts", status: "done", items: 2 },
          { organizationId: ORG, channelConfigId: WA, kind: "history", fingerprint: "ho-history", status: "done", items: 6, progress: 100 },
          { organizationId: OTHER, channelConfigId: OTHER_WA, kind: "history", fingerprint: "ho-other-history", status: "done", items: 1, progress: 100 },
        ],
      })
      const imported = (id: string, externalId: string, lastMessageAt: Date, extra: Record<string, unknown> = {}) => ({
        id, organizationId: ORG, platform: "whatsapp", externalId, channelConfigId: WA, assignedTo: null,
        contactName: externalId, lastMessage: `Köhnə yazışma ${externalId}`, lastMessageAt, metadata: { historyImport: true }, ...extra,
      })
      await prisma.socialConversation.createMany({
        data: [
          imported(IMPORTED[0], "994700000001", hoursAgo(24 * 40)),
          imported(IMPORTED[1], "994700000002", hoursAgo(24 * 150)),
          // What the import made but is closed or in the trash, or what nobody imported, stays out.
          imported("conv-ho-imported-resolved", "994700000003", hoursAgo(24 * 60), { status: "resolved", closedAt: MONTH_AGO }),
          imported("conv-ho-imported-trash", "994700000004", hoursAgo(24 * 60), { deletedAt: MONTH_AGO, deletedBy: ADMIN }),
          imported("conv-ho-live-quiet", "994700000005", hoursAgo(24 * 40), { metadata: {} }),
          { ...imported("conv-ho-imported-other", "994700000006", hoursAgo(24 * 40)), organizationId: OTHER, channelConfigId: OTHER_WA },
        ],
      })
      await prisma.channelMessage.createMany({
        data: IMPORTED.map((conversationId, index) => ({
          id: `m-ho-imported-${index}`, organizationId: ORG, conversationId, channelType: "whatsapp", channelConfigId: WA,
          direction: "inbound", body: `Köhnə yazışma ${index}`, status: "read", from: `customer-${conversationId}`, to: "business",
          createdAt: index === 0 ? hoursAgo(24 * 40) : hoursAgo(24 * 150), historyImportedAt: NOW, metadata: { historyImport: true },
        })),
      })
    })

    as(ORG, ADMIN)
    const { rows, assignee } = await list()
    const found = rows.filter((row) => row.socialConversationId && row.socialConversationId.startsWith("conv-ho-") && /imported|live-quiet/.test(row.socialConversationId))
    expect(found.map((row) => row.socialConversationId).sort()).toEqual([...IMPORTED].sort())
    for (const row of found) {
      // A row without messages, read and marked «idxal»; opening it reads its history as usual.
      expect(row).toMatchObject({ historyImport: true, unreadCount: 0, messages: [], lastChannel: "whatsapp", status: "open" })
    }
    // In the list by their own dates, below what was written today.
    const at = (id: string) => rows.findIndex((row) => row.socialConversationId === id)
    expect(at(C_OPEN)).toBeLessThan(at(IMPORTED[0]))
    expect(at(IMPORTED[0])).toBeLessThan(at(IMPORTED[1]))
    // Nothing else the window missed came with them — that is still the «Ответственный» filter's job.
    expect(conversationIds(rows)).not.toContain(C_QUIET)
    expect(assignee).toBeUndefined()

    const opened = await history.GET(request(`/api/v1/inbox/thread?conversationId=${IMPORTED[1]}`), undefined as never)
    expect(opened.status).toBe(200)
    expect((await opened.json()).data.messages.map((m: { id: string }) => m.id)).toEqual(["m-ho-imported-1"])

    // Another channel's list, a number hidden from the caller, the trash and another organization.
    expect(conversationIds((await list("?channel=instagram")).rows).filter((id) => IMPORTED.includes(id))).toEqual([])
    expect(conversationIds((await list("?view=trash")).rows).filter((id) => IMPORTED.includes(id))).toEqual([])
    as(ORG, SELLER, "sales", [WA])
    expect(conversationIds((await list()).rows).filter((id) => id.includes("imported"))).toEqual([])
    as(OTHER, OTHER_ADMIN)
    const other = conversationIds((await list()).rows)
    expect(other).toContain("conv-ho-imported-other")
    expect(other.filter((id) => IMPORTED.includes(id))).toEqual([])
  })
})
