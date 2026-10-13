import { Prisma } from "@prisma/client"

const CLOSED = "MTM_ATTENDANCE_MONTH_CLOSED"
const connectorRefusal = /(?:^|\n)ConnectorError\(ConnectorError \{[^\n]*PostgresError \{ code: "23514", message: "MTM_ATTENDANCE_MONTH_CLOSED",/
const databaseRefusal = (value: unknown) => typeof value === "string"
  && (value.trim() === CLOSED || value.trim() === `ERROR: ${CLOSED}` || connectorRefusal.test(value))

/** Prisma exposes model-write trigger exceptions as UnknownRequestError and
 * raw SQL exceptions as KnownRequestError. Both represent a rolled-back write.
 * Match database diagnostics, never a marker merely echoed in query arguments. */
export function isAttendanceMonthClosedWrite(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientUnknownRequestError) return connectorRefusal.test(error.message)
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2004", "P2010"].includes(error.code)) return false
  const meta = error.meta ?? {}
  return databaseRefusal(meta.database_error)
    || (meta.code === "23514" && databaseRefusal(meta.message))
    || connectorRefusal.test(error.message)
}
