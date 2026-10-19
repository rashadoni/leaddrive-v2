/**
 * A prospect connects his own Facebook Page to the demo and writes to it, on a
 * real Postgres under row-level security, through the real routes, with an
 * application role that cannot bypass it.
 *
 * What a mocked Prisma cannot show, and this does:
 *   - a message from anyone but the one sender the code proved adds nothing to
 *     ANY table — every table of the schema is counted before and after — and
 *     the proof itself is taken once, atomically, by one sender;
 *   - the Facebook webhook's demo branch writes demo tables only, never runs
 *     before the tenant path: a Page LeadDrive Inc. has as an active channel
 *     still lands in its inbox, and the demo sees nothing of it;
 *   - the callback refuses a Page some organisation relies on — another
 *     tenant's row read under FORCE RLS, by the Page's id or its Instagram
 *     account's — and the product's own OAuth state never enters the demo
 *     branch, nor a demo state the product path;
 *   - tokens land only as ciphertext; the public read carries no id and no
 *     token; with either switch off nothing is reachable;
 *   - the agent answers at most ten times, and «Ayır» / «Bitir» ask for the
 *     release that the real release engine then carries out.
 * Only outbound requests are stubbed: graph.facebook.com (each request's
 * method, path and Bearer header asserted) and the model.
 *
 * Set DEMO_SOCIAL_CONNECT_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   DEMO_SOCIAL_CONNECT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Demo social connect database gate»), where
 * `DEMO_SOCIAL_CONNECT_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createHmac, randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { decryptToken, encryptToken } from "@/lib/secure-token"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { demoSessionCookieName } from "@/lib/demo-center/security"
import { demoSocialCode, demoSocialTokenPurpose } from "@/lib/demo-center/demo-social-connection"

const adminUrl = process.env.DEMO_SOCIAL_CONNECT_TEST_DATABASE_URL
if (!adminUrl && process.env.DEMO_SOCIAL_CONNECT_DB_GATE === "required") {
  throw new Error("DEMO_SOCIAL_CONNECT_TEST_DATABASE_URL is required by the demo social connect database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.DEMO_SOCIAL_CONNECT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `demo_social_connect_${process.pid}`
  const role = `demo_social_connect_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  return { name, role, password, adminScratch: adminScratch.toString() }
})

// The model: the demo agent's answer. Everything else of the product runs.
const anthropicCreate = vi.hoisted(() => vi.fn())
vi.mock("@/lib/ai/anthropic-client", async (original) => ({
  ...(await original<typeof import("@/lib/ai/anthropic-client")>()),
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}))
// The product callback's session lookup (a prospect has none) and the tenant
// path's side effects that need services this database has not got.
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(async () => null), getSession: vi.fn(async () => null) }))
const tenantSideEffects = vi.hoisted(() => ({ notify: vi.fn(async () => undefined), autoReply: vi.fn(async () => ({ handled: false })) }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: tenantSideEffects.notify }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn(async () => undefined) }))
vi.mock("@/lib/chatbot-autoreply", () => ({ maybeAutoReply: tenantSideEffects.autoReply, chatbotTookOwnership: () => false }))
vi.mock("@/lib/social/meta-sender-profile", () => ({ resolveMetaSenderName: vi.fn(async () => "Müştəri") }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATIONS = [
  "prisma/migrations/20261021090000_demo_social_connections/migration.sql",
]

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

function sql(url: string, statement: string) {
  prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)
}

/** The schema as `db push` can build it on any Postgres: the pgvector columns are left out (nothing here reads them). */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "demo-social-connect-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const SALES = "org-demo-sales"
const OTHER = "org-other-tenant"
const APP_ROW = "cc-staged-meta-app"
const APP_ID = "2414060595720618"
const APP_SECRET = "staged-app-secret"
const REDIRECT = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
const CODE = "meta-oauth-code"
const SHORT = `short-user-token-${randomBytes(4).toString("hex")}`
const LONG = `long-user-token-${randomBytes(4).toString("hex")}`
const META_USER = "880011223344"
const REPLY = "Salam! Mən LeadDrive-ın demo AI agentiyəm. Sualınızı yazın."
// The real clock: the routes read the time themselves.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

// --- Meta, as far as the code can see it -----------------------------------

interface MetaCall {
  method: string
  url: URL
  authorization: string | null
  body: string
}

interface FakePage {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id: string }
}

const metaCalls: MetaCall[] = []
/** Every Page token this file handed to Meta's side: none may ever appear in a URL. */
const pageTokens = new Set<string>()
let accounts: FakePage[] = []
let accountsRefuseInstagram = false
let debugPageIds: string[] = []
let pagesById: Record<string, FakePage> = {}
let subscribeOk = true

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const metaError = (code: number) => json(400, { error: { code, message: `refused for Page 999 and person 888 (${code})` } })

function withoutInstagram(page: FakePage, fields: string | null): Record<string, unknown> {
  if (fields?.includes("instagram_business_account")) return { ...page }
  const { instagram_business_account: _ig, ...rest } = page
  void _ig
  return rest
}

