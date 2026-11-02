/**
 * The other openers of the social-monitoring fence, on a real Postgres with the
 * production row-level security and a small connection pool: the Apify result
 * webhook, Google Alerts inbound e-mail and POST /api/v1/social/ingest, and
 * scheduled work holding fences of its own.
 *
 * Each of them opens the fence, a transaction that takes its organization's
 * advisory lock and keeps its pooled connection for the whole callback, while
 * the work inside it, on the global client, needs another connection. #912 and
 * #914 queued four webhooks in front of the fence; every other opener still
 * waited for the lock holding a connection. Apify calls back once per finished
 * run, and runs started together finish together; Google Alerts sends one
 * e-mail per alert to one address per organization; an API client posts in
 * parallel; several crons fire in the same minute. As many of them at once for
 * one organization as the pool has connections left the one holding the lock
 * none for its work, and the pool timed out. Since 2026-10-19 the fence queues
 * every opener itself (`src/lib/social/monitoring-import-fence.ts`).
 *
 * The real routes run against a scratch database built from schema.prisma.
 * Every tenant table gets the production `tenant_isolation` policy
 * (scripts/rls/enable-batch-*.sql) except the ones production still leaves
 * without RLS, and the application connects as a role the policies apply to.
 * The pool is three connections with a five-second timeout, so a request that
 * holds a connection while it needs another stalls on every machine, not only
 * on a 2-core runner (whose default pool is 5), and fails fast. Only outbound
 * side effects are stubbed: Apify's API and the news site answer from `fetch`,
 * DNS resolves the news host to a public address, and workflows, webhooks and
 * notifications do nothing.
 *
 * Set SOCIAL_FENCE_OPENERS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   SOCIAL_FENCE_OPENERS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Social monitoring fence openers pool database gate»), where
 * `SOCIAL_FENCE_OPENERS_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.SOCIAL_FENCE_OPENERS_TEST_DATABASE_URL
if (!adminUrl && process.env.SOCIAL_FENCE_OPENERS_DB_GATE === "required") {
  throw new Error("SOCIAL_FENCE_OPENERS_TEST_DATABASE_URL is required by the social monitoring fence openers pool database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.SOCIAL_FENCE_OPENERS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `social_fence_openers_${process.pid}`
  const role = `social_fence_openers_app_${process.pid}`
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
  // The inbound e-mail worker's shared secret, and the key the Apify webhook
  // secrets and the Google Alerts addresses are signed with.
  process.env.CF_INBOUND_SECRET = `inbound-${process.pid}`
  process.env.NEXTAUTH_SECRET = `nextauth-${process.pid}`
  // No sentiment model: the mentions are classified without an outbound call.
  delete process.env.ANTHROPIC_API_KEY
  return { name, role, password, adminDbUrl: adminDb.toString() }
})

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
// The news host resolves to a public address; the article itself comes from `fetch`.
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }])
  return { default: { lookup }, lookup }
})

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
  const directory = mkdtempSync(path.join(tmpdir(), "social-fence-openers-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/**
 * Three organizations, each monitoring the brand "Zorbex": an Instagram keyword
 * source collected through Apify, a web scenario fed by Google Alerts, and an
 * API key for the ingest endpoint. Ids are lowercase: the Google Alerts address
 * carries the id, and its parser lowercases it.
 */
const ORGS = {
  first: { id: "org-fence-1" },
  second: { id: "org-fence-2" },
  third: { id: "org-fence-3" },
} as const
type OrgName = keyof typeof ORGS

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
const apiKeyOf = (org: OrgName) => `ld_fence_openers_${ORGS[org].id}_${process.pid}`
const hourAgo = () => new Date(Date.now() - 60 * 60_000).toISOString()

/** What Apify's dataset holds for the run `ext-<key>`: one Instagram post naming the brand. */
const apifyItem = (key: string) => ({
  id: `zorbex-${key}`,
  url: `https://www.instagram.com/p/ZORBEX-${key}/`,
  caption: `Zorbex opens a new store in Baku (${key})`,
  timestamp: hourAgo(),
  ownerUsername: `shopper_${key}`,
})

