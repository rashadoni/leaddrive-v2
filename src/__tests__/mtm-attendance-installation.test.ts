import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
import { prisma } from "@/lib/prisma"
import { enforceAttendanceInstallationApproval } from "@/lib/mtm/attendance-installation-policy"
import { AttendanceInstallationDecisionSchema, AttendanceInstallationRequestSchema, attendanceInstallationState } from "@/lib/mtm/attendance-installation-contract"
import { readOwnAttendanceInstallation, submitAttendanceInstallation } from "@/lib/mtm/attendance-installation-store"
import { agentPermissionStates } from "@/lib/mtm/agent-permissions"
import type { Prisma } from "@prisma/client"

const scope = { organizationId: "fictional-installation-org", agentId: "fictional-installation-employee" }
const self = { ...scope, role: "EMPLOYEE" }, device = "rf-fictional-installation-000001"
let enabled: unknown, required: unknown, approved: boolean | null
beforeEach(() => {
  vi.resetAllMocks(); enabled = true; required = true; approved = null
  vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: Prisma.TransactionClient) => Promise<unknown>) => cb(prisma)) as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async (arg: { where: { organizationId_key: { key: string } } }) => ({ value: arg.where.organizationId_key.key === "attendanceEnabled" ? enabled : required })) as never)
  vi.mocked(prisma.mtmSetting.findMany).mockImplementation((async () => [{ key: "attendanceEnabled", value: enabled }]) as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: self.agentId, role: "EMPLOYEE", attendanceParticipant: true } as never)
  vi.mocked(prisma.$queryRaw).mockImplementation((async (sql: TemplateStringsArray) => {
    if (Array.isArray(sql) && sql.join(" ").includes("AS approved")) return approved === null ? [] : [{ approved }]
    return []
  }) as never)
})

describe("installation approval boundaries", () => {
  it.each([false, "true", null])("keeps attendance off for non-true feature value %s", async value => {
    enabled = value
    await expect(enforceAttendanceInstallationApproval(prisma, scope, null)).resolves.toBeUndefined()
    expect(prisma.mtmSetting.findUnique).toHaveBeenCalledTimes(1)
  })
  it.each([false, "true", undefined])("leaves ordinary legacy marks intact for non-true rule %s", async value => {
    required = value
    await expect(enforceAttendanceInstallationApproval(prisma, scope, null)).resolves.toBeUndefined()
    expect(vi.mocked(prisma.$queryRaw).mock.calls.some(call => Array.isArray(call[0]) && call[0].join(" ").includes("AS approved"))).toBe(false)
  })
  it.each([null, "", "physical-imei", "rf-short"])("refuses missing or invalid installation %s only with the opt-in rule", async value => {
    await expect(enforceAttendanceInstallationApproval(prisma, scope, value)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_INSTALLATION_APP_REQUIRED", status: 422 })
  })
  it.each([null, false])("refuses absent, pending, rejected or revoked approval (%s)", async value => {
    approved = value
    await expect(enforceAttendanceInstallationApproval(prisma, scope, device)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_INSTALLATION_APPROVAL_REQUIRED" })
  })
  it("accepts only an affirmative current approval for the exact owner and installation", async () => {
    approved = true
    await expect(enforceAttendanceInstallationApproval(prisma, scope, device)).resolves.toBeUndefined()
    const read = vi.mocked(prisma.$queryRaw).mock.calls.find(call => Array.isArray(call[0]) && call[0].join(" ").includes("AS approved"))!
    expect(read).toContain(scope.organizationId); expect(read).toContain(scope.agentId); expect(read).toContain(device)
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
  it("denies reads and creates when disabled, without creating any audit or request", async () => {
    enabled = false
    await expect(readOwnAttendanceInstallation(self, device)).rejects.toMatchObject({ status: 404 })
    await expect(submitAttendanceInstallation(self, device, { requestId: randomUUID() })).rejects.toMatchObject({ status: 404 })
    expect(vi.mocked(prisma.$executeRaw).mock.calls.some(call => (call[0] as TemplateStringsArray).join(" ").includes("INSERT"))).toBe(false)
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
  it("does not grant access to an office employee whose participation was removed", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: self.agentId, role: "EMPLOYEE", attendanceParticipant: false } as never)
    await expect(submitAttendanceInstallation(self, device, { requestId: randomUUID() })).rejects.toMatchObject({ status: 403 })
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
  it("accepts no employee, location or installation in the request body", () => {
    expect(AttendanceInstallationRequestSchema.safeParse({ requestId: randomUUID(), agentId: "other" }).success).toBe(false)
    expect(AttendanceInstallationRequestSchema.safeParse({ requestId: randomUUID(), latitude: 40 }).success).toBe(false)
    expect(AttendanceInstallationDecisionSchema.safeParse({ requestId: randomUUID(), action: "APPROVE", reason: " " }).success).toBe(false)
    expect(AttendanceInstallationDecisionSchema.safeParse({ requestId: randomUUID(), action: "REVOKE", reason: "Fictional replacement" }).success).toBe(true)
  })
  it("keeps the old bootstrap shape when attendance is disabled", () => {
    expect(agentPermissionStates({ attendanceEnabled: false })).not.toHaveProperty("attendanceInstallation")
    expect(agentPermissionStates({ attendanceEnabled: true })).toHaveProperty("attendanceInstallation", true)
  })
  it("projects a revocation ahead of the original approval", () => {
    expect(attendanceInstallationState(null)).toBe("NOT_REQUESTED")
    expect(attendanceInstallationState({ action: null, revokedAt: null })).toBe("PENDING")
    expect(attendanceInstallationState({ action: "APPROVE", revokedAt: new Date() })).toBe("REVOKED")
  })
})
