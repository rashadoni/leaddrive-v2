import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"

type CursorRow = { cursor: string | null }

export interface JobCursorStore {
  read(name: string): Promise<string | null>
  compareAndSet(name: string, previousCursor: string | null, nextCursor: string | null): Promise<boolean>
}

function validName(name: string): boolean {
  return name.length >= 1 && name.length <= 191
}

function validCursor(cursor: string | null): boolean {
  return cursor === null || (cursor.length >= 1 && cursor.length <= 512)
}

/** Global operational cursor; values must never encode tenant/employee data. */
export function prismaJobCursorStore(db: Pick<PrismaClient, "$queryRaw"> = prisma): JobCursorStore {
  return {
    async read(name) {
      if (!validName(name)) throw new Error("JOB_CURSOR_NAME_INVALID")
      const rows = await db.$queryRaw<CursorRow[]>`
        SELECT "cursor"
        FROM "system_job_cursors"
        WHERE "name" = ${name}
        LIMIT 1
      `
      return rows[0]?.cursor ?? null
    },

    async compareAndSet(name, previousCursor, nextCursor) {
      if (!validName(name)) throw new Error("JOB_CURSOR_NAME_INVALID")
      if (!validCursor(previousCursor) || !validCursor(nextCursor)) {
        throw new Error("JOB_CURSOR_VALUE_INVALID")
      }
      // Only a null cursor may create the row. A non-null previous cursor is a
      // plain UPDATE: as one INSERT … SELECT … WHERE previous IS NULL it
      // selected no row, ON CONFLICT never fired, and every swap after the
      // first failed (mtm-attendance-reminders answered 500 from 2026-10-13).
      const rows = previousCursor === null
        ? await db.$queryRaw<CursorRow[]>`
          INSERT INTO "system_job_cursors" ("name", "cursor", "version", "updatedAt")
          VALUES (${name}, ${nextCursor}, 1, CURRENT_TIMESTAMP)
          ON CONFLICT ("name") DO UPDATE
          SET "cursor" = EXCLUDED."cursor",
              "version" = "system_job_cursors"."version" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "system_job_cursors"."cursor" IS NULL
          RETURNING "cursor"
        `
        : await db.$queryRaw<CursorRow[]>`
          UPDATE "system_job_cursors"
          SET "cursor" = ${nextCursor},
              "version" = "version" + 1,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "name" = ${name} AND "cursor" = ${previousCursor}
          RETURNING "cursor"
        `
      return rows.length === 1
    },
  }
}
