import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { KafkaEventRecord } from "@/lib/event-platform/consumer"
import {
  consumeFundShadowRecord,
  type FundShadowDatabase,
  type FundShadowScope,
  type FundShadowTransaction,
} from "@/lib/event-platform/fund-shadow-consumer"

// No production access. The dedicated CI step must follow the existing real
// migration gate (which creates the synthetic event_app/event_migrator roles).
// A separate, exactly named disposable database receives the ACTUAL three
// migrations. No full schema db-push or mocked transaction is used here.
const adminUrl = process.env.FUND_SHADOW_TEST_DATABASE_URL
if (!adminUrl && process.env.FUND_SHADOW_DB_GATE === "required") {
  throw new Error("FUND_SHADOW_TEST_DATABASE_URL is required by the Fund shadow database gate")
}
const pgDescribe = adminUrl ? describe : describe.skip
const databaseName = `ld_fund_shadow_${process.pid}`
const codeSha = "f".repeat(40)
const topic = "ld.test.finance.events.v1"
const password = "synthetic-shadow-fixture-only"
type Client = PrismaClient
type Context = { scope: FundShadowScope; client: Client; records: KafkaEventRecord[]; fundId: string }
let admin: Client
let scratch: Client
let created = false
let counter = 0
const clients: Client[] = []
const workerRoles: string[] = []

function checkedAdmin(): URL {
  const url = new URL(adminUrl!)
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !/^[1-9][0-9]*$/.test(url.port)
    || url.username !== "postgres" || url.password !== "postgres" || url.pathname !== "/event_platform_test"
    || url.search !== "" || url.hash !== "") {
    throw new Error("Fund shadow integration requires the exact disposable loopback CI service contract")
  }
  return url
}

function clientFor(url: URL): Client {
  const client: Client = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: url.toString() } } })
  clients.push(client)
  return client
}

function sql(url: URL, source: string): void {
  const result = spawnSync("node_modules/.bin/prisma", ["db", "execute", "--url", url.toString(), "--stdin"], {
    input: source, encoding: "utf8", timeout: 30_000,
  })
  if (result.status !== 0) throw new Error(`Disposable Fund fixture SQL failed: ${result.error ?? result.stderr}`)
}

// Optional instrumentation injects a failure AFTER real SQL or just before
// the real COMMIT. The enclosing Prisma factory still owns COMMIT/ROLLBACK.
function database(client: Client, input?: {
  afterQuery?: (query: string, tx: FundShadowTransaction) => Promise<void>
  afterExecute?: (query: string, tx: FundShadowTransaction) => Promise<void>
  onExecuteError?: (receipt: ExecuteFailure) => void
  beforeCommit?: (tx: FundShadowTransaction) => Promise<void>
}): FundShadowDatabase {
  return {
    $transaction: (work, options) => client.$transaction(async real => {
      const tx: FundShadowTransaction = {
        $queryRawUnsafe: async <T>(query: string, ...values: unknown[]) => {
          const result = await real.$queryRawUnsafe<T>(query, ...values)
          await input?.afterQuery?.(query, tx)
          return result
        },
        $executeRawUnsafe: async (query, ...values) => {
          let count: number
          try {
            count = await real.$executeRawUnsafe(query, ...values)
          } catch (error) {
            // Observe only an actual SQL rejection, not afterExecute injection.
            // Preserve the original error; Prisma still rolls the factory back.
            input?.onExecuteError?.({ query, values, error })
            throw error
          }
          await input?.afterExecute?.(query, tx)
          return count
        },
      }
      const result = await work(tx)
      await input?.beforeCommit?.(tx)
      return result
    }, options),
  }
}

function at(record: KafkaEventRecord, offset: number): KafkaEventRecord {
  return { ...record, offset: String(offset) }
}

