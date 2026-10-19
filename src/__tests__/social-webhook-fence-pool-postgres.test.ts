/**
 * Facebook/Instagram comment webhooks and TikTok organic webhooks, on a real
 * Postgres with the production row-level security and a small connection pool.
 *
 * Found on 2026-10-19 while the TikTok Lead Ads webhook was fixed (#912): each
 * delivery opens the social-monitoring fence, a transaction that takes its
 * organization's advisory lock and keeps its pooled connection for the whole
 * delivery, while the work inside it, on the global client, needs another
 * connection. Every other delivery for that organization waited for the lock
 * holding a connection too. With as many simultaneous deliveries for one
 * organization as the pool has connections, the one holding the lock could not
 * get one more, and the whole pool timed out (`Timed out fetching a new
 * connection from the connection pool`) — on production that pool is the whole
 * application's. A burst of comments under one Facebook post is an ordinary
 * event. The Meta webhook swallowed each failed comment, answered 200, and the
 * comment was never stored.
 *
 * The real routes run against a scratch database built from schema.prisma.
 * Every tenant table gets the production `tenant_isolation` policy
 * (scripts/rls/enable-batch-*.sql) except the ones production still leaves
 * without RLS, and the application connects as a role the policies apply to.
 * The pool is three connections with a five-second timeout, so a request that
 * holds a connection while it needs another stalls on every machine, not only
 * on a 2-core runner (whose default pool is 5), and fails fast. Only outbound
 * side effects (workflows, webhooks, notifications, fetch) are stubbed.
 *
 * Set SOCIAL_WEBHOOK_FENCE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   SOCIAL_WEBHOOK_FENCE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Social webhook fence pool database gate»), where
 * `SOCIAL_WEBHOOK_FENCE_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.SOCIAL_WEBHOOK_FENCE_TEST_DATABASE_URL
if (!adminUrl && process.env.SOCIAL_WEBHOOK_FENCE_DB_GATE === "required") {
  throw new Error("SOCIAL_WEBHOOK_FENCE_TEST_DATABASE_URL is required by the social webhook fence pool database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.SOCIAL_WEBHOOK_FENCE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `social_webhook_fence_${process.pid}`
  const role = `social_webhook_fence_app_${process.pid}`
  // A password for a role that lives only as long as this scratch database.
  const password = `scratch-${process.pid}`
  const adminDb = new URL(admin)
  adminDb.pathname = `/${name}`
  const app = new URL(adminDb.toString())
  app.username = role
  app.password = password
  app.search = "?connection_limit=3&pool_timeout=5"
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  // The Meta webhook rejects any delivery not signed with this app secret.
  process.env.META_WEBHOOK_SECRET = `meta-app-secret-${process.pid}`
  return { name, role, password, adminDbUrl: adminDb.toString() }
})

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

/** Tenant tables production still has without RLS (docs/rls-rollout-runbook.md). */
const NO_RLS_IN_PRODUCTION = [
  "advisor_playbooks", "advisor_signal_snapshots", "business_hours", "channel_connections",
  "conversation_flows", "conversation_flow_runs", "leaderboard_config", "leaderboard_snapshots",
  "loyalty_redemptions", "loyalty_rewards", "message_snippets", "team_queues", "ticket_categories",
  "ticket_closure_requests",
]

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

const sql = (url: string, statement: string) => prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "social-webhook-fence-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** Three organizations, each with a connected Facebook page and a TikTok organic connection. */
const ORGS = {
  first: { id: "org-social-1", page: "page-social-1", organicCallback: "organic-callback-1" },
  second: { id: "org-social-2", page: "page-social-2", organicCallback: "organic-callback-2" },
  third: { id: "org-social-3", page: "page-social-3", organicCallback: "organic-callback-3" },
} as const
type OrgName = keyof typeof ORGS

