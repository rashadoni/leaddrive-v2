/**
 * TikTok Lead Ads deliveries and the CRM leads they create, on a real Postgres
 * with the production row-level security and a small connection pool.
 *
 * Found on 2026-10-18 while the WhatsApp intake (#896) was fixed: a delivery
 * waited for its lock while holding a pooled connection, and the delivery
 * holding the lock needed one more for its work. With as many simultaneous
 * deliveries as the pool has connections, nothing could move until the pool
 * timeout (`Timed out fetching a new connection from the connection pool`) —
 * on production that pool is the whole application's. The webhook did it
 * twice over: the social-monitoring fence around a request is such a lock
 * (one per organization), and inside it each event took its own lock in a
 * second transaction.
 *
 * The real route runs against a scratch database built from schema.prisma.
 * Every tenant table gets the production `tenant_isolation` policy
 * (scripts/rls/enable-batch-*.sql) except the ones production still leaves
 * without RLS, and the application connects as a role the policies apply to.
 * The pool is three connections with a five-second timeout, so a request that
 * holds a connection while it needs another stalls on every machine, not only
 * on a 2-core runner (whose default pool is 5), and fails fast. Only outbound
 * side effects (workflows, webhooks, notifications, fetch) are stubbed.
 *
 * Set TIKTOK_LEAD_AD_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   TIKTOK_LEAD_AD_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («TikTok lead ad lock database gate»), where
 * `TIKTOK_LEAD_AD_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PrismaClient, type Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.TIKTOK_LEAD_AD_TEST_DATABASE_URL
if (!adminUrl && process.env.TIKTOK_LEAD_AD_DB_GATE === "required") {
  throw new Error("TIKTOK_LEAD_AD_TEST_DATABASE_URL is required by the TikTok lead ad lock database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.TIKTOK_LEAD_AD_TEST_DATABASE_URL
  if (!admin) return null
  const name = `tiktok_lead_ad_${process.pid}`
  const role = `tiktok_lead_ad_app_${process.pid}`
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
  const directory = mkdtempSync(path.join(tmpdir(), "tiktok-lead-ad-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** Two organizations collecting social monitoring, and one whose clean-slate reset has closed it. */
const ORGS = {
  open: { id: "org-tt", token: "tt-secret-open", settings: {} },
  second: { id: "org-tt-2", token: "tt-secret-second", settings: {} },
  closed: {
    id: "org-tt-closed",
    token: "tt-secret-closed",
    settings: { socialMonitoringCleanSlate: { collectionBlocked: true } },
  },
} as const
type OrgName = keyof typeof ORGS

