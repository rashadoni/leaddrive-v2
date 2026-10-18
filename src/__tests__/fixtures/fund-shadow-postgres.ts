/** Shared synthetic PostgreSQL fixture. No production or environment fallback. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { PrismaClient, type Prisma } from "@prisma/client"
import type { KafkaEventRecord } from "../../lib/event-platform/consumer"
import type { FundShadowDatabase, FundShadowScope, FundShadowTransaction } from "../../lib/event-platform/fund-shadow-consumer"

export type FundShadowContext = {
  scope: FundShadowScope
  client: PrismaClient
  records: KafkaEventRecord[]
  fundId: string
}
export type FundShadowExecuteFailure = { readonly query: string; readonly values: readonly unknown[]; readonly error: unknown }
export interface FundShadowDatabaseHooks {
  afterQuery?: (query: string, tx: FundShadowTransaction) => Promise<void>
  afterExecute?: (query: string, tx: FundShadowTransaction) => Promise<void>
  onExecuteError?: (receipt: FundShadowExecuteFailure) => void
  beforeCommit?: (tx: FundShadowTransaction) => Promise<void>
  /** Runs only after Prisma's actual COMMIT, outside its transaction timeout. */
  afterCommit?: () => Promise<void>
}

/** Instrumentation never replaces Prisma's real COMMIT/ROLLBACK ownership. */
export function fundShadowDatabase(client: PrismaClient, hooks?: FundShadowDatabaseHooks): FundShadowDatabase {
  return {
    async $transaction(work, options) {
      const result = await client.$transaction(async real => {
        const tx: FundShadowTransaction = {
          $queryRawUnsafe: async <T>(query: string, ...values: unknown[]) => {
            const value = await real.$queryRawUnsafe<T>(query, ...values)
            await hooks?.afterQuery?.(query, tx)
            return value
          },
          $executeRawUnsafe: async (query, ...values) => {
            let count: number
            try { count = await real.$executeRawUnsafe(query, ...values) }
            catch (error) {
              // Observe the exact SQL rejection, not an afterExecute injection.
              hooks?.onExecuteError?.({ query, values, error })
              throw error
            }
            await hooks?.afterExecute?.(query, tx)
            return count
          },
        }
        const value = await work(tx)
        await hooks?.beforeCommit?.(tx)
        return value
      }, options)
      // In particular, a takeover drill must hold here, NOT keep a 15s SQL
      // transaction open for the broker's 30s maximum poll interval.
      await hooks?.afterCommit?.()
      return result
    },
  }
}

function checkedAdmin(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !/^[1-9][0-9]*$/.test(url.port)
    || url.username !== "postgres" || url.password !== "postgres" || url.pathname !== "/event_platform_test"
    || url.search !== "" || url.hash !== "") {
    throw new Error("Fund shadow integration requires the exact disposable loopback CI service contract")
  }
  return url
}

/**
 * Requires the existing migration gate's event_app/event_migrator bootstrap.
 * This fixture never creates, replaces or drops those shared roles. Its own
 * exactly named database and restricted worker roles are the only drop targets.
 */
