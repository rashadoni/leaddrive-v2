/**
 * One customer, one feed (owner, 2026-11-15, «Bütün kanallar bir lentdə») on a real Postgres, connected as
 * an application role without BYPASSRLS, the inbox tables under the standard tenant policy — the real
 * routes, only the browser session and the farewell's way out stubbed.
 *
 *  - Instagram and Messenger carry no customer identity: an Instagram conversation stays its own thread
 *    until a manager says «Bu eyni müştəridir». Then it joins the customer's WhatsApp and his calls,
 *    every message of it — and «Ayır» puts back exactly what was there.
 *  - A number the customer typed in the chat is only a suggestion, and only when it belongs to exactly
 *    one customer. A number two customers share suggests nobody; another organization's never.
 *  - The thread knows all its conversations. Closing closes them all and says goodbye once, in the
 *    channel the manager answers in.
 *  - The opened customer's own history: every channel, his calls, not the numbers hidden from the person.
 *  - A conversation in the trash leaves the feed, the customer's live channels stay.
 *
 * Set INBOX_CUSTOMER_FEED_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55497:5432 postgres:16
 *   INBOX_CUSTOMER_FEED_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Inbox customer feed
 * database gate»), where `INBOX_CUSTOMER_FEED_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.INBOX_CUSTOMER_FEED_TEST_DATABASE_URL
if (!adminUrl && process.env.INBOX_CUSTOMER_FEED_DB_GATE === "required") {
  throw new Error("INBOX_CUSTOMER_FEED_TEST_DATABASE_URL is required by the inbox customer feed database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.INBOX_CUSTOMER_FEED_TEST_DATABASE_URL
  if (!admin) return null
  const name = `inbox_feed_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "inbox-feed-fixture-only"
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
  }
})

/** The farewell's way out to Meta / WhatsApp — recorded, not sent. */
const farewells = vi.hoisted(() => ({ sentTo: [] as string[] }))
vi.mock("@/lib/inbox/conversation-actions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/inbox/conversation-actions")>(),
  executeConversationAction: vi.fn(async (_action: unknown, context: { conversationId: string }) => {
    farewells.sentTo.push(context.conversationId)
    return { ok: true }
  }),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = ["contacts", "social_conversations", "channel_messages", "call_logs", "audit_logs"]

const ORG = "org-feed"
const OTHER = "org-feed-other"
const ADMIN = "user-feed-admin"
const SELLER = "user-feed-seller"
const OTHER_ADMIN = "user-feed-other-admin"
const IG = "cfg-feed-ig"
const WA = "cfg-feed-wa"
const FB = "cfg-feed-fb"
const ANAR = "contact-anar"
const RENA = "contact-rena"
const RENA_TWIN = "contact-rena-twin" // the same number as Rəna — a family phone
const ELSEWHERE = "contact-elsewhere" // Anar's number in another organization
const CONV_WA = "conv-feed-wa"
const CONV_IG = "conv-feed-ig"
const CONV_FB = "conv-feed-fb"
const CALL = "call-feed-voip"

const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000)
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000)

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "inbox-feed-schema-")), "schema.prisma")
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

type Thread = {
  threadKey: string
  contactId: string | null
  channels: string[]
  socialConversationId: string | null
  messages: Array<{ id: string; channelType: string; conversationId: string | null }>
  threadConversations: Array<{ key: string; id: string; platform: string; status?: string; contactLinked?: boolean }>
  callLogs?: Array<{ id: string }>
}

