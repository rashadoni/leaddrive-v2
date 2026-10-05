import type { PrismaClient } from "@prisma/client"

const JOB_NAME = "workforce-claim-reconciliation-v1"
const MAX_VERSION = 2_147_483_647

export type WorkforceReconciliationCursorState = Readonly<{
  cursor: string | null
  version: number
}>

export type WorkforceReconciliationCursorCommit = "COMMITTED" | "FENCED_OUT" | "VERSION_EXHAUSTED"

type CursorDatabase = Pick<PrismaClient, "$queryRaw" | "$transaction">

function validCursor(value: string | null): boolean {
  return value === null || (typeof value === "string" && value.length >= 1 && value.length <= 512)
}

function validState(state: WorkforceReconciliationCursorState): boolean {
  return validCursor(state.cursor) && Number.isSafeInteger(state.version)
    && state.version >= 1 && state.version <= MAX_VERSION
}

/**
 * Dormant operational store: no route or scheduler calls this helper.
 * The caller must supply an authorized database client and an opaque cursor
 * protocol that does not encode tenant/employee identifiers or source payload.
 * null state means no row; an existing row with a null cursor retains its version.
 * All writers for this fixed job name must use this store and the lease protocol.
 */
export function workforceReconciliationCursorStore(db: CursorDatabase) {
  return {
    async read(): Promise<WorkforceReconciliationCursorState | null> {
      const rows = await db.$queryRaw<WorkforceReconciliationCursorState[]>`
        SELECT "cursor", "version" FROM "system_job_cursors"
        WHERE "name" = ${JOB_NAME}
      `
      const state = rows[0] ?? null
      if (state !== null && !validState(state)) throw new Error("WORKFORCE_CURSOR_STATE_INVALID")
      return state
    },

    async commit(input: {
      expected: WorkforceReconciliationCursorState | null
      nextCursor: string | null
      ownerToken: string
    }): Promise<WorkforceReconciliationCursorCommit> {
      // Copy the observation before any await; callers cannot change the fence
      // while this operation is waiting for the database lock.
      const expected = input.expected === null ? null : { ...input.expected }
      const nextCursor = input.nextCursor
      const ownerToken = input.ownerToken
      if (!validCursor(nextCursor) || (expected !== null && !validState(expected))) {
        throw new Error("WORKFORCE_CURSOR_STATE_INVALID")
      }
      if (typeof ownerToken !== "string" || ownerToken.length < 1 || ownerToken.length > 191) {
        throw new Error("WORKFORCE_CURSOR_OWNER_INVALID")
      }
      if (expected?.version === MAX_VERSION) return "VERSION_EXHAUSTED"

      return db.$transaction(async (tx): Promise<WorkforceReconciliationCursorCommit> => {
        // Lock first. Lease acquisition/completion already update this same row,
        // so a new owner cannot race between the check and cursor commit.
        const lease = await tx.$queryRaw<Array<{ name: string }>>`
          SELECT "name" FROM "system_job_leases"
          WHERE "name" = ${JOB_NAME}
          FOR UPDATE
        `
        if (lease.length !== 1) return "FENCED_OUT"

        // clock_timestamp is evaluated in a later statement, after the lock
        // wait, not at transaction start. Every write also checks the lease.
        if (expected === null) {
          const inserted = await tx.$queryRaw<Array<{ version: number }>>`
            INSERT INTO "system_job_cursors" ("name", "cursor", "version", "updatedAt")
            SELECT ${JOB_NAME}, ${nextCursor}, 1, clock_timestamp()
            FROM "system_job_leases"
            WHERE "name" = ${JOB_NAME}
              AND "ownerToken" = ${ownerToken}
              AND "status" = 'running'
              AND "leaseUntil" > clock_timestamp()
            ON CONFLICT ("name") DO NOTHING
            RETURNING "version"
          `
          return inserted.length === 1 ? "COMMITTED" : "FENCED_OUT"
        }

        // A cursor row can itself be locked by an operational transaction.
        // Finish that wait before evaluating the wall-clock lease predicate.
        await tx.$queryRaw<Array<{ version: number }>>`
          SELECT "version" FROM "system_job_cursors"
          WHERE "name" = ${JOB_NAME}
          FOR UPDATE
        `
        const updated = await tx.$queryRaw<Array<{ version: number }>>`
          UPDATE "system_job_cursors"
          SET "cursor" = ${nextCursor}, "version" = "version" + 1,
              "updatedAt" = clock_timestamp()
          WHERE "name" = ${JOB_NAME}
            AND "version" = ${expected.version}
            AND "cursor" IS NOT DISTINCT FROM ${expected.cursor}
            AND EXISTS (
              SELECT 1 FROM "system_job_leases"
              WHERE "name" = ${JOB_NAME}
                AND "ownerToken" = ${ownerToken}
                AND "status" = 'running'
                AND "leaseUntil" > clock_timestamp()
            )
          RETURNING "version"
        `
        return updated.length === 1 ? "COMMITTED" : "FENCED_OUT"
      })
    },
  }
}
