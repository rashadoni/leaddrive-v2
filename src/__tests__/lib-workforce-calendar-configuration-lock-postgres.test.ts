import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createWorkforceCalendarMovedDay,
  listWorkforceCalendarOverrides,
  lockWorkforceCalendarConfigurationDates,
  reverseWorkforceCalendarMovedDay,
  type WorkforceCalendarConfigurationLockDb,
} from "@/lib/workforce/calendar-configuration"

const databaseUrl = process.env.WORKFORCE_CALENDAR_LOCK_TEST_DATABASE_URL
const integrationDatabaseUrl = databaseUrl ?? "postgresql://disabled:disabled@127.0.0.1:1/disabled"
const postgresDescribe = databaseUrl ? describe : describe.skip
const schema = `workforce_calendar_lock_${randomUUID().replaceAll("-", "")}`
const applicationRole = `calendar_reversal_app_${randomUUID().replaceAll("-", "").slice(0, 20)}`
const applicationPassword = `Calendar_${randomUUID().replaceAll("-", "")}`
const sourceDate = "2026-10-05"
const destinationDate = "2026-10-10"
const currentDate = "2026-09-30"
const reversalActor = "scheduler-reversal-proof"
const reversalAction = "WORKFORCE_CALENDAR_MOVED_DAY_REVERSED"

type CalendarRowState = {
  id: string
  organizationId: string
  date: string
  kind: string
  name: string | null
  teamId: string | null
  agentId: string | null
  movedToDate: string | null
  routePlanningAllowed: boolean | null
  source: string
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type AuditRowState = {
  id: string
  organizationId: string
  actorUserId: string | null
  action: string
  entity: string
  entityId: string | null
  metadataKind: string | null
  [field: string]: unknown
}

type CalendarState = { rows: CalendarRowState[]; audits: AuditRowState[] }
type ReversalInput = Parameters<typeof reverseWorkforceCalendarMovedDay>[0]
type ReversalResult = Awaited<ReturnType<typeof reverseWorkforceCalendarMovedDay>>
type PairFixture = {
  organizationId: string
  scope: "ORGANIZATION" | "TEAM"
  teamId?: string
  sourceId: string
  destinationId: string
  pairGenerationId: string
  createInput: Parameters<typeof createWorkforceCalendarMovedDay>[0]
}

type TransactionHooks = {
  onStart?: (pid: number, tx: Prisma.TransactionClient) => void | Promise<void>
  afterTableLock?: (tx: Prisma.TransactionClient) => void | Promise<void>
  afterCalendarUpdate?: (
    tx: Prisma.TransactionClient,
    args: Prisma.MtmWorkCalendarDayUpdateManyArgs,
    count: number,
  ) => void | Promise<void>
  beforeAuditInsert?: (
    tx: Prisma.TransactionClient,
    args: Prisma.MtmAuditLogCreateArgs,
  ) => void | Promise<void>
  afterAuditInsert?: (
    tx: Prisma.TransactionClient,
    args: Prisma.MtmAuditLogCreateArgs,
  ) => void | Promise<void>
}

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

function schemaDatabaseUrl(application = false): string {
  const url = new URL(integrationDatabaseUrl)
  url.searchParams.set("schema", schema)
  url.searchParams.set("connection_limit", "2")
  if (application) {
    url.username = applicationRole
    url.password = applicationPassword
  }
  return url.toString()
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function boundedSignal<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2_500)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function watch<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  // Attach both handlers immediately, including while another client is paused.
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  )
}

function fulfilled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason
  return result.value
}

/**
 * Only adds fixture schema/context and observation barriers. Every calendar,
 * audit and lock statement still runs on the real service transaction/client.
 */
