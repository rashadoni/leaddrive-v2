import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"

const code = "MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT"
const connector = /(?:^|\n)ConnectorError\(ConnectorError \{[^\n]*PostgresError \{ code: "23514", message: "MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT",/
const diagnostic = (value: unknown) => typeof value === "string"
  && (value.trim() === code || value.trim() === `ERROR: ${code}` || connector.test(value))

/** Only a real database refusal, never a marker echoed in an input value. */
export function attendanceIdentityConflictResponse(error: unknown): NextResponse | null {
  const refused = error instanceof Prisma.PrismaClientUnknownRequestError ? connector.test(error.message)
    : error instanceof Prisma.PrismaClientKnownRequestError && ["P2004", "P2010"].includes(error.code)
      && (diagnostic(error.meta?.database_error) || (error.meta?.code === "23514" && diagnostic(error.meta?.message)) || connector.test(error.message))
  if (!refused) return null
  return NextResponse.json({ code, error: "This user conflicts with an existing employee card. Review the card's linked user before retrying." },
    { status: 409, headers: { "cache-control": "private, no-store" } })
}