/** A customer's complaint: the comment gate admits a negative comment on an own page. */
const complaint = (id: string) => `Order ${id} never arrived and nobody answers the phone, terrible service`

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("social webhooks inside the monitoring fence, on a real Postgres with RLS and a small pool", () => {
  type AppPrisma = typeof import("@/lib/prisma").prisma
  let prisma!: AppPrisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let metaPOST!: typeof import("@/app/api/v1/webhooks/meta-social/route").POST
  let organicPOST!: typeof import("@/app/api/v1/webhooks/tiktok-organic/route").POST

  beforeAll(async () => {
    sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.adminDbUrl },
    )
    const excluded = NO_RLS_IN_PRODUCTION.map((table) => `'${table}'`).join(", ")
    sql(scratch!.adminDbUrl, `
      CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO "${scratch!.role}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}";
      DO $rls$
      DECLARE t text;
      BEGIN
        FOR t IN
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'organizationId' AND table_name NOT IN (${excluded})
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
          EXECUTE format($policy$CREATE POLICY tenant_isolation ON public.%I
            USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
            WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')$policy$, t);
        END LOOP;
      END
      $rls$;`)

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      throw new Error(`unexpected outbound request to ${String(input instanceof Request ? input.url : input)}`)
    })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    metaPOST = (await import("@/app/api/v1/webhooks/meta-social/route")).POST
    organicPOST = (await import("@/app/api/v1/webhooks/tiktok-organic/route")).POST

    for (const org of Object.values(ORGS)) {
      await bypass(() => prisma.organization.create({
        data: { id: org.id, name: `Tenant ${org.id}`, slug: org.id, settings: {} },
      }))
      await bypass(() => prisma.socialAccount.create({
        data: { organizationId: org.id, platform: "facebook", handle: org.page, displayName: `Page of ${org.id}` },
      }))
      await bypass(() => prisma.channelConnection.create({
        data: {
          organizationId: org.id,
          platform: "tiktok",
          surface: "organic",
          provider: "tiktok_organic",
          displayName: "TikTok",
          status: "connected",
          capabilities: { read: true, reply: false, webhook: true },
          settings: { webhookSecret: org.organicCallback },
        },
      }))
    }
  }, 300_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  /** Meta delivers one new comment under a post on the organization's Facebook page, signed. */
  async function metaDelivers(org: OrgName, commentId: string) {
    const raw = JSON.stringify({
      object: "page",
      entry: [{
        id: ORGS[org].page,
        time: 1_792_400_000,
        changes: [{
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: commentId,
            post_id: `${ORGS[org].page}_post-1`,
            message: complaint(commentId),
            from: { id: `fan-${commentId}`, name: `Customer ${commentId}` },
            created_time: 1_792_400_000,
          },
        }],
      }],
    })
    const signature = "sha256=" + crypto.createHmac("sha256", process.env.META_WEBHOOK_SECRET!).update(raw).digest("hex")
    const response = await metaPOST(new NextRequest("http://localhost/api/v1/webhooks/meta-social", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body: raw,
    }))
    expect(response.status).toBe(200)
    return await response.json() as { success: boolean; ingested: number; blocked?: number }
  }

  /** TikTok delivers one new comment under a video of the organization's account. */
  async function tiktokDelivers(org: OrgName, commentId: string) {
    const response = await organicPOST(new NextRequest(
      `http://localhost/api/v1/webhooks/tiktok-organic?token=${ORGS[org].organicCallback}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "comment.create",
          data: {
            comment_id: commentId,
            video_id: "video-1",
            text: complaint(commentId),
            author: { username: `fan_${commentId}`, name: `Customer ${commentId}` },
            created_at: "2026-10-19T08:00:00.000Z",
          },
        }),
      },
    ))
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; data?: { ingested: number }; ignored?: string }
    return { ok: body.ok, ingested: body.data?.ingested ?? null, ...(body.ignored ? { ignored: body.ignored } : {}) }
  }

  /**
   * Every delivery's answer, or the last line of what it threw — a pool timeout
   * reads `Timed out fetching a new connection…`. Settled rather than raced, so
   * a failed delivery leaves none of the others running into the next test.
   */
  async function answersTo<T>(deliveries: Array<Promise<T>>): Promise<Array<T | { threw: string }>> {
    return (await Promise.allSettled(deliveries)).map((outcome) => outcome.status === "fulfilled"
      ? outcome.value
      : { threw: outcome.reason instanceof Error ? outcome.reason.message.trim().split("\n").at(-1)! : String(outcome.reason) })
  }

  /** The mentions stored for these comments, as the table holds them. */
  async function storedMentions(org: OrgName, platform: "facebook" | "tiktok", externalIds: string[]) {
    const rows = await bypass(() => prisma.socialMention.findMany({
      where: { organizationId: ORGS[org].id, platform, externalId: { in: externalIds } },
      select: { externalId: true },
    }))
    return rows.map((row: { externalId: string }) => row.externalId).sort()
  }

  const metaExternalId = (commentId: string) => `c:${commentId}`
  const tiktokExternalId = (commentId: string) => `tiktok_organic:comment:${commentId}`

  /** Each test has comment ids of its own, so nothing is cleaned up between them. */
  function burst(name: string, orgs: OrgName[], size = 8) {
    return Array.from({ length: size * orgs.length }, (_, i) => ({ org: orgs[i % orgs.length], commentId: `${name}-${i}` }))
  }

  async function expectEachStoredOnce(
    deliveries: Array<{ org: OrgName; commentId: string }>,
    platform: "facebook" | "tiktok",
    externalId: (commentId: string) => string,
  ) {
    for (const org of new Set(deliveries.map((d) => d.org))) {
      const ids = deliveries.filter((d) => d.org === org).map((d) => externalId(d.commentId))
      expect(await storedMentions(org, platform, ids)).toEqual([...new Set(ids)].sort())
    }
  }

  it("stores a single comment from each webhook (what the bursts below are measured against)", async () => {
    expect(await metaDelivers("first", "fb-single")).toEqual({ success: true, ingested: 1 })
    expect(await tiktokDelivers("first", "tt-single")).toEqual({ ok: true, ingested: 1 })

    expect(await storedMentions("first", "facebook", [metaExternalId("fb-single")])).toEqual([metaExternalId("fb-single")])
    expect(await storedMentions("first", "tiktok", [tiktokExternalId("tt-single")])).toEqual([tiktokExternalId("tt-single")])
  }, 60_000)

  it("stores each of eight comments Meta delivers at once for one page", async () => {
    const deliveries = burst("fb-burst", ["first"])

    const answers = await answersTo(deliveries.map(({ org, commentId }) => metaDelivers(org, commentId)))

    expect(answers).toEqual(deliveries.map(() => ({ success: true, ingested: 1 })))
    await expectEachStoredOnce(deliveries, "facebook", metaExternalId)
  }, 120_000)

  it("stores one comment once when Meta delivers it eight times at once", async () => {
    const deliveries = Array.from({ length: 8 }, () => ({ org: "first" as const, commentId: "fb-same" }))

    const answers = await answersTo(deliveries.map(({ org, commentId }) => metaDelivers(org, commentId)))

    expect(answers).toEqual(deliveries.map(() => ({ success: true, ingested: 1 })))
    expect(await storedMentions("first", "facebook", [metaExternalId("fb-same")])).toEqual([metaExternalId("fb-same")])
  }, 120_000)

  it("stores every comment when the pages of two organizations get their bursts at the same moment", async () => {
    const deliveries = burst("fb-two-orgs", ["first", "second"])

    const answers = await answersTo(deliveries.map(({ org, commentId }) => metaDelivers(org, commentId)))

    expect(answers).toEqual(deliveries.map(() => ({ success: true, ingested: 1 })))
    await expectEachStoredOnce(deliveries, "facebook", metaExternalId)
  }, 120_000)

  it("stores every comment when three organizations get bursts at once, more than the pool can fence at a time", async () => {
    // Deliveries of different organizations do not wait for each other's
    // lock, so each would hold a fence transaction; three would take the whole
    // three-connection pool. Only two hold one at a time.
    const deliveries = burst("fb-three-orgs", ["first", "second", "third"], 4)

    const answers = await answersTo(deliveries.map(({ org, commentId }) => metaDelivers(org, commentId)))

    expect(answers).toEqual(deliveries.map(() => ({ success: true, ingested: 1 })))
    await expectEachStoredOnce(deliveries, "facebook", metaExternalId)
  }, 120_000)

  it("stores each of eight comments TikTok delivers at once for one organization", async () => {
    const deliveries = burst("tt-burst", ["first"])

    const answers = await answersTo(deliveries.map(({ org, commentId }) => tiktokDelivers(org, commentId)))

    expect(answers).toEqual(deliveries.map(() => ({ ok: true, ingested: 1 })))
    await expectEachStoredOnce(deliveries, "tiktok", tiktokExternalId)
  }, 120_000)

  it("stores every TikTok comment when two organizations get their bursts at the same moment", async () => {
    const deliveries = burst("tt-two-orgs", ["first", "second"])

    const answers = await answersTo(deliveries.map(({ org, commentId }) => tiktokDelivers(org, commentId)))

    expect(answers).toEqual(deliveries.map(() => ({ ok: true, ingested: 1 })))
    await expectEachStoredOnce(deliveries, "tiktok", tiktokExternalId)
  }, 120_000)

  it("stores every comment when Meta and TikTok deliver bursts for one organization at the same moment", async () => {
    const facebook = burst("mixed-fb", ["first"])
    const tiktok = burst("mixed-tt", ["first"])

    const [metaAnswers, tiktokAnswers] = await Promise.all([
      answersTo(facebook.map(({ org, commentId }) => metaDelivers(org, commentId))),
      answersTo(tiktok.map(({ org, commentId }) => tiktokDelivers(org, commentId))),
    ])

    expect(metaAnswers).toEqual(facebook.map(() => ({ success: true, ingested: 1 })))
    expect(tiktokAnswers).toEqual(tiktok.map(() => ({ ok: true, ingested: 1 })))
    await expectEachStoredOnce(facebook, "facebook", metaExternalId)
    await expectEachStoredOnce(tiktok, "tiktok", tiktokExternalId)
  }, 120_000)
})