function meta(call: MetaCall): Response {
  const p = call.url.pathname
  const q = call.url.searchParams
  const bearer = call.authorization?.replace(/^Bearer /, "") ?? null
  if (p === "/v21.0/oauth/access_token") {
    // A token request is a POST with a form body; nothing of it is in the address.
    if (call.method !== "POST" || [...call.url.searchParams.keys()].length) return metaError(100)
    const q = new URLSearchParams(call.body)
    if (q.get("grant_type") === "fb_exchange_token") {
      return q.get("fb_exchange_token") === SHORT && q.get("client_secret") === APP_SECRET ? json(200, { access_token: LONG }) : metaError(190)
    }
    const ok = q.get("code") === CODE && q.get("client_id") === APP_ID && q.get("client_secret") === APP_SECRET && q.get("redirect_uri") === REDIRECT
    return ok ? json(200, { access_token: SHORT }) : metaError(100)
  }
  if (p === "/v21.0/me" && bearer === LONG) return json(200, { id: META_USER })
  if (p === "/v21.0/me/accounts" && bearer === LONG) {
    const fields = q.get("fields")
    if (accountsRefuseInstagram && fields?.includes("instagram_business_account")) return metaError(100)
    return json(200, { data: accounts.map((page) => withoutInstagram(page, fields)) })
  }
  if (p === "/v21.0/debug_token") {
    return json(200, { data: { is_valid: true, scopes: ["pages_messaging"], granular_scopes: [{ scope: "pages_messaging", target_ids: debugPageIds }] } })
  }
  const pageRead = p.match(/^\/v21\.0\/([0-9]+)$/)
  if (pageRead && bearer === LONG && call.method === "GET") {
    const page = pagesById[pageRead[1]]
    if (!page) return metaError(100)
    if (accountsRefuseInstagram && q.get("fields")?.includes("instagram_business_account")) return metaError(100)
    return json(200, withoutInstagram(page, q.get("fields")))
  }
  const subscription = p.match(/^\/v21\.0\/([0-9]+)\/subscribed_apps$/)
  if (subscription && call.method === "POST") {
    const form = new URLSearchParams(call.body)
    const page = pagesById[subscription[1]]
    if (!page || form.get("access_token") !== page.access_token) return metaError(190)
    return subscribeOk ? json(200, { success: true }) : json(500, { error: { code: 2 } })
  }
  if (subscription && call.method === "DELETE") return json(200, { success: true })
  if (p === "/v20.0/me/messages" && call.method === "POST") return json(200, { recipient_id: "x", message_id: `m_out_${metaCalls.length}` })
  return metaError(100)
}

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.host !== "graph.facebook.com") throw new Error(`unexpected request to ${url.host}`)
  const call: MetaCall = {
    method: init?.method ?? "GET",
    url,
    authorization: new Headers(init?.headers).get("authorization"),
    body: init?.body === undefined || init.body === null ? "" : String(init.body),
  }
  metaCalls.push(call)
  return meta(call)
})

/** What was sent, as `METHOD path`, in order. */
const sent = () => metaCalls.map((call) => `${call.method} ${call.url.pathname}`)

let pageSeq = 0
function fakePage(name: string, options: { instagram?: boolean } = {}): FakePage {
  pageSeq += 1
  const page: FakePage = {
    id: `4242424200${String(pageSeq).padStart(2, "0")}`,
    name,
    access_token: `page-token-${pageSeq}-${randomBytes(4).toString("hex")}`,
    ...(options.instagram ? { instagram_business_account: { id: `1784140000${String(pageSeq).padStart(2, "0")}` } } : {}),
  }
  pageTokens.add(page.access_token)
  pagesById[page.id] = page
  return page
}

