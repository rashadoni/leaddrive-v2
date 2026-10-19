/**
 * Unbinding prospects' Facebook Pages, on a real Postgres under row-level
 * security, with an application role that cannot bypass it.
 *
 * A prospect who connects his own Page to the demo hands us a token to it and
 * a webhook subscription on it. The release engine
 * (src/lib/demo-center/demo-social-release.ts) has to give both back when the
 * demo is over — and must never undo anything an organisation relies on: a
 * Page's subscription to our app is shared by everyone using that Page through
 * it, and one grant covers every Page the person granted. Whether a Page is
 * claimed is read across every organisation from tables under FORCE RLS,
 * where a read without bypass silently answers «nobody»; a mocked Prisma would
 * accept any answer. So the real engine runs here against real rows, and only
 * `fetch` to graph.facebook.com is stubbed: every request's method, path and
 * Bearer header is asserted, and no token may ever appear in a URL.
 *
 * Set DEMO_SOCIAL_RELEASE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   DEMO_SOCIAL_RELEASE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Demo social release database gate»), where
 * `DEMO_SOCIAL_RELEASE_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { encryptToken } from "@/lib/secure-token"
import { demoSocialCode, demoSocialTokenPurpose } from "@/lib/demo-center/demo-social-connection"

const adminUrl = process.env.DEMO_SOCIAL_RELEASE_TEST_DATABASE_URL
if (!adminUrl && process.env.DEMO_SOCIAL_RELEASE_DB_GATE === "required") {
  throw new Error("DEMO_SOCIAL_RELEASE_TEST_DATABASE_URL is required by the demo social release database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.DEMO_SOCIAL_RELEASE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `demo_social_release_${process.pid}`
  const role = `demo_social_app_${process.pid}`
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

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const MIGRATION = "prisma/migrations/20261021090000_demo_social_connections/migration.sql"

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
  const directory = mkdtempSync(path.join(tmpdir(), "demo-social-release-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const SALES = "org-demo-sales"
const OTHER = "org-other-tenant"
// The real clock: the engine is handed NOW, but the smoke call reads the time itself.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

// --- Meta, as far as the engine can see it --------------------------------

interface MetaCall {
  method: string
  host: string
  path: string
  url: string
  authorization: string | null
}

const metaCalls: MetaCall[] = []
/** Every token this file handed to a row, to prove none ever lands in a URL. */
const tokens = new Set<string>()
/** The Pages each user token reaches on /me/accounts. */
const pagesOf = new Map<string, string[]>()
let metaDelayMs = 0

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function healthyMeta(call: MetaCall): Response {
  const token = call.authorization?.replace(/^Bearer /, "") ?? ""
  if (call.method === "DELETE" && /^\/v21\.0\/[0-9]+\/subscribed_apps$/.test(call.path)) return json(200, { success: true })
  if (call.method === "GET" && call.path === "/v21.0/me/accounts") return json(200, { data: (pagesOf.get(token) ?? []).map((id) => ({ id })) })
  if (call.method === "DELETE" && call.path === "/v21.0/me/permissions") return json(200, { success: true })
  return json(400, { error: { code: 100, message: "unexpected call" } })
}

let meta: (call: MetaCall) => Response = healthyMeta

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.host !== "graph.facebook.com") throw new Error(`unexpected request to ${url.host}`)
  const call: MetaCall = {
    method: init?.method ?? "GET",
    host: url.host,
    path: url.pathname,
    url: url.toString(),
    authorization: new Headers(init?.headers).get("authorization"),
  }
  metaCalls.push(call)
  if (metaDelayMs) await new Promise((resolve) => setTimeout(resolve, metaDelayMs))
  return meta(call)
})

/** What the engine sent, as `METHOD path token`. */
function sent(): string[] {
  return metaCalls.map((call) => `${call.method} ${call.path} ${call.authorization?.replace(/^Bearer /, "") ?? "(none)"}`)
}

