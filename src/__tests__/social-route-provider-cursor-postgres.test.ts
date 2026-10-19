/**
 * A source's route/provider cursor, written on a real Postgres under the
 * production row-level security.
 *
 * `advanceMonitoringRouteProviderCursor` stores the cursor with
 * `jsonb_build_object(...)`, which is VARIADIC "any": Postgres takes each
 * argument's type from the argument itself. Prisma binds a string as text and a
 * JS `null` with no type, so until 2026-10-19 a cursor without a target
 * scenario or without an archive start failed the whole statement:
 *
 *   ERROR: could not determine data type of parameter $8   (42P18)
 *
 * Only a manual archive run sets both. Every scheduled Google Alerts run that
 * read feed entries lost its checkpoint this way on prod (logged and carried
 * on), and an Apify discovery run without a target scenario failed its
 * persistence fence: the result webhook answered 500 and the run stayed
 * IMPORTING, with reconciliation failing the same way on every retry. The unit
 * tests mock Prisma, so the statement had never been sent with those arguments.
 *
 * The real Apify result webhook runs against a scratch database built from
 * schema.prisma. Every tenant table gets the production `tenant_isolation`
 * policy (scripts/rls/enable-batch-*.sql) except the ones production still
 * leaves without RLS, and the application connects as a role the policies
 * apply to. Only outbound side effects are stubbed: Apify's API answers from
 * `fetch`, and workflows, webhooks and notifications do nothing.
 *
 * Set SOCIAL_ROUTE_CURSOR_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55497:5432 postgres:16
 *   SOCIAL_ROUTE_CURSOR_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Social route provider cursor database gate»), where
 * `SOCIAL_ROUTE_CURSOR_DB_GATE=required` turns a missing URL into a failure.
 * The deploy's database is a plain `postgres:16`, the pull-request one has
 * pgvector; it passes on both.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.SOCIAL_ROUTE_CURSOR_TEST_DATABASE_URL
if (!adminUrl && process.env.SOCIAL_ROUTE_CURSOR_DB_GATE === "required") {
  throw new Error("SOCIAL_ROUTE_CURSOR_TEST_DATABASE_URL is required by the social route provider cursor database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.SOCIAL_ROUTE_CURSOR_TEST_DATABASE_URL
  if (!admin) return null
  const name = `social_route_cursor_${process.pid}`
  const role = `social_route_cursor_app_${process.pid}`
  // A password for a role that lives only as long as this scratch database.
  const password = `scratch-${process.pid}`
  const adminDb = new URL(admin)
  adminDb.pathname = `/${name}`
  const app = new URL(adminDb.toString())
  app.username = role
  app.password = password
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  // The key the Apify webhook secrets are signed with.
  process.env.NEXTAUTH_SECRET = `nextauth-${process.pid}`
  // No sentiment model: the mentions are classified without an outbound call.
  delete process.env.ANTHROPIC_API_KEY
  return { name, role, password, adminDbUrl: adminDb.toString() }
})

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-route-cursor"
const OTHER_ORG = "org-route-cursor-other"
const SCENARIO = `scenario-${ORG}`
const ADAPTER = "APIFY_ASYNC"
const ARCHIVE_START = "2026-07-01T00:00:00.000Z"

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
  const directory = mkdtempSync(path.join(tmpdir(), "social-route-cursor-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const hourAgo = () => new Date(Date.now() - 60 * 60_000).toISOString()

/** What Apify's dataset holds for the run `ext-<key>`: one Instagram post naming the brand. */
const apifyItem = (key: string) => ({
  id: `zorbex-${key}`,
  url: `https://www.instagram.com/p/ZORBEX-${key}/`,
  caption: `Zorbex opens a new store in Baku (${key})`,
  timestamp: hourAgo(),
  ownerUsername: `shopper_${key}`,
})

