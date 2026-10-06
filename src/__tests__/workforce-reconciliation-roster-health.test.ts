import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PrismaClient, type Prisma } from "@prisma/client"
import { readWorkforceEligibleRosterHealth as health } from "@/lib/workforce/reconciliation-roster-health"

describe("eligible roster failure boundary", () => {
  it("never exposes database errors, private values or false zero counts", async () => {
    const db = { $transaction: async () => { throw new Error("PRIVATE-TENANT password=secret") } }
    const result = await health(db as unknown as PrismaClient)
    expect(result).toEqual({ status: "UNKNOWN", coverage: "UNAVAILABLE", reason: "DATABASE_UNAVAILABLE", alerts: ["RECONCILIATION_COVERAGE_UNAVAILABLE"] })
  })
})

const url = process.env.WORKFORCE_ROSTER_HEALTH_TEST_DATABASE_URL
describe.skipIf(!url)("eligible roster on an isolated synthetic PostgreSQL schema", () => {
  let db: PrismaClient, other: PrismaClient
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } }); other = new PrismaClient({ datasources: { db: { url } } })
    await db.$executeRaw`CREATE TABLE organizations (id text PRIMARY KEY,"isActive" boolean NOT NULL,plan text,addons jsonb,features jsonb,modules jsonb,"createdAt" timestamp(3) NOT NULL DEFAULT now())`
    await db.$executeRaw`CREATE TABLE workforce_reconciliation_tenant_states ("organizationId" text PRIMARY KEY REFERENCES organizations(id),"lastAttemptAt" timestamp(3),"lastCompletedAt" timestamp(3),"dueAt" timestamp(3),"lastOutcome" text)`
    await db.$executeRaw`CREATE ROLE wf_roster_fixture_reader NOLOGIN NOSUPERUSER NOBYPASSRLS`
    await db.$executeRaw`GRANT SELECT ON organizations,workforce_reconciliation_tenant_states TO wf_roster_fixture_reader`
    await db.$executeRaw`ALTER TABLE organizations ENABLE ROW LEVEL SECURITY`
    await db.$executeRaw`ALTER TABLE organizations FORCE ROW LEVEL SECURITY`
    await db.$executeRaw`CREATE POLICY no_rows ON organizations USING (false)`
    await db.$executeRaw`ALTER TABLE workforce_reconciliation_tenant_states ENABLE ROW LEVEL SECURITY`
    await db.$executeRaw`ALTER TABLE workforce_reconciliation_tenant_states FORCE ROW LEVEL SECURITY`
    await db.$executeRaw`CREATE POLICY no_rows ON workforce_reconciliation_tenant_states USING (false)`
  })
  beforeEach(async () => { await db.$executeRaw`TRUNCATE workforce_reconciliation_tenant_states,organizations` })
  afterAll(async () => { await db?.$disconnect(); await other?.$disconnect() })
  async function org(id: string, active = true, modules: Record<string, boolean> = { "workforce-hrm": true }) {
    await db.$executeRaw`INSERT INTO organizations(id,"isActive",plan,addons,features,modules,"createdAt") VALUES (${id},${active},'starter','[]','[]',${JSON.stringify(modules)}::jsonb,now()-interval '1 day')`
  }
  async function state(id: string, outcome = "MATCHED", due = false) {
    await db.$executeRaw`INSERT INTO workforce_reconciliation_tenant_states VALUES (${id},now()-interval '1 minute',CASE WHEN ${outcome}='MATCHED' THEN now()-interval '1 minute' ELSE NULL END,now()+(CASE WHEN ${due} THEN -60 ELSE 3600 END)*interval '1 second',${outcome})`
  }
  async function fingerprint() {
    return db.$queryRaw`SELECT md5((SELECT COALESCE(jsonb_agg(o ORDER BY id),'[]')::text FROM organizations o)|| (SELECT COALESCE(jsonb_agg(s ORDER BY "organizationId"),'[]')::text FROM workforce_reconciliation_tenant_states s)) AS hash`
  }
  it("does not call an empty denominator healthy or invent a coverage percentage", async () => {
    expect(await health(db)).toMatchObject({ status: "NO_ELIGIBLE", coverage: "ELIGIBLE_ROSTER_SNAPSHOT", counts: { eligible: 0, neverAttempted: 0 } })
  })
  it("counts eligible organizations with no state and returns no identifiers", async () => {
    await org("PRIVATE-UNATTEMPTED")
    const before = await fingerprint(), result = await health(db)
    expect(result).toMatchObject({ status: "ATTENTION", counts: { eligible: 1, trackedEligible: 0, neverAttempted: 1, neverMatched: 1, due: 1 } })
    expect(result.alerts).toContain("RECONCILIATION_UNATTEMPTED")
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|organizationId|keyHash|plan|modules/)
    expect(await fingerprint()).toEqual(before)
  })
  it("keeps inactive and HRM-disabled tracked tenants outside eligible failure counts", async () => {
    await org("active"); await state("active"); await org("inactive", false); await state("inactive", "MISMATCH")
    await org("disabled", true, { "workforce-hrm": false }); await state("disabled", "UNKNOWN")
    expect(await health(db)).toMatchObject({ status: "CLEAR", counts: { eligible: 1, trackedEligible: 1, failed: 0, excludedTracked: 2 } })
  })
  it("uses legacy MTM fallback while honoring explicit HRM disable", async () => {
    await org("legacy", true, { mtm: true })
    await org("off", true, { mtm: true, "workforce-hrm": false })
    expect(await health(db)).toMatchObject({ counts: { eligible: 1, neverAttempted: 1 } })
  })
  it("distinguishes never-attempted state rows from attempts that never matched", async () => {
    await org("never"); await db.$executeRaw`INSERT INTO workforce_reconciliation_tenant_states VALUES ('never',NULL,NULL,now(),'NEVER')`
    await org("failure"); await state("failure", "INCOMPLETE", true)
    expect(await health(db)).toMatchObject({ counts: { eligible: 2, trackedEligible: 2, neverAttempted: 1, neverMatched: 2, failed: 1, due: 2 } })
  })
  it("separates live attempts, expired attempts and stale successful completions", async () => {
    await org("live"); await state("live", "RUNNING")
    await org("expired"); await state("expired", "RUNNING", true)
    await org("stale"); await state("stale")
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "lastCompletedAt"=now()-interval '3 hours' WHERE "organizationId"='stale'`
    expect(await health(db)).toMatchObject({ counts: { eligible: 3, running: 1, expiredAttempts: 1, staleCompleted: 1, neverMatched: 2 } })
  })
  it("does not erase the last match when a newer attempt fails", async () => {
    await org("retry"); await state("retry")
    await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "lastOutcome"='MISMATCH'`
    expect(await health(db)).toMatchObject({ counts: { failed: 1, neverMatched: 0 } })
  })
  it("refuses a tenant-filtered role instead of accepting a false empty roster", async () => {
    await org("hidden")
    const scoped = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE wf_roster_fixture_reader`; return fn(tx)
    }, options) }
    expect(await health(scoped as unknown as PrismaClient)).toMatchObject({ coverage: "UNAVAILABLE", reason: "VISIBILITY_UNVERIFIED" })
  })
  it("accepts exactly 10000 organizations but refuses 10001 without partial counts", async () => {
    await db.$executeRaw`INSERT INTO organizations SELECT 'org-'||n,true,'starter','[]','[]','{"workforce-hrm":true}',now() FROM generate_series(1,10000) n`
    expect(await health(db)).toMatchObject({ counts: { eligible: 10000, neverAttempted: 10000 } })
    await org("overflow")
    expect(await health(db)).toMatchObject({ status: "UNKNOWN", coverage: "UNAVAILABLE", reason: "ROSTER_LIMIT" })
  })
  it("refuses a projection exceeding 4MiB before returning tenant fields", async () => {
    await org("large")
    await db.$executeRaw`UPDATE organizations SET features=jsonb_build_array(repeat('PRIVATE-',600000))`
    const result = await health(db)
    expect(result).toMatchObject({ coverage: "UNAVAILABLE", reason: "PROJECTION_LIMIT" })
    expect(JSON.stringify(result)).not.toContain("PRIVATE-")
  })
  it.each(["not-json", '{"private":"secret"}'])("does not turn malformed entitlement JSON into a clear denominator (%s)", async value => {
    await org("malformed")
    await db.$executeRaw`UPDATE organizations SET features=${JSON.stringify(value)}::jsonb`
    expect(await health(db)).toMatchObject({ coverage: "UNAVAILABLE", reason: "INVALID_SNAPSHOT" })
  })
  it("refuses inconsistent RUNNING state instead of calling it live", async () => {
    await org("invalid"); await db.$executeRaw`INSERT INTO workforce_reconciliation_tenant_states VALUES ('invalid',NULL,NULL,now()+interval '1 hour','RUNNING')`
    expect(await health(db)).toMatchObject({ coverage: "UNAVAILABLE", reason: "INVALID_SNAPSHOT" })
  })
  it("holds one MVCC snapshot across concurrent entitlement changes", async () => {
    await org("changed"); let queries = 0
    const wrapped = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => db.$transaction(async tx => {
      const proxy = new Proxy(tx, { get(target, key) {
        if (key !== "$queryRaw") return Reflect.get(target, key)
        return async (...args: unknown[]) => {
          const result = await (target.$queryRaw as (...a: unknown[]) => Promise<unknown>)(...args)
          if (++queries === 1) await other.$executeRaw`UPDATE organizations SET "isActive"=false`
          return result
        }
      } })
      return fn(proxy)
    }, options) }
    expect(await health(wrapped as unknown as PrismaClient)).toMatchObject({ counts: { eligible: 1 } })
    expect(await health(db)).toMatchObject({ status: "NO_ELIGIBLE" })
  })
})