describe.skipIf(!scratch)("releasing prospects' Facebook Pages on a real Postgres under row-level security", () => {
  let admin!: PrismaClient
  let engine!: typeof import("@/lib/demo-center/demo-social-release")
  let app!: typeof import("@/lib/prisma").prisma
  let rls!: typeof import("@/lib/rls-context")
  let requestId = ""
  let rowSeq = 0

  beforeAll(async () => {
    const control = adminUrl!
    sql(control, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(control, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    // Production's tenant isolation: FORCE RLS with `tenant_isolation` on
    // every table carrying organizationId — channel_configs and
    // social_accounts among them.
    prismaCli(["db", "execute", "--url", scratch!.adminScratch, "--file", path.join(ROOT, "prisma/migrations/20260825170000_tenant_isolation_from_migrations/migration.sql")], process.env)
    // The demo tables exactly as the migration makes them: its CHECKs, its
    // partial indexes, its bypass-only policy.
    sql(scratch!.adminScratch, `DROP TABLE IF EXISTS "demo_social_messages", "demo_social_connections" CASCADE`)
    prismaCli(["db", "execute", "--url", scratch!.adminScratch, "--file", path.join(ROOT, MIGRATION)], process.env)
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
    engine = await import("@/lib/demo-center/demo-social-release")
    app = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    vi.stubGlobal("fetch", fakeFetch)
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
    // Every run sweeps the whole table, so each case starts from an empty one.
    await admin.demoSocialConnection.deleteMany()
    await admin.channelConfig.deleteMany()
    await admin.socialAccount.deleteMany()
    metaCalls.length = 0
    pagesOf.clear()
    meta = healthyMeta
    metaDelayMs = 0
  })

  afterEach(() => {
    for (const call of metaCalls) {
      expect(call.host).toBe("graph.facebook.com")
      expect(call.authorization).toMatch(/^Bearer \S+$/)
      expect(call.url).not.toContain("access_token")
      for (const token of tokens) expect(call.url).not.toContain(token)
    }
  })

  /** A grant in a live session unless told otherwise. */
  async function grant(state: Partial<Prisma.DemoGrantUncheckedCreateInput> = {}) {
    return admin.demoGrant.create({
      data: {
        requestId, tokenHash: randomBytes(32).toString("hex"), tokenHint: "abcd", moduleIds: [], scenarioId: "prospect-to-closed-won", scenarioVersion: 1,
        locale: "az", watermark: "ci", linkExpiresAt: at(7 * 24 * 60), createdBy: "user-admin",
        status: "ACTIVE", sessionHash: randomBytes(32).toString("hex"), sessionStartedAt: at(-60), sessionLastSeenAt: at(-1),
        sessionExpiresAt: at(60), inactivityMinutes: 30, verifiedAt: at(-61), liveWhatsAppEnabled: true,
        ...state,
      },
    })
  }

  /** A connected Page with both tokens, its proven sender and two messages; live unless told otherwise. */
  async function connection(grantId: string | null, overrides: Partial<Prisma.DemoSocialConnectionUncheckedCreateInput> = {}, options: { page?: boolean; user?: boolean } = {}) {
    rowSeq += 1
    const id = `conn-${rowSeq}`
    const pageToken = `page-token-${rowSeq}-${randomBytes(4).toString("hex")}`
    const userToken = `user-token-${rowSeq}-${randomBytes(4).toString("hex")}`
    tokens.add(pageToken)
    tokens.add(userToken)
    const pageId = `${7_000_000 + rowSeq}`
    const withPage = options.page !== false
    const withUser = options.user !== false
    const row = await admin.demoSocialConnection.create({
      data: {
        id, grantId, appConfigId: "cc-meta-app", code: demoSocialCode(grantId ?? id),
        oauthStateHash: "a".repeat(64), metaUserId: `${9_000_000 + rowSeq}`,
        userTokenCipher: withUser ? encryptToken(userToken, demoSocialTokenPurpose(id, "user")) : null,
        pageTokenCipher: withPage ? encryptToken(pageToken, demoSocialTokenPurpose(id, "page")) : null,
        pendingPages: [{ id: pageId, name: "Xəzər Logistika" }],
        pageId: withPage ? pageId : null, pageName: withPage ? "Xəzər Logistika" : null, provenSenderId: `${5_000_000 + rowSeq}`,
        subscribedAt: withPage ? at(-170) : null, connectedAt: withPage ? at(-170) : null, provenAt: at(-160),
        createdAt: at(-180), expiresAt: at(300),
        ...overrides,
      },
    })
    await admin.demoSocialMessage.createMany({
      data: [
        { connectionId: id, direction: "inbound", text: "Salam, LD-123456", externalId: `m_${rowSeq}_1` },
        { connectionId: id, direction: "outbound", text: "Salam! LeadDrive demo agentiyəm.", externalId: `m_${rowSeq}_2` },
      ],
    })
    pagesOf.set(userToken, [pageId])
    return { row, id, pageId, pageToken, userToken }
  }

  const stored = (id: string) => admin.demoSocialConnection.findUniqueOrThrow({ where: { id } })
  const messagesOf = (id: string) => admin.demoSocialMessage.count({ where: { connectionId: id } })
  const eventsOf = (grantId: string) => admin.demoAccessEvent.findMany({ where: { grantId, eventType: { startsWith: "SOCIAL_" } } })

  function expectWiped(row: Awaited<ReturnType<typeof stored>>) {
    expect(row.scrubbedAt).not.toBeNull()
    expect(row).toMatchObject({
      oauthStateHash: null, metaUserId: null, userTokenCipher: null, pageTokenCipher: null,
      pendingPages: null, pageId: null, pageName: null, provenSenderId: null, releaseLeaseUntil: null,
    })
  }

  it("the application's role sees neither the demo rows nor another tenant's channels without bypass", async () => {
    await connection((await grant()).id)
    await admin.channelConfig.create({ data: { organizationId: OTHER, channelType: "facebook", configName: "Their Page", pageId: "123", isActive: true } })
    // Raw counts with no context: the guard only warns on raw queries, the database answers.
    const demo = await app.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM demo_social_connections`
    const channels = await app.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM channel_configs`
    expect([Number(demo[0].count), Number(channels[0].count)]).toEqual([0, 0])
  })

  it("at the end of the Baku day: unsubscribes the Page, lists the person's Pages, revokes the grant, and wipes everything", async () => {
    const g = await grant()
    const c = await connection(g.id, { expiresAt: at(-1) })

    const run = await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect(run).toEqual({ checked: 1, due: 1, released: 1, retrying: 0, incomplete: 0 })
    expect(sent()).toEqual([
      `DELETE /v21.0/${c.pageId}/subscribed_apps ${c.pageToken}`,
      `GET /v21.0/me/accounts ${c.userToken}`,
      "DELETE /v21.0/me/permissions " + c.userToken,
    ])
    const row = await stored(c.id)
    expectWiped(row)
    expect(row).toMatchObject({ releaseReason: "day_over", unsubscribeOutcome: "removed", grantRevokeOutcome: "revoked", releaseAttempts: 1, releaseError: null })
    expect(row.releaseRequestedAt).toEqual(NOW)
    expect(await messagesOf(c.id)).toBe(0)
    const events = await eventsOf(g.id)
    expect(events.map((event) => event.eventType)).toEqual(["SOCIAL_RELEASED"])
    expect(events[0].metadata).toEqual({ platform: "facebook", reason: "day_over", unsubscribe: "removed", grantRevoke: "revoked" })
    expect(JSON.stringify(events[0].metadata)).not.toMatch(new RegExp(`${c.pageId}|${c.row.provenSenderId}|${c.row.metaUserId}|Xəzər`))
  })

  it("leaves a live connection alone: no request at all, nothing written", async () => {
    const c = await connection((await grant()).id)
    const before = await stored(c.id)

    expect(await engine.releaseDueDemoSocialConnections({ now: NOW })).toEqual({ checked: 1, due: 0, released: 0, retrying: 0, incomplete: 0 })
    expect(metaCalls).toEqual([])
    expect(await stored(c.id)).toEqual(before)
    expect(await messagesOf(c.id)).toBe(2)
  })

  it("releases early when the admin revokes the link", async () => {
    const g = await grant({ status: "REVOKED", revokedAt: at(-5) })
    const c = await connection(g.id)

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect(metaCalls.map((call) => call.method)).toEqual(["DELETE", "GET", "DELETE"])
    const row = await stored(c.id)
    expectWiped(row)
    expect(row.releaseReason).toBe("revoked")
  })

  it("releases a session that went idle 31 minutes ago and is still ACTIVE in the database (the closed tab)", async () => {
    const g = await grant({ sessionLastSeenAt: at(-31) })
    const c = await connection(g.id)

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect((await admin.demoGrant.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("ACTIVE")
    const row = await stored(c.id)
    expectWiped(row)
    expect(row.releaseReason).toBe("session_over")
  })

  it("keeps the row when its grant is deleted, and releases it as grant_gone", async () => {
    const g = await grant()
    const c = await connection(g.id)
    await admin.demoGrant.delete({ where: { id: g.id } })
    expect((await stored(c.id)).grantId).toBeNull()

    expect(await engine.releaseDueDemoSocialConnections({ now: NOW })).toMatchObject({ due: 1, released: 1 })

    expect(metaCalls).toHaveLength(3)
    const row = await stored(c.id)
    expectWiped(row)
    expect(row).toMatchObject({ releaseReason: "grant_gone", unsubscribeOutcome: "removed", grantRevokeOutcome: "revoked" })
  })

  it("never unsubscribes a Page another organisation's active channel uses — a claim the app role sees only through bypass", async () => {
    const c = await connection((await grant()).id, { expiresAt: at(-1) })
    await admin.channelConfig.create({ data: { organizationId: OTHER, channelType: "facebook", configName: "Their Page", pageId: c.pageId, isActive: true } })

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    // Neither the Page's subscription nor the grant that reaches the Page is touched.
    expect(sent()).toEqual([`GET /v21.0/me/accounts ${c.userToken}`])
    const row = await stored(c.id)
    expectWiped(row)
    expect(row).toMatchObject({ unsubscribeOutcome: "kept_claimed", grantRevokeOutcome: "kept_shared" })
  })

  it("does not count a switched-off channel as a claim", async () => {
    const c = await connection((await grant()).id, { expiresAt: at(-1) })
    await admin.channelConfig.create({ data: { organizationId: OTHER, channelType: "facebook", configName: "Old", pageId: c.pageId, isActive: false } })

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect((await stored(c.id)).unsubscribeOutcome).toBe("removed")
  })

  it("does not revoke a grant that also reaches a Page LeadDrive Inc. relies on", async () => {
    const c = await connection((await grant()).id, { expiresAt: at(-1) })
    pagesOf.set(c.userToken, [c.pageId, "373662722735767"])
    await admin.socialAccount.create({ data: { organizationId: SALES, platform: "facebook", handle: "373662722735767", isActive: true } })

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect(sent()).toEqual([
      `DELETE /v21.0/${c.pageId}/subscribed_apps ${c.pageToken}`,
      `GET /v21.0/me/accounts ${c.userToken}`,
    ])
    expect(await stored(c.id)).toMatchObject({ unsubscribeOutcome: "removed", grantRevokeOutcome: "kept_shared", scrubbedAt: NOW })
  })

  it("does not revoke a grant another live demo connection of the same person rests on", async () => {
    const live = await connection((await grant()).id)
    const over = await connection((await grant()).id, { expiresAt: at(-1), metaUserId: live.row.metaUserId })

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect(sent()).toEqual([`DELETE /v21.0/${over.pageId}/subscribed_apps ${over.pageToken}`])
    expect(await stored(over.id)).toMatchObject({ unsubscribeOutcome: "removed", grantRevokeOutcome: "kept_shared" })
    expect((await stored(live.id)).scrubbedAt).toBeNull()
  })

  it("revokes the grant of a connect abandoned before any Page was bound", async () => {
    const c = await connection((await grant()).id, { createdAt: at(-31) }, { page: false })

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect(sent()).toEqual([`GET /v21.0/me/accounts ${c.userToken}`, `DELETE /v21.0/me/permissions ${c.userToken}`])
    expect(await stored(c.id)).toMatchObject({ releaseReason: "connect_abandoned", unsubscribeOutcome: "not_subscribed", grantRevokeOutcome: "revoked" })
  })

  it("on a Meta 500: keeps the tokens, counts the attempt, sends nothing again before the lease ends, and finishes later", async () => {
    const g = await grant()
    const c = await connection(g.id, { expiresAt: at(-1) })
    const before = await stored(c.id)
    meta = () => json(500, { error: { code: 2, message: "Service temporarily unavailable" } })

    expect(await engine.releaseDueDemoSocialConnections({ now: NOW })).toMatchObject({ due: 1, released: 0, retrying: 1 })
    const failed = await stored(c.id)
    expect(sent()).toEqual([`DELETE /v21.0/${c.pageId}/subscribed_apps ${c.pageToken}`])
    expect(failed).toMatchObject({
      scrubbedAt: null, releaseAttempts: 1, releaseError: "meta_2", unsubscribeOutcome: null,
      userTokenCipher: before.userTokenCipher, pageTokenCipher: before.pageTokenCipher, pageId: c.pageId,
    })
    expect(await messagesOf(c.id)).toBe(2)

    // A minute later another tick: the lease still holds, Meta hears nothing.
    expect(await engine.releaseDueDemoSocialConnections({ now: at(1) })).toMatchObject({ released: 0, retrying: 1 })
    expect(metaCalls).toHaveLength(1)

    meta = healthyMeta
    expect(await engine.releaseDueDemoSocialConnections({ now: at(3) })).toMatchObject({ released: 1, retrying: 0 })
    expect(metaCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `DELETE /v21.0/${c.pageId}/subscribed_apps`,
      `DELETE /v21.0/${c.pageId}/subscribed_apps`,
      "GET /v21.0/me/accounts",
      "DELETE /v21.0/me/permissions",
    ])
    const row = await stored(c.id)
    expectWiped(row)
    expect(row).toMatchObject({ releaseAttempts: 2, unsubscribeOutcome: "removed", grantRevokeOutcome: "revoked" })
    // The clock of the release started at the first attempt.
    expect(row.releaseRequestedAt).toEqual(NOW)
    expect((await eventsOf(g.id)).map((event) => event.eventType)).toEqual(["SOCIAL_RELEASED"])
  })

  it("does not repeat a finished step: after the Page is unsubscribed and the revoke fails, only the revoke is retried", async () => {
    const c = await connection((await grant()).id, { expiresAt: at(-1) })
    meta = (call) => (call.path === "/v21.0/me/permissions" ? json(503, null) : healthyMeta(call))

    await engine.releaseDueDemoSocialConnections({ now: NOW })
    expect(await stored(c.id)).toMatchObject({ unsubscribeOutcome: "removed", grantRevokeOutcome: null, releaseError: "http_503", scrubbedAt: null })

    meta = healthyMeta
    metaCalls.length = 0
    await engine.releaseDueDemoSocialConnections({ now: at(3) })
    expect(sent()).toEqual([`GET /v21.0/me/accounts ${c.userToken}`, `DELETE /v21.0/me/permissions ${c.userToken}`])
    expect(await stored(c.id)).toMatchObject({ unsubscribeOutcome: "removed", grantRevokeOutcome: "revoked", scrubbedAt: at(3) })
  })

  it("treats a dead token (Meta #190) as gone and wipes the row", async () => {
    const g = await grant()
    const c = await connection(g.id, { expiresAt: at(-1) })
    meta = () => json(400, { error: { code: 190, error_subcode: 458, message: "The user has not authorized application" } })

    expect(await engine.releaseDueDemoSocialConnections({ now: NOW })).toMatchObject({ released: 1, incomplete: 0 })

    expect(metaCalls.map((call) => `${call.method} ${call.path}`)).toEqual([`DELETE /v21.0/${c.pageId}/subscribed_apps`, "GET /v21.0/me/accounts"])
    const row = await stored(c.id)
    expectWiped(row)
    expect(row).toMatchObject({ unsubscribeOutcome: "token_invalid", grantRevokeOutcome: "token_invalid", releaseError: "meta_190_458" })
    expect((await eventsOf(g.id)).map((event) => event.eventType)).toEqual(["SOCIAL_RELEASED"])
  })

  it("after 25 hours of failures wipes the row anyway and records the release as incomplete", async () => {
    const g = await grant()
    const c = await connection(g.id, {
      createdAt: at(-26 * 60), expiresAt: at(-25 * 60 - 1),
      releaseRequestedAt: at(-25 * 60), releaseReason: "day_over", releaseAttempts: 300, releaseError: "http_500",
    })
    meta = () => json(500, null)

    expect(await engine.releaseDueDemoSocialConnections({ now: NOW })).toMatchObject({ released: 1, incomplete: 1 })

    const row = await stored(c.id)
    expectWiped(row)
    expect(row).toMatchObject({ unsubscribeOutcome: "unreachable", grantRevokeOutcome: "unreachable", releaseAttempts: 301 })
    expect(await messagesOf(c.id)).toBe(0)
    const events = await eventsOf(g.id)
    expect(events.map((event) => event.eventType)).toEqual(["SOCIAL_RELEASE_INCOMPLETE"])
    expect(events[0].metadata).toEqual({ platform: "facebook", reason: "day_over", unsubscribe: "unreachable", grantRevoke: "unreachable" })
    expect(await engine.demoSocialReleaseHealth(NOW)).toEqual({ live: 0, due: 0, stranded: 0, incompleteLast7d: 1 })
  })

  it("wipes a row whose tokens no longer decrypt, and says the release is incomplete", async () => {
    const g = await grant()
    // Encrypted for another row: under this row's purpose it does not decrypt (as after a NEXTAUTH_SECRET rotation).
    const c = await connection(g.id, { expiresAt: at(-1), pageTokenCipher: encryptToken("page-token-elsewhere", demoSocialTokenPurpose("conn-other", "page")) })

    await engine.releaseDueDemoSocialConnections({ now: NOW })

    expect(sent()).toEqual([`GET /v21.0/me/accounts ${c.userToken}`, `DELETE /v21.0/me/permissions ${c.userToken}`])
    expect(await stored(c.id)).toMatchObject({ unsubscribeOutcome: "decrypt_failed", grantRevokeOutcome: "revoked" })
    expect((await eventsOf(g.id)).map((event) => event.eventType)).toEqual(["SOCIAL_RELEASE_INCOMPLETE"])
  })

  it("two runs at once send each Meta call exactly once", async () => {
    const rows = [
      await connection((await grant()).id, { expiresAt: at(-1) }),
      await connection((await grant()).id, { expiresAt: at(-1) }),
      await connection((await grant()).id, { expiresAt: at(-1) }),
    ]
    metaDelayMs = 50

    const runs = await Promise.all([
      engine.releaseDueDemoSocialConnections({ now: NOW }),
      engine.releaseDueDemoSocialConnections({ now: NOW }),
    ])

    expect(runs[0].released + runs[1].released).toBe(3)
    const expected = rows.flatMap((c) => [
      `DELETE /v21.0/${c.pageId}/subscribed_apps ${c.pageToken}`,
      `GET /v21.0/me/accounts ${c.userToken}`,
      `DELETE /v21.0/me/permissions ${c.userToken}`,
    ])
    expect([...sent()].sort()).toEqual([...expected].sort())
    for (const c of rows) {
      const row = await stored(c.id)
      expectWiped(row)
      expect(row.releaseAttempts).toBe(1)
    }
    expect(await admin.demoAccessEvent.count({ where: { eventType: "SOCIAL_RELEASED", grantId: { in: rows.map((c) => c.row.grantId!) } } })).toBe(3)
  })

  it("still releases when called inside a tenant's context: the engine enters bypass itself", async () => {
    const c = await connection((await grant()).id, { expiresAt: at(-1) })

    const run = await rls.runWithTenant(SALES, () => engine.releaseDueDemoSocialConnections({ now: NOW }))

    expect(run).toMatchObject({ checked: 1, due: 1, released: 1 })
    expectWiped(await stored(c.id))
  })

  it("answers the deploy's smoke call without a request to Meta and without a write", async () => {
    const live = await connection((await grant()).id)
    const stranded = await connection((await grant()).id, { expiresAt: at(-31) })
    const before = await admin.demoSocialConnection.findMany({ orderBy: { id: "asc" } })
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = "cron-secret-for-this-test"
    try {
      const { POST } = await import("@/app/api/cron/demo-social-release/route")
      const request = new NextRequest("http://localhost:3001/api/cron/demo-social-release?smoke=1", {
        method: "POST",
        headers: { "x-cron-secret": "cron-secret-for-this-test" },
      })
      // In a scope of its own: the cron guard binds bypass to the rest of the request.
      const response = await rls.rlsStorage.run({}, async () => await POST(request))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ success: true, smoke: true, due: 1, stranded: 1 })
      expect(body.live).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = previous
    }
    expect(metaCalls).toEqual([])
    expect(await admin.demoSocialConnection.findMany({ orderBy: { id: "asc" } })).toEqual(before)
    expect(await messagesOf(live.id) + await messagesOf(stranded.id)).toBe(4)
  })
})