async function snapshotSource(organizationId: string) {
  return scratch.$queryRawUnsafe(`SELECT jsonb_build_object(
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

async function counts(context: Context) {
  const [row] = await scratch.$queryRawUnsafe<Array<{ shadows: number; inbox: number; checkpoints: number }>>(`SELECT
    (SELECT count(*)::int FROM fund_balance_projections WHERE "organizationId" = $1 AND "buildKey" = $2) AS shadows,
    (SELECT count(*)::int FROM consumer_inbox WHERE "organizationId" = $1 AND "consumerName" = $3) AS inbox,
    (SELECT count(*)::int FROM projection_checkpoints WHERE "organizationId" = $1 AND "buildId" = $4::uuid) AS checkpoints`,
  context.scope.organizationId, context.scope.buildKey, `fund-shadow:${context.scope.buildId}`, context.scope.buildId)
  return row
}

const permissionDenied = { code: "P2010", meta: { code: "42501" } }
type ExecuteFailure = { readonly query: string; readonly values: readonly unknown[]; readonly error: unknown }
type ShadowInsertKey = readonly [organizationId: string, fundId: string, projectionVersion: number, buildKey: string, eventId: string]

function matchesShadowInsert(receipt: ExecuteFailure | undefined, key: ShadowInsertKey | undefined): boolean {
  return !!receipt && !!key && receipt.values.length === 9
    && /^\/\* fund-shadow:insert-shadow \*\/\s+INSERT INTO public\.fund_balance_projections \("organizationId", "fundId", "projectionVersion", "buildKey", status,/.test(receipt.query)
    && key.slice(0, 4).every((value, i) => receipt.values[i] === value)
    && receipt.values[7] === key[4]
}

// Print only allowlisted structural facts, never raw SQL, key values, unknown
// metadata, connection strings or error messages, even for a failed assertion.
function concurrentAbortShape(error: unknown) {
  const typed = (error && typeof error === "object" ? error : {}) as {
    code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown; target?: unknown }
  }
  const safeCode = (value: unknown) => typeof value === "string" && /^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(value) ? value : "unknown"
  const top = typeof typed.message === "string" ? typed.message : ""
  const meta = typeof typed.meta?.message === "string" ? typed.meta.message : ""
  const target = typed.meta?.target
  const fields = ["organizationId", "fundId", "projectionVersion", "buildKey"]
  return {
    prismaCode: safeCode(typed.code), sqlState: safeCode(typed.meta?.code),
    metaMessagePresent: meta.length > 0,
    exactConstraintInTop: top.includes('"fund_balance_projections_build_key"'),
    exactConstraintInMeta: meta.includes('"fund_balance_projections_build_key"'),
    uniqueViolationInMeta: meta.includes("duplicate key value violates unique constraint"),
    keyExistsInMeta: meta.includes(" already exists"),
    exactKeyFieldsInMeta: /Key \("?organizationId"?, "?fundId"?, "?projectionVersion"?, "?buildKey"?\)=/.test(meta),
    targetIsFieldList: Array.isArray(target),
    targetIsExactKeyFields: Array.isArray(target) && target.length === fields.length && fields.every((field, i) => target[i] === field),
    targetIsExactConstraint: target === "fund_balance_projections_build_key",
  }
}

function isExpectedConcurrentAbort(error: unknown, receipt?: ExecuteFailure, key?: ShadowInsertKey): boolean {
  if (!error || typeof error !== "object") return false
  const typed = error as { code?: string; meta?: { code?: string } }
  // Prisma may surface serialization failures directly as P2034 or wrap the
  // PostgreSQL SQLSTATE from a raw query. Only the adapter's bounded lock wait
  // (55P03) or a real, exactly scoped competing shadow INSERT is an alternative.
  // Actual Prisma6.19.2 preserves23505 but loses constraint/detail metadata.
  // Do not guess it from a message: require the original error captured at
  // the real INSERT, its exact key/event parameters, a coherent committed
  // winner, and then a successful whole-factory duplicate retry below.
  const shadowInsertConflict = typed.meta?.code === "23505" && receipt?.error === error && matchesShadowInsert(receipt, key)
  return typed.code === "P2034" || (typed.code === "P2010"
    && (["40001", "55P03"].includes(typed.meta?.code ?? "") || shadowInsertConflict))
}

describe("Fund concurrency test's narrow abort classification", () => {
  it("never leaks error text, target values, SQL or credentials through its diagnostic", () => {
    const secret = "synthetic-credential-not-for-output"
    const result = concurrentAbortShape({ code: secret, message: secret, meta: { code: secret, message: secret, target: [secret] } })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result).toMatchObject({ prismaCode: "unknown", sqlState: "unknown", exactConstraintInMeta: false, targetIsExactKeyFields: false })
  })

  it("never treats an unobserved, unrelated or differently scoped SQL/unique error as a competing shadow INSERT", () => {
    const error = { code: "P2010", meta: { code: "23505" } }
    const key: ShadowInsertKey = ["tenant", "fund", 2, "build", "event"]
    const receipt: ExecuteFailure = {
      error,
      query: '/* fund-shadow:insert-shadow */\n INSERT INTO public.fund_balance_projections ("organizationId", "fundId", "projectionVersion", "buildKey", status, balance)',
      values: ["tenant", "fund", 2, "build", "0.0000", "USD", "1", "event", "{}"],
    }
    expect(isExpectedConcurrentAbort(error, receipt, key)).toBe(true)
    expect(isExpectedConcurrentAbort(error)).toBe(false)
    expect(isExpectedConcurrentAbort({ ...error }, receipt, key)).toBe(false)
    for (const changed of [
      { ...receipt, query: receipt.query.replace("insert-shadow", "insert-inbox") },
      { ...receipt, query: receipt.query.replace("public.fund_balance_projections", "public.consumer_inbox") },
      { ...receipt, values: receipt.values.slice(0, 8) },
      ...[0, 1, 2, 3, 7].map(index => ({ ...receipt, values: receipt.values.map((value, i) => i === index ? "different" : value) })),
    ]) expect(isExpectedConcurrentAbort(error, changed, key)).toBe(false)
    for (const wrong of [null, new Error("unrelated"), { code: "P2002", meta: { code: "23505" } },
      { code: "P2010", meta: { code: "42501" } }, { code: "P2010", meta: { code: "23514" } },
      { code: "P2010", meta: { message: 'duplicate key value violates unique constraint "fund_balance_projections_build_key"' } },
    ]) expect(isExpectedConcurrentAbort(wrong, { ...receipt, error: wrong }, key)).toBe(false)
  })
})

function signal<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

async function newBuild(organizationId: string, fundId: string, records: KafkaEventRecord[]): Promise<Context> {
  const number = ++counter
  const buildId = randomUUID()
  const buildKey = `shadow-${number}`
  const role = `ld_fund_shadow_${process.pid}_${number}`
  const scope: FundShadowScope = { organizationId, buildId, buildKey, projectionVersion: 2, codeSha,
    environment: "test", expectedWorkerRole: role }
  await scratch.$executeRawUnsafe(`INSERT INTO projection_builds
    (id, "organizationId", "projectionName", "projectionVersion", "buildKey", "codeSha", mode)
    VALUES ($1::uuid, $2, 'finance.fund-balance', 2, $3, $4, 'shadow')`, buildId, organizationId, buildKey, codeSha)
  await scratch.$executeRawUnsafe(`UPDATE projection_builds SET status = 'running', "startedAt" = CURRENT_TIMESTAMP WHERE id = $1::uuid`, buildId)
  // All interpolated names/literals below are generated solely in this fixture,
  // never read from messages, user input or a production configuration file.
  sql(new URL(scratchUrl()), `
    CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}';
    GRANT CONNECT ON DATABASE "${databaseName}" TO "${role}";
    GRANT USAGE ON SCHEMA public TO "${role}";
    GRANT SELECT ON event_outbox, event_aggregate_heads, funds, domain_events,
      fund_balance_projections, projection_builds, projection_checkpoints, consumer_inbox TO "${role}";
    GRANT INSERT ON fund_balance_projections, projection_checkpoints, consumer_inbox TO "${role}";
    GRANT UPDATE (balance, currency, "aggregateVersion", "lastEventId", evidence) ON fund_balance_projections TO "${role}";
    GRANT UPDATE ("sourceOffset", "lastEventId", "updatedAt") ON projection_checkpoints TO "${role}";
    GRANT UPDATE ("createdAt") ON projection_builds TO "${role}";
  `)
  workerRoles.push(role)
  for (const table of ["event_outbox", "event_aggregate_heads", "funds", "domain_events"]) {
    await scratch.$executeRawUnsafe(`CREATE POLICY "${role}" ON "${table}" AS RESTRICTIVE TO "${role}"
      USING ("organizationId" = '${organizationId}') WITH CHECK ("organizationId" = '${organizationId}')`)
  }
  const boundaries: Record<string, string> = {
    projection_builds: `"organizationId" = '${organizationId}' AND id = '${buildId}'::uuid`,
    projection_checkpoints: `"organizationId" = '${organizationId}' AND "buildId" = '${buildId}'::uuid`,
    consumer_inbox: `"organizationId" = '${organizationId}' AND "consumerName" = 'fund-shadow:${buildId}' AND "consumerVersion" = 1`,
  }
  for (const [table, boundary] of Object.entries(boundaries)) {
    await scratch.$executeRawUnsafe(`CREATE POLICY "${role}" ON "${table}" AS RESTRICTIVE TO "${role}"
      USING (${boundary}) WITH CHECK (${boundary})`)
  }
  const shadow = `"organizationId" = '${organizationId}' AND status = 'shadow' AND "projectionVersion" = 2 AND "buildKey" = '${buildKey}'`
  await scratch.$executeRawUnsafe(`CREATE POLICY "${role}_read" ON fund_balance_projections AS RESTRICTIVE FOR SELECT TO "${role}"
    USING ((${shadow}) OR ("organizationId" = '${organizationId}' AND status = 'active' AND "projectionVersion" = 1))`)
  await scratch.$executeRawUnsafe(`CREATE POLICY "${role}_insert" ON fund_balance_projections AS RESTRICTIVE FOR INSERT TO "${role}" WITH CHECK (${shadow})`)
  await scratch.$executeRawUnsafe(`CREATE POLICY "${role}_update" ON fund_balance_projections AS RESTRICTIVE FOR UPDATE TO "${role}"
    USING (${shadow}) WITH CHECK (${shadow})`)
  const url = new URL(scratchUrl())
  url.username = role
  url.password = password
  return { scope, client: clientFor(url), records, fundId }
}

function scratchUrl(): string {
  const url = checkedAdmin()
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function fixture(): Promise<Context> {
  const organizationId = `shadow-org-${randomUUID()}`
  const fundId = `shadow-fund-${randomUUID()}`
  await scratch.$executeRawUnsafe(`INSERT INTO organizations (id, name) VALUES ($1, 'synthetic Fund shadow tenant')`, organizationId)
  await scratch.$executeRawUnsafe(`INSERT INTO funds (id, "organizationId", name, currency, "currentBalance") VALUES ($1, $2, 'Synthetic Fund', 'USD', 0.0000)`, fundId, organizationId)
  for (const [type, amount] of [["deposit", "10.1234"], ["withdrawal", "0.1234"]]) {
    // Match the real INSERT-first compatibility route. Its BEFORE INSERT
    // trigger appends the fact/outbox and changes active v1, deliberately NOT
    // funds: the second source update must observe the pre-withdrawal balance.
    // Deferred coherence rejects an omitted second statement at COMMIT.
    await scratch.$transaction(async tx => {
      await tx.$executeRawUnsafe(`INSERT INTO fund_transactions (id, "organizationId", "fundId", type, amount) VALUES ($1, $2, $3, $4, $5::numeric)`,
      randomUUID(), organizationId, fundId, type, amount)
      const changed = await tx.$executeRawUnsafe(`UPDATE funds SET "currentBalance" = "currentBalance" + $3::numeric
        WHERE id = $1 AND "organizationId" = $2 AND ($3::numeric >= 0 OR "currentBalance" >= -$3::numeric)`,
      fundId, organizationId, type === "deposit" ? amount : `-${amount}`)
      expect(changed).toBe(1)
    })
  }
  await scratch.$executeRawUnsafe(`UPDATE funds SET name = 'Synthetic renamed' WHERE id = $1`, fundId)
  await scratch.$executeRawUnsafe(`UPDATE funds SET "isActive" = false WHERE id = $1`, fundId)
  await scratch.$executeRawUnsafe(`UPDATE funds SET "isActive" = true WHERE id = $1`, fundId)
  const outbox = await scratch.$queryRawUnsafe<Array<{ value: string; hash: string; key: string; eventId: string; eventType: string }>>(`
    SELECT o.envelope::text AS value, o."payloadHash" AS hash, o."partitionKey" AS key, o."eventId"::text AS "eventId", o."eventType"
    FROM event_outbox o JOIN domain_events e ON e.id = o."eventId" AND e."organizationId" = o."organizationId"
    WHERE o."organizationId" = $1 ORDER BY e."aggregateVersion"`, organizationId)
  expect(outbox).toHaveLength(6)
  const records = outbox.map((row, index): KafkaEventRecord => ({ topic, partition: 0, offset: String(index * 2 + 10), key: row.key,
    value: row.value, headers: { id: row.eventId, eventtype: row.eventType, organizationid: organizationId, payloadhash: row.hash } }))
  return newBuild(organizationId, fundId, records)
}

pgDescribe("Fund shadow on actual PostgreSQL: immutable source, restricted login and real COMMIT", () => {
  beforeAll(async () => {
    const url = checkedAdmin()
    admin = clientFor(url)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    created = true
    const target = new URL(scratchUrl())
    scratch = clientFor(target)
    sql(target, `GRANT CREATE ON DATABASE "${databaseName}" TO event_migrator;
      GRANT USAGE, CREATE ON SCHEMA public TO event_app, event_migrator;`)
    target.username = "event_app"
    target.password = "event-app-password"
    sql(target, readFileSync("scripts/ci/fixtures/fund-shadow/base.sql", "utf8"))
    target.username = "event_migrator"
    target.password = "event-migrator-password"
    for (const migration of ["20260901090000_event_platform_foundation", "20260901100000_fund_event_source_pilot", "20260906120000_projection_replay_control_plane"]) {
      sql(target, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    }
    // The minimal legacy anchors do not install the application's funds RLS;
    // explicitly add its tenant predicate, then independently restrict workers.
    sql(new URL(scratchUrl()), `ALTER TABLE funds ENABLE ROW LEVEL SECURITY;
      ALTER TABLE funds FORCE ROW LEVEL SECURITY;
      CREATE POLICY shadow_fixture_tenant ON funds USING ("organizationId" = current_setting('app.org_id', true))
        WITH CHECK ("organizationId" = current_setting('app.org_id', true));`)
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled(clients.filter(client => client !== admin).map(client => client.$disconnect()))
    if (created) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`)
      for (const role of workerRoles) await admin.$executeRawUnsafe(`DROP ROLE "${role}"`)
    }
    await admin?.$disconnect()
  })

  it("keeps the real source guard: an orphan ledger INSERT cannot commit or leave facts behind", async () => {
    const context = await fixture()
    const before = await snapshotSource(context.scope.organizationId)
    await expect(scratch.$executeRawUnsafe(`INSERT INTO fund_transactions (id, "organizationId", "fundId", type, amount)
      VALUES ($1, $2, $3, 'deposit', 1.0000)`, randomUUID(), context.scope.organizationId, context.fundId))
      .rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } })
    expect(await snapshotSource(context.scope.organizationId)).toEqual(before)
    expect(await counts(context)).toEqual({ shadows: 0, inbox: 0, checkpoints: 0 })
  })

  it("rebuilds two independently authorized tenants exactly, leaving source/active/pointers/effects unchanged", async () => {
    const a = await fixture()
    const b = await fixture()
    for (const context of [a, b]) {
      const before = await snapshotSource(context.scope.organizationId)
      let result
      for (const record of context.records) result = await consumeFundShadowRecord(database(context.client), context.scope, record)
      expect(result?.state).toMatchObject({ organizationId: context.scope.organizationId, fundId: context.fundId, balance: "10.0000", currency: "USD", aggregateVersion: 6 })
      expect(await counts(context)).toEqual({ shadows: 1, inbox: 6, checkpoints: 1 })
      expect(await snapshotSource(context.scope.organizationId)).toEqual(before)
      const [parity] = await scratch.$queryRawUnsafe<Array<{ parity: boolean }>>(`SELECT s.balance = a.balance
        AND s.currency = a.currency AND s."aggregateVersion" = a."aggregateVersion" AND s."lastEventId" = a."lastEventId" AS parity
        FROM fund_balance_projections s JOIN fund_balance_projections a ON a."organizationId" = s."organizationId" AND a."fundId" = s."fundId" AND a.status = 'active'
        WHERE s."organizationId" = $1 AND s."buildKey" = $2`, context.scope.organizationId, context.scope.buildKey)
      expect(parity.parity).toBe(true)
    }
    await expect(consumeFundShadowRecord(database(a.client), { ...b.scope, expectedWorkerRole: a.scope.expectedWorkerRole }, b.records[0])).rejects.toThrow()
    await a.client.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, b.scope.organizationId)
      for (const table of ["funds", "event_outbox", "domain_events", "projection_builds", "fund_balance_projections", "consumer_inbox", "projection_checkpoints"]) {
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM "${table}" WHERE "organizationId" = $1`, b.scope.organizationId)
        expect(rows).toEqual([])
      }
    })
    // Every required field is present and the referenced foreign tenant/event
    // exists. Only independent RLS, not NULL/foreign-key validation, may deny.
    await expect(a.client.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, b.scope.organizationId)
      await tx.$executeRawUnsafe(`INSERT INTO consumer_inbox ("organizationId", "consumerName", "consumerVersion", "eventId", "eventType", "payloadHash",
        "sourceTopic", "sourcePartition", "sourceOffset", result) VALUES ($1, $2, 1, $3::uuid, $4, $5, $6, 2, 999, '{}'::jsonb)`,
      b.scope.organizationId, `fund-shadow:${a.scope.buildId}`, b.records[0].headers!.id, b.records[0].headers!.eventtype,
      b.records[0].headers!.payloadhash, topic)
    })).rejects.toMatchObject(permissionDenied)
  })

  it("keeps duplicate/newer/older offsets monotonic, current state fresh and separate builds independent", async () => {
    const context = await fixture()
    const db = database(context.client)
    for (const record of context.records) await consumeFundShadowRecord(db, context.scope, record)
    const same = await consumeFundShadowRecord(db, context.scope, context.records[5])
    expect(same).toMatchObject({ duplicate: true, checkpointAdvanced: false, state: { balance: "10.0000", aggregateVersion: 6 } })
    const newer = await consumeFundShadowRecord(db, context.scope, at(context.records[0], 40))
    expect(newer).toMatchObject({ duplicate: true, checkpointAdvanced: true, state: { balance: "10.0000", aggregateVersion: 6 }, checkpoint: { sourceOffset: BigInt(40) } })
    const older = await consumeFundShadowRecord(db, context.scope, at(context.records[1], 30))
    expect(older).toMatchObject({ duplicate: true, checkpointAdvanced: false, checkpoint: { sourceOffset: BigInt(40) } })
    await expect(consumeFundShadowRecord(db, context.scope, at(context.records[1], 10))).rejects.toThrow()
    expect(await counts(context)).toEqual({ shadows: 1, inbox: 6, checkpoints: 1 })
    const second = await newBuild(context.scope.organizationId, context.fundId, context.records)
    for (const record of second.records) expect((await consumeFundShadowRecord(database(second.client), second.scope, record)).duplicate).toBe(false)
    expect(await counts(second)).toEqual({ shadows: 1, inbox: 6, checkpoints: 1 })
    // Same-tenant builds are separately authorized, not merely hidden by a
    // mutable tenant GUC. The first login cannot adopt the second build.
    await context.client.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, second.scope.organizationId)
      expect(await tx.$queryRawUnsafe(`SELECT id FROM projection_builds WHERE id = $1::uuid`, second.scope.buildId)).toEqual([])
      expect(await tx.$queryRawUnsafe(`SELECT "buildKey" FROM fund_balance_projections WHERE "buildKey" = $1`, second.scope.buildKey)).toEqual([])
    })
    await expect(consumeFundShadowRecord(db, { ...second.scope, expectedWorkerRole: context.scope.expectedWorkerRole }, second.records[0])).rejects.toThrow(/Build identity/)
  })

  it("uses PostgreSQL full-envelope canonicalization, rejecting altered facts/data-only hashes before writes", async () => {
    const context = await fixture()
    const record = context.records[0]
    const parsed = JSON.parse(String(record.value))
    const reordered = Object.fromEntries(Object.entries(parsed).reverse())
    expect((await consumeFundShadowRecord(database(context.client), context.scope, { ...record, value: JSON.stringify(reordered) })).duplicate).toBe(false)
    const fresh = await fixture()
    const changed = JSON.parse(String(fresh.records[0].value))
    changed.data.openingBalance = "1.0000"
    await expect(consumeFundShadowRecord(database(fresh.client), fresh.scope, { ...fresh.records[0], value: JSON.stringify(changed) })).rejects.toThrow()
    const [{ hash }] = await scratch.$queryRawUnsafe<Array<{ hash: string }>>(`SELECT "payloadHash" AS hash FROM domain_events WHERE id = $1::uuid`, fresh.records[0].headers!.id)
    await expect(consumeFundShadowRecord(database(fresh.client), fresh.scope, { ...fresh.records[0], headers: { ...fresh.records[0].headers, payloadhash: hash } })).rejects.toThrow()
    expect(await counts(fresh)).toEqual({ shadows: 0, inbox: 0, checkpoints: 0 })
  })

  it("rolls all three writes back after a real inbox write and after a deferred COMMIT failure; never calls ack", async () => {
    const context = await fixture()
    const failed = database(context.client, { afterExecute: async query => {
      if (query.includes("fund-shadow:insert-inbox")) throw new Error("synthetic crash after inbox SQL")
    } })
    await expect(consumeFundShadowRecord(failed, context.scope, context.records[0])).rejects.toThrow("synthetic crash")
    expect(await counts(context)).toEqual({ shadows: 0, inbox: 0, checkpoints: 0 })
    // A real deferred constraint executes only at COMMIT, after the adapter's
    // callback returned. This distinguishes a transaction factory from a mock.
    sql(new URL(scratchUrl()), `CREATE FUNCTION shadow_fixture_commit_reject() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic deferred failure' USING ERRCODE = '23514'; END $$;
      CREATE CONSTRAINT TRIGGER shadow_fixture_commit_reject AFTER INSERT ON consumer_inbox
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shadow_fixture_commit_reject();`)
    let ack = 0
    try {
      await expect(consumeFundShadowRecord(database(context.client), context.scope, context.records[0]).then(() => { ack++ })).rejects.toThrow("synthetic deferred failure")
      expect(ack).toBe(0)
      expect(await counts(context)).toEqual({ shadows: 0, inbox: 0, checkpoints: 0 })
    } finally {
      await scratch.$executeRawUnsafe("DROP TRIGGER shadow_fixture_commit_reject ON consumer_inbox")
      await scratch.$executeRawUnsafe("DROP FUNCTION shadow_fixture_commit_reject()")
    }
    expect((await consumeFundShadowRecord(database(context.client), context.scope, context.records[0])).duplicate).toBe(false)
    // Ack loss AFTER commit is a safe duplicate on delivery retry.
    expect((await consumeFundShadowRecord(database(context.client), context.scope, context.records[0])).duplicate).toBe(true)
    expect(await counts(context)).toEqual({ shadows: 1, inbox: 1, checkpoints: 1 })
  })

  it("serializes two real connections, rejects gaps/old unknown events, and retries aborted duplicate transactions safely", async () => {
    const context = await fixture()
    const before = await snapshotSource(context.scope.organizationId)
    const url = new URL(scratchUrl())
    url.username = context.scope.expectedWorkerRole
    url.password = password
    const second = clientFor(url)
    const connections = [context.client, second]
    const bothSnapshotsStarted = signal<void>()
    const failures = new Map<number, ExecuteFailure>()
    const insertKey: ShadowInsertKey = [context.scope.organizationId, context.fundId, context.scope.projectionVersion, context.scope.buildKey, String(context.records[0].headers!.id)]
    let snapshots = 0
    const afterQuery = async (query: string) => {
      if (!query.includes("fund-shadow:role")) return
      if (++snapshots === 2) bothSnapshotsStarted.resolve()
      await bounded(bothSnapshotsStarted.promise, "two real Serializable snapshots before either INSERT")
    }
    const outcomes = await Promise.allSettled(connections.map((client, index) => consumeFundShadowRecord(database(client, {
      afterQuery, onExecuteError: receipt => { failures.set(index, receipt) },
    }), context.scope, context.records[0])))
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1)
    const winner = outcomes.find(value => value.status === "fulfilled")
    if (!winner || winner.status !== "fulfilled") throw new Error("The real concurrent winner must have committed")
    const expected = {
      checkpointAdvanced: false,
      state: { organizationId: context.scope.organizationId, fundId: context.fundId, balance: "0.0000", currency: "USD", aggregateVersion: 1, lastEventId: context.records[0].headers!.id },
      checkpoint: { sourceOffset: BigInt(context.records[0].offset), lastEventId: context.records[0].headers!.id },
    }
    expect(winner.value).toMatchObject({ ...expected, duplicate: false, checkpointAdvanced: true })
    expect(await counts(context)).toEqual({ shadows: 1, inbox: 1, checkpoints: 1 })
    expect(await snapshotSource(context.scope.organizationId)).toEqual(before)
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status !== "rejected") continue
      const receipt = failures.get(index)
      expect(isExpectedConcurrentAbort(outcome.reason, receipt, insertKey), `Unexpected concurrent SQL/ACL failure: ${JSON.stringify({ ...concurrentAbortShape(outcome.reason), sameErrorObserved: receipt?.error === outcome.reason, exactShadowInsertObserved: matchesShadowInsert(receipt, insertKey) })}`).toBe(true)
      // Retry the actual rejected connection in a NEW factory, not inside the
      // failed transaction, and prove the committed duplicate's current state.
      expect(await consumeFundShadowRecord(database(connections[index]), context.scope, context.records[0])).toMatchObject({ ...expected, duplicate: true })
    }
    expect(await counts(context)).toEqual({ shadows: 1, inbox: 1, checkpoints: 1 })
    await expect(consumeFundShadowRecord(database(context.client), context.scope, context.records[2])).rejects.toThrow()
    await expect(consumeFundShadowRecord(database(context.client), context.scope, at(context.records[1], 9))).rejects.toThrow()
    expect(await counts(context)).toEqual({ shadows: 1, inbox: 1, checkpoints: 1 })
    expect(await snapshotSource(context.scope.organizationId)).toEqual(before)
  })

  it("requires a real restricted LOGIN, cannot mutate active/source/effects/lifecycle or inherit privileged roles", async () => {
    const context = await fixture()
    const db = database(context.client)
    await expect(consumeFundShadowRecord(database(scratch), context.scope, context.records[0])).rejects.toThrow()
    const [roles] = await context.client.$queryRawUnsafe<Array<{ reachable: number }>>(`SELECT count(*)::int AS reachable
      FROM pg_roles WHERE (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AND pg_has_role(current_user, oid, 'SET')`)
    expect(roles.reachable).toBe(0)
    for (const query of [
      `UPDATE funds SET "currentBalance" = 999 WHERE id = $1`,
      `UPDATE fund_balance_projections SET status = 'retired' WHERE "fundId" = $1`,
      `UPDATE event_outbox SET "eventType" = 'forged' WHERE "partitionKey" LIKE $1`,
      `INSERT INTO effect_outbox ("organizationId") VALUES ($1)`,
      `INSERT INTO projection_activations ("organizationId") VALUES ($1)`,
      `UPDATE projection_builds SET status = 'verifying' WHERE "buildKey" = $1`,
      `UPDATE projection_builds SET id = gen_random_uuid() WHERE "buildKey" = $1`,
    ]) await expect(context.client.$executeRawUnsafe(query, context.fundId)).rejects.toMatchObject(permissionDenied)
    await context.client.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, context.scope.organizationId)
      expect(await tx.$executeRawUnsafe(`UPDATE fund_balance_projections SET balance = 999 WHERE "fundId" = $1 AND status = 'active'`, context.fundId)).toBe(0)
    })
    await scratch.$executeRawUnsafe(`REVOKE UPDATE ("createdAt") ON projection_builds FROM "${context.scope.expectedWorkerRole}"`)
    await expect(consumeFundShadowRecord(db, context.scope, context.records[0])).rejects.toMatchObject(permissionDenied)
    await scratch.$executeRawUnsafe(`GRANT UPDATE ("createdAt") ON projection_builds TO "${context.scope.expectedWorkerRole}"`)
    expect((await consumeFundShadowRecord(db, context.scope, context.records[0])).duplicate).toBe(false)
    await expect(context.client.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, context.scope.organizationId)
      await tx.$executeRawUnsafe(`UPDATE projection_builds SET "createdAt" = "createdAt" + interval '1 second' WHERE id = $1::uuid`, context.scope.buildId)
    })).rejects.toThrow("identity and replay fence are immutable")
    await scratch.$executeRawUnsafe(`UPDATE projection_builds SET status = 'verifying' WHERE id = $1::uuid`, context.scope.buildId)
    await expect(consumeFundShadowRecord(db, context.scope, context.records[1])).rejects.toThrow()
    expect(await counts(context)).toEqual({ shadows: 1, inbox: 1, checkpoints: 1 })
  })

  it("holds the build lock until COMMIT against a concurrent controller transition", async () => {
    const context = await fixture()
    const workerAtCommit = signal<number>()
    const releaseWorker = signal<void>()
    const controllerReady = signal<number>()
    const controller = clientFor(new URL(scratchUrl()))
    const worker = consumeFundShadowRecord(database(context.client, { beforeCommit: async tx => {
      const [{ pid }] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(`SELECT pg_backend_pid() AS pid`)
      workerAtCommit.resolve(pid)
      await releaseWorker.promise
    } }), context.scope, context.records[0])
    // Attach handlers immediately without suppressing later assertions.
    const workerOutcome = worker.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
    let controllerOutcome: Promise<{ ok: true; count: number } | { ok: false; error: unknown }> | undefined
    try {
      const workerPid = await bounded(workerAtCommit.promise, "worker holding the build lock")
      const transition = controller.$transaction(async tx => {
        await tx.$queryRawUnsafe(`SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '8s', true)`)
        const [{ pid }] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(`SELECT pg_backend_pid() AS pid`)
        controllerReady.resolve(pid)
        return tx.$executeRawUnsafe(`UPDATE projection_builds SET status = 'verifying' WHERE id = $1::uuid`, context.scope.buildId)
      }, { maxWait: 5000, timeout: 10000 })
      controllerOutcome = transition.then(count => ({ ok: true as const, count }), error => ({ ok: false as const, error }))
      const controllerPid = await bounded(controllerReady.promise, "controller update")
      let blocked = false
      // Observe a REAL PostgreSQL blocking relationship, not a timing guess.
      // Bound polling to 2s, comfortably below both server lock timeouts.
      const deadline = Date.now() + 2_000
      while (!blocked && Date.now() < deadline) {
        const [row] = await scratch.$queryRawUnsafe<Array<{ blocked: boolean }>>(`SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked`, workerPid, controllerPid)
        blocked = row.blocked
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(blocked, "controller must wait for the worker's exact build-row lock").toBe(true)
      releaseWorker.resolve()
      expect((await bounded(workerOutcome, "worker COMMIT")).ok).toBe(true)
      expect(await bounded(controllerOutcome, "controller transition")).toEqual({ ok: true, count: 1 })
      await expect(consumeFundShadowRecord(database(context.client), context.scope, context.records[1])).rejects.toThrow(/Build identity/)
      expect(await counts(context)).toEqual({ shadows: 1, inbox: 1, checkpoints: 1 })
    } finally {
      releaseWorker.resolve()
      await workerOutcome
      if (controllerOutcome) await controllerOutcome
    }
  })
})