/** The lock the webhook takes for one TikTok lead of one organization. */
const leadLockKey = (organizationId: string, tiktokLeadId: string) =>
  `tiktok-business-lead-ad:${organizationId}:${tiktokLeadId}`

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("TikTok Lead Ads deliveries on a real Postgres with RLS and a small pool", () => {
  type AppPrisma = typeof import("@/lib/prisma").prisma
  let prisma!: AppPrisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let POST!: typeof import("@/app/api/v1/webhooks/tiktok-business/route").POST

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
    POST = (await import("@/app/api/v1/webhooks/tiktok-business/route")).POST

    for (const org of Object.values(ORGS)) {
      await bypass(() => prisma.organization.create({
        data: { id: org.id, name: `Tenant ${org.id}`, slug: org.id, settings: org.settings },
      }))
      await bypass(() => prisma.channelConnection.create({
        data: {
          organizationId: org.id,
          platform: "tiktok",
          surface: "lead_ad",
          provider: "tiktok_business",
          displayName: "TikTok Lead Ads",
          status: "connected",
          capabilities: { read: true, reply: false, webhook: true, importLead: true },
          settings: { webhookSecret: org.token },
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

  /** TikTok delivers one Lead Ads form submission to the organization's webhook. */
  async function tiktokDelivers(org: OrgName, tiktokLeadId: string) {
    const response = await POST(new NextRequest(
      `http://localhost/api/v1/webhooks/tiktok-business?token=${ORGS[org].token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "lead.created",
          data: {
            lead_id: tiktokLeadId,
            form_id: "form-1",
            campaign_id: "campaign-1",
            fields: [{ name: "full_name", value: `Customer ${tiktokLeadId}` }],
          },
        }),
      },
    ))
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { results: Array<{ leadId: string; status: string }> } }
    expect(body.data.results).toHaveLength(1)
    return body.data.results[0]
  }

  /** The CRM leads the webhook created for one TikTok lead, as the tables hold them. */
  async function leadsFor(org: OrgName, tiktokLeadId: string) {
    return bypass(() => prisma.lead.findMany({
      where: {
        organizationId: ORGS[org].id,
        source: "tiktok:lead_ad",
        scoreDetails: { path: ["tiktokLeadId"], equals: tiktokLeadId },
      },
      select: { id: true },
    }))
  }

  async function mentionFor(org: OrgName, tiktokLeadId: string) {
    return bypass(() => prisma.socialMention.findUnique({
      where: {
        organizationId_platform_externalId: {
          organizationId: ORGS[org].id,
          platform: "tiktok",
          externalId: `tiktok_business:lead_ad:${tiktokLeadId}`,
        },
      },
      select: { leadId: true },
    }))
  }

  async function expectOneLeadFromEightDeliveries(org: OrgName, tiktokLeadId: string) {
    const results = await Promise.all(Array.from({ length: 8 }, () => tiktokDelivers(org, tiktokLeadId)))

    const leads = await leadsFor(org, tiktokLeadId)
    expect(leads).toHaveLength(1)
    expect(results.filter((r) => r.status === "lead_created")).toHaveLength(1)
    expect(results.filter((r) => r.status === "already_linked")).toHaveLength(7)
    expect(new Set(results.map((r) => r.leadId))).toEqual(new Set([leads[0].id]))
    return leads[0]
  }

  /** Each test has TikTok lead ids of its own, so nothing is cleaned up between them. */
  async function expectEveryLeadOfABurstOnce(burst: string, orgs: OrgName[]) {
    const deliveries = Array.from({ length: 10 }, (_, i) => ({ org: orgs[i % orgs.length], tiktokLeadId: `${burst}-${i}` }))

    const results = await Promise.all(deliveries.map(({ org, tiktokLeadId }) => tiktokDelivers(org, tiktokLeadId)))

    expect(results.map((r) => r.status)).toEqual(deliveries.map(() => "lead_created"))
    for (const [i, { org, tiktokLeadId }] of deliveries.entries()) {
      expect(await leadsFor(org, tiktokLeadId)).toEqual([{ id: results[i].leadId }])
    }
  }

  it("creates one lead, not several, for eight deliveries of the same TikTok lead at once", async () => {
    const lead = await expectOneLeadFromEightDeliveries("open", "tt-lead-1")

    expect(await mentionFor("open", "tt-lead-1")).toEqual({ leadId: lead.id })
  }, 60_000)

  it("creates every lead of a burst of ten different TikTok leads, without running the pool dry", async () => {
    await expectEveryLeadOfABurstOnce("tt-burst", ["open"])
  }, 60_000)

  it("creates every lead when two organizations get their bursts at the same moment", async () => {
    await expectEveryLeadOfABurstOnce("tt-two-orgs", ["open", "second"])
  }, 60_000)

  it("with social monitoring closed by a clean-slate reset, still creates each lead once and mirrors none", async () => {
    await expectOneLeadFromEightDeliveries("closed", "tt-lead-closed")
    await expectEveryLeadOfABurstOnce("tt-burst-closed", ["closed"])

    expect(await mentionFor("closed", "tt-lead-closed")).toBeNull()
  }, 120_000)

  for (const org of ["open", "closed"] as const) {
    it(`waits for another process that is creating the same TikTok lead, and links to its lead (${org} monitoring)`, async () => {
      const tiktokLeadId = `tt-other-process-${org}`
      const otherProcess = new PrismaClient<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminDbUrl })
      let release!: () => void
      const released = new Promise<void>((resolve) => { release = resolve })
      let holding!: () => void
      const held = new Promise<void>((resolve) => { holding = resolve })
      try {
        // The other process holds the lead's lock and has created its lead, not yet committed.
        const other = otherProcess.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${leadLockKey(ORGS[org].id, tiktokLeadId)}, 0))`
          await tx.lead.create({
            data: {
              id: `lead-other-process-${org}`,
              organizationId: ORGS[org].id,
              contactName: "From the other process",
              source: "tiktok:lead_ad",
              status: "new",
              priority: "medium",
              scoreDetails: { tiktokLeadId },
            },
          })
          holding()
          await released
        }, { timeout: 30_000 })
        await held

        let finished = false
        const ours = tiktokDelivers(org, tiktokLeadId).finally(() => { finished = true })
        await new Promise((resolve) => setTimeout(resolve, 700))
        expect(finished).toBe(false)

        release()
        await other
        expect(await ours).toEqual(expect.objectContaining({ leadId: `lead-other-process-${org}`, status: "already_linked" }))
        expect(await leadsFor(org, tiktokLeadId)).toEqual([{ id: `lead-other-process-${org}` }])
      } finally {
        release()
        await otherProcess.$disconnect()
      }
    }, 30_000)
  }
})
