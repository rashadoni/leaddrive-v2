import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { attendanceIdentityConflictResponse } from "@/lib/mtm/attendance-identity-error"

const marker = "MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT"
const connector = (message = marker, code = "23514") => `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`
const unknown = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: "fixture" })
const known = (code: string, meta: Record<string, unknown>, message = "Raw query failed") => new Prisma.PrismaClientKnownRequestError(message, { code, meta, clientVersion: "fixture" })

describe("automatic attendance identity conflict response", () => {
  it("explains protected active-user links with a distinct attendance-only action", async () => {
    const marker = "MTM_ATTENDANCE_EMPLOYEE_LINK_REQUIRED"
    const response = attendanceIdentityConflictResponse(unknown(connector(marker)))
    expect(response?.status).toBe(409)
    expect(await response!.json()).toEqual({ code: marker,
      error: "An active CRM user keeps their employee card. Use the attendance participation switch to exclude them from attendance." })
    expect(attendanceIdentityConflictResponse(new Error(marker))).toBeNull()
  })
  it.each([
    unknown(`PRIVATE_EMPLOYEE_QUERY\n${connector()}`),
    known("P2010", { code: "23514", message: `ERROR: ${marker}` }),
    known("P2004", { database_error: connector() }),
  ])("maps a real rolled-back conflict to a private safe409 (%#)", async error => {
    const response = attendanceIdentityConflictResponse(error)
    expect(response?.status).toBe(409)
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    const body = await response!.json()
    expect(body.code).toBe(marker)
    expect(body.error).toContain("existing employee card")
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|Query|Prisma|ConnectorError/)
  })
  it.each([
    new Error(marker), { code: "P2010", message: marker }, unknown(`Invalid input: "${marker}"`),
    unknown(connector("unrelated constraint")), unknown(connector(marker, "40001")),
    known("P2010", { code: "40001", message: marker }), known("P2002", { database_error: marker }),
    known("P2004", { reason: marker }), known("P2010", {}, `Invalid argument: "${marker}"`),
  ])("does not reinterpret unrelated errors or client-controlled marker strings (%#)", error => {
    expect(attendanceIdentityConflictResponse(error)).toBeNull()
  })
})
