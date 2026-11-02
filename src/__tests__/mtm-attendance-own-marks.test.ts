import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mtm/attendance-self-access", () => ({ requireAttendanceSelf: vi.fn() }))
vi.mock("@/lib/with-mobile-rls", () => ({ withMobileRls: (handler: unknown) => handler }))
import { prisma } from "@/lib/prisma"
import { requireAttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { ownAttendanceMark, readOwnAttendanceMarks, type OwnAttendanceMarkRow } from "@/lib/mtm/attendance-own-marks"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { officeAttendanceMobilePath } from "@/lib/mtm/attendance-employee-contract"
import { isMtmMobileApiPath } from "@/lib/mtm/mobile-api-path"
import { GET } from "@/app/api/v2/mtm/mobile/route-field/attendance/marks/route"
const self = { organizationId: "fixture-org", agentId: "fixture-employee", role: "EMPLOYEE" }
const row: OwnAttendanceMarkRow = { eventId: "fixture-event", action: "START", claimedAt: new Date("2026-10-22T05:00:00Z"), serverReceivedAt: new Date("2026-10-22T07:00:00Z"),
  locationState: "INSIDE", latitude: 40.5, longitude: 49.5, accuracy: 12, fixCapturedAt: new Date("2026-10-22T05:00:00Z"), branchName: "Test branch", distanceMeters: 20,
  qrState: "VERIFIED", qrBranchName: "Test QR branch", openCases: 1, closedCases: 0 }
const path = "/api/v2/mtm/mobile/route-field/attendance/marks"
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAttendanceSelf).mockResolvedValue("Asia/Baku")
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "fixture-day", workDate: new Date("2026-10-22T00:00:00Z") } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([row])
})
it('returns only the current employee’s scoped day, historical evidence and current case counts', async () => {
  const result = await readOwnAttendanceMarks(self, "fixture-day")
  expect(requireAttendanceSelf).toHaveBeenCalledWith(expect.anything(), self)
  expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({ where: { id: "fixture-day", organizationId: self.organizationId, agentId: self.agentId }, select: { id: true, workDate: true } })
  expect(vi.mocked(prisma.$queryRaw).mock.calls[0].slice(1)).toEqual([self.organizationId, self.agentId, "fixture-day"])
  expect(result.items[0]).toMatchObject({ claimedAt: row.claimedAt.toISOString(), location: { state: "INSIDE", coordinates: { latitude: 40.5, longitude: 49.5 } }, review: { openCases: 1, closedCases: 0 } })
})
it('does not read evidence for a day outside the authenticated employee scope', async () => {
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
  await expect(readOwnAttendanceMarks(self, "foreign-day")).rejects.toMatchObject({ status: 404 })
  expect(prisma.$queryRaw).not.toHaveBeenCalled()
})
it.each([403, 404])('checks withdrawal/exclusion before reading any day (%s)', async status => {
  vi.mocked(requireAttendanceSelf).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_SELF_REQUIRED", status))
  await expect(readOwnAttendanceMarks(self, "fixture-day")).rejects.toMatchObject({ status })
  expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled(); expect(prisma.$queryRaw).not.toHaveBeenCalled()
})
it.each(["PAUSE", "RESUME"])("never exposes GPS or QR for %s even if a legacy join contains it", action => {
  expect(ownAttendanceMark({ ...row, action })).toMatchObject({ location: { state: "NOT_RECORDED", coordinates: null, accuracyMeters: null, capturedAt: null, branchName: null, distanceMeters: null }, qr: null })
})
it.each(["UNAVAILABLE", "NO_CONSENT", "BREAK_PRIVACY", "unknown"])("does not turn %s into outside presence or leak stray coordinates", locationState => {
  const result = ownAttendanceMark({ ...row, locationState, qrState: null })
  expect(result.location.state).not.toBe("OUTSIDE")
  expect(result.location.coordinates).toBeNull(); expect(result.location.branchName).toBeNull()
})
it('bounds history and excludes unrelated private fields', async () => {
  vi.mocked(prisma.$queryRaw).mockResolvedValue(Array.from({ length: 65 }, (_, index) => ({ ...row, eventId: `event-${index}`, installationId: "private-device", note: "private-note", requestHash: "private-hash" })))
  const result = await readOwnAttendanceMarks(self, "fixture-day")
  expect(result.hasMore).toBe(true); expect(result.items).toHaveLength(64)
  expect(JSON.stringify(result)).not.toMatch(/private-|installationId|requestHash/)
})
it('allows only the exact GET office path', () => {
  expect(officeAttendanceMobilePath("GET", path)).toBe(true); expect(isMtmMobileApiPath(path)).toBe(true)
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(officeAttendanceMobilePath(method, path)).toBe(false)
  expect(officeAttendanceMobilePath("GET", `${path}/all`)).toBe(false)
})
it.each(["", "?agentId=foreign&workdayId=fixture-day", "?workdayId=one&workdayId=two"])("rejects ambiguous or employee-selecting queries: %s", async query => {
  const response = await (GET as unknown as (req: Request, auth: unknown) => Promise<Response>)(new Request(`https://fixture.invalid${path}${query}`), { orgId: self.organizationId, agentId: self.agentId, role: self.role })
  expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
})
it('returns a private response and does not expose database failures', async () => {
  vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("private-database-payload"))
  const response = await (GET as unknown as (req: Request, auth: unknown) => Promise<Response>)(new Request(`https://fixture.invalid${path}?workdayId=fixture-day`), { orgId: self.organizationId, agentId: self.agentId, role: self.role })
  expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(JSON.stringify(await response.json())).not.toContain("private-database-payload")
})
