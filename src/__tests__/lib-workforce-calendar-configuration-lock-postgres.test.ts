import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createWorkforceCalendarMovedDay,
  lockWorkforceCalendarConfigurationDates,
  type WorkforceCalendarConfigurationLockDb,
} from "@/lib/workforce/calendar-configuration"

const databaseUrl = process.env.WORKFORCE_CALENDAR_LOCK_TEST_DATABASE_URL
const integrationDatabaseUrl = databaseUrl ?? "postgresql://disabled:disabled@127.0.0.1:1/disabled"
const postgresDescribe = databaseUrl ? describe : describe.skip
const schema = `workforce_calendar_lock_${randomUUID().replaceAll("-", "")}`

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function schemaDatabaseUrl(): string {
  const url = new URL(integrationDatabaseUrl)
  url.searchParams.set("schema", schema)
  return url.toString()
}

async function waitForAdvisoryLockWait(
  observer: PrismaClient,
  backendPid: number,
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const [activity] = await observer.$queryRaw<Array<{
      waitEventType: string | null
      waitEvent: string | null
    }>>(Prisma.sql`
      SELECT
        "wait_event_type" AS "waitEventType",
        "wait_event" AS "waitEvent"
      FROM "pg_stat_activity"
      WHERE "pid" = ${backendPid}
    `)
    if (activity?.waitEventType === "Lock" && activity.waitEvent === "advisory") return
    await delay(20)
  }
  throw new Error(`backend ${backendPid} did not enter an advisory-lock wait`)
}