type StoredSettings = Record<string, unknown> & {
  searchIndex?: Record<string, unknown> & {
    routeProviderCursors?: Record<string, Record<string, unknown>>
  }
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("social monitoring route/provider cursors on a real Postgres with RLS", () => {
  type AppPrisma = typeof import("@/lib/prisma").prisma
  let prisma!: AppPrisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let hmacToken!: typeof import("@/lib/secure-token").hmacToken
  let cursors!: typeof import("@/lib/social/archive-provider-window")
  let apifyPOST!: typeof import("@/app/api/v1/social/providers/apify/webhook/route").POST
  let sourceNumber = 0

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
      throw new Error(`unexpected outbound request to ${url}`)
    })
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithRlsBypass: bypass, runWithTenant: tenant } = await import("@/lib/rls-context"))
    hmacToken = (await import("@/lib/secure-token")).hmacToken
    cursors = await import("@/lib/social/archive-provider-window")
    apifyPOST = (await import("@/app/api/v1/social/providers/apify/webhook/route")).POST

    for (const id of [ORG, OTHER_ORG]) {
      await bypass(() => prisma.organization.create({
        data: { id, name: `Tenant ${id}`, slug: id, settings: {}, features: ["social"] },
      }))
    }
    await bypass(() => prisma.channelConfig.create({
      data: {
        organizationId: ORG,
        channelType: "social_monitoring",
        configName: "Monitoring providers",
        apiKey: "apify-test-token",
        settings: { searchIndex: { enabled: true, provider: "apify" } },
      },
    }))
    await bypass(() => prisma.channelConfig.create({
      data: {
        organizationId: ORG,
        channelType: "social_monitoring",
        configName: "Monitoring scenarios",
        settings: {
          scenarios: [{ id: SCENARIO, name: "Zorbex", status: "active", platforms: ["instagram"], search: { keywords: ["zorbex"] } }],
        },
      },
    }))
  }, 300_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  /** An Instagram keyword source collected through Apify, with a route plan of its own. */
  async function seedSource(settings: Record<string, unknown> = {}, organizationId = ORG) {
    sourceNumber += 1
    const source = await bypass(() => prisma.monitoringSource.create({
      data: {
        organizationId,
        platform: "instagram",
        sourceType: "keyword",
        collectionMode: "search_index",
        // One source per case; the query is unique per organization and mode.
        query: `Zorbex ${sourceNumber}`,
        keywords: ["Zorbex"],
        settings: settings as never,
      },
    }))
    const routePlan = await bypass(() => prisma.sourceRoutePlan.create({
      data: {
        organizationId,
        routeKey: `route-${sourceNumber}`,
        sourceId: source.id,
        platform: "instagram",
        capability: "DISCOVER_POSTS",
        contentScope: "PUBLIC",
        primaryAdapter: ADAPTER,
        acquisitionMode: "APIFY_FALLBACK",
        policyVersion: "test",
        reason: "test",
      },
    }))
    return { sourceId: source.id, routePlanId: routePlan.id }
  }

  async function storedSettings(sourceId: string): Promise<StoredSettings> {
    const source = await bypass(() => prisma.monitoringSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { settings: true },
    }))
    return source.settings as unknown as StoredSettings
  }

  describe("advanceMonitoringRouteProviderCursor", () => {
    const until = new Date("2026-10-19T07:34:06.000Z")

    // Every combination of the two values a caller may leave empty. Before the
    // fix only the last one could be stored.
    it.each([
      {
        name: "a scheduled run without a target scenario or an archive start",
        scope: { fullArchiveRun: false, targetScenarioId: undefined, archiveStartAt: undefined },
        stored: { fullArchiveRun: false, targetScenarioId: null, archiveStartAt: null },
      },
      {
        name: "a scheduled run of a source with an archive start (Google Alerts RSS)",
        scope: { fullArchiveRun: false, targetScenarioId: undefined, archiveStartAt: new Date(ARCHIVE_START) },
        stored: { fullArchiveRun: false, targetScenarioId: null, archiveStartAt: ARCHIVE_START },
      },
      {
        name: "a targeted run whose scenario has no archive start (explicit null)",
        scope: { fullArchiveRun: false, targetScenarioId: SCENARIO, archiveStartAt: null },
        stored: { fullArchiveRun: false, targetScenarioId: SCENARIO, archiveStartAt: null },
      },
      {
        name: "a manual archive run (both set)",
        scope: { fullArchiveRun: true, targetScenarioId: SCENARIO, archiveStartAt: ARCHIVE_START },
        stored: { fullArchiveRun: true, targetScenarioId: SCENARIO, archiveStartAt: ARCHIVE_START },
      },
    ])("stores the cursor of $name", async ({ scope, stored }) => {
      const { sourceId, routePlanId } = await seedSource({
        scenarioId: SCENARIO,
        searchIndex: { fetchAfter: "2026-10-01T00:00:00.000Z" },
      })
      const key = cursors.archiveProviderCursorKey({ routePlanId, adapterKey: ADAPTER, ...scope })

      const updated = await tenant(ORG, () => cursors.advanceMonitoringRouteProviderCursor({
        organizationId: ORG,
        sourceId,
        routePlanId,
        adapterKey: ADAPTER,
        ...scope,
        until,
        reason: "apify_discovery_imported",
      }))

      expect(updated).toBe(1)
      const settings = await storedSettings(sourceId)
      expect(settings.searchIndex?.routeProviderCursors).toEqual({
        [key]: {
          fetchAfter: until.toISOString(),
          updatedAt: expect.any(String),
          reason: "apify_discovery_imported",
          routePlanId,
          adapterKey: ADAPTER,
          ...stored,
        },
      })
      // The merge leaves everything else the source carries where it was.
      expect(settings).toMatchObject({ scenarioId: SCENARIO, searchIndex: { fetchAfter: "2026-10-01T00:00:00.000Z" } })
      // What was written is what the next run reads back as its lower bound.
      expect(cursors.routeProviderCursorFetchAfterForSource(settings, { routePlanId, adapterKey: ADAPTER, ...scope }))
        .toEqual(until)
    })

    it("only moves forward, keeps another route's cursor, and leaves another organization's source alone", async () => {
      const { sourceId, routePlanId } = await seedSource({
        searchIndex: { routeProviderCursors: { "other-route:GOOGLE_ALERTS_RSS": { fetchAfter: "2026-10-10T00:00:00.000Z" } } },
      })
      const advance = (to: string, organizationId = ORG, id = sourceId) => tenant(organizationId, () =>
        cursors.advanceMonitoringRouteProviderCursor({
          organizationId,
          sourceId: id,
          routePlanId,
          adapterKey: ADAPTER,
          until: new Date(to),
          reason: "scheduled_route_package_persisted",
        }))

      expect(await advance("2026-10-19T07:34:06.000Z")).toBe(1)
      expect(await advance("2026-10-19T07:34:06.000Z")).toBe(0)
      expect(await advance("2026-10-18T00:00:00.000Z")).toBe(0)
      expect(await advance("2026-10-19T08:00:00.000Z")).toBe(1)
      const other = await seedSource({}, OTHER_ORG)
      expect(await advance("2026-10-19T09:00:00.000Z", ORG, other.sourceId)).toBe(0)

      expect((await storedSettings(sourceId)).searchIndex?.routeProviderCursors).toEqual({
        "other-route:GOOGLE_ALERTS_RSS": { fetchAfter: "2026-10-10T00:00:00.000Z" },
        [`${routePlanId}:${ADAPTER}`]: expect.objectContaining({
          fetchAfter: "2026-10-19T08:00:00.000Z",
          targetScenarioId: null,
          archiveStartAt: null,
        }),
      })
      expect((await storedSettings(other.sourceId)).searchIndex).toBeUndefined()
    })
  })

  describe("advanceMonitoringSourceFetchAfter", () => {
    it("stores the source-wide watermark and only moves it forward", async () => {
      const { sourceId } = await seedSource({ scenarioId: SCENARIO })
      const advance = (to: string) => tenant(ORG, () => cursors.advanceMonitoringSourceFetchAfter({
        organizationId: ORG,
        sourceId,
        until: new Date(to),
        reason: "provider_window_complete",
      }))

      expect(await advance("2026-10-19T07:34:06.000Z")).toBe(1)
      expect(await advance("2026-10-18T00:00:00.000Z")).toBe(0)

      const settings = await storedSettings(sourceId)
      expect(settings.searchIndex).toEqual({
        fetchAfter: "2026-10-19T07:34:06.000Z",
        fetchAfterUpdatedAt: expect.any(String),
        fetchAfterReason: "provider_window_complete",
      })
      expect(settings.scenarioId).toBe(SCENARIO)
    })
  })

  describe("the Apify result webhook for a discovery run", () => {
    type ApifyRun = { key: string; runId: string; secret: string; sourceId: string; routePlanId: string; until: string }

    /** A discovery run of its own source that has finished on Apify's side and will call back. */
    async function apifyRunFinished(
      key: string,
      cursorScope?: { targetScenarioId: string; archiveStartAt: string },
    ): Promise<ApifyRun> {
      const { sourceId, routePlanId } = await seedSource()
      const tomorrow = new Date(Date.now() + 24 * 60 * 60_000)
      const collectorRun = await bypass(() => prisma.collectorRun.create({
        data: { organizationId: ORG, sourceId, claimToken: `claim-${key}`, claimVersion: 1, leaseExpiresAt: tomorrow },
      }))
      const idempotencyKey = `apify:${key}`
      const secret = `apify-webhook-secret-${key}`
      const until = new Date().toISOString()
      const run = await bypass(() => prisma.socialProviderRun.create({
        data: {
          organizationId: ORG,
          sourceId,
          routePlanId,
          collectorRunId: collectorRun.id,
          providerKey: "APIFY",
          adapterKey: ADAPTER,
          phase: "DISCOVER_CANDIDATE_POSTS",
          status: "RUNNING",
          schemaVersion: "social-observation-v2.1",
          externalRunId: `ext-${key}`,
          actorId: "apify/instagram-scraper",
          idempotencyKey,
          inputHash: `input-${key}`,
          webhookSecretHash: hmacToken(secret, `apify-webhook:${ORG}:${idempotencyKey}`),
          maxTotalChargeUsd: 1,
          maxItems: 50,
          timeoutSeconds: 900,
          purgeAt: tomorrow,
          inputSnapshot: {
            leadDriveSuppressDependentPaidRuns: true,
            ...(cursorScope ? { leadDriveProviderCursorScope: cursorScope } : {}),
            leadDriveProviderWindow: {
              since: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
              until,
            },
          },
        },
      }))
      return { key, runId: run.id, secret, sourceId, routePlanId, until }
    }

    async function apifyCallsBack(run: ApifyRun) {
      const response = await apifyPOST(new NextRequest(
        `http://localhost/api/v1/social/providers/apify/webhook?runId=${run.runId}`,
        { method: "POST", headers: { "x-leaddrive-apify-secret": run.secret } },
      ))
      return { status: response.status, body: await response.json() as unknown }
    }

    async function storedRun(run: ApifyRun) {
      return bypass(() => prisma.socialProviderRun.findUniqueOrThrow({
        where: { id: run.runId },
        select: { status: true, acceptedCount: true, lastError: true },
      }))
    }

    async function storedMentions(run: ApifyRun) {
      const rows = await bypass(() => prisma.socialMention.findMany({
        where: { organizationId: ORG, platform: "instagram", externalId: `apify:zorbex-${run.key}` },
        select: { externalId: true },
      }))
      return rows.map((row: { externalId: string }) => row.externalId)
    }

    const importedAnswer = { status: 200, body: { success: true, data: { status: "IMPORTED", imported: 1 } } }

    it("imports a run started for a scenario with an archive start, and stores the cursor (the case that always worked)", async () => {
      const run = await apifyRunFinished("targeted", { targetScenarioId: SCENARIO, archiveStartAt: ARCHIVE_START })

      expect(await apifyCallsBack(run)).toEqual(importedAnswer)

      expect(await storedRun(run)).toEqual({ status: "IMPORTED", acceptedCount: 1, lastError: null })
      expect(await storedMentions(run)).toEqual(["apify:zorbex-targeted"])
      expect((await storedSettings(run.sourceId)).searchIndex?.routeProviderCursors).toEqual({
        [`${run.routePlanId}:${ADAPTER}`]: {
          fetchAfter: run.until,
          updatedAt: expect.any(String),
          reason: "apify_discovery_imported",
          routePlanId: run.routePlanId,
          adapterKey: ADAPTER,
          fullArchiveRun: false,
          targetScenarioId: SCENARIO,
          archiveStartAt: ARCHIVE_START,
        },
      })
    }, 60_000)

    it("imports a run with no target scenario and no archive start, and stores its cursor with both empty", async () => {
      // Until 2026-10-19 this answered 500 and the run stayed IMPORTING: the
      // cursor update inside the persistence fence failed with 42P18.
      const run = await apifyRunFinished("untargeted")

      expect(await apifyCallsBack(run)).toEqual(importedAnswer)

      expect(await storedRun(run)).toEqual({ status: "IMPORTED", acceptedCount: 1, lastError: null })
      expect(await storedMentions(run)).toEqual(["apify:zorbex-untargeted"])
      expect((await storedSettings(run.sourceId)).searchIndex?.routeProviderCursors).toEqual({
        [`${run.routePlanId}:${ADAPTER}`]: {
          fetchAfter: run.until,
          updatedAt: expect.any(String),
          reason: "apify_discovery_imported",
          routePlanId: run.routePlanId,
          adapterKey: ADAPTER,
          fullArchiveRun: false,
          targetScenarioId: null,
          archiveStartAt: null,
        },
      })
    }, 60_000)
  })
})
