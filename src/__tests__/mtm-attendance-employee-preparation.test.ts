import { beforeEach, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import { readAttendanceEmployeePreparation } from "@/lib/mtm/attendance-employee-preparation"
const query = vi.fn()
const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient
const scope = { organizationId: "fixture-org", agentId: "fixture-employee", date: "2026-10-22" }
const now = new Date("2026-10-22T08:00:00Z")
const card = { status: "ACTIVE", phone: "+994550000000", user: { isActive: true, phone: null } }
const configured = { companySchedule: true, shiftSchedule: false, branchName: "Fictional branch", branchActive: true, approvalRequired: true, approved: 1, pending: 2 }
beforeEach(() => { query.mockReset(); query.mockResolvedValue([configured]) })
it('returns configuration facts scoped to the already authorized employee without a fake workday', async () => {
  expect(await readAttendanceEmployeePreparation(tx, scope, card, now)).toEqual({ checkedAt: now.toISOString(), date: scope.date, login: "AVAILABLE", schedule: "COMPANY", branch: { name: "Fictional branch", active: true }, installations: { required: true, approved: 1, pending: 2 } })
  expect(query.mock.calls[0].slice(1)).toEqual([scope.organizationId, scope.agentId, scope.date])
})
it.each([
  [{ ...card, user: null }, "ACCOUNT_MISSING"],
  [{ ...card, status: "INACTIVE" }, "INACTIVE"],
  [{ ...card, user: { isActive: false, phone: null } }, "INACTIVE"],
  [{ ...card, phone: null }, "CONTACT_MISSING"],
] as const)('does not claim complete access for incomplete account facts', async (input, login) => {
  expect((await readAttendanceEmployeePreparation(tx, scope, input, now)).login).toBe(login)
})
it('separates an initial schedule, no primary branch and optional installation approval', async () => {
  query.mockResolvedValue([{ ...configured, companySchedule: false, branchName: null, branchActive: null, approvalRequired: false, approved: 0, pending: 0 }])
  expect(await readAttendanceEmployeePreparation(tx, scope, card, now)).toMatchObject({ schedule: "DEFAULT", branch: null, installations: { required: false, approved: 0, pending: 0 } })
  query.mockResolvedValue([{ ...configured, shiftSchedule: true, branchActive: false }])
  expect(await readAttendanceEmployeePreparation(tx, scope, card, now)).toMatchObject({ schedule: "SHIFT", branch: { active: false } })
})
it('does not hide unavailable data behind green defaults', async () => {
  query.mockResolvedValue([])
  await expect(readAttendanceEmployeePreparation(tx, scope, card, now)).rejects.toThrow('MTM_ATTENDANCE_PREPARATION_UNAVAILABLE')
})
it('accepts real email sign-in while ignoring internal placeholder addresses', async () => {
  expect((await readAttendanceEmployeePreparation(tx, scope, { ...card, phone: null, email: "fixture@example.invalid" }, now)).login).toBe("AVAILABLE")
  expect((await readAttendanceEmployeePreparation(tx, scope, { ...card, phone: null, email: "fixture@invalid.local" }, now)).login).toBe("CONTACT_MISSING")
})