;(scratch ? describe : describe.skip)("one customer, one feed — on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let inbox!: typeof import("@/app/api/v1/inbox/route")
  let contactLink!: typeof import("@/app/api/v1/inbox/conversations/[id]/contact-link/route")
  let history!: typeof import("@/app/api/v1/inbox/thread/route")
  let bulk!: typeof import("@/app/api/v1/inbox/conversations/bulk/route")
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

  async function listThreads(): Promise<Thread[]> {
    const res = await inbox.GET(request("/api/v1/inbox"), undefined as never)
    expect(res.status).toBe(200)
    return (await res.json()).data.conversations as Thread[]
  }
  const threadOf = (threads: Thread[], messageId: string) => threads.find((t) => t.messages.some((m) => m.id === messageId))

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'inbox-feed-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    inbox = await import("@/app/api/v1/inbox/route")
    contactLink = await import("@/app/api/v1/inbox/conversations/[id]/contact-link/route")
    history = await import("@/app/api/v1/inbox/thread/route")
    bulk = await import("@/app/api/v1/inbox/conversations/bulk/route")

    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id } })
      for (const [id, organizationId, role] of [[ADMIN, ORG, "admin"], [SELLER, ORG, "sales"], [OTHER_ADMIN, OTHER, "admin"]] as const) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@example.test`, name: id, role, passwordHash: "x" } })
      }
      await prisma.channelConfig.createMany({
        data: [
          { id: IG, organizationId: ORG, channelType: "instagram", configName: "magaza.baku", pageId: "ig-page" },
          { id: WA, organizationId: ORG, channelType: "whatsapp", configName: "Mağaza WhatsApp", phoneNumber: "+994121234567" },
          { id: FB, organizationId: ORG, channelType: "facebook", configName: "Mağaza Baku", pageId: "fb-page" },
        ],
      })
      await prisma.contact.createMany({
        data: [
          { id: ANAR, organizationId: ORG, fullName: "Anar Məmmədov", phone: "+994501112233", source: "whatsapp" },
          { id: RENA, organizationId: ORG, fullName: "Rəna Hüseynova", phone: "+994551234567" },
          { id: RENA_TWIN, organizationId: ORG, fullName: "Rəna (ev)", phone: "+994551234567" },
          { id: ELSEWHERE, organizationId: OTHER, fullName: "Anar başqa şirkətdə", phone: "+994501112233" },
        ],
      })
      await prisma.socialConversation.createMany({
        data: [
          { id: CONV_WA, organizationId: ORG, platform: "whatsapp", externalId: "994501112233", contactId: ANAR, contactName: "Anar", channelConfigId: WA, lastMessageAt: at(30) },
          { id: CONV_IG, organizationId: ORG, platform: "instagram", externalId: "ig-anar", contactName: "anar.mm", channelConfigId: IG, lastMessageAt: at(2) },
          { id: CONV_FB, organizationId: ORG, platform: "facebook", externalId: "psid-rena", contactName: "Rena H", channelConfigId: FB, lastMessageAt: at(1) },
        ],
      })
      const message = (id: string, conversationId: string, channelType: string, channelConfigId: string, direction: "inbound" | "outbound", body: string, hoursAgo: number, extra: Record<string, unknown> = {}) => ({
        id, organizationId: ORG, conversationId, channelType, channelConfigId, direction, body, createdAt: at(hoursAgo),
        from: direction === "inbound" ? (extra.from as string ?? "customer") : "business",
        to: direction === "inbound" ? "business" : (extra.to as string ?? "customer"),
        contactId: (extra.contactId as string | undefined) ?? null,
        metadata: (extra.metadata as object | undefined) ?? {},
      })
      await prisma.channelMessage.createMany({
        data: [
          // Instagram, 12 Nov: the price question and the answer.
          message("m-ig-1", CONV_IG, "instagram", IG, "inbound", "Salam, bu çəkmənin 42-si var? Qiyməti?", 50, { from: "ig-anar" }),
          message("m-ig-2", CONV_IG, "instagram", IG, "outbound", "Salam! Var, 89 ₼ 😊", 49, { to: "ig-anar" }),
          // WhatsApp, 13 Nov: the same question, another answer. WhatsApp knows him by phone.
          message("m-wa-1", CONV_WA, "whatsapp", WA, "inbound", "Salam, çəkmə 42 hələ var?", 30, { from: "994501112233", contactId: ANAR, metadata: { waPhone: "994501112233" } }),
          message("m-wa-2", CONV_WA, "whatsapp", WA, "outbound", "95 ₼, endirim bitib", 29, { to: "994501112233", contactId: ANAR, metadata: { waPhone: "994501112233" } }),
          // Instagram today: he wrote his number.
          message("m-ig-3", CONV_IG, "instagram", IG, "inbound", "Sabah gələrəm 😊 nömrəm 050 111 22 33", 2, { from: "ig-anar" }),
          // Messenger: a number two customers share — the family phone.
          message("m-fb-1", CONV_FB, "facebook", FB, "inbound", "Zəng edin: +994 55 123 45 67", 1, { from: "psid-rena" }),
        ],
      })
      // A phone call with Anar that belongs to no conversation (the shop line).
      await prisma.callLog.create({
        data: { id: CALL, organizationId: ORG, contactId: ANAR, direction: "inbound", fromNumber: "+994501112233", toNumber: "+994121234567", status: "completed", duration: 72, provider: "voip", createdAt: at(20) },
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  it("keeps the inbox tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await bypass(() => prisma.$queryRaw<Array<{ relname: string; forced: boolean }>>`
      SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY(${RLS_TABLES}) ORDER BY relname`)
    expect(tables).toEqual([...RLS_TABLES].sort().map((relname) => ({ relname, forced: true })))
  })

  it("keeps an Instagram conversation nobody linked as its own thread", async () => {
    as(ORG, ADMIN)
    const threads = await listThreads()
    const anar = threadOf(threads, "m-wa-1")!
    const instagram = threadOf(threads, "m-ig-1")!
    expect(anar.contactId).toBe(ANAR)
    expect(anar.messages.map((m) => m.id)).toEqual(["m-wa-2", "m-wa-1"])
    expect(instagram).not.toBe(anar)
    expect(instagram.contactId).toBeNull()
    // The calls of the customer that sit on no conversation are in his feed.
    expect(anar.callLogs?.map((c) => c.id)).toContain(CALL)
  })

  it("suggests the customer a number from the chat belongs to — only when it belongs to exactly one", async () => {
    as(ORG, ADMIN)
    const ig = await (await contactLink.GET(request(`/api/v1/inbox/conversations/${CONV_IG}/contact-link`), idCtx(CONV_IG))).json()
    expect(ig.data).toMatchObject({ platform: "instagram", linkable: true, contact: null })
    expect(ig.data.suggestions).toEqual([
      expect.objectContaining({ id: ANAR, fullName: "Anar Məmmədov", matchedBy: "phone", matchedValue: "994501112233" }),
    ])
    // A family phone: two customers own it, so it names nobody.
    const fb = await (await contactLink.GET(request(`/api/v1/inbox/conversations/${CONV_FB}/contact-link`), idCtx(CONV_FB))).json()
    expect(fb.data.suggestions).toEqual([])
    // A suggestion is a question — nothing was linked by reading it.
    const stored = await bypass<{ contactId: string | null; metadata?: unknown }>(() => prisma.socialConversation.findUniqueOrThrow({ where: { id: CONV_IG }, select: { contactId: true } }))
    expect(stored.contactId).toBeNull()

    const search = await (await contactLink.GET(request(`/api/v1/inbox/conversations/${CONV_IG}/contact-link?q=Anar`), idCtx(CONV_IG))).json()
    expect(search.data.results.map((c: { id: string }) => c.id)).toEqual([ANAR]) // not the other organization's Anar
  })

  it("refuses to link to another organization's customer, and a WhatsApp conversation at all", async () => {
    as(ORG, ADMIN)
    const foreign = await contactLink.POST(request(`/api/v1/inbox/conversations/${CONV_IG}/contact-link`, "POST", { contactId: ELSEWHERE }), idCtx(CONV_IG))
    expect(foreign.status).toBe(400)
    const whatsapp = await contactLink.POST(request(`/api/v1/inbox/conversations/${CONV_WA}/contact-link`, "POST", { contactId: RENA }), idCtx(CONV_WA))
    expect(whatsapp.status).toBe(400)
    // Another organization cannot touch this one's conversation.
    as(OTHER, OTHER_ADMIN)
    const crossTenant = await contactLink.POST(request(`/api/v1/inbox/conversations/${CONV_IG}/contact-link`, "POST", { contactId: ELSEWHERE }), idCtx(CONV_IG))
    expect(crossTenant.status).toBe(404)
    const rows = await bypass(() => prisma.socialConversation.findMany({ where: { id: { in: [CONV_IG, CONV_WA] } }, select: { id: true, contactId: true }, orderBy: { id: "asc" } }))
    expect(rows).toEqual([{ id: CONV_IG, contactId: null }, { id: CONV_WA, contactId: ANAR }])
  })

  it("«Bu eyni müştəridir»: the Instagram conversation joins his WhatsApp and calls — every message of it", async () => {
    as(ORG, ADMIN)
    const res = await contactLink.POST(request(`/api/v1/inbox/conversations/${CONV_IG}/contact-link`, "POST", { contactId: ANAR, via: "suggestion" }), idCtx(CONV_IG))
    expect(res.status).toBe(200)

    const threads = await listThreads()
    const anar = threadOf(threads, "m-wa-1")!
    expect(threadOf(threads, "m-ig-1")).toBe(anar)
    expect(anar.messages.map((m) => m.id)).toEqual(["m-ig-3", "m-wa-2", "m-wa-1", "m-ig-2", "m-ig-1"])
    expect([...anar.channels].sort()).toEqual(["instagram", "whatsapp"])
    expect(anar.threadConversations.map((c) => [c.id, c.platform, c.contactLinked])).toEqual([
      [CONV_IG, "instagram", true],
      [CONV_WA, "whatsapp", false],
    ])
    expect(anar.callLogs?.map((c) => c.id)).toContain(CALL)
    // Nobody else's thread grew: Rəna's Messenger is still alone.
    expect(threadOf(threads, "m-fb-1")!.contactId).toBeNull()

    const stored = await bypass<{ contactId: string | null; metadata?: unknown }>(() => prisma.socialConversation.findUniqueOrThrow({ where: { id: CONV_IG }, select: { contactId: true, metadata: true } }))
    expect(stored.contactId).toBe(ANAR)
    expect(stored.metadata).toMatchObject({ contactLink: { contactId: ANAR, by: ADMIN, via: "suggestion" } })
    const audit = await bypass(() => prisma.auditLog.findMany({ where: { organizationId: ORG, entityId: CONV_IG }, select: { userId: true, newValue: true } }))
    expect(audit).toEqual([expect.objectContaining({ userId: ADMIN, newValue: expect.objectContaining({ contactId: ANAR, action: "contact_link" }) })])
  })

  it("reads the opened customer's own history — every channel and his calls, not a hidden number", async () => {
    as(ORG, ADMIN)
    const full = await (await history.GET(request(`/api/v1/inbox/thread?contactId=${ANAR}`), undefined as never)).json()
    expect(full.data.messages.map((m: { id: string }) => m.id)).toEqual(["m-ig-3", "m-wa-2", "m-wa-1", "m-ig-2", "m-ig-1"])
    expect(full.data.callLogs.map((c: { id: string }) => c.id)).toEqual([CALL])
    expect([...full.data.conversationIds].sort()).toEqual([CONV_IG, CONV_WA].sort())

    // A seller the admin hid the Instagram page from reads only the WhatsApp part.
    as(ORG, SELLER, "sales", [IG])
    const narrowed = await (await history.GET(request(`/api/v1/inbox/thread?contactId=${ANAR}`), undefined as never)).json()
    expect(narrowed.data.messages.map((m: { id: string }) => m.id)).toEqual(["m-wa-2", "m-wa-1"])
    const listed = threadOf(await listThreads(), "m-wa-1")!
    expect(listed.messages.every((m) => m.channelType === "whatsapp")).toBe(true)
    expect(listed.threadConversations.map((c) => c.id)).toEqual([CONV_WA])

    // Another organization reads nothing of him.
    as(OTHER, OTHER_ADMIN)
    expect((await history.GET(request(`/api/v1/inbox/thread?contactId=${ANAR}`), undefined as never)).status).toBe(404)
  })

  it("closes every channel of the customer and says goodbye once — in the channel being answered", async () => {
    as(ORG, ADMIN)
    farewells.sentTo = []
    const res = await bulk.POST(request("/api/v1/inbox/conversations/bulk", "POST", {
      action: "close",
      ids: [CONV_IG, CONV_WA],
      farewellIds: [CONV_IG],
      message: "Sağ olun, sabah gözləyirik!",
      operationId: "8a1c6a3e-4f3b-4c55-9d0e-2b1f3c4d5e6f",
    }), undefined as never)
    expect(res.status).toBe(200)
    expect(farewells.sentTo).toEqual([CONV_IG])
    const rows = await bypass<Array<{ status: string }>>(() => prisma.socialConversation.findMany({ where: { id: { in: [CONV_IG, CONV_WA] } }, select: { status: true } }))
    expect(rows.map((r) => r.status)).toEqual(["resolved", "resolved"])
    const body = await res.json()
    // His WhatsApp was closed without a farewell on purpose — not reported as a failed send.
    expect(body.data?.results ?? body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: CONV_IG, ok: true, sent: true }),
      expect.objectContaining({ id: CONV_WA, ok: true }),
    ]))
    expect((body.data?.results ?? body.results).find((r: { id: string }) => r.id === CONV_WA)).not.toHaveProperty("sent")
  })

  it("leaves a deleted channel in the trash and keeps the customer's live one in the list", async () => {
    as(ORG, ADMIN)
    await bypass(() => prisma.socialConversation.update({ where: { id: CONV_WA }, data: { deletedAt: NOW, deletedBy: ADMIN } }))
    try {
      const anar = threadOf(await listThreads(), "m-ig-1")!
      expect(anar.contactId).toBe(ANAR)
      expect(anar.messages.map((m) => m.id)).toEqual(["m-ig-3", "m-ig-2", "m-ig-1"])
      expect(anar.threadConversations.map((c) => c.id)).toEqual([CONV_IG])
      const trash = await inbox.GET(request("/api/v1/inbox?view=trash"), undefined as never)
      const trashed = (await trash.json()).data.conversations as Thread[]
      expect(trashed.some((t) => t.messages.some((m) => m.id === "m-wa-1"))).toBe(true)
    } finally {
      await bypass(() => prisma.socialConversation.update({ where: { id: CONV_WA }, data: { deletedAt: null, deletedBy: null } }))
    }
  })

  it("«Ayır» puts back exactly what was there", async () => {
    as(ORG, ADMIN)
    const res = await contactLink.DELETE(request(`/api/v1/inbox/conversations/${CONV_IG}/contact-link`, "DELETE"), idCtx(CONV_IG))
    expect(res.status).toBe(200)
    const threads = await listThreads()
    const anar = threadOf(threads, "m-wa-1")!
    expect(anar.messages.map((m) => m.id)).toEqual(["m-wa-2", "m-wa-1"])
    expect(threadOf(threads, "m-ig-1")!.contactId).toBeNull()
    const full = await (await history.GET(request(`/api/v1/inbox/thread?contactId=${ANAR}`), undefined as never)).json()
    expect(full.data.messages.map((m: { id: string }) => m.id)).toEqual(["m-wa-2", "m-wa-1"])
    const stored = await bypass<{ contactId: string | null; metadata?: unknown }>(() => prisma.socialConversation.findUniqueOrThrow({ where: { id: CONV_IG }, select: { contactId: true, metadata: true } }))
    expect(stored.contactId).toBeNull()
    expect(stored.metadata).toMatchObject({ contactUnlinked: { contactId: ANAR, by: ADMIN } })
    expect(stored.metadata).not.toHaveProperty("contactLink")
  })
})