export function createFundShadowPostgresFixture(input: { adminUrl: string; environment: "test" | "testbroker"; codeSha?: string }) {
  const base = checkedAdmin(input.adminUrl)
  assert.ok(input.environment === "test" || input.environment === "testbroker", "synthetic Fund environment required")
  const environment = input.environment, topic = `ld.${environment}.finance.events.v1`
  const suffix = `${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`
  const databaseName = `ld_fund_shadow_${suffix}`
  const codeSha = input.codeSha ?? "f".repeat(40), password = "synthetic-shadow-fixture-only"
  assert.match(codeSha, /^[0-9a-f]{40}$/, "synthetic fixture release SHA required")
  let admin: PrismaClient | undefined, scratch: PrismaClient | undefined
  let created = false, counter = 0
  let state: "new" | "starting" | "ready" | "closing" | "closed" = "new"
  let closing: Promise<void> | undefined
  const clients = new Set<PrismaClient>()
  const workerRoles = new Set<string>()
  const sourceFunds = new Map<string, string>()
  const contexts = new Map<FundShadowContext, { role: string; clients: Set<PrismaClient>; closed: boolean }>()

  function clientFor(url: URL): PrismaClient {
    const boundedUrl = new URL(url)
    boundedUrl.searchParams.set("connection_limit", "1")
    boundedUrl.searchParams.set("connect_timeout", "5")
    boundedUrl.searchParams.set("pool_timeout", "5")
    const client: PrismaClient = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: boundedUrl.toString() } } })
    clients.add(client)
    return client
  }
  function scratchUrl() {
    const url = new URL(base)
    url.pathname = `/${databaseName}`
    return url
  }
  function sqlAt(url: URL, source: string) {
    const result = spawnSync("node_modules/.bin/prisma", ["db", "execute", "--url", url.toString(), "--stdin"], {
      input: source, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    })
    if (result.status !== 0) throw new Error("Disposable Fund fixture SQL failed")
  }
  function active(): PrismaClient {
    if (state !== "ready" || !scratch || !created) throw new Error("Disposable Fund fixture is not ready")
    return scratch
  }
  async function disconnect(selected: Iterable<PrismaClient>) {
    const outcomes = await Promise.allSettled([...selected].map(async client => {
      await client.$disconnect()
      clients.delete(client)
    }))
    if (outcomes.some(outcome => outcome.status === "rejected")) throw new Error("Disposable Fund client cleanup failed")
  }
  function close(): Promise<void> {
    if (!closing) {
      state = "closing"
      closing = (async () => {
        let failed = false
        try { await disconnect([...clients].filter(client => client !== admin)) } catch { failed = true }
        // No DROP IF EXISTS, FORCE or broad cleanup. A failed CREATE never
        // authorizes dropping a pre-existing database with the same name.
        if (created && admin) {
          try { await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`); created = false }
          catch { failed = true }
        }
        // Worker roles depend on this database's policies/grants. If DROP
        // failed, retain them rather than performing wider privilege cleanup.
        if (!created && admin) {
          for (const role of workerRoles) {
            try { await admin.$executeRawUnsafe(`DROP ROLE "${role}"`); workerRoles.delete(role) }
            catch { failed = true }
          }
        }
        try { if (admin) await disconnect([admin]) } catch { failed = true }
        state = "closed"
        if (failed) throw new Error("Disposable Fund fixture cleanup failed")
      })()
    }
    return closing
  }
  async function setup() {
    if (state !== "new") throw new Error("Disposable Fund fixture setup may run only once")
    state = "starting"
    try {
      admin = clientFor(base)
      const roles = await admin.$queryRawUnsafe<Array<{ rolname: string }>>(`SELECT rolname FROM pg_catalog.pg_roles
        WHERE rolname IN ('event_app', 'event_migrator') ORDER BY rolname`)
      if (roles.length !== 2 || roles[0].rolname !== "event_app" || roles[1].rolname !== "event_migrator") {
        throw new Error("Disposable Fund fixture requires the event-platform migration role bootstrap")
      }
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
      created = true
      scratch = clientFor(scratchUrl())
      const target = scratchUrl()
      sqlAt(target, `GRANT CREATE ON DATABASE "${databaseName}" TO event_migrator;
        GRANT USAGE, CREATE ON SCHEMA public TO event_app, event_migrator;`)
      target.username = "event_app"; target.password = "event-app-password"
      sqlAt(target, readFileSync("scripts/ci/fixtures/fund-shadow/base.sql", "utf8"))
      target.username = "event_migrator"; target.password = "event-migrator-password"
      for (const migration of ["20260901090000_event_platform_foundation", "20260901100000_fund_event_source_pilot", "20260906120000_projection_replay_control_plane"]) {
        sqlAt(target, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
      }
      // Legacy anchors omit funds RLS; retain the exact tenant predicate and
      // add the independent per-login restrictions during newBuild below.
      sqlAt(scratchUrl(), `ALTER TABLE funds ENABLE ROW LEVEL SECURITY;
        ALTER TABLE funds FORCE ROW LEVEL SECURITY;
        CREATE POLICY shadow_fixture_tenant ON funds USING ("organizationId" = current_setting('app.org_id', true))
          WITH CHECK ("organizationId" = current_setting('app.org_id', true));`)
      state = "ready"
    } catch (error) { await close(); throw error }
  }

  async function newBuild(organizationId: string, fundId: string, records: KafkaEventRecord[]): Promise<FundShadowContext> {
    const db = active()
    // Policy SQL interpolates only identities generated by this fixture, not
    // caller headers or arbitrary tenant input accepted by a reusable helper.
    if (sourceFunds.get(organizationId) !== fundId) throw new Error("Fund build must reference this fixture's generated source")
    const number = ++counter, buildId = randomUUID(), buildKey = `shadow-${number}`
    const role = `ld_fund_shadow_${suffix}_${number}`
    const scope: FundShadowScope = { organizationId, buildId, buildKey, projectionVersion: 2, codeSha,
      environment, expectedWorkerRole: role }
    await db.$executeRawUnsafe(`INSERT INTO projection_builds
      (id, "organizationId", "projectionName", "projectionVersion", "buildKey", "codeSha", mode)
      VALUES ($1::uuid, $2, 'finance.fund-balance', 2, $3, $4, 'shadow')`, buildId, organizationId, buildKey, codeSha)
    await db.$executeRawUnsafe(`UPDATE projection_builds SET status = 'running', "startedAt" = CURRENT_TIMESTAMP WHERE id = $1::uuid`, buildId)
    // Track ownership immediately after CREATE, before any later grant/policy
    // can fail. Do not reuse a role or drop an unconfirmed creation.
    await db.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`)
    workerRoles.add(role)
    sqlAt(scratchUrl(), `
      GRANT CONNECT ON DATABASE "${databaseName}" TO "${role}";
      GRANT USAGE ON SCHEMA public TO "${role}";
      GRANT SELECT ON event_outbox, event_aggregate_heads, funds, domain_events,
        fund_balance_projections, projection_builds, projection_checkpoints, consumer_inbox TO "${role}";
      GRANT INSERT ON fund_balance_projections, projection_checkpoints, consumer_inbox TO "${role}";
      GRANT UPDATE (balance, currency, "aggregateVersion", "lastEventId", evidence) ON fund_balance_projections TO "${role}";
      GRANT UPDATE ("sourceOffset", "lastEventId", "updatedAt") ON projection_checkpoints TO "${role}";
      GRANT UPDATE ("createdAt") ON projection_builds TO "${role}";
    `)
    for (const table of ["event_outbox", "event_aggregate_heads", "funds", "domain_events"]) {
      await db.$executeRawUnsafe(`CREATE POLICY "${role}" ON "${table}" AS RESTRICTIVE TO "${role}"
        USING ("organizationId" = '${organizationId}') WITH CHECK ("organizationId" = '${organizationId}')`)
    }
    const boundaries: Record<string, string> = {
      projection_builds: `"organizationId" = '${organizationId}' AND id = '${buildId}'::uuid`,
      projection_checkpoints: `"organizationId" = '${organizationId}' AND "buildId" = '${buildId}'::uuid`,
      consumer_inbox: `"organizationId" = '${organizationId}' AND "consumerName" = 'fund-shadow:${buildId}' AND "consumerVersion" = 1`,
    }
    for (const [table, boundary] of Object.entries(boundaries)) {
      await db.$executeRawUnsafe(`CREATE POLICY "${role}" ON "${table}" AS RESTRICTIVE TO "${role}"
        USING (${boundary}) WITH CHECK (${boundary})`)
    }
    const shadow = `"organizationId" = '${organizationId}' AND status = 'shadow' AND "projectionVersion" = 2 AND "buildKey" = '${buildKey}'`
    await db.$executeRawUnsafe(`CREATE POLICY "${role}_read" ON fund_balance_projections AS RESTRICTIVE FOR SELECT TO "${role}"
      USING ((${shadow}) OR ("organizationId" = '${organizationId}' AND status = 'active' AND "projectionVersion" = 1))`)
    await db.$executeRawUnsafe(`CREATE POLICY "${role}_insert" ON fund_balance_projections AS RESTRICTIVE FOR INSERT TO "${role}" WITH CHECK (${shadow})`)
    await db.$executeRawUnsafe(`CREATE POLICY "${role}_update" ON fund_balance_projections AS RESTRICTIVE FOR UPDATE TO "${role}"
      USING (${shadow}) WITH CHECK (${shadow})`)
    const url = scratchUrl(); url.username = role; url.password = password
    const client = clientFor(url), context = { scope, client, records, fundId }
    contexts.set(context, { role, clients: new Set([client]), closed: false })
    return context
  }

  async function fixture(): Promise<FundShadowContext> {
    const db = active(), organizationId = `shadow-org-${randomUUID()}`, fundId = `shadow-fund-${randomUUID()}`
    await db.$executeRawUnsafe(`INSERT INTO organizations (id, name) VALUES ($1, 'synthetic Fund shadow tenant')`, organizationId)
    await db.$executeRawUnsafe(`INSERT INTO funds (id, "organizationId", name, currency, "currentBalance") VALUES ($1, $2, 'Synthetic Fund', 'USD', 0.0000)`, fundId, organizationId)
    for (const [type, amount] of [["deposit", "10.1234"], ["withdrawal", "0.1234"]]) {
      // INSERT-first compatibility route: the real deferred source guard
      // requires both ledger insertion and its matching balance update.
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`INSERT INTO fund_transactions (id, "organizationId", "fundId", type, amount) VALUES ($1, $2, $3, $4, $5::numeric)`,
        randomUUID(), organizationId, fundId, type, amount)
        const changed = await tx.$executeRawUnsafe(`UPDATE funds SET "currentBalance" = "currentBalance" + $3::numeric
          WHERE id = $1 AND "organizationId" = $2 AND ($3::numeric >= 0 OR "currentBalance" >= -$3::numeric)`,
        fundId, organizationId, type === "deposit" ? amount : `-${amount}`)
        assert.equal(changed, 1)
      })
    }
    await db.$executeRawUnsafe(`UPDATE funds SET name = 'Synthetic renamed' WHERE id = $1`, fundId)
    await db.$executeRawUnsafe(`UPDATE funds SET "isActive" = false WHERE id = $1`, fundId)
    await db.$executeRawUnsafe(`UPDATE funds SET "isActive" = true WHERE id = $1`, fundId)
    const outbox = await db.$queryRawUnsafe<Array<{ value: string; hash: string; key: string; eventId: string; eventType: string }>>(`
      SELECT o.envelope::text AS value, o."payloadHash" AS hash, o."partitionKey" AS key, o."eventId"::text AS "eventId", o."eventType"
      FROM event_outbox o JOIN domain_events e ON e.id = o."eventId" AND e."organizationId" = o."organizationId"
      WHERE o."organizationId" = $1 ORDER BY e."aggregateVersion"`, organizationId)
    assert.equal(outbox.length, 6)
    // Preserve the immutable PostgreSQL outbox bytes/hash. These legacy
    // synthetic positions are replaced with actual broker offsets ONLY by
    // the combined harness after producing these same key/value/header bytes.
    const records = outbox.map((row, index): KafkaEventRecord => ({ topic, partition: 0, offset: String(index * 2 + 10), key: row.key,
      value: row.value, headers: { id: row.eventId, eventtype: row.eventType, organizationid: organizationId, payloadhash: row.hash } }))
    sourceFunds.set(organizationId, fundId)
    return newBuild(organizationId, fundId, records)
  }
  async function snapshotSource(organizationId: string) {
    return active().$queryRawUnsafe(`SELECT jsonb_build_object(
      'funds', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM funds x WHERE "organizationId" = $1),
      'ledger', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM fund_transactions x WHERE "organizationId" = $1),
      'events', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM domain_events x WHERE "organizationId" = $1),
      'outbox', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM event_outbox x WHERE "organizationId" = $1),
      'heads', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM event_aggregate_heads x WHERE "organizationId" = $1),
      'active', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM fund_balance_projections x WHERE "organizationId" = $1 AND status = 'active'),
      'pointers', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM projection_activations x WHERE "organizationId" = $1),
      'promotions', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM projection_promotion_events x WHERE "organizationId" = $1),
      'effects', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM effect_outbox x WHERE "organizationId" = $1)
    ) AS source`, organizationId)
  }
  async function counts(context: FundShadowContext) {
    if (!contexts.has(context)) throw new Error("Fund context belongs to a different fixture")
    const [row] = await active().$queryRawUnsafe<Array<{ shadows: number; inbox: number; checkpoints: number }>>(`SELECT
      (SELECT count(*)::int FROM fund_balance_projections WHERE "organizationId" = $1 AND "buildKey" = $2) AS shadows,
      (SELECT count(*)::int FROM consumer_inbox WHERE "organizationId" = $1 AND "consumerName" = $3) AS inbox,
      (SELECT count(*)::int FROM projection_checkpoints WHERE "organizationId" = $1 AND "buildId" = $4::uuid) AS checkpoints`,
    context.scope.organizationId, context.scope.buildKey, `fund-shadow:${context.scope.buildId}`, context.scope.buildId)
    return row
  }
  function connect(context?: FundShadowContext): PrismaClient {
    active()
    const url = scratchUrl()
    if (!context) return clientFor(url)
    const owned = contexts.get(context)
    if (!owned || owned.closed) throw new Error("Restricted Fund connection requires an active owned context")
    url.username = owned.role; url.password = password
    const client = clientFor(url); owned.clients.add(client)
    return client
  }
  async function closeContext(context: FundShadowContext) {
    active()
    const owned = contexts.get(context)
    if (!owned) throw new Error("Fund context belongs to a different fixture")
    if (owned.closed) return
    await disconnect(owned.clients)
    owned.closed = true
  }
  return { setup, close, fixture, newBuild, snapshotSource, counts, connect, closeContext,
    sql(source: string) { active(); sqlAt(scratchUrl(), source) },
    get scratch() { return active() }, get topic() { return topic } }
}
