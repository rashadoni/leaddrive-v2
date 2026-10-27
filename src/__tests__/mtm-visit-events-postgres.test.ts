import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { lockMtmVisitSnapshot, mtmVisitEvents, recordMtmVisitChange, type MtmVisitSnapshot } from "@/lib/mtm/visit-events"

// MTM visits on the event platform (owner 2026-10-26: «Подключай к Kafka
// визиты MTM»). The pure part runs everywhere; the PostgreSQL part runs on the
// event-platform CI database (actual migrations, real commit-coherence
// triggers) with a session-local stand-in for mtm_visits.

const visit = (patch: Partial<MtmVisitSnapshot> = {}): MtmVisitSnapshot => ({
  id: "v1", organizationId: "org-b", agentId: "a1", customerId: "c1", contactId: null, routeId: null, routePointId: null,
  status: "CHECKED_IN", checkInAt: new Date("2026-10-26T08:00:00Z"), checkOutAt: null, duration: null,
  outcome: null, potential: null, nextActionDueAt: null, deletedAt: null, ...patch,
})
const types = (before: MtmVisitSnapshot | null, after: MtmVisitSnapshot | null) => mtmVisitEvents(before, after).map(e => e.type)

describe("which events a change to a visit makes", () => {
  it("a check-in starts the visit; one made fully offline also completes it", () => {
    expect(types(null, visit())).toEqual(["started"])
    expect(types(null, visit({ status: "CHECKED_OUT", checkOutAt: new Date("2026-10-26T08:30:00Z"), outcome: "SUCCESSFUL" })))
      .toEqual(["started", "completed", "result-recorded"])
  })
  it("names each change once, and a lock-only write none", () => {
    expect(types(visit(), visit())).toEqual([])
    expect(types(visit(), visit({ agentId: "a2" }))).toEqual(["reassigned"])
    expect(types(visit(), visit({ status: "CANCELLED" }))).toEqual(["cancelled"])
    expect(types(visit({ status: "CHECKED_OUT" }), visit())).toEqual(["reopened"])
    expect(types(visit(), visit({ potential: "HIGH" }))).toEqual(["result-recorded"])
    expect(types(visit(), visit({ deletedAt: new Date() }))).toEqual(["deleted"])
  })
  it("carries ids and times, never coordinates or notes", () => {
    for (const event of mtmVisitEvents(null, visit({ status: "CHECKED_OUT", outcome: "PARTIAL", checkOutAt: new Date() }))) {
      expect(Object.keys(event.data).filter(k => /lat|lng|note|text/i.test(k))).toEqual([])
    }
  })
})

const databaseUrl = process.env.EVENT_PLATFORM_TEST_DATABASE_URL
const postgresDescribe = databaseUrl ? describe : describe.skip

