/**
 * Advancing a social-monitoring cursor, against a real Postgres.
 *
 * Why this exists: from 2026-09-04 to 2026-10-02 every scheduled Google Alerts
 * run on prod that had feed entries to read lost its checkpoint to
 *
 *   ERROR: could not determine data type of parameter $8   (42P18, P2010)
 *
 * The cursor is written with `jsonb_build_object(...)`, which is VARIADIC
 * "any": Postgres takes each argument's type from the argument itself, and a
 * bound NULL has none. Prisma sends a string as text and a null as unknown, so
 * the statement worked for a manual archive run (target scenario and archive
 * start both set) and failed for every scheduled one, which has no target
 * scenario. The caller logs the error and carries on, and the unit tests mock
 * Prisma without `$executeRaw` at all, so the statement had never been sent to
 * a database with the arguments a scheduled run passes.
 *
 * Set SOCIAL_MONITORING_CURSOR_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   SOCIAL_MONITORING_CURSOR_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Social monitoring cursor database gate»), where
 * `SOCIAL_MONITORING_CURSOR_DB_GATE=required` turns a missing URL into a
 * failure so the gate cannot go quietly green. The deploy's database is a
 * plain `postgres:16`, the pull-request one has pgvector; it passes on both.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.SOCIAL_MONITORING_CURSOR_TEST_DATABASE_URL
if (!adminUrl && process.env.SOCIAL_MONITORING_CURSOR_DB_GATE === "required") {
  throw new Error("SOCIAL_MONITORING_CURSOR_TEST_DATABASE_URL is required by the social monitoring cursor database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.SOCIAL_MONITORING_CURSOR_TEST_DATABASE_URL
  if (!admin) return null
  const name = `social_monitoring_cursor_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

// Which terms a scenario listens for is not what is under test.
vi.mock("@/lib/social/search-index-adapter", () => ({
  requiredMatchTermsForSource: vi.fn(async () => ({
    terms: ["Araz Supermarket"],
    source: "scenario",
    scenarioIds: ["scenario-araz"],
    scenarioNames: ["Araz Supermarket"],
  })),
}))

const ROOT = process.cwd()
const ORG = "org-monitoring-cursor"
const OTHER_ORG = "org-monitoring-cursor-other"
const SCENARIO = "scenario-araz"
const ROUTE_PLAN = "route-plan-rss"
const ADAPTER = "GOOGLE_ALERTS_RSS"
const SCHEDULED_KEY = `${ROUTE_PLAN}:${ADAPTER}`
const ARCHIVE_START = "2026-07-01T00:00:00.000Z"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres: the pull-request
 * database has pgvector, a plain `postgres:16` does not, and nothing here
 * reads the two knowledge-base columns that need it.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "social-monitoring-cursor-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

type StoredSettings = Record<string, unknown> & {
  searchIndex: Record<string, unknown> & {
    routeProviderCursors: Record<string, Record<string, unknown>>
  }
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("social monitoring cursors on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let asTenant!: typeof import("@/lib/rls-context").runWithTenant
  let cursors!: typeof import("@/lib/social/archive-provider-window")
  let sourceNumber = 0

  /** Settings as a scenario's Google Alerts source carries them on prod. */
  function sourceSettings(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      managedBy: "google_alerts_rss",
      scenarioId: SCENARIO,
      scenarioLinks: [{ scenarioId: SCENARIO, archiveStartAt: ARCHIVE_START }],
      ...extra,
    }
  }

  async function seedSource(settings: Record<string, unknown>, organizationId = ORG): Promise<string> {
    sourceNumber += 1
    const source = await bypass(() => prisma.monitoringSource.create({
      data: {
        organizationId,
        platform: "web",
        sourceType: "notification_inbox",
        collectionMode: "notification_inbox",
        query: `google-alerts-rss:${SCENARIO}:${sourceNumber}`,
        settings: settings as never,
      },
      select: { id: true },
    }))
    return source.id
  }

  async function storedSettings(sourceId: string): Promise<StoredSettings> {
    const source = await bypass(() => prisma.monitoringSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { settings: true },
    }))
    return source.settings as unknown as StoredSettings
  }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    const rls = await import("@/lib/rls-context")
    bypass = rls.runWithRlsBypass
    asTenant = rls.runWithTenant
    cursors = await import("@/lib/social/archive-provider-window")
    await bypass(() => prisma.organization.createMany({
      data: [
        { id: ORG, name: "Araz", slug: "monitoring-cursor-test" },
        { id: OTHER_ORG, name: "Other", slug: "monitoring-cursor-other" },
      ],
    }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("advanceMonitoringRouteProviderCursor", () => {
    const until = new Date("2026-09-29T07:34:06.000Z")

    // Every combination of the two optional values a caller can leave empty.
    // The first two are what a scheduled run sends; only the last ever worked.
    it.each([
      {
        name: "a scheduled run of a scenario without an archive start (both empty)",
        scope: { fullArchiveRun: false, targetScenarioId: undefined, archiveStartAt: null },
        stored: { fullArchiveRun: false, targetScenarioId: null, archiveStartAt: null },
      },
      {
        name: "a scheduled run of a scenario with an archive start (no target scenario)",
        scope: { fullArchiveRun: false, targetScenarioId: undefined, archiveStartAt: new Date(ARCHIVE_START) },
        stored: { fullArchiveRun: false, targetScenarioId: null, archiveStartAt: ARCHIVE_START },
      },
      {
        name: "a targeted run without an archive start (no archive start)",
        scope: { fullArchiveRun: false, targetScenarioId: SCENARIO, archiveStartAt: null },
        stored: { fullArchiveRun: false, targetScenarioId: SCENARIO, archiveStartAt: null },
      },
      {
        name: "a manual archive run (both set)",
        scope: { fullArchiveRun: true, targetScenarioId: SCENARIO, archiveStartAt: ARCHIVE_START },
        stored: { fullArchiveRun: true, targetScenarioId: SCENARIO, archiveStartAt: ARCHIVE_START },
      },
    ])("stores the cursor for $name", async ({ scope, stored }) => {
      const sourceId = await seedSource(sourceSettings({ searchIndex: { fetchAfter: "2026-09-01T00:00:00.000Z" } }))
      const key = cursors.archiveProviderCursorKey({ routePlanId: ROUTE_PLAN, adapterKey: ADAPTER, ...scope })

      const updated = await asTenant(ORG, () => cursors.advanceMonitoringRouteProviderCursor({
        organizationId: ORG,
        sourceId,
        routePlanId: ROUTE_PLAN,
        adapterKey: ADAPTER,
        ...scope,
        until,
        reason: "google_alerts_rss_feed_complete",
      }))

      expect(updated).toBe(1)
      const settings = await storedSettings(sourceId)
      expect(settings.searchIndex.routeProviderCursors).toEqual({
        [key]: {
          fetchAfter: until.toISOString(),
          updatedAt: expect.any(String),
          reason: "google_alerts_rss_feed_complete",
          routePlanId: ROUTE_PLAN,
          adapterKey: ADAPTER,
          ...stored,
        },
      })
      // The merge leaves everything else the source carries where it was.
      expect(settings).toMatchObject({
        managedBy: "google_alerts_rss",
        scenarioId: SCENARIO,
        scenarioLinks: [{ scenarioId: SCENARIO, archiveStartAt: ARCHIVE_START }],
        searchIndex: { fetchAfter: "2026-09-01T00:00:00.000Z" },
      })
      // What was written is what the next run reads back as its lower bound.
      expect(cursors.routeProviderCursorFetchAfterForSource(settings, {
        routePlanId: ROUTE_PLAN,
        adapterKey: ADAPTER,
        ...scope,
      })).toEqual(until)
    })

    it("only moves forward, and keeps another route's cursor", async () => {
      const sourceId = await seedSource(sourceSettings({
        searchIndex: { routeProviderCursors: { "other-route:APIFY_ASYNC": { fetchAfter: "2026-09-10T00:00:00.000Z" } } },
      }))
      const advance = (to: string) => asTenant(ORG, () => cursors.advanceMonitoringRouteProviderCursor({
        organizationId: ORG,
        sourceId,
        routePlanId: ROUTE_PLAN,
        adapterKey: ADAPTER,
        fullArchiveRun: false,
        archiveStartAt: null,
        until: new Date(to),
        reason: "scheduled_route_package_persisted",
      }))

      expect(await advance("2026-09-29T07:34:06.000Z")).toBe(1)
      expect(await advance("2026-09-29T07:34:06.000Z")).toBe(0)
      expect(await advance("2026-09-28T00:00:00.000Z")).toBe(0)
      expect(await advance("2026-09-30T00:00:00.000Z")).toBe(1)

      const stored = (await storedSettings(sourceId)).searchIndex.routeProviderCursors
      expect(stored[SCHEDULED_KEY].fetchAfter).toBe("2026-09-30T00:00:00.000Z")
      expect(stored["other-route:APIFY_ASYNC"]).toEqual({ fetchAfter: "2026-09-10T00:00:00.000Z" })
    })

    it("does not touch a source of another organization", async () => {
      const sourceId = await seedSource(sourceSettings(), OTHER_ORG)

      const updated = await asTenant(ORG, () => cursors.advanceMonitoringRouteProviderCursor({
        organizationId: ORG,
        sourceId,
        routePlanId: ROUTE_PLAN,
        adapterKey: ADAPTER,
        until: new Date("2026-09-29T07:34:06.000Z"),
        reason: "scheduled_route_package_persisted",
      }))

      expect(updated).toBe(0)
      expect((await storedSettings(sourceId)).searchIndex).toBeUndefined()
    })
  })

  describe("advanceMonitoringSourceFetchAfter", () => {
    it("stores the source-wide watermark and only moves it forward", async () => {
      const sourceId = await seedSource(sourceSettings())
      const advance = (to: string) => asTenant(ORG, () => cursors.advanceMonitoringSourceFetchAfter({
        organizationId: ORG,
        sourceId,
        until: new Date(to),
        reason: "provider_window_complete",
      }))

      expect(await advance("2026-09-29T07:34:06.000Z")).toBe(1)
      expect(await advance("2026-09-28T00:00:00.000Z")).toBe(0)

      const settings = await storedSettings(sourceId)
      expect(settings.searchIndex).toEqual({
        fetchAfter: "2026-09-29T07:34:06.000Z",
        fetchAfterUpdatedAt: expect.any(String),
        fetchAfterReason: "provider_window_complete",
      })
      expect(settings.scenarioId).toBe(SCENARIO)
    })
  })

  describe("a scheduled Google Alerts run", () => {
    const FEED_URL = "https://www.google.com/alerts/feeds/11111111111111111111/22222222222222222222"
    const OLDER = { url: "https://report.az/biznes/araz-supermarket-older", updated: "2026-09-28T15:33:34.000Z" }
    const NEWER = { url: "https://report.az/biznes/araz-supermarket-newer", updated: "2026-09-29T07:34:06.000Z" }
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom">${[OLDER, NEWER].map((entry) => `
      <entry>
        <title>Araz Supermarket</title>
        <link href="${entry.url}" rel="alternate"/>
        <updated>${entry.updated}</updated>
      </entry>`).join("")}
    </feed>`

    it("stores its checkpoint, so the next run opens only what the feed delivered since", async () => {
      const { runGoogleAlertsRssCollector } = await import("@/lib/social/google-alerts-rss-adapter")
      const { encryptToken } = await import("@/lib/secure-token")
      const sourceId = await seedSource(sourceSettings({
        googleAlertsRss: {
          configured: true,
          encryptedFeedUrl: encryptToken(FEED_URL, `google-alerts-rss:${ORG}:${SCENARIO}`),
          fingerprint: "test-fingerprint",
          accountSuffix: "1111",
          alertSuffix: "2222",
        },
      }))
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      const fetchArticle = vi.fn(async (url: string) => ({
        url,
        publisherName: "Report.az",
        publisherDomain: "report.az",
        headline: "Araz Supermarket xəbəri",
        description: null,
        authorName: null,
        imageUrl: null,
        publishedAt: new Date(url === OLDER.url ? OLDER.updated : NEWER.updated),
        matchedCorpus: "Araz Supermarket xəbəri",
      }))

      /** One scheduled run, on the source as it is stored now. */
      async function scheduledRun() {
        const source = await bypass(() => prisma.monitoringSource.findUniqueOrThrow({ where: { id: sourceId } }))
        return asTenant(ORG, () => runGoogleAlertsRssCollector({
          ...source,
          // A scheduled run names no target scenario and no archive start;
          // see the routeExecution built in monitoring-collector.ts.
          routeExecution: {
            collectorRunId: "collector-run",
            routePlanId: ROUTE_PLAN,
            capability: "DISCOVER_POSTS",
            adapterKey: ADAPTER,
            acquisitionMode: "NOTIFICATION_INBOX",
            maxItems: 50,
            fullArchiveRun: false,
          },
        } as never, {
          fetchImpl: (async () => new Response(feed, {
            status: 200,
            headers: { "content-type": "application/atom+xml" },
          })) as unknown as typeof fetch,
          fetchArticle: fetchArticle as never,
          // Whether the article becomes a mention is decided elsewhere.
          ingest: (async () => ({ id: "unused", created: false, accepted: false })) as never,
        }))
      }

      const first = await scheduledRun()
      expect(first.rawStats).toMatchObject({
        entryCount: 2,
        feedCheckpointAt: null,
        checkpointAdvanced: true,
        nextFeedCheckpointAt: NEWER.updated,
      })
      expect(fetchArticle.mock.calls.map(([url]) => url).sort()).toEqual([NEWER.url, OLDER.url])
      expect((await storedSettings(sourceId)).searchIndex.routeProviderCursors[SCHEDULED_KEY]).toMatchObject({
        fetchAfter: NEWER.updated,
        reason: "google_alerts_rss_feed_complete",
        targetScenarioId: null,
        archiveStartAt: ARCHIVE_START,
      })

      // The feed has not changed. The older entry is behind the checkpoint;
      // the newest one sits on it and is re-read inside the five-minute overlap.
      fetchArticle.mockClear()
      const second = await scheduledRun()
      expect(second.rawStats).toMatchObject({
        entryCount: 1,
        deliveredEntryCount: 2,
        checkpointFilteredCount: 1,
        feedCheckpointAt: NEWER.updated,
      })
      expect(fetchArticle.mock.calls.map(([url]) => url)).toEqual([NEWER.url])
      expect(errors.mock.calls).toEqual([])
    })
  })
})
