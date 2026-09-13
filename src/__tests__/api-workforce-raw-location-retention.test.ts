import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionRetentionReadAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/raw-location-retention", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workforce/raw-location-retention")>()
  return { ...actual, runWorkforceRawLocationRetention: vi.fn() }
})

import { GET } from "@/app/api/v1/workforce/retention/raw-location/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { runWorkforceRawLocationRetention } from "@/lib/workforce/raw-location-retention"

const AUTH = { orgId: "org-retention", userId: "admin-1", role: "admin", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const report = {
  mode: "DRY_RUN" as const,
  rawGpsCutoff: "2026-07-31T12:00:00.000Z",
  rawEvidenceDueAt: "2026-08-30T12:00:00.000Z",
  candidates: { locationRows: 2, latestLocationRows: 1, workdayCoordinateRows: 1, workdayEventCoordinateRows: 3, evidenceCiphertextRows: 2 },
  purged: { locationRows: 0, latestLocationRows: 0, workdayCoordinateRows: 0, workdayEventCoordinateRows: 0, evidenceCiphertextRows: 0 },
  remaining: { locationRows: 2, latestLocationRows: 1, workdayCoordinateRows: 1, workdayEventCoordinateRows: 3, evidenceCiphertextRows: 2 },
  morePending: true,
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/workforce/retention/raw-location${query}`, {
    headers: { "user-agent": "retention-test" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(runWorkforceRawLocationRetention).mockResolvedValue(report)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("GET /api/v1/workforce/retention/raw-location", () => {
  it("returns only an MFA-protected tenant dry run and appends a counts-only audit", async () => {
    const response = await invoke(request("?limit=25"), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      data: { report: { mode: "DRY_RUN", candidates: { locationRows: 2 } }, execution: "NOT_AVAILABLE_OVER_HTTP" },
    })
    expect(requireWorkforceAttendanceSecurityMfa).toHaveBeenCalledWith(AUTH.orgId, AUTH)
    expect(runWorkforceRawLocationRetention).toHaveBeenCalledWith(expect.anything(), {
      organizationId: AUTH.orgId, mode: "DRY_RUN", limit: 25,
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: AUTH.orgId,
        action: "WORKFORCE_RAW_LOCATION_RETENTION_DRY_RUN_VIEWED",
        newData: expect.objectContaining({ candidates: report.candidates, remaining: report.remaining }),
      }),
    }))
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0]?.[0] as { data: { newData: unknown } }
    expect(JSON.stringify(audit.data.newData)).not.toContain("latitude")
    expect(JSON.stringify(audit.data.newData)).not.toContain("agent")
  })

  it("fails before any retention query when MFA or the limit is invalid", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(new Response(null, { status: 403 }) as never)
    expect((await invoke(request(), AUTH)).status).toBe(403)
    expect(runWorkforceRawLocationRetention).not.toHaveBeenCalled()

    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(null)
    const invalid = await invoke(request("?limit=0"), AUTH)
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get("cache-control")).toBe("private, no-store")
    expect(runWorkforceRawLocationRetention).not.toHaveBeenCalled()
  })

  it("contains runner and audit failures without reflecting private details", async () => {
    const privateFailure = new Error("coordinate 40.4093 employee-42")
    vi.mocked(runWorkforceRawLocationRetention).mockRejectedValueOnce(privateFailure)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await invoke(request(), AUTH)
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(await response.json())).not.toContain(privateFailure.message)
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "retention-raw-location-dry-run" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateFailure.message)

    vi.mocked(runWorkforceRawLocationRetention).mockResolvedValueOnce(report)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValueOnce(privateFailure)
    const auditFailure = await invoke(request(), AUTH)
    expect(auditFailure.status).toBe(500)
  })
})