postgresDescribe("Workforce calendar date locks (real PostgreSQL)", () => {
  let firstClient!: PrismaClient
  let secondClient!: PrismaClient
  let observer!: PrismaClient

  beforeAll(async () => {
    observer = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    await observer.$connect()
    await observer.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    await observer.$executeRawUnsafe(`
      CREATE TYPE "${schema}"."MtmWorkCalendarDayKind" AS ENUM (
        'WORKING_DAY',
        'WEEKEND',
        'PUBLIC_HOLIDAY',
        'COMPANY_HOLIDAY',
        'EXCEPTION_WORKDAY',
        'MOVED_WORKDAY',
        'MOVED_DAY_OFF'
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."mtm_work_calendar_days" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "date" DATE NOT NULL,
        "kind" "${schema}"."MtmWorkCalendarDayKind" NOT NULL,
        "name" TEXT,
        "teamId" TEXT,
        "agentId" TEXT,
        "movedToDate" DATE,
        "routePlanningAllowed" BOOLEAN,
        "source" TEXT NOT NULL DEFAULT 'ADMIN',
        "createdBy" TEXT,
        "updatedBy" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMPTZ
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "calendar_active_org_scope_key"
      ON "${schema}"."mtm_work_calendar_days" ("organizationId", "date")
      WHERE "deletedAt" IS NULL AND "teamId" IS NULL AND "agentId" IS NULL
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."mtm_audit_logs" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "agentId" TEXT,
        "actorUserId" TEXT,
        "action" TEXT NOT NULL,
        "entity" TEXT NOT NULL,
        "entityId" TEXT,
        "metadataKind" TEXT,
        "oldData" JSONB,
        "newData" JSONB,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    firstClient = new PrismaClient({ datasourceUrl: schemaDatabaseUrl() })
    secondClient = new PrismaClient({ datasourceUrl: schemaDatabaseUrl() })
    await Promise.all([firstClient.$connect(), secondClient.$connect()])
  })

  afterAll(async () => {
    await Promise.all([
      firstClient.$disconnect(),
      secondClient.$disconnect(),
    ])
    await observer.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await observer.$disconnect()
  })

  it("sorts reversed two-date requests so both transactions finish without deadlock", async () => {
    const organizationId = `org-calendar-lock-${randomUUID()}`
    const earlierDate = "2026-10-05"
    const laterDate = "2026-10-10"
    const firstHasOneLock = deferred<void>()
    const releaseFirst = deferred<void>()
    const secondBackendPid = deferred<number>()
    const acquisitionOrder: string[] = []

    const firstRun = firstClient.$transaction(async (tx) => {
      let lockCount = 0
      const executeRaw = async (
        query: TemplateStringsArray | Prisma.Sql,
        ...values: unknown[]
      ): Promise<number> => {
        const result = await tx.$executeRaw(query, ...values)
        lockCount += 1
        if (lockCount === 1) {
          firstHasOneLock.resolve()
          await releaseFirst.promise
        }
        return result
      }
      const pausedAfterFirstLock: WorkforceCalendarConfigurationLockDb = {
        $executeRaw: executeRaw as unknown as WorkforceCalendarConfigurationLockDb["$executeRaw"],
      }
      await lockWorkforceCalendarConfigurationDates({
        db: pausedAfterFirstLock,
        organizationId,
        // Deliberately reversed. Without production sorting this transaction
        // holds the later key while the second transaction holds the earlier
        // key, and both deadlock when this barrier opens.
        dates: [laterDate, earlierDate],
      })
      acquisitionOrder.push("first")
    }, { timeout: 5_000 })

    await firstHasOneLock.promise
    const secondRun = secondClient.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::integer AS "pid"
      `
      secondBackendPid.resolve(backend.pid)
      await lockWorkforceCalendarConfigurationDates({
        db: tx,
        organizationId,
        dates: [earlierDate, laterDate],
      })
      acquisitionOrder.push("second")
    }, { timeout: 5_000 })

    try {
      await waitForAdvisoryLockWait(observer, await secondBackendPid.promise)
    } finally {
      releaseFirst.resolve()
    }

    await Promise.all([firstRun, secondRun])
    expect(acquisitionOrder).toEqual(["first", "second"])
  }, 10_000)

  it("persists one reciprocal pair and one audit under concurrent exact retries", async () => {
    const organizationId = `org-calendar-writer-${randomUUID()}`
    const draft = {
      operation: "MOVE_WORKDAY" as const,
      scope: "ORGANIZATION" as const,
      sourceDate: "2026-10-05",
      destinationDate: "2026-10-10",
      name: "Production lock proof",
    }
    const input = {
      organizationId,
      createdByUserId: "scheduler-lock-proof",
      currentDate: "2026-09-29",
      draft,
      audit: {
        actorUserId: "scheduler-lock-proof",
        ipAddress: "203.0.113.12",
        userAgent: "PostgreSQL calendar lock proof",
      },
    }

    const results = await Promise.all([
      createWorkforceCalendarMovedDay({ ...input, db: firstClient }),
      createWorkforceCalendarMovedDay({ ...input, db: secondClient }),
    ])
    expect(results.map((result) => result.created).sort()).toEqual([false, true])

    const rows = await observer.$queryRawUnsafe<Array<{
      date: string
      kind: string
      movedToDate: string
      routePlanningAllowed: boolean
    }>>(`
      SELECT
        "date"::text AS "date",
        "kind"::text AS "kind",
        "movedToDate"::text AS "movedToDate",
        "routePlanningAllowed"
      FROM "${schema}"."mtm_work_calendar_days"
      WHERE "organizationId" = $1 AND "deletedAt" IS NULL
      ORDER BY "date" ASC
    `, organizationId)
    expect(rows).toEqual([
      {
        date: draft.sourceDate,
        kind: "MOVED_DAY_OFF",
        movedToDate: draft.destinationDate,
        routePlanningAllowed: true,
      },
      {
        date: draft.destinationDate,
        kind: "MOVED_WORKDAY",
        movedToDate: draft.sourceDate,
        routePlanningAllowed: false,
      },
    ])

    const [auditState] = await observer.$queryRawUnsafe<Array<{
      count: bigint
      action: string | null
    }>>(`
      SELECT count(*)::bigint AS "count", min("action") AS "action"
      FROM "${schema}"."mtm_audit_logs"
      WHERE "organizationId" = $1
    `, organizationId)
    expect(auditState).toEqual({
      count: 1n,
      action: "WORKFORCE_CALENDAR_MOVED_DAY_CREATED",
    })

    await expect(createWorkforceCalendarMovedDay({
      ...input,
      db: secondClient,
      draft: {
        ...draft,
        sourceDate: draft.destinationDate,
        destinationDate: draft.sourceDate,
      },
    })).rejects.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
    })

    const [finalState] = await observer.$queryRawUnsafe<Array<{
      dayCount: bigint
      auditCount: bigint
    }>>(`
      SELECT
        (SELECT count(*)::bigint
           FROM "${schema}"."mtm_work_calendar_days"
          WHERE "organizationId" = $1 AND "deletedAt" IS NULL) AS "dayCount",
        (SELECT count(*)::bigint
           FROM "${schema}"."mtm_audit_logs"
          WHERE "organizationId" = $1) AS "auditCount"
    `, organizationId)
    expect(finalState).toEqual({ dayCount: 2n, auditCount: 1n })
  }, 10_000)
})
