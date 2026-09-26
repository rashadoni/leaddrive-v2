import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { lockWorkforceExceptionDecisionStream } from "@/lib/workforce/exception-case-writer"
import {
  lockWorkforceExceptionLinkedMutation,
  type WorkforceExceptionLinkedMutationDb,
} from "@/lib/workforce/exception-linked-mutation"

const databaseUrl = process.env.WORKFORCE_EXCEPTION_LOCK_TEST_DATABASE_URL
const integrationDatabaseUrl = databaseUrl ?? "postgresql://disabled:disabled@127.0.0.1:1/disabled"
const postgresDescribe = databaseUrl ? describe : describe.skip
const schema = `workforce_exception_lock_${randomUUID().replaceAll("-", "")}`
const organizationId = "org-workforce-lock-proof"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

postgresDescribe("Workforce exception shared lock (real PostgreSQL)", () => {
  let observer!: PrismaClient
  let terminalClient!: PrismaClient
  let linkedClient!: PrismaClient

  beforeAll(async () => {
    observer = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    terminalClient = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    linkedClient = new PrismaClient({ datasourceUrl: integrationDatabaseUrl })
    await observer.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."case_decisions" (
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "decisions" JSONB NOT NULL DEFAULT '[]'::jsonb,
        PRIMARY KEY ("organization_id", "case_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."linked_mutations" (
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "mutation_count" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY ("organization_id", "case_id")
      )
    `)
    await observer.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."linked_requests" (
        "organization_id" TEXT NOT NULL,
        "case_id" TEXT NOT NULL,
        "client_request_id" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        PRIMARY KEY ("organization_id", "client_request_id")
      )
    `)
  })

  afterAll(async () => {
    await observer?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    await Promise.all([
      observer?.$disconnect(),
      terminalClient?.$disconnect(),
      linkedClient?.$disconnect(),
    ])
  })

  function linkedMutationDb(tx: Prisma.TransactionClient): WorkforceExceptionLinkedMutationDb {
    return {
      $executeRaw: tx.$executeRaw.bind(tx) as WorkforceExceptionLinkedMutationDb["$executeRaw"],
      workforceExceptionDecision: {
        findMany: async (args) => {
          const rows = await tx.$queryRawUnsafe<Array<{ decisions: string[] }>>(`
            SELECT "decisions"
              FROM "${schema}"."case_decisions"
             WHERE "organization_id" = $1 AND "case_id" = $2
          `, args.where.organizationId, args.where.caseId)
          return (rows[0]?.decisions ?? [])
            .slice(0, args.take)
            .map((decisionCode) => ({ decisionCode }))
        },
      },
    }
  }

  async function configureBoundedTransaction(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '7s'")
  }

  async function waitForAdvisoryLockWait(pid: number): Promise<void> {
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      const rows = await observer.$queryRawUnsafe<Array<{
        wait_event_type: string | null
        wait_event: string | null
      }>>(`
        SELECT wait_event_type, wait_event
          FROM pg_stat_activity
         WHERE pid = $1
      `, pid)
      if (rows[0]?.wait_event_type === "Lock" && rows[0]?.wait_event === "advisory") return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`backend ${pid} did not wait on the shared advisory lock`)
  }

  async function readState(caseId: string): Promise<{
    decisions: string[]
    linked_mutation_count: number
  }> {
    const rows = await observer.$queryRawUnsafe<Array<{
      decisions: string[]
      linked_mutation_count: number
    }>>(`
      SELECT decisions."decisions",
             mutations."mutation_count" AS "linked_mutation_count"
        FROM "${schema}"."case_decisions" decisions
        JOIN "${schema}"."linked_mutations" mutations
          ON mutations."organization_id" = decisions."organization_id"
         AND mutations."case_id" = decisions."case_id"
       WHERE decisions."organization_id" = $1 AND decisions."case_id" = $2
    `, organizationId, caseId)
    if (!rows[0]) throw new Error("missing Workforce lock proof state")
    return rows[0]
  }

  it("makes a linked writer wait for terminal resolution and reject from the post-lock lifecycle", async () => {
    const caseId = `terminal-first-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."case_decisions" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."linked_mutations" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)

    const terminalHasLock = deferred<void>()
    const releaseTerminal = deferred<void>()
    const terminal = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."case_decisions"
           SET "decisions" = '["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"]'::jsonb
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      terminalHasLock.resolve()
      await releaseTerminal.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await terminalHasLock.promise
    const linkedPid = deferred<number>()
    const linkedOutcome = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      linkedPid.resolve(backend.pid)
      await lockWorkforceExceptionLinkedMutation({
        db: linkedMutationDb(tx),
        organizationId,
        caseId,
      })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."linked_mutations"
           SET "mutation_count" = "mutation_count" + 1
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    }).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )

    try {
      await waitForAdvisoryLockWait(await linkedPid.promise)
    } finally {
      releaseTerminal.resolve()
    }
    await terminal

    const outcome = await linkedOutcome
    expect(outcome).toMatchObject({
      status: "rejected",
      error: { code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED" },
    })
    await expect(readState(caseId)).resolves.toEqual({
      decisions: ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"],
      linked_mutation_count: 0,
    })
  }, 15_000)

  it("makes terminal resolution wait for and observe a committed linked mutation", async () => {
    const caseId = `linked-first-${randomUUID()}`
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."case_decisions" (
        "organization_id", "case_id", "decisions"
      ) VALUES ($1, $2, '["ACKNOWLEDGE"]'::jsonb)
    `, organizationId, caseId)
    await observer.$executeRawUnsafe(`
      INSERT INTO "${schema}"."linked_mutations" ("organization_id", "case_id")
      VALUES ($1, $2)
    `, organizationId, caseId)

    const linkedHasLock = deferred<void>()
    const releaseLinked = deferred<void>()
    const linked = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionLinkedMutation({
        db: linkedMutationDb(tx),
        organizationId,
        caseId,
      })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."linked_mutations"
           SET "mutation_count" = "mutation_count" + 1
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      linkedHasLock.resolve()
      await releaseLinked.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await linkedHasLock.promise
    const terminalPid = deferred<number>()
    const terminal = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      terminalPid.resolve(backend.pid)
      const [beforeLock] = await tx.$queryRawUnsafe<Array<{ mutation_count: number }>>(`
        SELECT "mutation_count"
          FROM "${schema}"."linked_mutations"
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      const [afterLock] = await tx.$queryRawUnsafe<Array<{ mutation_count: number }>>(`
        SELECT "mutation_count"
          FROM "${schema}"."linked_mutations"
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."case_decisions"
           SET "decisions" = "decisions" || '["RESOLVE_NO_CHANGE"]'::jsonb
         WHERE "organization_id" = $1 AND "case_id" = $2
      `, organizationId, caseId)
      return { beforeLock: beforeLock.mutation_count, afterLock: afterLock.mutation_count }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await terminalPid.promise)
    } finally {
      releaseLinked.resolve()
    }
    await linked

    await expect(terminal).resolves.toEqual({ beforeLock: 0, afterLock: 1 })
    await expect(readState(caseId)).resolves.toEqual({
      decisions: ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"],
      linked_mutation_count: 1,
    })
  }, 15_000)

  it("serializes cross-domain writers in the global workday then case order", async () => {
    const agentId = `agent-${randomUUID()}`
    const caseId = `ordered-locks-${randomUUID()}`
    const firstHasBothLocks = deferred<void>()
    const releaseFirst = deferred<void>()
    const first = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockMtmWorkdayTransitions(tx, { organizationId, agentId })
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      firstHasBothLocks.resolve()
      await releaseFirst.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await firstHasBothLocks.promise
    const secondPid = deferred<number>()
    const second = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      secondPid.resolve(backend.pid)
      await lockMtmWorkdayTransitions(tx, { organizationId, agentId })
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      return "completed"
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await secondPid.promise)
    } finally {
      releaseFirst.resolve()
    }
    await first
    await expect(second).resolves.toBe("completed")
  }, 15_000)

  it("observes exact submit and cancellation replays after waiting for the case lock", async () => {
    const caseId = `replay-${randomUUID()}`
    const clientRequestId = `client-${randomUUID()}`

    const submitHasLock = deferred<void>()
    const releaseSubmit = deferred<void>()
    const submitWinner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        INSERT INTO "${schema}"."linked_requests" (
          "organization_id", "case_id", "client_request_id", "status"
        ) VALUES ($1, $2, $3, 'PENDING')
      `, organizationId, caseId, clientRequestId)
      submitHasLock.resolve()
      await releaseSubmit.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await submitHasLock.promise
    const submitWaiterPid = deferred<number>()
    const submitReplay = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const before = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      submitWaiterPid.resolve(backend.pid)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      const after = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      return { before: before[0]?.status ?? null, after: after[0]?.status ?? null }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await submitWaiterPid.promise)
    } finally {
      releaseSubmit.resolve()
    }
    await submitWinner
    await expect(submitReplay).resolves.toEqual({ before: null, after: "PENDING" })

    const cancelHasLock = deferred<void>()
    const releaseCancel = deferred<void>()
    const cancelWinner = terminalClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      await tx.$executeRawUnsafe(`
        UPDATE "${schema}"."linked_requests" SET "status" = 'CANCELLED'
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      cancelHasLock.resolve()
      await releaseCancel.promise
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    await cancelHasLock.promise
    const cancelWaiterPid = deferred<number>()
    const cancelReplay = linkedClient.$transaction(async (tx) => {
      await configureBoundedTransaction(tx)
      const before = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      const [backend] = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        "SELECT pg_backend_pid()::int AS pid",
      )
      cancelWaiterPid.resolve(backend.pid)
      await lockWorkforceExceptionDecisionStream(tx, { organizationId, caseId })
      const after = await tx.$queryRawUnsafe<Array<{ status: string }>>(`
        SELECT "status" FROM "${schema}"."linked_requests"
         WHERE "organization_id" = $1 AND "client_request_id" = $2
      `, organizationId, clientRequestId)
      return { before: before[0]?.status ?? null, after: after[0]?.status ?? null }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    })

    try {
      await waitForAdvisoryLockWait(await cancelWaiterPid.promise)
    } finally {
      releaseCancel.resolve()
    }
    await cancelWinner
    await expect(cancelReplay).resolves.toEqual({ before: "PENDING", after: "CANCELLED" })
  }, 20_000)
})
