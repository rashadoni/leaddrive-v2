import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async (original) => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { GET, POST } from "@/app/api/v1/mtm/attendance/recordings/route"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { AttendanceHrRecordingInputSchema } from "@/lib/mtm/attendance-hr-recording-contract"
import { AttendanceRequestDetailsSchema, AttendanceRequestInputSchema } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestSelect } from "@/lib/mtm/attendance-request-store"
import { getRlsContext } from "@/lib/rls-context"
import type { Prisma } from "@prisma/client"
const organizationId = "hr-recording-fixture", userId = "hr-fixture"
const catalogue = defaultAttendanceDayKinds(() => ({ az: "Nümunə", ru: "Пример", en: "Fixture" }))
type Row = Prisma.MtmHrmRequestGetPayload<{ select: typeof attendanceRequestSelect }>
let rows: Row[], currentUser: { role: string; hiddenModules: string[] } | null
const input = () => ({ clientRequestId: randomUUID(), agentIds: ["employee-b", "employee-a"], dayKindKey: "STUDY_LEAVE", catalogueVersion: null,
  unit: "DAYS", startDate: "2026-11-09", endDate: "2026-11-10", reason: "PRIVATE_HR_REASON" })
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/v1/mtm/attendance/recordings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined)
const noWrites = () => {
  expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks(); rows = []; currentUser = { role: "admin", hiddenModules: [] }
  vi.mocked(requireAuth).mockResolvedValue({ orgId: organizationId, userId, role: "admin", principalType: "session", email: "fixture@example.test", name: "Fixture" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.$queryRaw).mockImplementation((async (query: TemplateStringsArray) => query.join(" ").includes('FROM "users"') ? currentUser ? [currentUser] : [] : []) as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: ["mtm"], modules: { "route-field": true }, settings: {} } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async ({ where }: { where: { organizationId_key: { key: string } } }) => {
    const key = where.organizationId_key.key
    return key === "attendanceEnabled" ? { value: true } : key === "timezone" ? { value: "Asia/Baku" } : null
  }) as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue(["employee-a", "employee-b"].map(id => ({ id, userId: null, user: null, name: id, teamId: "fixture-team", team: { name: "Fixture team" } })) as never)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockImplementation((async ({ where }: { where: { clientRequestId?: string } }) => where.clientRequestId ? rows.filter(row => row.clientRequestId === where.clientRequestId) : []) as never)
  vi.mocked(prisma.mtmHrmRequest.create).mockImplementation((async ({ data }: { data: Row }) => {
    expect(getRlsContext()?.orgId).toBe(organizationId)
    expect(getRlsContext()?.bypass).not.toBe(true)
    const row = { ...data, cancelledAt: null, updatedAt: new Date() }; rows.push(row); return row
  }) as never)
})
describe("HR day recording through the real tenant/attendance/reviewer boundary", () => {
  it("records one explicit batch with author/reason, immutable snapshot and safe employee notices", async () => {
    const body = input(), res = await post(body)
    expect(res.status).toBe(201)
    const payload = await res.json()
    expect(payload.data.items).toHaveLength(2)
    expect(rows.every(row => row.status === "APPROVED" && row.reason === body.reason)).toBe(true)
    for (const row of rows) expect(AttendanceRequestDetailsSchema.parse(row.attendanceDetails)).toMatchObject({ kind: "HR_RECORD", dayKind: { key: "STUDY_LEAVE" }, recording: { userId, operationId: body.clientRequestId } })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain(body.reason)
    expect(JSON.stringify(vi.mocked(prisma.mtmNotification.create).mock.calls)).not.toMatch(/PRIVATE_HR_REASON|STUDY_LEAVE/)
    expect(JSON.stringify(payload)).not.toMatch(/submissionHash|recording|actorUserId/)
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })
  it("replays the same sorted employee set before catalogue changes, without extra writes", async () => {
    const body = input()
    expect((await post(body)).status).toBe(201)
    expect((await post({ ...body, agentIds: [...body.agentIds].reverse() })).status).toBe(200)
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(2)
    expect((await post({ ...body, reason: "Changed reason" })).status).toBe(409)
  })
  it.each(["self", "inactive-target", "other-team", "read-only", "hidden", "api-key", "scope-revoked-after-lock"])("rejects the entire batch for %s", async (reason) => {
    if (reason === "self") vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "employee-a", userId }, { id: "employee-b", userId: null }] as never)
    if (reason === "inactive-target") vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "employee-a", userId: null }] as never)
    if (reason === "other-team") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: ["employee-a"] })
    if (reason === "read-only") currentUser!.role = "viewer"
    if (reason === "hidden") currentUser = { role: "manager", hiddenModules: ["mtm"] }
    if (reason === "api-key") vi.mocked(requireAuth).mockResolvedValue({ orgId: organizationId, userId, role: "admin", principalType: "api_key" } as never)
    if (reason === "scope-revoked-after-lock") vi.mocked(resolveMtmRouteActor).mockResolvedValueOnce({ agentId: null, role: "ADMIN", scopedAgentIds: null }).mockResolvedValueOnce({ agentId: null, role: "ADMIN", scopedAgentIds: null }).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: [] })
    expect((await post(input())).status).toBe(403)
    noWrites()
  })
  it("rejects overlap before inserting any of the batch", async () => {
    const find = vi.mocked(prisma.mtmHrmRequest.findMany)
    find.mockImplementation((async ({ where }: { where: { clientRequestId?: string } }) => where.clientRequestId ? [] : [{ startDate: new Date("2026-11-10"), endDate: new Date("2026-11-10"), attendanceDetails: null }]) as never)
    expect((await post(input())).status).toBe(409); noWrites()
  })
  it.each(["WORKED", "NOT_EMPLOYED", "unknown"])("does not manufacture %s facts", async key => {
    expect((await post({ ...input(), dayKindKey: key })).status).toBe(400); noWrites()
  })
  it("rejects a stale catalogue and incorrect unit", async () => {
    expect((await post({ ...input(), catalogueVersion: "2026-11-01T00:00:00.000Z" })).status).toBe(409)
    expect((await post({ ...input(), dayKindKey: "PAID_HOURS" })).status).toBe(400); noWrites()
  })
  it("returns only recordable catalogue kinds and preserves team identities", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/mtm/attendance/recordings"), undefined)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.employees[0]).toMatchObject({ id: "employee-a", teamName: "Fixture team" })
    expect(body.data.catalogue.items.some((kind: { key: string }) => kind.key === "WORKED" || kind.key === "NOT_EMPLOYED")).toBe(false)
    expect(body.data.catalogue.items.some((kind: { key: string }) => kind.key === "STUDY_LEAVE")).toBe(true)
  })
  it("does not let an employee submit the HR-only metadata", () => {
    expect(AttendanceRequestInputSchema.safeParse({ ...input(), kind: "HR_RECORD" }).success).toBe(false)
    expect(AttendanceRequestDetailsSchema.safeParse({ version: 1, kind: "HR_RECORD", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: catalogue[8], attachmentIds: [], submissionHash: "a".repeat(64) }).success).toBe(false)
  })
  it.each([
    { agentIds: [] }, { agentIds: ["employee-a", "employee-a"] }, { agentIds: Array.from({ length: 101 }, (_, i) => `employee-${i}`) },
    { reason: " " }, { endDate: "2026-11-08" }, { endDate: "2028-11-10" }, { startTime: "09:00" },
    { unit: "HOURS", startTime: "09:00", endTime: "10:00" },
  ])("rejects invalid batch %j", async change => {
    const body = { ...input(), ...change }
    expect(AttendanceHrRecordingInputSchema.safeParse(body).success).toBe(false)
    expect((await post(body)).status).toBe(400); noWrites()
  })
})
