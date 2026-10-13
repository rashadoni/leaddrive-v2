import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mtm/attendance-attachment", () => ({ readAttendanceDocument: vi.fn() }))
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async (original) => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
import { prisma } from "@/lib/prisma"
import { requireAuth, type AuthResult } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireTenantCapabilityAccessResponse } from "@/lib/tenant-capability-access"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { POST } from "@/app/api/v1/mtm/attendance/requests/[id]/revoke/route"
import ru from "../../messages/ru.json"

import { GET as reviewGet } from "@/app/api/v1/mtm/attendance/requests/route"
const organizationId = "revocation-fixture-org", userId = "revocation-reviewer", agentId = "revocation-employee", id = randomUUID()
const version = "2026-10-10T12:00:00.000Z", reason = "PRIVATE_REVOCATION_REASON"
function initial() { return { id, organizationId, agentId, clientRequestId: randomUUID(), type: "LEAVE", status: "APPROVED", startDate: new Date("2026-09-01"), endDate: new Date("2026-09-03"),
  submittedAt: new Date("2026-08-01"), updatedAt: new Date(version), reason: "PRIVATE_LEAVE_REASON", decidedAt: new Date("2026-08-02"), decidedByUserId: "original-reviewer", decisionNote: "Original approval", cancelledAt: null as Date | null,
  attendanceDetails: { version: 1, kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", attachmentIds: [], submissionHash: "a".repeat(64),
    dayKind: defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" })).find(kind => kind.key === "ANNUAL_LEAVE")! },
  agent: { name: "Fictional employee", team: null, userId: "owner" } } }
let stored: ReturnType<typeof initial> | null, audit: Record<string, unknown> | null
let currentUser: { role: string; hiddenModules: string[] } | null
function identity(change: Partial<AuthResult> = {}) { vi.mocked(requireAuth).mockResolvedValue({ orgId: organizationId, userId, role: "admin", email: "fictional@example.invalid", name: "Fictional reviewer", principalType: "session", ...change } as AuthResult) }
const post = (body: unknown = { version, reason }) => POST(new NextRequest(`http://localhost/api/v1/mtm/attendance/requests/${id}/revoke`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
function noWrites() { expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled(); expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled(); expect(prisma.mtmNotification.create).not.toHaveBeenCalled() }
beforeEach(() => {
  vi.resetAllMocks(); stored = initial(); audit = null; currentUser = { role: "admin", hiddenModules: [] }; identity()
  vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(null)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.$queryRaw).mockImplementation((async (query: TemplateStringsArray) => query.join(" ").includes('FROM "users"') ? currentUser ? [currentUser] : [] : []) as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: ["mtm"], modules: { mtm: true }, settings: {} } as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async () => stored ? { userId: stored.agent.userId, user: { preferredLanguage: "ru" }, status: "INACTIVE" } : null) as never)
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockImplementation((async () => stored) as never)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockImplementation((async () => stored ? [stored] : []) as never)
  vi.mocked(prisma.mtmHrmRequest.updateMany).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => { Object.assign(stored!, data, { updatedAt: new Date() }); return { count: 1 } }) as never)
  vi.mocked(prisma.mtmAuditLog.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => { audit = data; return data }) as never)
  vi.mocked(prisma.mtmAuditLog.findFirst).mockImplementation((async () => audit) as never)
  vi.mocked(prisma.mtmAuditLog.findMany).mockImplementation((async () => audit ? [audit] : []) as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: userId, name: "Fictional reviewer" }, { id: "original-reviewer", name: "Original reviewer" }] as never)
})
describe("scoped retroactive leave revocation", () => {
  it("preserves the approval and submission, records a private cause, and retries without duplicate side effects", async () => {
    const before = initial()
    const response = await post(); expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { idempotent: false, request: { status: "CANCELLED", reason: before.reason, decisionNote: before.decisionNote, decidedAt: before.decidedAt.toISOString() } } })
    expect(stored?.decidedByUserId).toBe(before.decidedByUserId)
    expect(stored?.attendanceDetails).toEqual(before.attendanceDetails)
    expect(audit).toMatchObject({ actorUserId: userId, oldData: { status: "APPROVED" }, newData: { status: "CANCELLED", sourceVersion: version, reason } })
    expect(prisma.mtmNotification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: ru.mtmAttendance.revocationNotification }) }))
    expect(JSON.stringify(vi.mocked(prisma.mtmNotification.create).mock.calls)).not.toMatch(/PRIVATE_/)
    expect((await post()).status).toBe(200)
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: agentId, organizationId } }))
  })
  it("returns both original approval and cancellation author/reason in authorized history", async () => {
    await post()
    const response = await reviewGet(new NextRequest("http://localhost/api/v1/mtm/attendance/requests?status=CANCELLED"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { items: [{ reviewerName: "Original reviewer", cancellation: { byName: "Fictional reviewer", reason }, decisionNote: "Original approval" }] } })
  })
  it.each([{ reason: "" }, { reason: "x" }, { reason: "a".repeat(1001) }, { version: "invalid" }, { agentId: "foreign" }])("rejects invalid bodies without writes: %j", change => {
    return post({ version, reason, ...change }).then(response => { expect(response.status).toBe(400); noWrites() })
  })
  it.each(["PENDING", "REJECTED", "CANCELLED"])("refuses %s without an exact revocation audit", async status => {
    stored!.status = status; expect((await post()).status).toBe(409); noWrites()
  })
  it("refuses another actor/body/version retry", async () => {
    await post()
    expect((await post({ version, reason: "different cause" })).status).toBe(409)
    expect((await post({ version: "2026-10-09T12:00:00.000Z", reason })).status).toBe(409)
    identity({ userId: "other-reviewer" }); expect((await post()).status).toBe(409)
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledTimes(1)
  })
  it("cannot revoke another kind of approval through leave revocation", async () => {
    stored!.attendanceDetails.kind = "SICK_LEAVE"
    expect((await post()).status).toBe(409); noWrites()
  })
  it("refuses a stale approval version", async () => {
    expect((await post({ version: "2026-10-09T12:00:00.000Z", reason })).status).toBe(409); noWrites()
  })
  it.each(["api-key", "self", "other-team", "revoked-user", "readonly", "hidden"])("rechecks current authority: %s", async condition => {
    if (condition === "api-key") identity({ principalType: "api_key" })
    if (condition === "self") stored!.agent.userId = userId
    if (condition === "other-team") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: ["foreign"] })
    if (condition === "revoked-user") currentUser = null
    if (condition === "readonly") currentUser = { role: "viewer", hiddenModules: [] }
    if (condition === "hidden") currentUser = { role: "manager", hiddenModules: ["mtm"] }
    expect((await post()).status).toBe(403); noWrites()
  })
  it("refuses feature-off and missing requests", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: false }] as never)
    expect((await post()).status).toBe(404); noWrites()
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
    stored = null; expect((await post()).status).toBe(404); noWrites()
  })
})
