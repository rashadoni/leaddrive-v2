import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { POST } from "@/app/api/v1/mtm/mobile/attendance/requests/route"
import { GET } from "@/app/api/v1/mtm/mobile/attendance/request-limits/route"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
const ORG = "quota-org", AGENT = "quota-agent"
const body = () => ({ clientRequestId: randomUUID(), kind: "HOURLY_ABSENCE", unit: "HOURS", startDate: "2027-05-10", endDate: "2027-05-10", startTime: "09:00", endTime: "10:00", reason: "Fictional reason" })
const post = (input = body()) => POST(new NextRequest("https://fixture.invalid/api/v1/mtm/mobile/attendance/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }))
function reservation(startTime: string, endTime: string) {
  return { startDate: new Date("2027-05-01"), attendanceDetails: { version: 1, kind: "HOURLY_ABSENCE", unit: "HOURS", startTime, endTime, timezone: "Asia/Baku",
    attachmentIds: [], submissionHash: "a".repeat(64), dayKind: defaultAttendanceDayKinds((key) => ({ az: key, ru: key, en: key })).find((item) => item.key === "HOURLY_ABSENCE") } }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: ORG, agentId: AGENT, role: "AGENT", tenantCapabilities: { routeField: true, workforceHrm: false } } as never)
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Asia/Baku" }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT } as never)
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmHrmRequest.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: "PENDING", updatedAt: new Date(), decisionNote: null, decidedAt: null, cancelledAt: null })) as never)
})
it("accepts the exact hourly boundary and rejects one additional minute before creating a request", async () => {
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([reservation("09:00", "16:00")] as never)
  expect((await post()).status).toBe(201)
  vi.mocked(prisma.mtmHrmRequest.create).mockClear()
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([reservation("09:00", "16:00")] as never)
  const denied = await post({ ...body(), endTime: "10:01" })
  expect(denied.status).toBe(409)
  expect(await denied.json()).toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT" })
  expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
})
it("reserves the number of applications separately from their duration", async () => {
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce(Array.from({ length: 3 }, () => reservation("09:00", "09:10")) as never)
  const denied = await post()
  expect(await denied.json()).toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_COUNT_LIMIT" })
  expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
})
it("returns only the authenticated employee's usage and clamps the remainder after a lower company limit", async () => {
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ updatedAt: new Date("2026-10-13T00:00:00Z"), value: { schemaVersion: 1, monthlyMinutes: 30, monthlyRequests: 1 } } as never)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockImplementation((async ({ where }: { where: { agentId: string; organizationId: string } }) => {
    expect(where).toMatchObject({ agentId: AGENT, organizationId: ORG, status: { in: ["PENDING", "APPROVED"] } })
    return [reservation("09:00", "10:00"), reservation("12:00", "13:00")]
  }) as never)
  const result = await GET(new NextRequest("https://fixture.invalid/api/v1/mtm/mobile/attendance/request-limits?month=2027-05&agentId=other"))
  expect(await result.json()).toMatchObject({ data: { month: "2027-05", usedMinutes: 120, usedRequests: 2, remainingMinutes: 0, remainingRequests: 0 } })
  expect(result.headers.get("cache-control")).toContain("no-store")
})
it("does not replace invalid persisted limits with a permissive default", async () => {
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async ({ where }: { where: { organizationId_key: { key: string } } }) => where.organizationId_key.key === "attendanceRequestLimits" ? { value: { monthlyMinutes: 480 } } : null) as never)
  const denied = await post()
  expect(denied.status).toBe(409)
  expect(await denied.json()).toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_LIMITS_INVALID_STORED" })
  expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
})
it("does not count sick leave against an hourly-absence quota", async () => {
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async ({ where }: { where: { organizationId_key: { key: string } } }) => {
    expect(where.organizationId_key.key).not.toBe("attendanceRequestLimits")
    return null
  }) as never)
  expect((await post({ ...body(), kind: "SICK_LEAVE" })).status).toBe(201)
})
it("rejects a malformed month and denies reading after the feature is disabled", async () => {
  expect((await GET(new NextRequest("https://fixture.invalid/api/v1/mtm/mobile/attendance/request-limits?month=2027-13"))).status).toBe(400)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: false }] as never)
  expect((await GET(new NextRequest("https://fixture.invalid/api/v1/mtm/mobile/attendance/request-limits?month=2027-05"))).status).toBe(404)
})
it.each([
  ["2026-11-01", 240, 409], // Fall-back: 00–04 is five actual hours.
  ["2027-03-14", 180, 201], // Spring-forward: 00–04 is three actual hours.
])("counts elapsed hours across DST on %s using the request timezone", async (date, minutes, status) => {
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "America/New_York" }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async ({ where }: { where: { organizationId_key: { key: string } } }) =>
    where.organizationId_key.key === "attendanceRequestLimits" ? { updatedAt: new Date(), value: { schemaVersion: 1, monthlyMinutes: minutes, monthlyRequests: 3 } } : null) as never)
  const result = await post({ ...body(), startDate: date, endDate: date, startTime: "00:00", endTime: "04:00" })
  expect(result.status).toBe(status)
  if (status === 409) expect(await result.json()).toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT" })
})