function calendarTestDb(
  client: PrismaClient,
  organizationId?: string,
  hooks: TransactionHooks = {},
): PrismaClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return <T>(
          action: (tx: Prisma.TransactionClient) => Promise<T>,
          options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
        ): Promise<T> => target.$transaction(async (tx) => {
          // URL schema selects model tables; this separately pins unqualified
          // raw LOCK TABLE / FOR SHARE to this isolated test schema.
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
          if (organizationId) {
            await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, true)`
          }
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid()::integer AS "pid"
          `
          await hooks.onStart?.(backend.pid, tx)
          const observedTx = new Proxy(tx, {
            get(transaction, transactionProperty) {
              if (transactionProperty === "$executeRaw") {
                return async (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
                  const result = await transaction.$executeRaw(query, ...values)
                  const statement = "sql" in query ? query.sql : Array.from(query).join("?")
                  if (/LOCK\s+TABLE\s+"mtm_work_calendar_days"\s+IN\s+SHARE\s+ROW\s+EXCLUSIVE\s+MODE/i.test(statement)) {
                    await hooks.afterTableLock?.(transaction)
                  }
                  return result
                }
              }
              if (transactionProperty === "mtmWorkCalendarDay") {
                return new Proxy(transaction.mtmWorkCalendarDay, {
                  get(model, modelProperty) {
                    if (modelProperty === "updateMany") {
                      return async (args: Prisma.MtmWorkCalendarDayUpdateManyArgs) => {
                        const result = await model.updateMany(args)
                        await hooks.afterCalendarUpdate?.(transaction, args, result.count)
                        return result
                      }
                    }
                    const value: unknown = Reflect.get(model, modelProperty)
                    return typeof value === "function" ? value.bind(model) : value
                  },
                })
              }
              if (transactionProperty === "mtmAuditLog") {
                return new Proxy(transaction.mtmAuditLog, {
                  get(model, modelProperty) {
                    if (modelProperty === "create") {
                      return async (args: Prisma.MtmAuditLogCreateArgs) => {
                        await hooks.beforeAuditInsert?.(transaction, args)
                        const result = await model.create(args)
                        await hooks.afterAuditInsert?.(transaction, args)
                        return result
                      }
                    }
                    const value: unknown = Reflect.get(model, modelProperty)
                    return typeof value === "function" ? value.bind(model) : value
                  },
                })
              }
              const value: unknown = Reflect.get(transaction, transactionProperty)
              return typeof value === "function" ? value.bind(transaction) : value
            },
          })
          return action(observedTx)
        }, options)
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
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
    if (activity?.waitEventType === "Lock" && activity.waitEvent === "advisory") {
      const [lock] = await observer.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE pid = ${backendPid} AND locktype = 'advisory' AND NOT granted
        ) AS "waiting"
      `
      if (lock?.waiting) return
    }
    await delay(20)
  }
  throw new Error(`backend ${backendPid} did not enter an advisory-lock wait`)
}

async function waitForRelationLockWait(
  observer: PrismaClient,
  backendPid: number,
  mode: "RowExclusiveLock" | "ShareRowExclusiveLock",
): Promise<void> {
  const deadline = Date.now() + 2_500
  while (Date.now() < deadline) {
    const [state] = await observer.$queryRawUnsafe<Array<{
      waitEventType: string | null
      waitEvent: string | null
      waiting: boolean
    }>>(`
      SELECT activity.wait_event_type AS "waitEventType",
             activity.wait_event AS "waitEvent",
             EXISTS (
               SELECT 1 FROM pg_locks locks
               WHERE locks.pid = activity.pid AND locks.locktype = 'relation'
                 AND locks.relation = '"${schema}"."mtm_work_calendar_days"'::regclass
                 AND locks.mode = $2 AND NOT locks.granted
             ) AS "waiting"
      FROM pg_stat_activity activity WHERE activity.pid = $1
    `, backendPid, mode)
    if (state?.waitEventType === "Lock" && state.waitEvent === "relation" && state.waiting) return
    await delay(20)
  }
  throw new Error(`backend ${backendPid} did not wait on fixture calendar ${mode}`)
}

postgresDescribe("Workforce calendar date locks (real PostgreSQL)", () => {
  let firstClient!: PrismaClient
  let secondClient!: PrismaClient
  let applicationClient!: PrismaClient
  let observer!: PrismaClient
  let roleCreated = false
  const clients: PrismaClient[] = []

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
      CREATE TABLE "${schema}"."mtm_teams" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "code" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "calendar_single_scope_check" CHECK (num_nonnulls("teamId", "agentId") <= 1)
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "calendar_active_team_scope_key"
      ON "${schema}"."mtm_work_calendar_days" ("organizationId", "date", "teamId")
      WHERE "deletedAt" IS NULL AND "teamId" IS NOT NULL AND "agentId" IS NULL
    `)
    await observer.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "calendar_active_agent_scope_key"
      ON "${schema}"."mtm_work_calendar_days" ("organizationId", "date", "agentId")
      WHERE "deletedAt" IS NULL AND "agentId" IS NOT NULL AND "teamId" IS NULL
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
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    // This is an independent restricted login, not SET ROLE on an owner client.
    // Creation/permission failures are real gate failures when the PG URL exists.
    await observer.$executeRawUnsafe(`
      CREATE ROLE "${applicationRole}" LOGIN NOSUPERUSER NOBYPASSRLS
      PASSWORD ${sqlLiteral(applicationPassword)}
    `)
    roleCreated = true
    await observer.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${applicationRole}"`)
    await observer.$executeRawUnsafe(`GRANT USAGE ON TYPE "${schema}"."MtmWorkCalendarDayKind" TO "${applicationRole}"`)
    await observer.$executeRawUnsafe(`
      GRANT SELECT, INSERT, UPDATE ON "${schema}"."mtm_work_calendar_days" TO "${applicationRole}"
    `)
    // SELECT FOR SHARE requires UPDATE privilege as well as SELECT.
    await observer.$executeRawUnsafe(`GRANT SELECT, UPDATE ON "${schema}"."mtm_teams" TO "${applicationRole}"`)
    await observer.$executeRawUnsafe(`GRANT SELECT, INSERT ON "${schema}"."mtm_audit_logs" TO "${applicationRole}"`)
    for (const table of ["mtm_work_calendar_days", "mtm_teams", "mtm_audit_logs"]) {
      await observer.$executeRawUnsafe(`ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY`)
      await observer.$executeRawUnsafe(`ALTER TABLE "${schema}"."${table}" FORCE ROW LEVEL SECURITY`)
      await observer.$executeRawUnsafe(`
        CREATE POLICY tenant_isolation ON "${schema}"."${table}"
        USING (
          "organizationId" = current_setting('app.org_id', true)
          OR current_setting('app.rls_bypass', true) = 'on'
        )
        WITH CHECK (
          "organizationId" = current_setting('app.org_id', true)
          OR current_setting('app.rls_bypass', true) = 'on'
        )
      `)
    }
    firstClient = new PrismaClient({ datasourceUrl: schemaDatabaseUrl() })
    secondClient = new PrismaClient({ datasourceUrl: schemaDatabaseUrl() })
    applicationClient = new PrismaClient({ datasourceUrl: schemaDatabaseUrl(true) })
    clients.push(firstClient, secondClient, applicationClient)
    await Promise.all(clients.map((client) => client.$connect()))
  })

  afterAll(async () => {
    const failures: unknown[] = []
    const disconnections = await Promise.allSettled(clients.map((client) => client.$disconnect()))
    for (const result of disconnections) {
      if (result.status === "rejected") failures.push(result.reason)
    }
    if (observer) {
      try {
        await observer.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } catch (error) { failures.push(error) }
      if (roleCreated) {
        try {
          await observer.$executeRawUnsafe(`DROP ROLE "${applicationRole}"`)
        } catch (error) { failures.push(error) }
      }
      try { await observer.$disconnect() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new Error("calendar PostgreSQL fixture cleanup failed", { cause: failures[0] })
  })

  async function readState(organizationId: string): Promise<CalendarState> {
    const rows = await observer.$queryRawUnsafe<Array<{ row: CalendarRowState }>>(`
      SELECT to_jsonb(day) AS "row" FROM "${schema}"."mtm_work_calendar_days" day
      WHERE "organizationId" = $1 ORDER BY "date", "id"
    `, organizationId)
    const audits = await observer.$queryRawUnsafe<Array<{ row: AuditRowState }>>(`
      SELECT to_jsonb(audit) AS "row" FROM "${schema}"."mtm_audit_logs" audit
      WHERE "organizationId" = $1 ORDER BY "id"
    `, organizationId)
    return { rows: rows.map(({ row }) => row), audits: audits.map(({ row }) => row) }
  }

  async function inventoryGeneration(pair: Pick<PairFixture, "organizationId" | "scope" | "teamId">): Promise<string> {
    const days = await listWorkforceCalendarOverrides({
      ...pair,
      currentDate,
      start: sourceDate,
      endExclusive: "2026-10-11",
      db: firstClient,
    })
    const source = days.find((day) => day.date === sourceDate && day.kind === "MOVED_DAY_OFF")
    const generation = source?.pairGenerationId
    if (!generation) throw new Error("actual calendar inventory did not expose the complete pair generation")
    expect(generation).toMatch(/^[a-f0-9]{64}$/)
    return generation
  }

  async function seedPair(scope: "ORGANIZATION" | "TEAM" = "ORGANIZATION"): Promise<PairFixture> {
    const organizationId = `org-calendar-reversal-${randomUUID()}`
    const teamId = scope === "TEAM" ? `team-calendar-reversal-${randomUUID()}` : undefined
    if (teamId) {
      await observer.$executeRawUnsafe(`
        INSERT INTO "${schema}"."mtm_teams" ("id", "organizationId", "name", "code")
        VALUES ($1, $2, 'Calendar reversal team', 'CAL-REV')
      `, teamId, organizationId)
    }
    const createInput: PairFixture["createInput"] = {
      organizationId,
      createdByUserId: "scheduler-creation-proof",
      currentDate,
      draft: {
        operation: "MOVE_WORKDAY",
        scope,
        ...(teamId ? { teamId } : {}),
        sourceDate,
        destinationDate,
        name: "Atomic reversal PostgreSQL proof",
      },
      audit: { actorUserId: "scheduler-creation-proof" },
      db: calendarTestDb(firstClient, organizationId),
    }
    const created = await createWorkforceCalendarMovedDay(createInput)
    expect(created.created).toBe(true)
    const state = await readState(organizationId)
    const source = state.rows.find((row) => row.kind === "MOVED_DAY_OFF")
    const destination = state.rows.find((row) => row.kind === "MOVED_WORKDAY")
    if (!source || !destination) throw new Error("missing seeded PostgreSQL pair")
    return {
      organizationId, scope, teamId, createInput,
      sourceId: source.id,
      destinationId: destination.id,
      pairGenerationId: await inventoryGeneration({ organizationId, scope, teamId }),
    }
  }

  function reversalInput(pair: PairFixture, db: PrismaClient = calendarTestDb(firstClient, pair.organizationId)): ReversalInput {
    return {
      organizationId: pair.organizationId,
      updatedByUserId: reversalActor,
      currentDate,
      draft: {
        operation: "REVERSE_MOVE_WORKDAY",
        scope: pair.scope,
        ...(pair.teamId ? { teamId: pair.teamId } : {}),
        sourceDate,
        destinationDate,
        pairGenerationId: pair.pairGenerationId,
      },
      audit: { actorUserId: reversalActor, ipAddress: "203.0.113.12", userAgent: "Calendar PostgreSQL reversal proof" },
      db,
    }
  }

  function expectReversedOriginals(state: CalendarState, pair: PairFixture): void {
    const source = state.rows.find((row) => row.id === pair.sourceId)
    const destination = state.rows.find((row) => row.id === pair.destinationId)
    expect(source?.deletedAt).not.toBeNull()
    expect(source?.deletedAt).toBeDefined()
    expect(source?.deletedAt).toBe(destination?.deletedAt)
    expect(source?.updatedAt).toBe(source?.deletedAt)
    expect(destination?.updatedAt).toBe(source?.deletedAt)
    expect(source?.updatedBy).toBe(reversalActor)
    expect(destination?.updatedBy).toBe(reversalActor)
    expect(state.audits.filter((audit) => audit.action === reversalAction)).toMatchObject([{
      organizationId: pair.organizationId,
      actorUserId: reversalActor,
      entity: "work_calendar_pair",
      entityId: pair.pairGenerationId,
      metadataKind: "workforce_calendar_configuration",
    }])
  }

  async function insertParent(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    // Deliberately bypasses date advisory helpers, as a legacy parent writer does.
    await tx.$executeRawUnsafe(`
      INSERT INTO "${schema}"."mtm_work_calendar_days"
        ("id", "organizationId", "date", "kind", "name", "routePlanningAllowed", "createdBy", "updatedBy")
      VALUES ($1, $2, $3::date, 'COMPANY_HOLIDAY', 'Changed inherited Route baseline', FALSE, 'legacy-proof', 'legacy-proof')
    `, `parent-calendar-${randomUUID()}`, organizationId, sourceDate)
  }

  async function withTrigger(
    table: "mtm_work_calendar_days" | "mtm_audit_logs",
    timing: "BEFORE UPDATE" | "BEFORE INSERT",
    body: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const trigger = `calendar_proof_${randomUUID().replaceAll("-", "")}`
    await observer.$executeRawUnsafe(`
      CREATE FUNCTION "${schema}"."${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $proof$
      BEGIN ${body} END;
      $proof$
    `)
    let triggerCreated = false
    try {
      await observer.$executeRawUnsafe(`
        CREATE TRIGGER "${trigger}" ${timing} ON "${schema}"."${table}"
        FOR EACH ROW EXECUTE FUNCTION "${schema}"."${trigger}"()
      `)
      triggerCreated = true
      await action()
    } finally {
      try {
        if (triggerCreated) await observer.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "${schema}"."${table}"`)
      } finally {
        await observer.$executeRawUnsafe(`DROP FUNCTION "${schema}"."${trigger}"()`)
      }
    }
  }

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

    const firstOutcome = watch(firstRun)
    let secondOutcome: Promise<PromiseSettledResult<void>> | undefined
    try {
      await boundedSignal(firstHasOneLock.promise, "first date lock")
      secondOutcome = watch(secondClient.$transaction(async (tx) => {
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
      }, { timeout: 5_000 }))
      await waitForAdvisoryLockWait(observer, await boundedSignal(secondBackendPid.promise, "second backend PID"))
    } finally {
      releaseFirst.resolve()
      await Promise.allSettled([firstOutcome, ...(secondOutcome ? [secondOutcome] : [])])
    }
    fulfilled(await firstOutcome)
    if (!secondOutcome) throw new Error("second date-lock transaction did not start")
    fulfilled(await secondOutcome)
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

    const outcomes = await Promise.allSettled([
      createWorkforceCalendarMovedDay({ ...input, db: calendarTestDb(firstClient, organizationId) }),
      createWorkforceCalendarMovedDay({ ...input, db: calendarTestDb(secondClient, organizationId) }),
    ])
    const results = outcomes.map(fulfilled)
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
      db: calendarTestDb(secondClient, organizationId),
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

  it("serializes exact reversals into one atomic deletion and one audit-backed replay", async () => {
    const pair = await seedPair()
    const before = await readState(pair.organizationId)
    const firstHasTableLock = deferred<void>()
    const releaseFirst = deferred<void>()
    const secondPid = deferred<number>()
    const firstOutcome = watch(reverseWorkforceCalendarMovedDay(reversalInput(pair,
      calendarTestDb(firstClient, pair.organizationId, {
        afterTableLock: async () => {
          firstHasTableLock.resolve()
          await releaseFirst.promise
        },
      }),
    )))
    let secondOutcome: Promise<PromiseSettledResult<ReversalResult>> | undefined
    try {
      await boundedSignal(firstHasTableLock.promise, "first reversal table lock")
      secondOutcome = watch(reverseWorkforceCalendarMovedDay(reversalInput(pair,
        calendarTestDb(secondClient, pair.organizationId, {
          onStart: (pid) => secondPid.resolve(pid),
        }),
      )))
      await waitForAdvisoryLockWait(observer, await boundedSignal(secondPid.promise, "second reversal PID"))
    } finally {
      releaseFirst.resolve()
      await Promise.allSettled([firstOutcome, ...(secondOutcome ? [secondOutcome] : [])])
    }
    if (!secondOutcome) throw new Error("second reversal did not start")
    const results = [fulfilled(await firstOutcome), fulfilled(await secondOutcome)]
    expect(results.map((result) => result.reversed).sort()).toEqual([false, true])
    expect(results.every((result) => result.pairGenerationId === pair.pairGenerationId)).toBe(true)
    const after = await readState(pair.organizationId)
    expect(after.rows).toHaveLength(2)
    expect(after.audits).toHaveLength(2)
    expectReversedOriginals(after, pair)
    for (const original of before.rows) {
      expect(after.rows.find((row) => row.id === original.id)).toMatchObject({
        createdAt: original.createdAt,
        createdBy: original.createdBy,
        kind: original.kind,
        routePlanningAllowed: original.routePlanningAllowed,
      })
    }
  }, 15_000)

  it("rolls back the first actual soft-delete when PostgreSQL suppresses the second CAS", async () => {
    const pair = await seedPair()
    const before = await readState(pair.organizationId)
    const affectedCounts: number[] = []
    let sawFirstDeleteInsideTransaction = false
    await withTrigger("mtm_work_calendar_days", "BEFORE UPDATE", `
      IF NEW."id" = ${sqlLiteral(pair.destinationId)} AND NEW."deletedAt" IS NOT NULL THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    `, async () => {
      const db = calendarTestDb(firstClient, pair.organizationId, {
        afterCalendarUpdate: async (tx, args, count) => {
          affectedCounts.push(count)
          if (args.where?.id === pair.sourceId && count === 1) {
            const source = await tx.mtmWorkCalendarDay.findFirst({ where: { id: pair.sourceId } })
            sawFirstDeleteInsideTransaction = source?.deletedAt != null
          }
        },
      })
      await expect(reverseWorkforceCalendarMovedDay(reversalInput(pair, db))).rejects.toMatchObject({
        code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED",
      })
      expect(affectedCounts).toEqual([1, 0])
      expect(sawFirstDeleteInsideTransaction).toBe(true)
      expect(await readState(pair.organizationId)).toEqual(before)
    })
  }, 15_000)

  it("rolls back both actual soft-deletes when the transactional audit insert fails", async () => {
    const pair = await seedPair()
    const before = await readState(pair.organizationId)
    let auditAttemptSawBothDeleted = false
    await withTrigger("mtm_audit_logs", "BEFORE INSERT", `
      IF NEW."organizationId" = ${sqlLiteral(pair.organizationId)}
        AND NEW."action" = ${sqlLiteral(reversalAction)} THEN
        RAISE EXCEPTION 'calendar reversal audit failure proof' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    `, async () => {
      const db = calendarTestDb(firstClient, pair.organizationId, {
        beforeAuditInsert: async (tx, args) => {
          if (args.data.action !== reversalAction) return
          const originals = await tx.mtmWorkCalendarDay.findMany({
            where: { id: { in: [pair.sourceId, pair.destinationId] } },
            select: { deletedAt: true },
          })
          auditAttemptSawBothDeleted = originals.length === 2 && originals.every((row) => row.deletedAt != null)
        },
      })
      await expect(reverseWorkforceCalendarMovedDay(reversalInput(pair, db))).rejects.toThrow()
      expect(auditAttemptSawBothDeleted).toBe(true)
      expect(await readState(pair.organizationId)).toEqual(before)
    })
  }, 15_000)

  it("replays an old generation after waiting for an identical replacement without touching the replacement", async () => {
    const pair = await seedPair()
    expect((await reverseWorkforceCalendarMovedDay(reversalInput(pair))).reversed).toBe(true)
    const oldState = await readState(pair.organizationId)
    const replacementInserted = deferred<void>()
    const releaseReplacement = deferred<void>()
    const replayPid = deferred<number>()
    const replacementOutcome = watch(createWorkforceCalendarMovedDay({
      ...pair.createInput,
      db: calendarTestDb(firstClient, pair.organizationId, {
        afterAuditInsert: async (_tx, args) => {
          if (args.data.action !== "WORKFORCE_CALENDAR_MOVED_DAY_CREATED") return
          replacementInserted.resolve()
          await releaseReplacement.promise
        },
      }),
    }))
    let replayOutcome: Promise<PromiseSettledResult<ReversalResult>> | undefined
    try {
      await boundedSignal(replacementInserted.promise, "uncommitted replacement pair and audit")
      const retry = reversalInput(pair, calendarTestDb(secondClient, pair.organizationId, {
        onStart: (pid) => replayPid.resolve(pid),
      }))
      replayOutcome = watch(reverseWorkforceCalendarMovedDay({
        ...retry,
        currentDate: "2026-11-01",
        updatedByUserId: "different-authorized-retry-user",
        audit: { actorUserId: "different-authorized-retry-user" },
      }))
      await waitForAdvisoryLockWait(observer, await boundedSignal(replayPid.promise, "old-generation replay PID"))
    } finally {
      releaseReplacement.resolve()
      await Promise.allSettled([replacementOutcome, ...(replayOutcome ? [replayOutcome] : [])])
    }
    expect(fulfilled(await replacementOutcome).created).toBe(true)
    if (!replayOutcome) throw new Error("old-generation replay did not start")
    expect(fulfilled(await replayOutcome)).toMatchObject({ reversed: false, pairGenerationId: pair.pairGenerationId })
    const after = await readState(pair.organizationId)
    const active = after.rows.filter((row) => row.deletedAt === null)
    expect(active).toHaveLength(2)
    expect(active.every((row) => row.id !== pair.sourceId && row.id !== pair.destinationId)).toBe(true)
    expect(after.rows.filter((row) => row.id === pair.sourceId || row.id === pair.destinationId)).toEqual(oldState.rows)
    expect(after.audits.filter((audit) => audit.action === reversalAction)).toEqual(
      oldState.audits.filter((audit) => audit.action === reversalAction),
    )
    expect(after.audits).toHaveLength(3)
    expect(await inventoryGeneration(pair)).not.toBe(pair.pairGenerationId)
  }, 15_000)

  it("rejects a stale generation when only the destination is replaced with an identical row", async () => {
    const pair = await seedPair()
    const replacementId = `destination-replacement-${randomUUID()}`
    await firstClient.$transaction(async (tx) => {
      const original = await tx.mtmWorkCalendarDay.findFirst({ where: { id: pair.destinationId } })
      if (!original) throw new Error("missing original destination for replacement proof")
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."mtm_work_calendar_days"
        SET "deletedAt" = TIMESTAMP '2026-09-30 12:00:00.000',
            "updatedAt" = TIMESTAMP '2026-09-30 12:00:00.000', "updatedBy" = 'replacement-proof'
        WHERE "id" = $1
      `, pair.destinationId)
      // Copy the PRE-delete provenance too: only the new row ID changes.
      // Using the deleted row's updatedBy/updatedAt would weaken this ABA proof.
      await tx.mtmWorkCalendarDay.create({ data: { ...original, id: replacementId, deletedAt: null } })
    })
    const before = await readState(pair.organizationId)
    const newGeneration = await inventoryGeneration(pair)
    expect(newGeneration).not.toBe(pair.pairGenerationId)
    await expect(reverseWorkforceCalendarMovedDay(reversalInput(pair))).rejects.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED",
    })
    expect(await readState(pair.organizationId)).toEqual(before)
    expect(before.rows.filter((row) => row.deletedAt === null).map((row) => row.id).sort()).toEqual(
      [pair.sourceId, replacementId].sort(),
    )
    expect(before.audits.filter((audit) => audit.action === reversalAction)).toEqual([])
  }, 15_000)

  it("does not replay deleted originals without a matching reversal receipt or touch their replacement", async () => {
    const pair = await seedPair()
    await observer.$executeRawUnsafe(`
      UPDATE "${schema}"."mtm_work_calendar_days"
      SET "deletedAt" = TIMESTAMP '2026-09-30 12:00:00.000',
          "updatedAt" = TIMESTAMP '2026-09-30 12:00:00.000', "updatedBy" = 'unreceipted-proof'
      WHERE "organizationId" = $1 AND "id" IN ($2, $3)
    `, pair.organizationId, pair.sourceId, pair.destinationId)
    expect((await createWorkforceCalendarMovedDay(pair.createInput)).created).toBe(true)
    const before = await readState(pair.organizationId)
    await expect(reverseWorkforceCalendarMovedDay(reversalInput(pair))).rejects.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED",
    })
    expect(await readState(pair.organizationId)).toEqual(before)
    expect(before.rows.filter((row) => row.deletedAt === null)).toHaveLength(2)
    expect(before.audits.filter((audit) => audit.action === reversalAction)).toEqual([])
  }, 15_000)

  it("rejects an inherited Route baseline change without deleting either team row", async () => {
    const pair = await seedPair("TEAM")
    await secondClient.$transaction((tx) => insertParent(tx, pair.organizationId))
    const before = await readState(pair.organizationId)
    await expect(reverseWorkforceCalendarMovedDay(reversalInput(pair))).rejects.toMatchObject({
      code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_ROUTE_CHANGED",
    })
    expect(await readState(pair.organizationId)).toEqual(before)
  }, 15_000)

  it("keeps an absent parent stable until reversal commits against a noncooperating insert", async () => {
    const pair = await seedPair("TEAM")
    const reversalHasTableLock = deferred<void>()
    const releaseReversal = deferred<void>()
    const parentPid = deferred<number>()
    const parentInserted = deferred<void>()
    const releaseParentCommit = deferred<void>()
    const reversalOutcome = watch(reverseWorkforceCalendarMovedDay(reversalInput(pair,
      calendarTestDb(firstClient, pair.organizationId, {
        afterTableLock: async () => {
          reversalHasTableLock.resolve()
          await releaseReversal.promise
        },
      }),
    )))
    let parentOutcome: Promise<PromiseSettledResult<void>> | undefined
    let stateBeforeParentCommit: CalendarState | undefined
    try {
      await boundedSignal(reversalHasTableLock.promise, "reversal holding table lock")
      parentOutcome = watch(secondClient.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`
        parentPid.resolve(backend.pid)
        await insertParent(tx, pair.organizationId)
        parentInserted.resolve()
        await releaseParentCommit.promise
      }, { timeout: 10_000 }))
      await waitForRelationLockWait(observer, await boundedSignal(parentPid.promise, "parent writer PID"), "RowExclusiveLock")
      releaseReversal.resolve()
      expect(fulfilled(await reversalOutcome).reversed).toBe(true)
      await boundedSignal(parentInserted.promise, "parent insert after reversal commit")
      stateBeforeParentCommit = await readState(pair.organizationId)
    } finally {
      releaseReversal.resolve()
      releaseParentCommit.resolve()
      await Promise.allSettled([reversalOutcome, ...(parentOutcome ? [parentOutcome] : [])])
    }
    fulfilled(await reversalOutcome)
    if (!parentOutcome || !stateBeforeParentCommit) throw new Error("parent race did not complete observation")
    fulfilled(await parentOutcome)
    expectReversedOriginals(stateBeforeParentCommit, pair)
    expect(stateBeforeParentCommit.rows).toHaveLength(2)
    const after = await readState(pair.organizationId)
    expectReversedOriginals(after, pair)
    expect(after.rows.filter((row) => row.deletedAt === null)).toMatchObject([{
      date: sourceDate, kind: "COMPANY_HOLIDAY", teamId: null, routePlanningAllowed: false,
    }])
  }, 15_000)

  it("waits for a prior noncooperating parent write and then checks its committed Route baseline", async () => {
    const pair = await seedPair("TEAM")
    const parentInserted = deferred<void>()
    const releaseParent = deferred<void>()
    const reversalPid = deferred<number>()
    const before = await readState(pair.organizationId)
    const parentOutcome = watch(firstClient.$transaction(async (tx) => {
      await insertParent(tx, pair.organizationId)
      parentInserted.resolve()
      await releaseParent.promise
    }, { timeout: 10_000 }))
    let reversalOutcome: Promise<PromiseSettledResult<ReversalResult>> | undefined
    try {
      await boundedSignal(parentInserted.promise, "prior uncommitted parent insert")
      reversalOutcome = watch(reverseWorkforceCalendarMovedDay(reversalInput(pair,
        calendarTestDb(secondClient, pair.organizationId, {
          onStart: (pid) => reversalPid.resolve(pid),
        }),
      )))
      await waitForRelationLockWait(observer,
        await boundedSignal(reversalPid.promise, "waiting reversal PID"), "ShareRowExclusiveLock")
    } finally {
      releaseParent.resolve()
      await Promise.allSettled([parentOutcome, ...(reversalOutcome ? [reversalOutcome] : [])])
    }
    fulfilled(await parentOutcome)
    if (!reversalOutcome) throw new Error("reversal behind parent did not start")
    expect(await reversalOutcome).toMatchObject({
      status: "rejected", reason: { code: "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_ROUTE_CHANGED" },
    })
    const after = await readState(pair.organizationId)
    expect(after.rows.filter((row) => row.id === pair.sourceId || row.id === pair.destinationId)).toEqual(before.rows)
    expect(after.audits).toEqual(before.audits)
    expect(after.rows.filter((row) => row.teamId === null && row.deletedAt === null)).toMatchObject([{
      date: sourceDate, kind: "COMPANY_HOLIDAY", routePlanningAllowed: false,
    }])
  }, 15_000)

  it("uses ordinary UPDATE privileges under forced tenant RLS and fails closed for foreign or absent context", async () => {
    const own = await seedPair("TEAM")
    const foreign = await seedPair("TEAM")
    const foreignBefore = await readState(foreign.organizationId)
    const [role] = await applicationClient.$queryRawUnsafe<Array<{
      role: string
      superuser: boolean
      bypassRls: boolean
      tableOwner: boolean
      canUpdate: boolean
      canDelete: boolean
      canTruncate: boolean
    }>>(`
      SELECT current_user::text AS "role", roles.rolsuper AS "superuser", roles.rolbypassrls AS "bypassRls",
             tables.relowner = roles.oid AS "tableOwner",
             has_table_privilege(current_user, tables.oid, 'UPDATE') AS "canUpdate",
             has_table_privilege(current_user, tables.oid, 'DELETE') AS "canDelete",
             has_table_privilege(current_user, tables.oid, 'TRUNCATE') AS "canTruncate"
      FROM pg_roles roles JOIN pg_class tables ON tables.oid = '"${schema}"."mtm_work_calendar_days"'::regclass
      WHERE roles.rolname = current_user
    `)
    expect(role).toEqual({
      role: applicationRole, superuser: false, bypassRls: false, tableOwner: false,
      canUpdate: true, canDelete: false, canTruncate: false,
    })
    const ownDb = calendarTestDb(applicationClient, own.organizationId)
    await expect(reverseWorkforceCalendarMovedDay(reversalInput(foreign, ownDb))).rejects.toThrow()
    expect(await readState(foreign.organizationId)).toEqual(foreignBefore)
    const ownBefore = await readState(own.organizationId)
    const noContextDb = calendarTestDb(applicationClient)
    await expect(reverseWorkforceCalendarMovedDay(reversalInput(own, noContextDb))).rejects.toThrow()
    expect(await readState(own.organizationId)).toEqual(ownBefore)
    expect(await applicationClient.mtmWorkCalendarDay.findMany({ where: { organizationId: foreign.organizationId } })).toEqual([])
    expect((await reverseWorkforceCalendarMovedDay(reversalInput(own, ownDb))).reversed).toBe(true)
    const ownAfter = await readState(own.organizationId)
    expectReversedOriginals(ownAfter, own)
    await observer.$executeRawUnsafe(`
      UPDATE "${schema}"."mtm_teams" SET "isActive" = FALSE WHERE "id" = $1
    `, own.teamId)
    const retry = reversalInput(own, ownDb)
    expect(await reverseWorkforceCalendarMovedDay({
      ...retry,
      currentDate: "2026-11-01",
      updatedByUserId: "authorized-late-retry-user",
      audit: { actorUserId: "authorized-late-retry-user" },
    })).toMatchObject({ reversed: false, pairGenerationId: own.pairGenerationId })
    expect(await readState(own.organizationId)).toEqual(ownAfter)
    expect(await readState(foreign.organizationId)).toEqual(foreignBefore)
  }, 15_000)
})
