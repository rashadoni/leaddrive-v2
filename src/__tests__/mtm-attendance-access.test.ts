import { NextRequest } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/mtm/route-permissions", () => ({ resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null),
}))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { auth } from "@/lib/auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"
import { getRlsContext } from "@/lib/rls-context"
import type { Role } from "@/lib/permissions"
import { accessibleNavItems, isNavOrgSettingOn } from "@/lib/nav-items"
import { visibleMtmToolGroups } from "@/lib/mtm/navigation"
import { GET as readAttendance } from "@/app/api/v1/mtm/attendance/route"
import { PUT as updateSettings } from "@/app/api/v1/mtm/settings/route"
import AttendanceLayout from "@/app/(dashboard)/mtm/attendance/layout"

const ORG = "attendance-test-org"
const USER = "attendance-test-user"
const ADMIN: MtmRouteActor = { agentId: null, role: "ADMIN", scopedAgentIds: null }
const MANAGER: MtmRouteActor = { agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["agent-1"] }
const SUPERVISOR: MtmRouteActor = { agentId: "supervisor-1", role: "SUPERVISOR", scopedAgentIds: ["agent-1"] }
const AGENT: MtmRouteActor = { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] }

function caller(role: Role = "admin", actor: MtmRouteActor | null = ADMIN) {
  const identity = { orgId: ORG, userId: USER, role, email: "fixture@example.test", name: "Test operator", principalType: "session" as const }
  vi.mocked(requireAuth).mockResolvedValue(identity)
  vi.mocked(requireSessionAuth).mockResolvedValue(identity)
  vi.mocked(auth).mockResolvedValue({ user: { id: USER, organizationId: ORG, role } } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor)
}

function storedSwitch(value?: boolean) {
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue(
    (value === undefined ? [] : [{ key: "attendanceEnabled", value }]) as never,
  )
}

function put(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/settings", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as never)
  storedSwitch()
  caller()
})

describe("attendance is an explicit organization opt-in", () => {
  it("starts off without hiding established MTM features", () => {
    expect(MTM_SETTING_DEFAULTS.attendanceEnabled).toBe(false)
    for (const value of [undefined, false, true]) {
      expect(isNavOrgSettingOn("attendanceEnabled", value)).toBe(value === true)
      expect(isNavOrgSettingOn("fieldContactsEnabled", value)).toBe(value !== false)
      expect(isNavOrgSettingOn("pharmacyPromotionsEnabled", value)).toBe(value !== false)
    }
  })

  it.each([undefined, false, true])("shows the destination in both menus only after an explicit true (%s)", (value) => {
    const orgSettings = value === undefined ? {} : { attendanceEnabled: value }
    const org = { plan: "enterprise", role: "admin", modules: { mtm: true, "route-field": true }, orgSettings }
    const shell = accessibleNavItems(org).map((item) => item.href)
    const tools = visibleMtmToolGroups(orgSettings, "admin").flatMap((group) => group.items.map((item) => item.href))
    expect(shell.includes("/mtm/attendance")).toBe(value === true)
    expect(tools.includes("/mtm/attendance")).toBe(value === true)
    for (const hrefs of [shell, tools]) {
      expect(hrefs).toContain("/mtm/contacts")
      expect(hrefs).toContain("/mtm/promotions")
    }
  })

  it.each([undefined, false])("does not resolve an employee scope while the feature is off (%s)", async (value) => {
    storedSwitch(value)
    expect(await getMtmAttendanceAccess(ORG, USER, "admin")).toEqual({ enabled: false })
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
  })

  it.each([ADMIN, MANAGER, SUPERVISOR])("preserves the authorized %s scope", async (actor) => {
    storedSwitch(true)
    caller(actor.role === "ADMIN" ? "admin" : "manager", actor)
    const access = await getMtmAttendanceAccess(ORG, USER, actor.role === "ADMIN" ? "admin" : "manager")
    expect(access).toMatchObject({ enabled: true, actor, settings: { attendanceEnabled: true } })
    expect(resolveMtmRouteActor).toHaveBeenCalledWith(prisma, expect.objectContaining({ organizationId: ORG, userId: USER }))
  })

  it.each([AGENT, null])("refuses the report to an employee or an unlinked user (%s)", async (actor) => {
    storedSwitch(true)
    caller("sales", actor)
    expect(await getMtmAttendanceAccess(ORG, USER, "sales")).toMatchObject({ enabled: true, actor: null })
  })
})