postgresDescribe("MTM visit events on PostgreSQL", () => {
  let prisma!: PrismaClient
  beforeAll(async () => {
    // One connection: the stand-in table is session-local.
    const url = new URL(databaseUrl!); url.searchParams.set("connection_limit", "1")
    prisma = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: url.toString() } } })
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE mtm_visits (id text PRIMARY KEY, "organizationId" text NOT NULL, "agentId" text NOT NULL,
      "customerId" text NOT NULL, "contactId" text, "routeId" text, "routePointId" text, status text NOT NULL DEFAULT 'CHECKED_IN',
      "checkInAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "checkOutAt" timestamp(3), duration int, outcome text, potential text,
      "nextActionDueAt" timestamp(3), "deletedAt" timestamp(3), "checkInLat" double precision, "checkInLng" double precision)`)
  })
  afterAll(async () => { await prisma?.$disconnect() })

  const newVisit = async (organizationId = "org-b") => {
    const id = `visit-${randomUUID()}`
    await prisma.$executeRawUnsafe(`INSERT INTO mtm_visits (id, "organizationId", "agentId", "customerId", "checkInLat", "checkInLng") VALUES ($1, $2, 'agent-1', 'customer-1', 40.4, 49.8)`, id, organizationId)
    return id
  }
  const stream = (id: string) => prisma.$queryRawUnsafe<Array<{ type: string; version: string; topic: string; envelope: string }>>(
    `SELECT e."eventType" AS type, e."aggregateVersion"::text AS version, o.topic, o.envelope::text AS envelope FROM domain_events e
     JOIN event_outbox o ON o."eventId" = e.id WHERE e."aggregateType" = 'visit' AND e."aggregateId" = $1 ORDER BY e."aggregateVersion"`, id)

  it("a check-in and its checkout reach the mtm topic, in order, without coordinates", async () => {
    const id = await newVisit()
    await prisma.$transaction(async tx => { expect(await recordMtmVisitChange(tx as never, "org-b", id, null)).toBe(1) })
    await prisma.$transaction(async tx => {
      const before = await lockMtmVisitSnapshot(tx as never, "org-b", id)
      await tx.$executeRawUnsafe(`UPDATE mtm_visits SET status = 'CHECKED_OUT', "checkOutAt" = CURRENT_TIMESTAMP, duration = 25, outcome = 'SUCCESSFUL' WHERE id = $1`, id)
      expect(await recordMtmVisitChange(tx as never, "org-b", id, before)).toBe(2)
    })
    const events = await stream(id)
    expect(events.map(e => [e.type, e.version, e.topic])).toEqual([
      ["mtm.visit-started.v1", "1", "leaddrive.domain.mtm.v1"],
      ["mtm.visit-completed.v1", "2", "leaddrive.domain.mtm.v1"],
      ["mtm.visit-result-recorded.v1", "3", "leaddrive.domain.mtm.v1"],
    ])
    expect(events.map(e => e.envelope).join("")).not.toMatch(/40\.4|49\.8|Lat|Lng/)
  })

  it("a visit made before the events existed gets its state first, once", async () => {
    const id = await newVisit()
    await prisma.$transaction(async tx => {
      const before = await lockMtmVisitSnapshot(tx as never, "org-b", id)
      await tx.$executeRawUnsafe(`UPDATE mtm_visits SET "agentId" = 'agent-2' WHERE id = $1`, id)
      await recordMtmVisitChange(tx as never, "org-b", id, before)
    })
    await prisma.$transaction(async tx => {
      const before = await lockMtmVisitSnapshot(tx as never, "org-b", id)
      await tx.$executeRawUnsafe(`UPDATE mtm_visits SET status = 'CANCELLED' WHERE id = $1`, id)
      await recordMtmVisitChange(tx as never, "org-b", id, before)
    })
    expect((await stream(id)).map(e => e.type)).toEqual(["mtm.visit-imported.v1", "mtm.visit-reassigned.v1", "mtm.visit-cancelled.v1"])
  })

  it("a lock-only write makes no event", async () => {
    const id = await newVisit()
    await prisma.$transaction(async tx => {
      const before = await lockMtmVisitSnapshot(tx as never, "org-b", id)
      await tx.$executeRawUnsafe(`UPDATE mtm_visits SET status = status WHERE id = $1`, id)
      expect(await recordMtmVisitChange(tx as never, "org-b", id, before)).toBe(0)
    })
    expect(await stream(id)).toEqual([])
  })

  it("when the events cannot be written, the visit is still written and committed", async () => {
    // An organization the event tables do not know: the append fails.
    const id = await newVisit("org-not-in-organizations")
    await prisma.$transaction(async tx => {
      const before = await lockMtmVisitSnapshot(tx as never, "org-not-in-organizations", id)
      await tx.$executeRawUnsafe(`UPDATE mtm_visits SET status = 'CHECKED_OUT', "checkOutAt" = CURRENT_TIMESTAMP WHERE id = $1`, id)
      expect(await recordMtmVisitChange(tx as never, "org-not-in-organizations", id, before)).toBe(0)
    })
    const [row] = await prisma.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status FROM mtm_visits WHERE id = $1`, id)
    expect(row.status).toBe("CHECKED_OUT")
    expect(await stream(id)).toEqual([])
  })

  // As in production: the application's role is subject to the event tables'
  // policies, which admit only rows of `app.org_id` and know no rls_bypass.
  // The superuser this suite connects as would pass any policy, which is how
  // 61 demo-pulse visits (a cron, under the bypass) lost their events on prod
  // on 2026-10-27 while this file was green.
  const asApplication = async (tx: Prisma.TransactionClient, settings: Record<string, string>) => {
    const [{ schema }] = await tx.$queryRawUnsafe<Array<{ schema: string }>>(`SELECT nspname AS schema FROM pg_namespace WHERE oid = pg_my_temp_schema()`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO event_app`)
    await tx.$executeRawUnsafe(`GRANT ALL ON mtm_visits TO event_app`)
    await tx.$executeRawUnsafe(`SET LOCAL ROLE event_app`)
    for (const [name, value] of Object.entries(settings)) await tx.$queryRawUnsafe(`SELECT set_config($1, $2, true)`, name, value)
  }
  const tenantNow = async (tx: Prisma.TransactionClient) =>
    (await tx.$queryRawUnsafe<Array<{ org: string | null }>>(`SELECT current_setting('app.org_id', true) AS org`))[0].org ?? ""

  it("a visit written without a tenant (a cron under the RLS bypass) still gets its events, and no tenant is left behind", async () => {
    const id = await newVisit()
    await prisma.$transaction(async tx => {
      await asApplication(tx, { "app.rls_bypass": "on" })
      expect(await recordMtmVisitChange(tx as never, "org-b", id, null)).toBe(1)
      expect(await tenantNow(tx)).toBe("")
    })
    expect((await stream(id)).map(e => e.type)).toEqual(["mtm.visit-started.v1"])
  })

  it("inside another tenant's transaction the events are refused, the visit kept, the tenant unchanged", async () => {
    const id = await newVisit()
    await prisma.$transaction(async tx => {
      await asApplication(tx, { "app.org_id": "org-a" })
      expect(await recordMtmVisitChange(tx as never, "org-b", id, null)).toBe(0)
      expect(await tenantNow(tx)).toBe("org-a")
    })
    expect(await prisma.$queryRawUnsafe(`SELECT id FROM mtm_visits WHERE id = $1`, id)).toEqual([{ id }])
    expect(await stream(id)).toEqual([])
  })
})
