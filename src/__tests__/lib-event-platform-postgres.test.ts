import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  AggregateVersionConflictError,
  appendDomainEvent,
  type EventPlatformTransaction,
} from "@/lib/event-platform"

const databaseUrl = process.env.EVENT_PLATFORM_TEST_DATABASE_URL
const integrationDatabaseUrl = databaseUrl ?? "postgresql://disabled:disabled@127.0.0.1:1/disabled"
const postgresDescribe = databaseUrl ? describe : describe.skip

postgresDescribe("event-platform PostgreSQL optimistic append", () => {
  let prisma!: PrismaClient

  beforeAll(() => {
    prisma = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: integrationDatabaseUrl } } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  function append(
    aggregateId: string,
    expectedVersion: number | undefined,
    probe: string,
    options: { timezone?: string; occurredAt?: Date } = {},
  ) {
    return prisma.$transaction(async (tx) => {
      if (options.timezone) {
        await tx.$queryRawUnsafe("SELECT set_config('TimeZone', $1, true)", options.timezone)
      }
      return appendDomainEvent(
        tx as unknown as EventPlatformTransaction,
        {
          organizationId: "org-b",
          domain: "finance",
          aggregateType: "sdk-probe",
          aggregateId,
          expectedVersion,
          eventType: "finance.sdk-probe.v1",
          source: "urn:leaddrive:event-platform-ci",
          dataSchema: "urn:leaddrive:schema:finance.sdk-probe:v1",
          classification: "internal",
          producer: "event-platform-postgres-ci",
          producerVersion: "integration-v1",
          data: { probe },
          occurredAt: options.occurredAt,
        },
      )
    })
  }

  it("supports create, positive expected update, stale rejection and one concurrent winner", async () => {
    const aggregateId = `sdk-optimistic-${randomUUID()}`

    const first = await append(aggregateId, 0, "create")
    const second = await append(aggregateId, 1, "advance")
    expect(first.aggregateVersion).toBe(1n)
    expect(second.aggregateVersion).toBe(2n)

    await expect(append(aggregateId, 1, "stale")).rejects.toBeInstanceOf(
      AggregateVersionConflictError,
    )

    const concurrent = await Promise.allSettled([
      append(aggregateId, 2, "concurrent-a"),
      append(aggregateId, 2, "concurrent-b"),
    ])
    const fulfilled = concurrent.filter((result) => result.status === "fulfilled")
    const rejected = concurrent.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(fulfilled.map((result) => result.status === "fulfilled"
      ? result.value.aggregateVersion
      : null)).toEqual([3n])
    expect(rejected).toHaveLength(1)
    expect(rejected.map((result) => result.status === "rejected" ? result.reason : null))
      .toEqual([expect.any(AggregateVersionConflictError)])

    const [coherence] = await prisma.$queryRawUnsafe<Array<{
      head_version: bigint
      event_count: bigint
      outbox_count: bigint
      version_count: bigint
    }>>(`
      SELECT h."currentVersion" AS head_version,
             count(DISTINCT e."id") AS event_count,
             count(DISTINCT o."id") AS outbox_count,
             count(DISTINCT e."aggregateVersion") AS version_count
        FROM "event_aggregate_heads" h
        JOIN "domain_events" e
          ON e."organizationId" = h."organizationId"
         AND e."aggregateType" = h."aggregateType"
         AND e."aggregateId" = h."aggregateId"
        JOIN "event_outbox" o
          ON o."organizationId" = e."organizationId" AND o."eventId" = e."id"
       WHERE h."organizationId" = 'org-b'
         AND h."aggregateType" = 'sdk-probe'
         AND h."aggregateId" = $1
       GROUP BY h."currentVersion"
    `, aggregateId)
    expect(coherence).toEqual({
      head_version: 3n,
      event_count: 3n,
      outbox_count: 3n,
      version_count: 3n,
    })
  })

  it.each(["UTC", "Europe/Berlin", "Asia/Baku", "America/New_York"])(
    "keeps head, event and outbox timestamps coherent in PostgreSQL timezone %s",
    async (timezone) => {
      const aggregateId = `sdk-timezone-${randomUUID()}`
      // Include milliseconds: the deferred production invariant compares exact
      // TIMESTAMP(3) values, not only the date or aggregate version.
      const times = [
        new Date("2026-10-25T12:06:19.123Z"),
        new Date("2026-10-25T12:07:47.456Z"),
        new Date("2026-07-01T08:00:00.789Z"),
      ]
      // Exercise optimistic create, optimistic update and blind update. Each
      // transaction must commit with the actual foundation guards enabled.
      for (const [index, expectedVersion] of [0, 1, undefined].entries()) {
        const result = await append(aggregateId, expectedVersion, `timezone-${index}`, {
          timezone,
          occurredAt: times[index],
        })
        expect(result.aggregateVersion).toBe(BigInt(index + 1))
        const [stored] = await prisma.$queryRawUnsafe<Array<{
          head_at: Date
          event_at: Date
          envelope_time: string
        }>>(`
          SELECT h."lastEventAt" AS head_at,
                 e."occurredAt" AS event_at,
                 o."envelope"->>'time' AS envelope_time
            FROM "event_aggregate_heads" h
            JOIN "domain_events" e
              ON e."organizationId" = h."organizationId" AND e.id = h."lastEventId"
            JOIN "event_outbox" o
              ON o."organizationId" = e."organizationId" AND o."eventId" = e.id
           WHERE h."organizationId" = 'org-b'
             AND h."aggregateType" = 'sdk-probe' AND h."aggregateId" = $1
        `, aggregateId)
        expect(stored.head_at.toISOString()).toBe(times[index].toISOString())
        expect(stored.event_at.toISOString()).toBe(times[index].toISOString())
        expect(stored.envelope_time).toBe(times[index].toISOString())
      }
    },
  )

  it("keeps blind append create-or-increment semantics", async () => {
    const aggregateId = `sdk-blind-${randomUUID()}`
    await expect(append(aggregateId, undefined, "blind-create")).resolves.toMatchObject({
      aggregateVersion: 1n,
    })
    await expect(append(aggregateId, undefined, "blind-increment")).resolves.toMatchObject({
      aggregateVersion: 2n,
    })
  })
})