describe("attendance API and server page guards", () => {
  it("returns a missing API while off, with no report data read", async () => {
    const response = await readAttendance(new NextRequest("http://localhost:3000/api/v1/mtm/attendance"))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body).toMatchObject({ code: "MTM_ATTENDANCE_DISABLED" })
    expect(body).not.toHaveProperty("data")
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
  })

  it.each([["admin", ADMIN, true], ["manager", MANAGER, false], ["manager", SUPERVISOR, false]] as const)(
    "lets %s read and distinguishes rule management (%s)", async (role, actor, canManageRules) => {
      storedSwitch(true)
      caller(role, actor)
      const response = await readAttendance(new NextRequest("http://localhost:3000/api/v1/mtm/attendance"))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true, data: { canManageRules } })
    },
  )

  it("returns 403 for an agent even when their organization enabled attendance", async () => {
    storedSwitch(true)
    caller("sales", AGENT)
    const response = await readAttendance(new NextRequest("http://localhost:3000/api/v1/mtm/attendance"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ATTENDANCE_FORBIDDEN" })
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
  })

  it("grants HR only attendance-wide reading without invoking a broader route role", async () => {
    storedSwitch(true)
    caller("viewer", null)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ mtmAttendanceAll: true, role: "viewer", hiddenModules: [] }] as never)
    expect(await getMtmAttendanceAccess(ORG, USER, "viewer")).toMatchObject({ enabled: true, actor: { role: "MANAGER", scopedAgentIds: null }, allEmployeesGrant: true })
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    const response = await readAttendance(new NextRequest("http://localhost/api/v1/mtm/attendance"))
    expect(await response.json()).toEqual({ success: true, data: { canManageRules: false } })
  })

  it("keeps a hidden module closed in the page before loading private attendance", async () => {
    storedSwitch(true)
    caller("manager", MANAGER)
    vi.mocked(auth).mockResolvedValue({ user: { id: USER, organizationId: ORG, role: "manager", hiddenModules: ["mtm"] } } as never)
    await expect(AttendanceLayout({ children: "private attendance" })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
  })

  it("does not render the nested page for a disabled organization", async () => {
    await expect(AttendanceLayout({ children: "private attendance content" })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
  })

  it("does not render the nested page to an agent", async () => {
    storedSwitch(true)
    caller("sales", AGENT)
    await expect(AttendanceLayout({ children: "private attendance content" })).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders the nested page for a manager and reads settings under the tenant context", async () => {
    caller("manager", MANAGER)
    vi.mocked(prisma.mtmSetting.findMany).mockImplementation((async () => {
      expect(getRlsContext()).toMatchObject({ orgId: ORG })
      expect(getRlsContext()?.bypass).not.toBe(true)
      return [{ key: "attendanceEnabled", value: true }]
    }) as never)
    const content = await AttendanceLayout({ children: "authorized attendance content" })
    expect(renderToStaticMarkup(content)).toContain("authorized attendance content")
  })
})

describe("attendance switch can only be changed by an administrator", () => {
  it.each([true, false])("persists the administrator's switch (%s)", async (enabled) => {
    storedSwitch(!enabled)
    const response = await updateSettings(put({ attendanceEnabled: enabled }))
    expect(response.status).toBe(200)
    expect(prisma.mtmSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_key: { organizationId: ORG, key: "attendanceEnabled" } },
      create: expect.objectContaining({ organizationId: ORG, key: "attendanceEnabled", value: enabled }),
      update: expect.objectContaining({ value: enabled }),
    }))
  })

  it.each([true, false])("refuses a manager's attendance switch (%s) before any setting is written", async (enabled) => {
    caller("manager", MANAGER)
    const response = await updateSettings(put({ attendanceEnabled: enabled, maxPhotosPerVisit: 12 }))
    expect(response.status).toBe(403)
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("continues ignoring older protected switches when a manager saves an allowed setting", async () => {
    caller("manager", MANAGER)
    const response = await updateSettings(put({ fieldContactsEnabled: false, pharmacyPromotionsEnabled: false, maxPhotosPerVisit: 12 }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.ignoredKeys).toEqual(["fieldContactsEnabled", "pharmacyPromotionsEnabled"])
    const writes = vi.mocked(prisma.mtmSetting.upsert).mock.calls.map(([args]) => args.create.key)
    expect(writes).toEqual(["maxPhotosPerVisit"])
  })
})
