import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn(async () => ({})) }))
vi.mock("@/lib/prisma", () => ({ prisma: { mtmSetting: { upsert } } }))
vi.mock("@/lib/mtm-settings", () => ({
  MTM_SETTING_DEFAULTS: { attendanceEnabled: false, attendanceTwoStepApproval: false, attendanceAutoCloseForgottenDay: false },
  getMtmSettings: async () => ({ attendanceEnabled: true, attendanceTwoStepApproval: false, attendanceAutoCloseForgottenDay: false }),
}))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(async () => undefined) }))

import { hrMayChangeLogin, isOfficeLogin, isPersonnelGrantHolder, isPersonnelManager, personnelManagerActor } from "@/lib/mtm/attendance-manager"
import { ATTENDANCE_POLICY_KEYS, saveAttendancePolicy } from "@/lib/mtm/attendance-policy-save"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"

// Owner, 2026-11-21: HR are not agents, see and manage all of Personnel.
describe("who runs Personnel", () => {
  it("an administrator, and HR whose role may write and whose Personnel tick is on", () => {
    expect(isPersonnelManager({ role: "admin" })).toBe(true)
    expect(isPersonnelManager({ role: "manager", mtmAttendanceAll: true, hiddenModules: ["mtm"] })).toBe(true)
    expect(isPersonnelGrantHolder({ role: "manager", mtmAttendanceAll: true })).toBe(true)
    expect(isPersonnelGrantHolder({ role: "admin", mtmAttendanceAll: true })).toBe(false)
  })

  it("not a manager without the grant, a read-only role with it, or one with Personnel hidden", () => {
    expect(isPersonnelManager({ role: "manager", mtmAttendanceAll: false })).toBe(false)
    expect(isPersonnelManager({ role: "viewer", mtmAttendanceAll: true })).toBe(false)
    expect(isPersonnelManager({ role: "manager", mtmAttendanceAll: true, hiddenModules: ["personnel"] })).toBe(false)
    expect(isPersonnelManager(null)).toBe(false)
  })

  it("reaches the whole organization with no card behind it", () => {
    expect(personnelManagerActor()).toMatchObject({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  })
})

describe("whose sign-in HR may change: whoever changes it can sign in as them", () => {
  const office = { role: "viewer", hiddenModules: [...USER_HIDEABLE_MODULE_IDS], mtmAttendanceAll: false, settingsSections: [] }

  it("an office employee, and a field or office card with no login", () => {
    expect(isOfficeLogin(office)).toBe(true)
    expect(hrMayChangeLogin("EMPLOYEE", office)).toBe(true)
    expect(hrMayChangeLogin("AGENT", null)).toBe(true)
  })

  it.each([
    ["a manager's login", "EMPLOYEE", { ...office, role: "manager" }],
    ["an administrator", "EMPLOYEE", { ...office, role: "admin" }],
    ["a viewer who can open a module", "EMPLOYEE", { ...office, hiddenModules: office.hiddenModules.filter(id => id !== "finance") }],
    ["another HR", "EMPLOYEE", { ...office, mtmAttendanceAll: true }],
    ["someone with a Settings section", "EMPLOYEE", { ...office, settingsSections: ["channels"] }],
    ["an office login on a manager's card", "MANAGER", office],
  ])("not %s", (_name, cardRole, user) => {
    expect(hrMayChangeLogin(cardRole, user)).toBe(false)
  })

  it("not a manager's card with no login", () => {
    expect(hrMayChangeLogin("SUPERVISOR", null)).toBe(false)
  })
})

describe("Personnel's own settings", () => {
  beforeEach(() => upsert.mockClear())

  it("do not include switching the section off", () => {
    expect(ATTENDANCE_POLICY_KEYS).not.toContain("attendanceEnabled")
  })

  it("write what belongs to the section and drop everything else from the same request", async () => {
    const auth = { orgId: "org-1", userId: "hr-1", role: "manager" }
    const result = await saveAttendancePolicy(auth, { attendanceEnabled: false, gpsInterval: 1, attendanceTwoStepApproval: true }, {} as NextRequest)
    expect(result.changed).toEqual(["attendanceTwoStepApproval"])
    expect(upsert.mock.calls.map(call => (call as unknown as [{ create: { key: string } }])[0].create.key)).toEqual(["attendanceTwoStepApproval"])
  })

  it("record who switched auto-approval on", async () => {
    await saveAttendancePolicy({ orgId: "org-1", userId: "hr-1", role: "manager" }, { attendanceAutoCloseForgottenDay: true }, {} as NextRequest)
    const written = upsert.mock.calls.map(call => (call as unknown as [{ create: { key: string; value: unknown } }])[0].create)
    expect(written).toContainEqual(expect.objectContaining({ key: "attendanceAutoCloseForgottenDayBy", value: "hr-1" }))
  })
})
