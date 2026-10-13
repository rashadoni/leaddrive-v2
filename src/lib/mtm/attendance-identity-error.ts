import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"

const conflictCode = "MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT"
const linkCode = "MTM_ATTENDANCE_EMPLOYEE_LINK_REQUIRED"
const connector = /(?:^|\n)ConnectorError\(ConnectorError \{[^\n]*PostgresError \{ code: "23514", message: "(MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT|MTM_ATTENDANCE_EMPLOYEE_LINK_REQUIRED)",/
const diagnostic = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const marker = value.trim().replace(/^ERROR: /, "")
  return marker === conflictCode || marker === linkCode ? marker : connector.exec(value)?.[1] ?? null
}

/** Only a real database refusal, never a marker echoed in an input value. */
export function attendanceIdentityConflictResponse(error: unknown): NextResponse | null {
  const code = error instanceof Prisma.PrismaClientUnknownRequestError ? connector.exec(error.message)?.[1]
    : error instanceof Prisma.PrismaClientKnownRequestError && ["P2004", "P2010"].includes(error.code)
      && (diagnostic(error.meta?.database_error) || (error.meta?.code === "23514" && diagnostic(error.meta?.message)) || connector.exec(error.message)?.[1])
  if (!code) return null
  return NextResponse.json({ code, error: code === linkCode
    ? "An active CRM user keeps their employee card. Use the attendance participation switch to exclude them from attendance."
    : "This user conflicts with an existing employee card. Review the card's linked user before retrying." },
    { status: 409, headers: { "cache-control": "private, no-store" } })
}
