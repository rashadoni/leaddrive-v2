import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { isAttendanceMonthClosedWrite } from "@/lib/mtm/attendance-month-guard"

const closed = "MTM_ATTENDANCE_MONTH_CLOSED"
const connector = (message = closed, code = "23514") => `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`
const unknown = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: "fixture" })
const known = (code: string, meta: Record<string, unknown>, message = "Raw query failed") => new Prisma.PrismaClientKnownRequestError(message, { code, meta, clientVersion: "fixture" })

describe("closed-month database refusal classification", () => {
  it("recognizes the real model-write connector exception after rollback", () => {
    expect(isAttendanceMonthClosedWrite(unknown(`Invalid create invocation\nError occurred during query execution:\n${connector()}`))).toBe(true)
  })
  it("recognizes raw SQL and mapped check-constraint errors", () => {
    expect(isAttendanceMonthClosedWrite(known("P2010", { code: "23514", message: `ERROR: ${closed}` }))).toBe(true)
    expect(isAttendanceMonthClosedWrite(known("P2004", { database_error: connector() }))).toBe(true)
  })
  it.each([
    new Error(closed), { code: "P2010", message: closed },
    unknown(`Invalid query argument: "${closed}"`), unknown(connector("unrelated constraint")), unknown(connector(closed, "40001")),
    known("P2010", { code: "40001", message: `ERROR: ${closed}` }), known("P2002", { database_error: closed }),
    known("P2004", { reason: closed }), known("P2010", {}, `Invalid create argument: "${closed}"`),
  ])("does not disguise an unrelated error or echoed client marker (%#)", error => {
    expect(isAttendanceMonthClosedWrite(error)).toBe(false)
  })
})