describe.skipIf(!scratch)("connecting a prospect's own Facebook Page to the demo, on a real Postgres under row-level security", () => {
  let admin!: PrismaClient
  let app!: typeof import("@/lib/prisma").prisma
  let socialRoute!: typeof import("@/app/api/v1/public/demo-access/[token]/social/route")
  let messengerRoute!: typeof import("@/app/api/v1/public/demo-access/[token]/social/messenger/route")
  let callbackRoute!: typeof import("@/app/api/v1/social/oauth/facebook/callback/route")
  let webhookRoute!: typeof import("@/app/api/v1/webhooks/facebook/route")
  let eventsRoute!: typeof import("@/app/api/v1/public/demo-access/[token]/events/route")
  let inbound!: typeof import("@/lib/demo-center/demo-social-inbound")
  let release!: typeof import("@/lib/demo-center/demo-social-release")
  let requestId = ""

  beforeAll(async () => {
    const control = adminUrl!
    sql(control, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(control, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    // Production's tenant isolation: FORCE RLS with `tenant_isolation` on
    // every table carrying organizationId — channel_configs, social_accounts,
    // channel_messages and social_conversations among them.
    prismaCli(["db", "execute", "--url", scratch!.adminScratch, "--file", path.join(ROOT, "prisma/migrations/20260825170000_tenant_isolation_from_migrations/migration.sql")], process.env)
    // The demo tables exactly as their migration makes them: CHECKs, partial
    // indexes, the bypass-only policy, the event types.
    sql(scratch!.adminScratch, `DROP TABLE IF EXISTS "demo_social_messages", "demo_social_connections" CASCADE`)
    for (const migration of MIGRATIONS) prismaCli(["db", "execute", "--url", scratch!.adminScratch, "--file", path.join(ROOT, migration)], process.env)
    // This PR's column comes from `db push`; its CHECK from the migration.
    sql(scratch!.adminScratch, `ALTER TABLE "demo_grants" ADD CONSTRAINT "demo_grants_live_social_scenario_check" CHECK (NOT "liveSocialEnabled" OR "scenarioId" IS NOT NULL)`)
    sql(control, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(control, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)

    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    await admin.organization.createMany({ data: [{ id: SALES, name: "LeadDrive Inc.", slug: "leaddrive" }, { id: OTHER, name: "Other", slug: "other" }] })
    const request = await admin.demoRequest.create({
      data: { name: "Nigar Əliyeva", company: "Xəzər Logistika MMC", email: "nigar@example.az", emailNormalized: "nigar@example.az", emailDomain: "example.az", locale: "az", consentAt: NOW },
    })
    requestId = request.id
    vi.stubGlobal("fetch", fakeFetch)
    app = (await import("@/lib/prisma")).prisma
    socialRoute = await import("@/app/api/v1/public/demo-access/[token]/social/route")
    messengerRoute = await import("@/app/api/v1/public/demo-access/[token]/social/messenger/route")
    callbackRoute = await import("@/app/api/v1/social/oauth/facebook/callback/route")
    webhookRoute = await import("@/app/api/v1/webhooks/facebook/route")
    eventsRoute = await import("@/app/api/v1/public/demo-access/[token]/events/route")
    inbound = await import("@/lib/demo-center/demo-social-inbound")
    release = await import("@/lib/demo-center/demo-social-release")
  }, 300_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await app?.$disconnect()
    await admin?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  beforeEach(async () => {
    process.env.DEMO_LEAD_ORGANIZATION_ID = SALES
    process.env.DEMO_SOCIAL_META_APP_CONFIG_ID = APP_ROW
    process.env.FACEBOOK_REDIRECT_URI = REDIRECT
    await admin.demoSocialConnection.deleteMany()
    await admin.channelMessage.deleteMany()
    await admin.socialConversation.deleteMany()
    await admin.channelConfig.deleteMany()
    await admin.socialAccount.deleteMany()
    // LeadDrive Inc.'s staged Facebook app row: the webhook's secret and the demo's app.
    await admin.channelConfig.create({
      data: {
        id: APP_ROW, organizationId: SALES, channelType: "facebook", configName: "CRM (App Review)", appId: APP_ID, appSecret: APP_SECRET,
        verifyToken: "verify-me", isActive: true, settings: { appReviewOnly: true },
      },
    })
    metaCalls.length = 0
    accounts = []
    accountsRefuseInstagram = false
    debugPageIds = []
    pagesById = {}
    subscribeOk = true
    anthropicCreate.mockReset()
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: REPLY }], usage: { input_tokens: 120, output_tokens: 30 } })
    tenantSideEffects.notify.mockClear()
    tenantSideEffects.autoReply.mockClear()
  })

  afterEach(() => {
    delete process.env.DEMO_SOCIAL_META_APP_CONFIG_ID
    for (const call of metaCalls) {
      expect(call.url.host).toBe("graph.facebook.com")
      // A Page token travels in a header or a form body, never in an address.
      for (const token of pageTokens) expect(call.url.toString()).not.toContain(token)
      // The user's tokens, the code and the app secret are in an address only where Graph takes them
      // nowhere else: debug_token, through the product's own helper (meta-granted-assets.ts).
      if (call.url.pathname !== "/v21.0/debug_token") {
        for (const secret of [LONG, SHORT, CODE, APP_SECRET]) expect(call.url.toString()).not.toContain(secret)
      }
      // The person's grant is never touched.
      expect(call.url.pathname).not.toMatch(/\/permissions$/)
    }
  })

  // --- fixtures -------------------------------------------------------------

  /** A granted guided demo in a live session, with the admin's Facebook switch on unless told otherwise. */
  async function grant(state: Partial<Prisma.DemoGrantUncheckedCreateInput> = {}) {
    const token = randomBytes(32).toString("hex")
    const credential = randomBytes(32).toString("hex")
    const row = await admin.demoGrant.create({
      data: {
        requestId, tokenHash: hashOneTimeToken(token), tokenHint: token.slice(-6), moduleIds: [], scenarioId: "prospect-to-closed-won", scenarioVersion: 1,
        locale: "az", watermark: "ci", linkExpiresAt: at(7 * 24 * 60), createdBy: "user-admin",
        status: "ACTIVE", sessionHash: hashOneTimeToken(credential), sessionStartedAt: at(-30), sessionLastSeenAt: at(-1),
        sessionExpiresAt: at(90), inactivityMinutes: 30, verifiedAt: at(-31), liveWhatsAppEnabled: true, liveSocialEnabled: true,
        ...state,
      },
    })
    return { row, token, credential }
  }
  type Granted = Awaited<ReturnType<typeof grant>>

  function demoRequest(g: Granted, suffix = "", init: { method?: string; body?: unknown } = {}) {
    return new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${g.token}/social${suffix}`, {
      method: init.method ?? "GET",
      headers: { cookie: `${demoSessionCookieName(g.token)}=${g.credential}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  }
  const params = (g: Granted) => ({ params: Promise.resolve({ token: g.token }) })

  async function readState(g: Granted) {
    const response = await socialRoute.GET(demoRequest(g), params(g))
    return { status: response.status, body: await response.json() as Record<string, unknown>, raw: response }
  }

  async function act(g: Granted, body: Record<string, unknown>) {
    const response = await socialRoute.POST(demoRequest(g, "", { method: "POST", body }), params(g))
    return { status: response.status, body: await response.json() as Record<string, unknown>, nonce: response.cookies.get("ld_demo_fb_oauth")?.value ?? null, response }
  }

  /** «Facebook ilə qoşun», then Meta's redirect back to the product's callback in the same browser. */
  async function connectThroughMeta(g: Granted, options: { code?: string | null; nonce?: string | null } = {}) {
    const started = await act(g, { action: "start", consent: true })
    expect(started.status).toBe(200)
    const dialog = new URL(String(started.body.url))
    const state = dialog.searchParams.get("state")!
    const callback = await callbackOnce(state, options.nonce === undefined ? started.nonce : options.nonce, options.code === undefined ? CODE : options.code)
    return { started, dialog, state, callback }
  }

  async function callbackOnce(state: string, nonce: string | null, code: string | null) {
    const url = new URL(REDIRECT)
    if (code) url.searchParams.set("code", code)
    else url.searchParams.set("error", "access_denied")
    url.searchParams.set("state", state)
    const response = await callbackRoute.GET(new NextRequest(url, { headers: nonce ? { cookie: `ld_demo_fb_oauth=${nonce}` } : {} }))
    return { response, location: new URL(response.headers.get("location")!) }
  }

  const rowOf = (g: Granted) => admin.demoSocialConnection.findFirstOrThrow({ where: { grantId: g.row.id }, orderBy: { createdAt: "desc" } })
  const eventsOf = (g: Granted) => admin.demoAccessEvent.findMany({ where: { grantId: g.row.id, eventType: { startsWith: "SOCIAL_" } }, orderBy: { occurredAt: "asc" } })

  /** A connected Page, live, as the callback leaves it — written directly, to test what follows. */
  async function connected(g: Granted, overrides: Partial<Prisma.DemoSocialConnectionUncheckedCreateInput> = {}) {
    const page = fakePage("Xəzər Logistika")
    const id = `conn${randomBytes(6).toString("hex")}`
    const row = await admin.demoSocialConnection.create({
      data: {
        id, grantId: g.row.id, appConfigId: APP_ROW, code: demoSocialCode(g.row.id), metaUserId: META_USER,
        userTokenCipher: encryptToken(LONG, demoSocialTokenPurpose(id, "user")),
        pageTokenCipher: encryptToken(page.access_token, demoSocialTokenPurpose(id, "page")),
        pageId: page.id, pageName: page.name, subscribedAt: at(-10), connectedAt: at(-10), createdAt: at(-12), expiresAt: at(300),
        ...overrides,
      },
    })
    return { row, page }
  }

  /** Every table of the schema, counted: «adds nothing to any table» means exactly this. */
  async function everyTable(): Promise<Record<string, number>> {
    const tables = await admin.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    const counts = await admin.$queryRawUnsafe<{ t: string; c: number }[]>(
      tables.map(({ table_name }) => `SELECT '${table_name}' AS t, count(*)::int AS c FROM "${table_name}"`).join(" UNION ALL "),
    )
    expect(counts.length).toBeGreaterThan(300)
    return Object.fromEntries(counts.map((row) => [row.t, row.c]))
  }

  function messengerEvent(pageId: string, senderId: string, text: string, mid = `m_${randomBytes(6).toString("hex")}`) {
    return { sender: { id: senderId }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text } }
  }

  /** Meta's delivery to LeadDrive Inc.'s own app (`?t=leaddrive`), signed with its secret. */
  async function deliver(pageId: string, events: unknown[]) {
    const raw = JSON.stringify({ object: "page", entry: [{ id: pageId, time: Date.now(), messaging: events }] })
    const signature = `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`
    const response = await webhookRoute.POST(new NextRequest("https://app.leaddrivecrm.org/api/v1/webhooks/facebook?t=leaddrive", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body: raw,
    }))
    expect(response.status).toBe(200)
  }

  const sends = () => metaCalls.filter((call) => call.url.pathname === "/v20.0/me/messages")

  // --- connecting -------------------------------------------------------------

  it("connects the one Page Meta granted: the user token stored right after the exchange, the Page token before the subscription, both only as ciphertext", async () => {
    const g = await grant()
    const page = fakePage("Xəzər Logistika", { instagram: true })
    accounts = [page]

    const { dialog, callback } = await connectThroughMeta(g)

    // The product's dialog shape for the pinned app, with exactly the four approved permissions (no configuration on this row).
    expect(dialog.origin + dialog.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth")
    expect(dialog.searchParams.get("client_id")).toBe(APP_ID)
    expect(dialog.searchParams.get("redirect_uri")).toBe(REDIRECT)
    expect(dialog.searchParams.get("scope")).toBe("public_profile,pages_show_list,pages_manage_metadata,pages_messaging")
    expect(dialog.searchParams.get("config_id")).toBeNull()
    expect(dialog.searchParams.get("state")).toMatch(/^ldd\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/)
    // No raw demo token in the state or anywhere in the dialog.
    expect(dialog.toString()).not.toContain(g.token)
    expect(callback.location.pathname).toBe("/demo-access/social")
    expect(callback.location.searchParams.get("r")).toBe("connected")
    expect(callback.response.cookies.get("ld_demo_fb_oauth")?.value).toBe("")

    expect(sent()).toEqual([
      "POST /v21.0/oauth/access_token",
      "POST /v21.0/oauth/access_token",
      "GET /v21.0/me",
      "GET /v21.0/me/accounts",
      "POST /v21.0/" + page.id + "/subscribed_apps",
    ])
    const subscribe = metaCalls.at(-1)!
    // `messages` only, with the Page's own token in the body.
    expect(Object.fromEntries(new URLSearchParams(subscribe.body))).toEqual({ subscribed_fields: "messages", access_token: page.access_token })
    for (const call of metaCalls.filter((c) => c.url.pathname.startsWith("/v21.0/me"))) expect(call.authorization).toBe(`Bearer ${LONG}`)

    const row = await rowOf(g)
    expect(row).toMatchObject({ pageId: page.id, pageName: page.name, linkedInstagramId: page.instagram_business_account!.id, metaUserId: META_USER, oauthStateHash: null, pendingPages: null })
    expect(row.connectedAt).not.toBeNull()
    expect(row.subscribedAt).not.toBeNull()
    expect(row.userTokenCipher).toMatch(/^v1:/)
    expect(row.pageTokenCipher).toMatch(/^v1:/)
    expect(decryptToken(row.userTokenCipher!, demoSocialTokenPurpose(row.id, "user"))).toBe(LONG)
    expect(decryptToken(row.pageTokenCipher!, demoSocialTokenPurpose(row.id, "page"))).toBe(page.access_token)
    const everything = JSON.stringify(row)
    for (const token of [SHORT, LONG, page.access_token, CODE]) expect(everything).not.toContain(token)
    const events = await eventsOf(g)
    expect(events.map((event) => event.eventType)).toEqual(["SOCIAL_CONNECTED"])
    expect(events[0].metadata).toEqual({ platform: "facebook", consentVersion: "2026-10-19" })

    // Nothing of the product's connect: no monitoring account, no inbox channel.
    expect(await admin.socialAccount.count()).toBe(0)
    expect(await admin.channelConfig.count()).toBe(1)
  })

  it("asks Meta for the configuration instead of a permission list when the pinned row carries one (Facebook Login for Business)", async () => {
    await admin.channelConfig.update({ where: { id: APP_ROW }, data: { settings: { appReviewOnly: true, loginConfigId: "cfg-778899" } } })
    const g = await grant()
    const started = await act(g, { action: "start", consent: true })
    const dialog = new URL(String(started.body.url))
    expect(dialog.searchParams.get("config_id")).toBe("cfg-778899")
    expect(dialog.searchParams.get("scope")).toBeNull()
  })

  it("never fails the connect for the Instagram field: refused, the same read goes again without it", async () => {
    const g = await grant()
    const page = fakePage("Nərgiz Gül Evi", { instagram: true })
    accounts = [page]
    accountsRefuseInstagram = true

    const { callback } = await connectThroughMeta(g)

    expect(callback.location.searchParams.get("r")).toBe("connected")
    expect(sent().filter((line) => line === "GET /v21.0/me/accounts")).toHaveLength(2)
    expect(await rowOf(g)).toMatchObject({ pageId: page.id, linkedInstagramId: null })
  })

  it("finds a portfolio Page through debug_token when /me/accounts is empty, as the product's callback does", async () => {
    const g = await grant()
    const page = fakePage("Portfel Səhifəsi")
    accounts = []
    debugPageIds = [page.id]

    const { callback } = await connectThroughMeta(g)

    expect(callback.location.searchParams.get("r")).toBe("connected")
    expect(sent()).toContain("GET /v21.0/debug_token")
    expect(sent()).toContain(`GET /v21.0/${page.id}`)
    expect((await rowOf(g)).pageId).toBe(page.id)
  })

  it("asks which Page when several were granted — names only on the page — and binds the chosen one alone", async () => {
    const g = await grant()
    const first = fakePage("Birinci Səhifə")
    const second = fakePage("İkinci Səhifə")
    accounts = [first, second]

    const { callback } = await connectThroughMeta(g)
    expect(callback.location.searchParams.get("r")).toBe("choose")
    const pending = await rowOf(g)
    expect(pending.pendingPages).toEqual([{ id: first.id, name: first.name }, { id: second.id, name: second.name }])
    expect(pending.pageId).toBeNull()
    expect(pending.pageTokenCipher).toBeNull()
    expect(JSON.stringify(pending)).not.toContain(first.access_token)
    expect(sent().some((line) => line.endsWith("/subscribed_apps"))).toBe(false)

    const choosing = await readState(g)
    expect(choosing.body).toMatchObject({ enabled: true, phase: "choose", pages: [first.name, second.name] })
    expect(JSON.stringify(choosing.body)).not.toContain(first.id)

    metaCalls.length = 0
    const chosen = await act(g, { action: "choose", page: 1 })
    expect(chosen.status).toBe(200)
    expect(chosen.body).toMatchObject({ phase: "connected", pageName: second.name })
    expect(sent()).toEqual([`GET /v21.0/${second.id}`, `POST /v21.0/${second.id}/subscribed_apps`])
    expect(new URLSearchParams(metaCalls[1].body).get("subscribed_fields")).toBe("messages")
    expect(await rowOf(g)).toMatchObject({ pageId: second.id, pendingPages: null })
  })

  it("refuses a Page another organisation relies on — read across tenants under FORCE RLS — and subscribes nothing", async () => {
    const g = await grant()
    const page = fakePage("Başqasının Səhifəsi")
    accounts = [page]
    await admin.channelConfig.create({ data: { organizationId: OTHER, channelType: "facebook", configName: "Their Page", pageId: page.id, isActive: true } })

    const { callback } = await connectThroughMeta(g)

    expect(callback.location.searchParams.get("r")).toBe("refused")
    expect(sent().some((line) => line.endsWith("/subscribed_apps"))).toBe(false)
    const row = await rowOf(g)
    expect(row).toMatchObject({ pageId: null, pageTokenCipher: null, connectedAt: null, pendingPages: [] })
    expect((await readState(g)).body).toMatchObject({ phase: "refused" })
  })

  it("refuses a Page whose linked Instagram account an organisation monitors — the Instagram id is a claim too", async () => {
    const g = await grant()
    const page = fakePage("İnstaqramlı Səhifə", { instagram: true })
    accounts = [page]
    await admin.socialAccount.create({ data: { organizationId: OTHER, platform: "instagram", handle: page.instagram_business_account!.id, isActive: true } })

    const { callback } = await connectThroughMeta(g)

    expect(callback.location.searchParams.get("r")).toBe("refused")
    expect((await rowOf(g)).pageId).toBeNull()
    expect(sent().some((line) => line.endsWith("/subscribed_apps"))).toBe(false)
  })

  it("takes a state once, only from the browser that started, and only while fresh", async () => {
    const g = await grant()
    accounts = [fakePage("Bir Səhifə")]
    const started = await act(g, { action: "start", consent: true })
    const state = new URL(String(started.body.url)).searchParams.get("state")!

    // Another browser (no nonce, or a wrong one) gets nothing and asks Meta nothing.
    expect((await callbackOnce(state, null, CODE)).location.searchParams.get("r")).toBe("failed")
    expect((await callbackOnce(state, "a-different-nonce", CODE)).location.searchParams.get("r")).toBe("failed")
    // A forged signature, a product-looking tail.
    expect((await callbackOnce(`${state.slice(0, -4)}0000`, started.nonce, CODE)).location.searchParams.get("r")).toBe("failed")
    expect(metaCalls).toEqual([])

    expect((await callbackOnce(state, started.nonce, CODE)).location.searchParams.get("r")).toBe("connected")
    const calls = metaCalls.length
    // Replayed: nothing left to consume.
    expect((await callbackOnce(state, started.nonce, CODE)).location.searchParams.get("r")).toBe("failed")
    expect(metaCalls).toHaveLength(calls)
  })

  it("a cancelled dialog stores nothing of Meta's and offers the connect again", async () => {
    const g = await grant()
    const { callback } = await connectThroughMeta(g, { code: null })
    expect(callback.location.searchParams.get("r")).toBe("denied")
    expect(metaCalls).toEqual([])
    expect(await rowOf(g)).toMatchObject({ userTokenCipher: null, pageId: null, pendingPages: [] })
  })

  it("a subscription Meta did not confirm asks for the release at once — the Page token is already recorded for it", async () => {
    const g = await grant()
    const page = fakePage("Səhifə")
    accounts = [page]
    subscribeOk = false

    const { callback } = await connectThroughMeta(g)

    expect(callback.location.searchParams.get("r")).toBe("failed")
    const row = await rowOf(g)
    expect(row).toMatchObject({ pageId: page.id, connectedAt: null, releaseReason: "connect_abandoned" })
    expect(row.pageTokenCipher).toMatch(/^v1:/)
    expect((await readState(g)).body).toMatchObject({ phase: "releasing", connectFailed: true })
  })

  it("holds at most twenty open connections across every demo", async () => {
    for (let index = 0; index < 20; index += 1) {
      await admin.demoSocialConnection.create({ data: { appConfigId: APP_ROW, code: "LD-000000", createdAt: NOW, expiresAt: at(60) } })
    }
    const g = await grant()
    const refused = await act(g, { action: "start", consent: true })
    expect(refused.status).toBe(429)
    expect(refused.body).toMatchObject({ success: false, code: "busy" })
    expect(refused.nonce).toBeNull()
    expect(await admin.demoSocialConnection.count({ where: { grantId: g.row.id } })).toBe(0)
  })

  // --- the product's path and the demo's never cross ---------------------------

  it("a product OAuth state never enters the demo branch, and a demo state never reaches the product path", async () => {
    const g = await grant()
    accounts = [fakePage("Səhifə")]
    const started = await act(g, { action: "start", consent: true })
    const before = await rowOf(g)

    // The product's own state shape (start/route.ts): base64url of `payload.hmac`.
    const payload = JSON.stringify({ orgId: SALES, state: "nonce", ts: Date.now(), app: APP_ROW })
    const signature = createHmac("sha256", process.env.NEXTAUTH_SECRET || "ld-social-oauth").update(payload).digest("hex")
    const productState = Buffer.from(`${payload}.${signature}`).toString("base64url")
    expect(productState.startsWith("ldd.")).toBe(false)
    const product = await callbackOnce(productState, started.nonce, CODE)
    // The product path: its own redirect, its own refusal (no CRM session), the demo row untouched.
    expect(product.location.pathname).toBe("/social-monitoring")
    expect(product.location.searchParams.get("error")).toBe("no_session")
    expect(await rowOf(g)).toEqual(before)
    expect(metaCalls).toEqual([])

    // The demo state: the demo's page, and nothing of the product's connect anywhere.
    const demo = await callbackOnce(new URL(String(started.body.url)).searchParams.get("state")!, started.nonce, CODE)
    expect(demo.location.pathname).toBe("/demo-access/social")
    expect(await admin.socialAccount.count()).toBe(0)
    expect(await admin.channelConfig.count()).toBe(1)
  })

  // --- messages ---------------------------------------------------------------

  it("before the proof, a message without the code adds nothing to any table and asks Meta nothing", async () => {
    const g = await grant()
    const { row, page } = await connected(g)
    const before = await everyTable()
    const rowBefore = await rowOf(g)

    await deliver(page.id, [messengerEvent(page.id, "551100000001", "Salam, iş saatlarınız?")])

    expect(await everyTable()).toEqual(before)
    expect(await rowOf(g)).toEqual(rowBefore)
    expect(metaCalls).toEqual([])
    expect(row.provenSenderId).toBeNull()
  })

  it("the first message with the code proves its sender, is stored once, and the demo agent answers him through his Page", async () => {
    const g = await grant()
    const { page } = await connected(g)
    const sender = "551100000002"
    const event = messengerEvent(page.id, sender, `Salam! Kod: ${demoSocialCode(g.row.id)}`, "m_proof_1")

    await deliver(page.id, [event])
    // Meta delivers it again: neither stored nor answered twice.
    await deliver(page.id, [event])

    const row = await rowOf(g)
    expect(row.provenSenderId).toBe(sender)
    expect(row.provenAt).not.toBeNull()
    expect(row).toMatchObject({ aiReplies: 1, aiInputTokens: 120, aiOutputTokens: 30 })
    const messages = await admin.demoSocialMessage.findMany({ where: { connectionId: row.id }, orderBy: { createdAt: "asc" } })
    expect(messages.map((message) => [message.direction, message.text])).toEqual([
      ["inbound", `Salam! Kod: ${demoSocialCode(g.row.id)}`],
      ["outbound", REPLY],
    ])
    expect(sends()).toHaveLength(1)
    expect(sends()[0].authorization).toBe(`Bearer ${page.access_token}`)
    expect(JSON.parse(sends()[0].body)).toEqual({ recipient: { id: sender }, message: { text: REPLY } })
    // The agent speaks for LeadDrive, on somebody else's Page.
    const system = anthropicCreate.mock.calls[0][0].system as string
    expect(system).toContain("Facebook Messenger")
    expect(system).toContain("bu səhifənin sahibi olan şirkətin adından deyil")
    expect((await eventsOf(g)).map((e) => e.eventType)).toEqual(["SOCIAL_PROVEN", "SOCIAL_AI_REPLIED"])
    // Demo tables alone: nothing in LeadDrive Inc.'s inbox, notifications, AI log or automations.
    expect(await admin.channelMessage.count()).toBe(0)
    expect(await admin.socialConversation.count()).toBe(0)
    expect(await admin.notification.count()).toBe(0)
    expect(await admin.aiInteractionLog.count()).toBe(0)
    expect(tenantSideEffects.notify).not.toHaveBeenCalled()
    expect(tenantSideEffects.autoReply).not.toHaveBeenCalled()
  })

  it("after the proof, another sender — code or not — adds nothing to any table, and is never answered", async () => {
    const g = await grant()
    const { page } = await connected(g, { provenSenderId: "551100000003", provenAt: at(-5) })
    const before = await everyTable()
    const rowBefore = await rowOf(g)

    await deliver(page.id, [
      messengerEvent(page.id, "551199999999", `Mən də yazıram ${demoSocialCode(g.row.id)}`),
      messengerEvent(page.id, "551188888888", "Sifariş vermək istəyirəm"),
    ])

    expect(await everyTable()).toEqual(before)
    expect(await rowOf(g)).toEqual(rowBefore)
    expect(metaCalls).toEqual([])
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("two senders with the code at once: exactly one is proven, once, and only his message is kept", async () => {
    const g = await grant()
    const { page } = await connected(g)
    const code = demoSocialCode(g.row.id)
    const generate = vi.fn(async () => ({ text: REPLY, inputTokens: 1, outputTokens: 1 }))
    const send = vi.fn(async () => true)

    await Promise.all([
      inbound.handleDemoSocialEntry({ organizationId: SALES, entry: { id: page.id, messaging: [messengerEvent(page.id, "551100000011", `A ${code}`)] } }, { generate, send }),
      inbound.handleDemoSocialEntry({ organizationId: SALES, entry: { id: page.id, messaging: [messengerEvent(page.id, "551100000022", `B ${code}`)] } }, { generate, send }),
    ])

    const row = await rowOf(g)
    expect(["551100000011", "551100000022"]).toContain(row.provenSenderId)
    const inboundMessages = await admin.demoSocialMessage.findMany({ where: { connectionId: row.id, direction: "inbound" } })
    expect(inboundMessages.map((message) => message.text)).toEqual([row.provenSenderId === "551100000011" ? `A ${code}` : `B ${code}`])
    expect((await eventsOf(g)).filter((e) => e.eventType === "SOCIAL_PROVEN")).toHaveLength(1)
    expect(send.mock.calls.map((call) => (call as unknown as string[])[0])).toEqual([row.provenSenderId])
  })

  it("answers at most ten times, three seconds apart at least, only the proven sender, with the stored Page token", async () => {
    const g = await grant()
    const sender = "551100000004"
    const { row, page } = await connected(g, { provenSenderId: sender, provenAt: at(-5) })

    const write = (text: string, offsetMs: number) =>
      inbound.handleDemoSocialEntry(
        { organizationId: SALES, entry: { id: page.id, messaging: [messengerEvent(page.id, sender, text)] } },
        { now: new Date(NOW.getTime() + offsetMs) },
      )
    await write("Sual 1", 0)
    // A second later: stored, not answered — two messages a second apart get one answer.
    await write("Tez sual", 1_000)
    expect(sends()).toHaveLength(1)
    for (let index = 1; index <= 12; index += 1) await write(`Sual ${index + 1}`, index * 4_000)

    expect(sends()).toHaveLength(10)
    for (const call of sends()) {
      expect(call.authorization).toBe(`Bearer ${page.access_token}`)
      expect(JSON.parse(call.body).recipient).toEqual({ id: sender })
    }
    const stored = await admin.demoSocialConnection.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored).toMatchObject({ aiReplies: 10, aiInputTokens: 1_200, aiOutputTokens: 300 })
    expect(await admin.demoSocialMessage.count({ where: { connectionId: row.id, direction: "outbound" } })).toBe(10)
    expect(await admin.aiInteractionLog.count()).toBe(0)
  })

  it("after the day is over nothing is stored and nothing is sent, cron or no cron", async () => {
    const g = await grant()
    const sender = "551100000005"
    const { page } = await connected(g, { provenSenderId: sender, provenAt: at(-5), createdAt: at(-60), expiresAt: at(-1) })
    const before = await everyTable()

    await deliver(page.id, [messengerEvent(page.id, sender, "Hələ buradasınız?")])

    expect(await everyTable()).toEqual(before)
    expect(metaCalls).toEqual([])
  })

  it("a Page LeadDrive Inc. has as an active channel takes the tenant path unchanged — the demo sees none of it", async () => {
    const g = await grant()
    const { page } = await connected(g)
    await admin.channelConfig.create({
      data: { organizationId: SALES, channelType: "facebook", configName: "Müştəri səhifəsi", pageId: page.id, apiKey: "tenant-page-token", isActive: true, settings: {} },
    })
    const rowBefore = await rowOf(g)

    await deliver(page.id, [messengerEvent(page.id, "551100000006", `Salam ${demoSocialCode(g.row.id)}`)])

    const tenantMessages = await admin.channelMessage.findMany()
    expect(tenantMessages).toHaveLength(1)
    expect(tenantMessages[0]).toMatchObject({ organizationId: SALES, channelType: "facebook", direction: "inbound", to: page.id })
    expect(await admin.demoSocialMessage.count()).toBe(0)
    expect(await rowOf(g)).toEqual(rowBefore)
    expect(sends()).toEqual([])
  })

  // --- what the demo page reads -------------------------------------------------

  it("the public read carries the Page's name, the code and the conversation — never an id or a token", async () => {
    const g = await grant()
    const sender = "551100000007"
    const { row, page } = await connected(g, { linkedInstagramId: "17841400777777" })
    await deliver(page.id, [messengerEvent(page.id, sender, `Kod ${demoSocialCode(g.row.id)}`, "m_public_1")])

    const { status, body, raw } = await readState(g)

    expect(status).toBe(200)
    expect(raw.headers.get("cache-control")).toContain("no-store")
    expect(body).toMatchObject({
      success: true, enabled: true, phase: "connected", pageName: page.name, code: demoSocialCode(g.row.id), proven: true, agentActive: true, repliesLeft: 9,
    })
    expect((body.messages as unknown[]).length).toBe(2)
    const text = JSON.stringify(body)
    for (const secret of [row.id, g.row.id, g.token, page.id, sender, META_USER, "17841400777777", page.access_token, LONG, "m_public_1", APP_ROW, APP_ID]) {
      expect(text).not.toContain(secret)
    }

    // The Messenger link: a redirect of ours, so the Page id is in that navigation only.
    const messenger = await messengerRoute.GET(demoRequest(g, "/messenger"), params(g))
    expect(messenger.status).toBe(302)
    expect(messenger.headers.get("location")).toBe(`https://m.me/${page.id}`)
  })

  // --- switches -------------------------------------------------------------

  it("with the server's switch off nothing is reachable: no panel, no start, no callback, no inbound", async () => {
    const g = await grant()
    accounts = [fakePage("Səhifə")]
    const started = await act(g, { action: "start", consent: true })
    const state = new URL(String(started.body.url)).searchParams.get("state")!
    const { page } = await connected(await grant())
    delete process.env.DEMO_SOCIAL_META_APP_CONFIG_ID

    expect((await readState(g)).body).toMatchObject({ success: true, enabled: false })
    const again = await act(g, { action: "start", consent: true })
    expect(again.status).toBe(404)
    expect(again.nonce).toBeNull()
    expect((await messengerRoute.GET(demoRequest(g, "/messenger"), params(g))).status).toBe(404)
    expect((await callbackOnce(state, started.nonce, CODE)).location.searchParams.get("r")).not.toBe("connected")
    const before = await everyTable()
    await deliver(page.id, [messengerEvent(page.id, "551100000008", "Salam")])
    expect(await everyTable()).toEqual(before)
    expect(metaCalls).toEqual([])
  })

  it("with the admin's switch off on the grant — or no granted session at all — nothing is offered", async () => {
    const off = await grant({ liveSocialEnabled: false })
    expect((await readState(off)).body).toMatchObject({ success: true, enabled: false })
    expect((await act(off, { action: "start", consent: true })).status).toBe(404)

    // A token no grant has (the open demo, the admin preview): nothing.
    const stranger = { ...(await grant()), token: "f".repeat(64) }
    expect((await readState(stranger)).status).toBe(404)
    // A grant whose session is not this browser's.
    const elsewhere = { ...(await grant()), credential: "0".repeat(64) }
    expect((await readState(elsewhere)).status).toBe(401)
    // The consent line is required.
    expect((await act(await grant(), { action: "start" })).status).toBe(400)
    expect(await admin.demoSocialConnection.count()).toBe(0)
  })

  // --- ending ----------------------------------------------------------------

  it("«Ayır» asks for the release now: use stops at once, the cron unbinds, and the page then says so", async () => {
    const g = await grant()
    const sender = "551100000009"
    const { row, page } = await connected(g, { provenSenderId: sender, provenAt: at(-5) })

    const disconnected = await act(g, { action: "disconnect" })
    expect(disconnected.status).toBe(200)
    expect(disconnected.body).toMatchObject({ phase: "releasing" })
    const asked = await rowOf(g)
    expect(asked.releaseReason).toBe("disconnected")
    expect(asked.releaseRequestedAt).not.toBeNull()
    expect((await messengerRoute.GET(demoRequest(g, "/messenger"), params(g))).status).toBe(404)

    // Dead for every use before the cron runs.
    const before = await everyTable()
    await deliver(page.id, [messengerEvent(page.id, sender, "Hələ də?")])
    expect(await everyTable()).toEqual(before)
    expect(sends()).toEqual([])

    const run = await release.releaseDueDemoSocialConnections({ now: new Date() })
    expect(run).toMatchObject({ released: 1 })
    expect(sent()).toEqual([`DELETE /v21.0/${page.id}/subscribed_apps`])
    expect((await admin.demoSocialConnection.findUniqueOrThrow({ where: { id: row.id } })).scrubbedAt).not.toBeNull()
    expect((await readState(g)).body).toMatchObject({ enabled: true, phase: "offer", released: true })
  })

  it("«Bitir» asks for the release too", async () => {
    const g = await grant()
    await connected(g)
    const response = await eventsRoute.POST(
      new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${g.token}/events`, {
        method: "POST",
        headers: { cookie: `${demoSessionCookieName(g.token)}=${g.credential}`, "content-type": "application/json" },
        body: JSON.stringify({ eventType: "COMPLETED" }),
      }),
      params(g),
    )
    expect(response.status).toBe(200)
    expect(await rowOf(g)).toMatchObject({ releaseReason: "finished" })
  })
})