/** The news article a Google Alert points to: a NewsArticle about the brand. */
const articleHtml = (slug: string) => `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "NewsArticle",
  headline: `Zorbex opens a new store in Baku (${slug})`,
  datePublished: hourAgo(),
  description: "The retailer Zorbex opened its tenth store.",
  publisher: { name: "Example News" },
})}</script></head><body></body></html>`

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("social-monitoring fence openers beyond the comment webhooks, on a real Postgres with RLS and a small pool", () => {
  type AppPrisma = typeof import("@/lib/prisma").prisma
  let prisma!: AppPrisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let fence!: typeof import("@/lib/social/monitoring-import-fence").withSocialMonitoringTenantCollectionFence
  let asScheduled!: typeof import("@/lib/scheduled-work").runAsScheduledWork
  let hmacToken!: typeof import("@/lib/secure-token").hmacToken
  let alertsAddress!: typeof import("@/lib/social/google-alerts-address").buildGoogleAlertsAddress
  let apifyPOST!: typeof import("@/app/api/v1/social/providers/apify/webhook/route").POST
  let emailPOST!: typeof import("@/app/api/v1/public/email-inbound/route").POST
  let ingestPOST!: typeof import("@/app/api/v1/social/ingest/route").POST
  const sources = new Map<OrgName, { sourceId: string; routePlanId: string }>()

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
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.origin === "https://api.apify.com") {
        const run = url.pathname.match(/^\/v2\/actor-runs\/ext-(.+)$/)
        if (run) return Response.json({ data: { status: "SUCCEEDED", defaultDatasetId: `ds-${decodeURIComponent(run[1])}` } })
        const items = url.pathname.match(/^\/v2\/datasets\/ds-(.+)\/items$/)
        if (items) return Response.json([apifyItem(decodeURIComponent(items[1]))])
      }
      if (url.origin === "https://news.example.az") {
        return new Response(articleHtml(url.pathname.slice(1)), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
      }
      throw new Error(`unexpected outbound request to ${url}`)
    })
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithRlsBypass: bypass, runWithTenant: tenant } = await import("@/lib/rls-context"))
    fence = (await import("@/lib/social/monitoring-import-fence")).withSocialMonitoringTenantCollectionFence
    asScheduled = (await import("@/lib/scheduled-work")).runAsScheduledWork
    hmacToken = (await import("@/lib/secure-token")).hmacToken
    alertsAddress = (await import("@/lib/social/google-alerts-address")).buildGoogleAlertsAddress
    apifyPOST = (await import("@/app/api/v1/social/providers/apify/webhook/route")).POST
    emailPOST = (await import("@/app/api/v1/public/email-inbound/route")).POST
    ingestPOST = (await import("@/app/api/v1/social/ingest/route")).POST

    for (const [name, org] of Object.entries(ORGS) as Array<[OrgName, (typeof ORGS)[OrgName]]>) {
      await bypass(() => prisma.organization.create({
        data: { id: org.id, name: `Tenant ${org.id}`, slug: org.id, settings: {}, features: ["social"] },
      }))
      await bypass(() => prisma.channelConfig.create({
        data: {
          organizationId: org.id,
          channelType: "social_monitoring",
          configName: "Monitoring providers",
          apiKey: "apify-test-token",
          settings: { searchIndex: { enabled: true, provider: "apify" } },
        },
      }))
      await bypass(() => prisma.channelConfig.create({
        data: {
          organizationId: org.id,
          channelType: "social_monitoring",
          configName: "Monitoring scenarios",
          settings: {
            scenarios: [{ id: `scenario-${org.id}`, name: "Zorbex news", status: "active", platforms: ["web"], search: { keywords: ["zorbex"] } }],
          },
        },
      }))
      const source = await bypass(() => prisma.monitoringSource.create({
        data: {
          organizationId: org.id,
          platform: "instagram",
          sourceType: "keyword",
          collectionMode: "search_index",
          query: "Zorbex",
          keywords: ["Zorbex"],
        },
      }))
      const routePlan = await bypass(() => prisma.sourceRoutePlan.create({
        data: {
          organizationId: org.id,
          routeKey: `route-${org.id}`,
          sourceId: source.id,
          platform: "instagram",
          capability: "DISCOVER_POSTS",
          contentScope: "PUBLIC",
          primaryAdapter: "APIFY_ASYNC",
          acquisitionMode: "APIFY_FALLBACK",
          policyVersion: "test",
          reason: "test",
        },
      }))
      sources.set(name, { sourceId: source.id, routePlanId: routePlan.id })
      await bypass(() => prisma.apiKey.create({
        data: {
          organizationId: org.id,
          name: "Ingest client",
          keyHash: sha256(apiKeyOf(name)),
          keyPrefix: apiKeyOf(name).slice(0, 8),
          scopes: ["write:social"],
          createdBy: `user-${org.id}`,
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

  type ApifyRun = { org: OrgName; key: string; runId: string; secret: string }

  /** An Apify run of the organization's source that has finished on Apify's side and will call back. */
  async function apifyRunFinished(org: OrgName, key: string): Promise<ApifyRun> {
    const organizationId = ORGS[org].id
    const { sourceId, routePlanId } = sources.get(org)!
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000)
    const collectorRun = await bypass(() => prisma.collectorRun.create({
      data: { organizationId, sourceId, claimToken: `claim-${key}`, claimVersion: 1, leaseExpiresAt: tomorrow },
    }))
    const idempotencyKey = `apify:${key}`
    const secret = `apify-webhook-secret-${key}`
    const run = await bypass(() => prisma.socialProviderRun.create({
      data: {
        organizationId,
        sourceId,
        routePlanId,
        collectorRunId: collectorRun.id,
        providerKey: "APIFY",
        adapterKey: "APIFY_ASYNC",
        phase: "DISCOVER_CANDIDATE_POSTS",
        status: "RUNNING",
        schemaVersion: "social-observation-v2.1",
        externalRunId: `ext-${key}`,
        actorId: "apify/instagram-scraper",
        idempotencyKey,
        inputHash: `input-${key}`,
        webhookSecretHash: hmacToken(secret, `apify-webhook:${organizationId}:${idempotencyKey}`),
        maxTotalChargeUsd: 1,
        maxItems: 50,
        timeoutSeconds: 900,
        purgeAt: tomorrow,
        inputSnapshot: {
          leadDriveSuppressDependentPaidRuns: true,
          // A run started for a scenario, as the collector starts them. Without
          // a target scenario and an archive start the source's cursor update
          // fails on Postgres (42P18, an untyped null) — a defect of its own.
          leadDriveProviderCursorScope: {
            targetScenarioId: `scenario-${organizationId}`,
            archiveStartAt: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
          },
          leadDriveProviderWindow: {
            since: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
            until: new Date().toISOString(),
          },
        },
      },
    }))
    return { org, key, runId: run.id, secret }
  }

  /** Apify calls the result webhook for a finished run. */
  async function apifyCallsBack(run: ApifyRun) {
    const response = await apifyPOST(new NextRequest(
      `http://localhost/api/v1/social/providers/apify/webhook?runId=${run.runId}`,
      { method: "POST", headers: { "x-leaddrive-apify-secret": run.secret } },
    ))
    return { status: response.status, body: await response.json() as { success?: boolean; data?: { status: string; imported: number; error?: string } } }
  }

  /** Google Alerts mails the organization's alert address about one article, as the e-mail worker posts it. */
  async function googleAlertArrives(org: OrgName, key: string) {
    const articleUrl = `https://news.example.az/zorbex-${key}`
    const response = await emailPOST(new NextRequest("http://localhost/api/v1/public/email-inbound", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cf-inbound-secret": process.env.CF_INBOUND_SECRET! },
      body: JSON.stringify({
        to: alertsAddress(ORGS[org].id),
        from: "googlealerts-noreply@google.com",
        headerFrom: "Google Alerts <googlealerts-noreply@google.com>",
        authenticationResults: "mx.example; dkim=pass header.d=google.com",
        subject: "Google Alert - Zorbex",
        html: `<a href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=${articleUrl}&amp;ct=ga">Zorbex opens a new store (${key})</a> - The retailer Zorbex opened its tenth store.`,
        messageId: `<alert-${key}@google.com>`,
      }),
    }))
    return { status: response.status, body: await response.json() as { success?: boolean; data?: { importedCount: number } } }
  }

  /** An API client posts one mention to the ingest endpoint with the organization's key. */
  async function clientPosts(org: OrgName, key: string) {
    const response = await ingestPOST(new NextRequest("http://localhost/api/v1/social/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKeyOf(org)}` },
      body: JSON.stringify({
        platform: "web",
        externalId: `client-${key}`,
        text: `Zorbex store review (${key})`,
        matchedTerm: "Zorbex",
        sourceType: "manual",
      }),
    }))
    return { status: response.status, body: await response.json() as { success?: boolean; data?: { ingested: number; results: Array<{ created?: boolean; error?: string }> } } }
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

  /** The mentions stored for these external ids, as the table holds them. */
  async function storedMentions(org: OrgName, platform: string, externalIds: string[]) {
    const rows = await bypass(() => prisma.socialMention.findMany({
      where: { organizationId: ORGS[org].id, platform, externalId: { in: externalIds } },
      select: { externalId: true },
    }))
    return rows.map((row: { externalId: string }) => row.externalId).sort()
  }

  /** The provider runs as the table holds them after their callbacks. */
  async function storedRuns(runs: ApifyRun[]) {
    const rows = await bypass(() => prisma.socialProviderRun.findMany({
      where: { id: { in: runs.map((run) => run.runId) } },
      select: { id: true, status: true, acceptedCount: true, lastError: true },
    }))
    return runs.map((run) => {
      const row = rows.find((candidate: { id: string }) => candidate.id === run.runId)
      return row ? { status: row.status, acceptedCount: row.acceptedCount, lastError: row.lastError } : null
    })
  }

  const apifyMention = (key: string) => `apify:zorbex-${key}`
  const alertMention = (key: string) => `google-alerts:${sha256(`https://news.example.az/zorbex-${key}`)}`
  const clientMention = (key: string) => `client-${key}`

  const importedAnswer = { status: 200, body: { success: true, data: { status: "IMPORTED", imported: 1 } } }
  const alertAnswer = { status: 201, body: { success: true, data: expect.objectContaining({ importedCount: 1 }) } }
  const ingestAnswer = { status: 200, body: { success: true, data: { ingested: 1, results: [expect.objectContaining({ created: true })] } } }

  async function expectRunsImported(runs: ApifyRun[]) {
    expect(await storedRuns(runs)).toEqual(runs.map(() => ({ status: "IMPORTED", acceptedCount: 1, lastError: null })))
    for (const org of new Set(runs.map((run) => run.org))) {
      const keys = runs.filter((run) => run.org === org).map((run) => apifyMention(run.key))
      expect(await storedMentions(org, "instagram", keys)).toEqual([...keys].sort())
    }
  }

  async function expectStored(org: OrgName, platform: string, externalIds: string[]) {
    expect(await storedMentions(org, platform, externalIds)).toEqual([...new Set(externalIds)].sort())
  }

  /** Keys of their own per test, so nothing is cleaned up between tests. */
  const keys = (name: string, size = 8) => Array.from({ length: size }, (_, i) => `${name}-${i}`)

  it("stores what one delivery of each kind brings (what the bursts below are measured against)", async () => {
    const run = await apifyRunFinished("first", "apify-single")
    expect(await apifyCallsBack(run)).toEqual(importedAnswer)
    expect(await googleAlertArrives("first", "alert-single")).toEqual(alertAnswer)
    expect(await clientPosts("first", "ingest-single")).toEqual(ingestAnswer)

    await expectRunsImported([run])
    await expectStored("first", "web", [alertMention("alert-single"), clientMention("ingest-single")])
  }, 60_000)

  it("imports each of eight Apify runs of one organization that call back at once", async () => {
    const runs = await Promise.all(keys("apify-burst").map((key) => apifyRunFinished("first", key)))

    const answers = await answersTo(runs.map(apifyCallsBack))

    expect(answers).toEqual(runs.map(() => importedAnswer))
    await expectRunsImported(runs)
  }, 120_000)

  it("imports a run once when Apify delivers its webhook eight times at once", async () => {
    const run = await apifyRunFinished("first", "apify-same")

    const answers = await answersTo(Array.from({ length: 8 }, () => apifyCallsBack(run)))

    // One delivery claims the run and imports it. Each of the others answers
    // with what it found: the run imported, still importing, or — when it read
    // the run before the claim and the fence after it — no longer importable.
    const outcomes = answers.map((answer) => {
      expect(answer).toMatchObject({ status: 200, body: { success: true } })
      return (answer as { body: { data: unknown } }).body.data
    })
    expect(outcomes).toContainEqual({ status: "IMPORTED", imported: 1 })
    for (const outcome of outcomes) {
      expect([
        { status: "IMPORTED", imported: 1 },
        { status: "IMPORTING", imported: 0 },
        { status: "BLOCKED", imported: 0, error: "social_monitoring_import_run_inactive" },
      ]).toContainEqual(outcome)
    }
    await expectRunsImported([run])
  }, 120_000)

  it("stores each of eight Google Alerts e-mails one organization receives at once", async () => {
    const alerts = keys("alert-burst")

    const answers = await answersTo(alerts.map((key) => googleAlertArrives("first", key)))

    expect(answers).toEqual(alerts.map(() => alertAnswer))
    await expectStored("first", "web", alerts.map(alertMention))
  }, 120_000)

  it("stores each of eight mentions an API client posts at once", async () => {
    const posts = keys("ingest-burst")

    const answers = await answersTo(posts.map((key) => clientPosts("first", key)))

    expect(answers).toEqual(posts.map(() => ingestAnswer))
    await expectStored("first", "web", posts.map(clientMention))
  }, 120_000)

  it("stores everything when Apify, Google Alerts and an API client deliver for one organization at the same moment", async () => {
    const runs = await Promise.all(keys("mixed-apify").map((key) => apifyRunFinished("second", key)))
    const alerts = keys("mixed-alert")
    const posts = keys("mixed-ingest")

    const [apifyAnswers, alertAnswers, ingestAnswers] = await Promise.all([
      answersTo(runs.map(apifyCallsBack)),
      answersTo(alerts.map((key) => googleAlertArrives("second", key))),
      answersTo(posts.map((key) => clientPosts("second", key))),
    ])

    expect(apifyAnswers).toEqual(runs.map(() => importedAnswer))
    expect(alertAnswers).toEqual(alerts.map(() => alertAnswer))
    expect(ingestAnswers).toEqual(posts.map(() => ingestAnswer))
    await expectRunsImported(runs)
    await expectStored("second", "web", [...alerts.map(alertMention), ...posts.map(clientMention)])
  }, 180_000)

  it("stores everything when three organizations get deliveries of every kind at once, more than the pool can fence at a time", async () => {
    // Deliveries of different organizations do not wait for each other's
    // lock, so each would hold a fence transaction; three would take the whole
    // three-connection pool. Only two hold one at a time.
    const orgs: OrgName[] = ["first", "second", "third"]
    const runs = await Promise.all(orgs.flatMap((org) => keys(`orgs-apify-${org}`, 3).map((key) => apifyRunFinished(org, key))))
    const alerts = orgs.flatMap((org) => keys(`orgs-alert-${org}`, 3).map((key) => ({ org, key })))
    const posts = orgs.flatMap((org) => keys(`orgs-ingest-${org}`, 3).map((key) => ({ org, key })))

    const [apifyAnswers, alertAnswers, ingestAnswers] = await Promise.all([
      answersTo(runs.map(apifyCallsBack)),
      answersTo(alerts.map(({ org, key }) => googleAlertArrives(org, key))),
      answersTo(posts.map(({ org, key }) => clientPosts(org, key))),
    ])

    expect(apifyAnswers).toEqual(runs.map(() => importedAnswer))
    expect(alertAnswers).toEqual(alerts.map(() => alertAnswer))
    expect(ingestAnswers).toEqual(posts.map(() => ingestAnswer))
    await expectRunsImported(runs)
    for (const org of orgs) {
      await expectStored(org, "web", [
        ...alerts.filter((alert) => alert.org === org).map(({ key }) => alertMention(key)),
        ...posts.filter((post) => post.org === org).map(({ key }) => clientMention(key)),
      ])
    }
  }, 180_000)

  it("lets another organization's deliveries through while scheduled work holds fences of two organizations", async () => {
    // Two crons, each inside a fence of its own organization for as long as
    // this test lets them. Scheduled work holds at most one of the two fence
    // slots, so the third organization's deliveries still get the other.
    let release!: () => void
    const released = new Promise<void>((resolve) => { release = resolve })
    const entered: OrgName[] = []
    const crons = (["first", "second"] as const).map((org) => asScheduled(() => tenant(ORGS[org].id, () =>
      fence(ORGS[org].id, async () => {
        entered.push(org)
        await released
        return org
      }))))
    while (entered.length === 0) await new Promise((resolve) => setTimeout(resolve, 20))
    await new Promise((resolve) => setTimeout(resolve, 200))

    const runs = await Promise.all(keys("cron-apify", 3).map((key) => apifyRunFinished("third", key)))
    const alerts = keys("cron-alert", 3)
    const posts = keys("cron-ingest", 3)
    // If the deliveries cannot get through while both crons are held, the
    // crons are let go after a minute so that the test ends, and it fails.
    let gaveUp = false
    const giveUp = setTimeout(() => { gaveUp = true; release() }, 60_000)
    const [apifyAnswers, alertAnswers, ingestAnswers] = await Promise.all([
      answersTo(runs.map(apifyCallsBack)),
      answersTo(alerts.map((key) => googleAlertArrives("third", key))),
      answersTo(posts.map((key) => clientPosts("third", key))),
    ])
    clearTimeout(giveUp)
    release()
    const cronAnswers = await answersTo(crons)

    expect(gaveUp).toBe(false)
    expect(apifyAnswers).toEqual(runs.map(() => importedAnswer))
    expect(alertAnswers).toEqual(alerts.map(() => alertAnswer))
    expect(ingestAnswers).toEqual(posts.map(() => ingestAnswer))
    expect(cronAnswers).toEqual([{ allowed: true, value: "first" }, { allowed: true, value: "second" }])
    await expectRunsImported(runs)
    await expectStored("third", "web", [...alerts.map(alertMention), ...posts.map(clientMention)])
  }, 180_000)
})
