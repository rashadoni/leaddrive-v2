import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { dealEvents, withDealEvents, type DealSnapshot } from "@/lib/deals/deal-events"

// Deals on the event platform (owner 2026-10-26: «Сделки»). The pure part runs
// everywhere; the PostgreSQL part runs on the event-platform CI database (real
// migrations, real commit-coherence triggers) with a session-local stand-in
// for deals, written through raw SQL inside the same withDealEvents calls the
// application makes.

const deal = (patch: Partial<DealSnapshot> = {}): DealSnapshot => ({
  id: "d1", pipelineId: "p1", stage: "LEAD", valueAmount: "1000.0000", currency: "AZN", probability: 10,
  expectedClose: null, assignedTo: "u1", companyId: null, contactId: null, campaignId: null, ...patch,
})
const types = (before: DealSnapshot | null, after: DealSnapshot | null) => dealEvents(before, after).map((e) => e.type)

describe("which events a change to a deal makes", () => {
  it("names each change once, and an edit of other fields none", () => {
    expect(types(null, deal())).toEqual(["created"])
    expect(types(deal(), null)).toEqual(["deleted"])
    expect(types(deal(), deal())).toEqual([])
    expect(types(deal(), deal({ stage: "Qazanıldı" }))).toEqual(["stage-changed"])
    expect(types(deal(), deal({ pipelineId: "p2" }))).toEqual(["stage-changed"])
    expect(types(deal(), deal({ valueAmount: "1500.0000" }))).toEqual(["amount-changed"])
    expect(types(deal(), deal({ assignedTo: "u2" }))).toEqual(["reassigned"])
    expect(types(deal(), deal({ probability: 50, expectedClose: new Date("2026-12-01T00:00:00Z") }))).toEqual(["forecast-changed"])
  })
  it("carries the stage as spelled and no free text", () => {
    const [stage] = dealEvents(deal(), deal({ stage: "Uduzdu" }))
    expect(stage.data).toMatchObject({ fromStage: "LEAD", toStage: "Uduzdu" })
    for (const event of dealEvents(null, deal())) {
      expect(Object.keys(event.data).filter((k) => /name|note|reason|need/i.test(k))).toEqual([])
    }
  })
})

const databaseUrl = process.env.EVENT_PLATFORM_TEST_DATABASE_URL
const postgresDescribe = databaseUrl ? describe : describe.skip

postgresDescribe("deal events on PostgreSQL", () => {
  let prisma!: PrismaClient
  beforeAll(async () => {
    // One connection: the stand-in table is session-local.
    const url = new URL(databaseUrl!); url.searchParams.set("connection_limit", "1")
    prisma = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: url.toString() } } })
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE deals (id text PRIMARY KEY, "organizationId" text NOT NULL, name text NOT NULL,
      "pipelineId" text, stage text NOT NULL DEFAULT 'LEAD', "valueAmount" numeric(18,4) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'AZN',
      probability int NOT NULL DEFAULT 0, "expectedClose" timestamp(3), "assignedTo" text, "companyId" text, "contactId" text,
      "campaignId" text, notes text)`)
  })
  afterAll(async () => { await prisma?.$disconnect() })

  const insert = (tx: { $executeRawUnsafe(q: string, ...v: unknown[]): Promise<number> }, id: string, organizationId = "org-b") =>
    tx.$executeRawUnsafe(`INSERT INTO deals (id, "organizationId", name, "valueAmount", "assignedTo", notes) VALUES ($1, $2, 'Acme renewal', 1200, 'u1', 'call Ali on +994')`, id, organizationId)
  const stream = (id: string) => prisma.$queryRawUnsafe<Array<{ type: string; version: string; topic: string; envelope: string }>>(
    `SELECT e."eventType" AS type, e."aggregateVersion"::text AS version, o.topic, o.envelope::text AS envelope FROM domain_events e
     JOIN event_outbox o ON o."eventId" = e.id WHERE e."aggregateType" = 'deal' AND e."aggregateId" = $1 ORDER BY e."aggregateVersion"`, id)

  it("a deal's life reaches the sales topic in order, without its name or notes", async () => {
    const id = `deal-${randomUUID()}`
    await withDealEvents(prisma, "org-b", [], async (tx) => { await insert(tx, id); return { value: null, createdIds: [id] } })
    await withDealEvents(prisma, "org-b", [id], async (tx) => ({
      value: await tx.$executeRawUnsafe(`UPDATE deals SET stage = 'Qazanıldı', "valueAmount" = 1500, probability = 100 WHERE id = $1`, id),
    }))
    await withDealEvents(prisma, "org-b", [id], async (tx) => ({ value: await tx.$executeRawUnsafe(`DELETE FROM deals WHERE id = $1`, id) }))
    const events = await stream(id)
    expect(events.map((e) => [e.type, e.version, e.topic])).toEqual([
      ["sales.deal-created.v1", "1", "leaddrive.domain.sales.v1"],
      ["sales.deal-stage-changed.v1", "2", "leaddrive.domain.sales.v1"],
      ["sales.deal-amount-changed.v1", "3", "leaddrive.domain.sales.v1"],
      ["sales.deal-forecast-changed.v1", "4", "leaddrive.domain.sales.v1"],
      ["sales.deal-deleted.v1", "5", "leaddrive.domain.sales.v1"],
    ])
    const text = events.map((e) => e.envelope).join("")
    expect(text).toContain("1500.0000")
    expect(text).not.toMatch(/Acme|Ali|\+994/)
  })

  it("a bulk handover writes one event per deal, after the state of deals made before", async () => {
    const ids = [`deal-${randomUUID()}`, `deal-${randomUUID()}`]
    for (const id of ids) await insert(prisma, id)
    await withDealEvents(prisma, "org-b", ids, async (tx) => ({
      value: await tx.$executeRawUnsafe(`UPDATE deals SET "assignedTo" = 'u2' WHERE id = ANY($1::text[])`, ids),
    }))
    for (const id of ids) {
      expect((await stream(id)).map((e) => e.type)).toEqual(["sales.deal-imported.v1", "sales.deal-reassigned.v1"])
    }
  })

  it("an edit of fields the events do not carry writes nothing", async () => {
    const id = `deal-${randomUUID()}`
    await insert(prisma, id)
    await withDealEvents(prisma, "org-b", [id], async (tx) => ({ value: await tx.$executeRawUnsafe(`UPDATE deals SET notes = 'x' WHERE id = $1`, id) }))
    expect(await stream(id)).toEqual([])
  })

  it("when the events cannot be written, the deal is still written and committed", async () => {
    const id = `deal-${randomUUID()}`
    await withDealEvents(prisma, "org-not-in-organizations", [], async (tx) => {
      await insert(tx, id, "org-not-in-organizations")
      return { value: null, createdIds: [id] }
    })
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM deals WHERE id = $1`, id)
    expect(rows).toHaveLength(1)
    expect(await stream(id)).toEqual([])
  })

  it("inside a transaction already open, the events join it and roll back with it", async () => {
    const id = `deal-${randomUUID()}`
    await expect(prisma.$transaction(async (tx) => {
      await withDealEvents(tx, "org-b", [], async (t) => { await insert(t, id); return { value: null, createdIds: [id] } })
      throw new Error("the caller's own failure")
    })).rejects.toThrow("the caller's own failure")
    expect(await prisma.$queryRawUnsafe(`SELECT id FROM deals WHERE id = $1`, id)).toEqual([])
    expect(await stream(id)).toEqual([])
  })
})
