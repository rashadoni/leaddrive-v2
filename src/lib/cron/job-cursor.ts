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
      const rows = await db.$queryRaw<CursorRow[]>`
        INSERT INTO "system_job_cursors" ("name", "cursor", "version", "updatedAt")
        SELECT ${name}, ${nextCursor}, 1, CURRENT_TIMESTAMP
        WHERE ${previousCursor}::text IS NULL
        ON CONFLICT ("name") DO UPDATE
        SET "cursor" = EXCLUDED."cursor",
            "version" = "system_job_cursors"."version" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "system_job_cursors"."cursor" IS NOT DISTINCT FROM ${previousCursor}
        RETURNING "cursor"
      `
      return rows.length === 1
    },
  }
}
