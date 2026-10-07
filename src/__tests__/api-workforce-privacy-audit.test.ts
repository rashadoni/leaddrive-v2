import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import matrix from "./fixtures/workforce-privacy-routes.json"
import { workforceLogFailures } from "./fixtures/workforce-log-failures"

// Execute real route modules and the real shared log sink. Auth, validation,
// service and persistence boundaries are mocked here; their domain suites run separately.
vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => {
  const wrap = (...args: unknown[]) => args[args.length - 1]
  return { withWorkforceRlsAuth: wrap, withWorkforceSessionAuth: wrap,
    withWorkforceSessionScheduleConfigurationAuth: wrap, withWorkforceSessionPolicyConfigurationAuth: wrap,
    withWorkforceSessionEmploymentConfigurationAuth: wrap, withWorkforceSessionPilotFenceAuth: wrap,
    workforceSessionRoleAllows: () => true }
})
vi.mock("@/lib/workforce/actor", () => ({ resolveWorkforceActor: vi.fn(), isAgentInWorkforceScope: () => true }))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceAdminAddon: vi.fn(), requireWorkforceAttendanceSecurityMfa: vi.fn(),
  workforceAttendanceRequestAuditContext: () => ({}),
}))
vi.mock("@/lib/workforce/attendance-rate-limit", () => ({ checkWorkforceAttendanceRateLimit: () => ({ allowed: true }) }))
vi.mock("@/lib/workforce/attendance-management", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/attendance-management")>("@/lib/workforce/attendance-management")
  return { ...actual,
    approveWorkforceAttendanceDeviceEnrollment: vi.fn(),
    createWorkforceAttendanceQrStation: vi.fn(),
    disableWorkforceAttendanceQrStation: vi.fn(),
    issueWorkforceAttendanceQr: vi.fn(),
    replaceWorkforceAttendanceQrStation: vi.fn(),
    revokeWorkforceAttendanceDeviceEnrollment: vi.fn(),
    WorkforceAttendanceStationCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceAttendanceStationReplacementSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/configuration-management", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/configuration-management")>("@/lib/workforce/configuration-management")
  return { ...actual,
    activateWorkforceShiftTemplateDraft: vi.fn(),
    createWorkforcePolicyDraft: vi.fn(),
    createWorkforceShiftTemplateDraft: vi.fn(),
    updateWorkforcePolicyDraft: vi.fn(),
    updateWorkforceShiftTemplateDraft: vi.fn(),
    WorkforcePolicyDraftCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforcePolicyDraftUpdateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftAssignmentBulkPreviewSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftAssignmentBulkPublishSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftAssignmentScheduleSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftDefaultPublishSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftTeamDefaultPublishSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftTemplateDraftCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceShiftTemplateDraftUpdateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/workforce/employment-history", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/employment-history")>("@/lib/workforce/employment-history")
  return { ...actual,
    recordWorkforceEmploymentEvent: vi.fn(),
    resolveWorkforceHistoricalAssignment: vi.fn(),
    WorkforceEmploymentEventCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/workforce/mobile-write-fence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/mobile-write-fence")>("@/lib/workforce/mobile-write-fence")
  return { ...actual,
    disableWorkforceMobileWriteCohort: vi.fn(),
    getWorkforceMobileWriteFenceConfiguration: vi.fn(),
    setWorkforceMobileWriteFence: vi.fn(),
    upsertWorkforceMobileWriteCohort: vi.fn(),
    WorkforceMobileWriteCohortDisableSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceMobileWriteCohortUpsertSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceMobileWriteFenceUpdateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/workforce/site-management", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/site-management")>("@/lib/workforce/site-management")
  return { ...actual,
    archiveWorkforceSite: vi.fn(),
    createWorkforceSite: vi.fn(),
    WorkforceSiteArchiveSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceSiteAssignmentBulkPreviewSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceSiteAssignmentBulkPublishSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceSiteAssignmentScheduleSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceSiteCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceSiteGeofenceRevisionCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/workforce/timesheet-approval-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/timesheet-approval-service")>("@/lib/workforce/timesheet-approval-service")
  return { ...actual,
    approveWorkforceTimesheet: vi.fn(),
    WorkforceTimesheetApprovalRequestSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/workforce/attendance-policy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/attendance-policy")>("@/lib/workforce/attendance-policy")
  return { ...actual,
    WorkforceAttendanceActionSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})
vi.mock("@/lib/workforce/calendar-configuration-contract", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/calendar-configuration-contract")>("@/lib/workforce/calendar-configuration-contract")
  return { ...actual,
    WorkforceCalendarConfigurationCreateSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    WorkforceCalendarScopeSelectionSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  }
})

import { prisma } from "@/lib/prisma"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { requireWorkforceAttendanceAdminAddon, requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import * as service0 from "@/lib/workforce/attendance-management"
import * as service1 from "@/lib/mtm-settings"
import * as service2 from "@/lib/workforce/configuration-management"
import * as service3 from "@/lib/workforce/employment-history"
import * as service4 from "@/lib/workforce/mobile-write-fence"
import * as service5 from "@/lib/workforce/site-management"
import * as service6 from "@/lib/workforce/timesheet-approval-service"
const faultTargets: Record<string, ReturnType<typeof vi.fn>> = {
  "approveWorkforceAttendanceDeviceEnrollment": vi.mocked(service0.approveWorkforceAttendanceDeviceEnrollment) as ReturnType<typeof vi.fn>,
  "revokeWorkforceAttendanceDeviceEnrollment": vi.mocked(service0.revokeWorkforceAttendanceDeviceEnrollment) as ReturnType<typeof vi.fn>,
  "prisma.workforceAttendanceDeviceEnrollment.findMany": vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findMany) as ReturnType<typeof vi.fn>,
  "prisma.mtmAgent.findMany": vi.mocked(prisma.mtmAgent.findMany) as ReturnType<typeof vi.fn>,
  "disableWorkforceAttendanceQrStation": vi.mocked(service0.disableWorkforceAttendanceQrStation) as ReturnType<typeof vi.fn>,
  "issueWorkforceAttendanceQr": vi.mocked(service0.issueWorkforceAttendanceQr) as ReturnType<typeof vi.fn>,
  "replaceWorkforceAttendanceQrStation": vi.mocked(service0.replaceWorkforceAttendanceQrStation) as ReturnType<typeof vi.fn>,
  "prisma.workforceAttendanceQrStation.findMany": vi.mocked(prisma.workforceAttendanceQrStation.findMany) as ReturnType<typeof vi.fn>,
  "createWorkforceAttendanceQrStation": vi.mocked(service0.createWorkforceAttendanceQrStation) as ReturnType<typeof vi.fn>,
  "getMtmSettings": vi.mocked(service1.getMtmSettings) as ReturnType<typeof vi.fn>,
  "prisma.workforceShiftAssignment.findMany": vi.mocked(prisma.workforceShiftAssignment.findMany) as ReturnType<typeof vi.fn>,
  "resolveWorkforceHistoricalAssignment": vi.mocked(service3.resolveWorkforceHistoricalAssignment) as ReturnType<typeof vi.fn>,
  "recordWorkforceEmploymentEvent": vi.mocked(service3.recordWorkforceEmploymentEvent) as ReturnType<typeof vi.fn>,
  "upsertWorkforceMobileWriteCohort": vi.mocked(service4.upsertWorkforceMobileWriteCohort) as ReturnType<typeof vi.fn>,
  "disableWorkforceMobileWriteCohort": vi.mocked(service4.disableWorkforceMobileWriteCohort) as ReturnType<typeof vi.fn>,
  "getWorkforceMobileWriteFenceConfiguration": vi.mocked(service4.getWorkforceMobileWriteFenceConfiguration) as ReturnType<typeof vi.fn>,
  "setWorkforceMobileWriteFence": vi.mocked(service4.setWorkforceMobileWriteFence) as ReturnType<typeof vi.fn>,
  "updateWorkforcePolicyDraft": vi.mocked(service2.updateWorkforcePolicyDraft) as ReturnType<typeof vi.fn>,
  "prisma.workforcePolicy.findMany": vi.mocked(prisma.workforcePolicy.findMany) as ReturnType<typeof vi.fn>,
  "createWorkforcePolicyDraft": vi.mocked(service2.createWorkforcePolicyDraft) as ReturnType<typeof vi.fn>,
  "activateWorkforceShiftTemplateDraft": vi.mocked(service2.activateWorkforceShiftTemplateDraft) as ReturnType<typeof vi.fn>,
  "updateWorkforceShiftTemplateDraft": vi.mocked(service2.updateWorkforceShiftTemplateDraft) as ReturnType<typeof vi.fn>,
  "prisma.workforceShiftDefaultAssignment.findMany": vi.mocked(prisma.workforceShiftDefaultAssignment.findMany) as ReturnType<typeof vi.fn>,
  "prisma.workforceShiftTemplate.findMany": vi.mocked(prisma.workforceShiftTemplate.findMany) as ReturnType<typeof vi.fn>,
  "createWorkforceShiftTemplateDraft": vi.mocked(service2.createWorkforceShiftTemplateDraft) as ReturnType<typeof vi.fn>,
  "prisma.workforceShiftTeamDefaultAssignment.findMany": vi.mocked(prisma.workforceShiftTeamDefaultAssignment.findMany) as ReturnType<typeof vi.fn>,
  "prisma.workforceSiteAssignment.findMany": vi.mocked(prisma.workforceSiteAssignment.findMany) as ReturnType<typeof vi.fn>,
  "archiveWorkforceSite": vi.mocked(service5.archiveWorkforceSite) as ReturnType<typeof vi.fn>,
  "prisma.workforceSiteGeofenceRevision.findMany": vi.mocked(prisma.workforceSiteGeofenceRevision.findMany) as ReturnType<typeof vi.fn>,
  "prisma.workforceSite.findMany": vi.mocked(prisma.workforceSite.findMany) as ReturnType<typeof vi.fn>,
  "createWorkforceSite": vi.mocked(service5.createWorkforceSite) as ReturnType<typeof vi.fn>,
  "prisma.organization.findUnique": vi.mocked(prisma.organization.findUnique) as ReturnType<typeof vi.fn>,
  "approveWorkforceTimesheet": vi.mocked(service6.approveWorkforceTimesheet) as ReturnType<typeof vi.fn>,
}
import * as route0 from "@/app/api/v1/workforce/attendance/devices/[id]/approve/route"
import * as route1 from "@/app/api/v1/workforce/attendance/devices/[id]/revoke/route"
import * as route2 from "@/app/api/v1/workforce/attendance/devices/route"
import * as route3 from "@/app/api/v1/workforce/attendance/security-triage/route"
import * as route4 from "@/app/api/v1/workforce/attendance/stations/[id]/disable/route"
import * as route5 from "@/app/api/v1/workforce/attendance/stations/[id]/qr/route"
import * as route6 from "@/app/api/v1/workforce/attendance/stations/[id]/replace/route"
import * as route7 from "@/app/api/v1/workforce/attendance/stations/route"
import * as route8 from "@/app/api/v1/workforce/configuration/assignments/bulk/publish/route"
import * as route9 from "@/app/api/v1/workforce/configuration/assignments/preview/route"
import * as route10 from "@/app/api/v1/workforce/configuration/assignments/route"
import * as route11 from "@/app/api/v1/workforce/configuration/calendar/route"
import * as route12 from "@/app/api/v1/workforce/configuration/employment-events/route"
import * as route13 from "@/app/api/v1/workforce/configuration/mobile-write-fence/cohorts/route"
import * as route14 from "@/app/api/v1/workforce/configuration/mobile-write-fence/route"
import * as route15 from "@/app/api/v1/workforce/configuration/policies/[id]/activate/route"
import * as route16 from "@/app/api/v1/workforce/configuration/policies/[id]/route"
import * as route17 from "@/app/api/v1/workforce/configuration/policies/route"
import * as route18 from "@/app/api/v1/workforce/configuration/shifts/[id]/activate/route"
import * as route19 from "@/app/api/v1/workforce/configuration/shifts/[id]/route"
import * as route20 from "@/app/api/v1/workforce/configuration/shifts/default/route"
import * as route21 from "@/app/api/v1/workforce/configuration/shifts/route"
import * as route22 from "@/app/api/v1/workforce/configuration/shifts/team-default/route"
import * as route23 from "@/app/api/v1/workforce/configuration/site-assignments/bulk/publish/route"
import * as route24 from "@/app/api/v1/workforce/configuration/site-assignments/preview/route"
import * as route25 from "@/app/api/v1/workforce/configuration/site-assignments/route"
import * as route26 from "@/app/api/v1/workforce/configuration/sites/[id]/archive/route"
import * as route27 from "@/app/api/v1/workforce/configuration/sites/[id]/geofences/route"
import * as route28 from "@/app/api/v1/workforce/configuration/sites/route"
import * as route29 from "@/app/api/v1/workforce/exceptions/mine/route"
import * as route30 from "@/app/api/v1/workforce/timesheet/approvals/route"
import * as route31 from "@/app/api/v1/workforce/timesheet/route"
import * as route32 from "@/app/api/v1/workforce/today/route"
type Handler = (req: NextRequest, auth: typeof authContext, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const routes: Record<string, Record<string, Handler>> = {
  "src/app/api/v1/workforce/attendance/devices/[id]/approve/route.ts": route0 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/devices/[id]/revoke/route.ts": route1 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/devices/route.ts": route2 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/security-triage/route.ts": route3 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/stations/[id]/disable/route.ts": route4 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/stations/[id]/qr/route.ts": route5 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/stations/[id]/replace/route.ts": route6 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/attendance/stations/route.ts": route7 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/assignments/bulk/publish/route.ts": route8 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/assignments/preview/route.ts": route9 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/assignments/route.ts": route10 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/calendar/route.ts": route11 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/employment-events/route.ts": route12 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/mobile-write-fence/cohorts/route.ts": route13 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/mobile-write-fence/route.ts": route14 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/policies/[id]/activate/route.ts": route15 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/policies/[id]/route.ts": route16 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/policies/route.ts": route17 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/shifts/[id]/activate/route.ts": route18 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/shifts/[id]/route.ts": route19 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/shifts/default/route.ts": route20 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/shifts/route.ts": route21 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/shifts/team-default/route.ts": route22 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/site-assignments/bulk/publish/route.ts": route23 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/site-assignments/preview/route.ts": route24 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/site-assignments/route.ts": route25 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/sites/[id]/archive/route.ts": route26 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/sites/[id]/geofences/route.ts": route27 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/configuration/sites/route.ts": route28 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/exceptions/mine/route.ts": route29 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/timesheet/approvals/route.ts": route30 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/timesheet/route.ts": route31 as unknown as Record<string, Handler>,
  "src/app/api/v1/workforce/today/route.ts": route32 as unknown as Record<string, Handler>,
}
const authContext = { orgId: "synthetic-org", userId: "synthetic-user", role: "admin", principalType: "session" }
function request(method: string) {
  return new NextRequest("http://localhost/api/v1/workforce/synthetic?agentId=synthetic-agent&occurredAt=2026-10-06T00:00:00Z&workDate=2026-10-06", {
    method, ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "START", scope: "ORGANIZATION" }) }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "synthetic-agent", role: "AGENT", scopedAgentIds: ["synthetic-agent"] })
  vi.mocked(requireWorkforceAttendanceAdminAddon).mockResolvedValue(null)
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

describe("All 46 remaining Workforce route log boundaries", () => {
  for (const row of matrix) {
    it.each(workforceLogFailures)(row.operation + " discards $kind", async ({ make }) => {
      const failure = make()
      const target = faultTargets[row.faultTarget]
      target.mockRejectedValueOnce(failure)
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const warnLog = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const response = await routes[row.path][row.method](request(row.method), authContext, { params: Promise.resolve({ id: "synthetic-id" }) })
      expect(target, "the intended failure boundary was reached").toHaveBeenCalledTimes(1)
      expect(response.status).toBe(row.operation === "today-get" ? 503 : 500)
      expect(errorLog.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation: row.operation }]])
      expect(warnLog).not.toHaveBeenCalled()
      const body = await response.text()
      expect(body).not.toContain("WORKFORCE_PRIVATE_CANARY")
      expect(body).not.toContain("synthetic-agent")
      if (row.operation === "timesheet-approvals-post") expect(response.headers.get("cache-control")).toBe("private, no-store")
    })
  }
})

import { WorkforceManagerTodayBoundsError } from "@/lib/workforce/manager-today"
import { WorkforceTimesheetReadModelError } from "@/lib/workforce/timesheet-read-model"

const typedCases = [
  { operation: "today-get", failure: new WorkforceManagerTodayBoundsError(), status: 503 },
  { operation: "timesheet-get", failure: new WorkforceTimesheetReadModelError(), status: 409 },
  ...["configuration-mobile-write-fence-get", "configuration-mobile-write-fence-put"].map(operation => ({ operation, failure: { code: "P2021" }, status: 503 })),
  { operation: "attendance-devices-item-approve-post", failure: new service0.WorkforceAttendanceManagementError("WORKFORCE_ATTENDANCE_ENROLLMENT_NOT_FOUND"), status: 404 },
  { operation: "attendance-devices-item-approve-post", failure: new service0.WorkforceAttendanceManagementError("WORKFORCE_ATTENDANCE_ENROLLMENT_APPROVAL_INVALID"), status: 409 },
  ...["attendance-stations-item-disable-post", "attendance-stations-item-qr-post", "attendance-stations-item-replace-post"].map(operation => ({ operation, failure: new service0.WorkforceAttendanceManagementError("WORKFORCE_ATTENDANCE_STATION_NOT_FOUND"), status: 404 })),
  { operation: "configuration-policies-item-activate-post", failure: new service2.WorkforceConfigurationManagementError("WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND"), status: 404 },
  { operation: "configuration-policies-item-activate-post", failure: new service2.WorkforceConfigurationManagementError("WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT"), status: 409 },
  { operation: "configuration-employment-events-post", failure: new service3.WorkforceEmploymentHistoryError("WORKFORCE_EMPLOYMENT_AGENT_NOT_FOUND"), status: 404 },
  { operation: "configuration-mobile-write-fence-cohorts-delete", failure: new service4.WorkforceMobileWriteFenceError("Synthetic missing cohort", "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_NOT_FOUND"), status: 404 },
  { operation: "configuration-mobile-write-fence-put", failure: new service4.WorkforceMobileWriteFenceError("Synthetic cohort required", "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED"), status: 409 },
  { operation: "configuration-sites-item-archive-post", failure: new service5.WorkforceSiteManagementError("WORKFORCE_SITE_NOT_FOUND"), status: 404 },
  { operation: "configuration-sites-item-archive-post", failure: new service5.WorkforceSiteManagementError("WORKFORCE_SITE_ALREADY_ARCHIVED"), status: 409 },
]
describe("Typed domain responses remain distinct from unexpected failures", () => {
  it.each(typedCases)("$operation retains typed status$status without failure log", async ({ operation, failure, status }) => {
    const row = matrix.find(value => value.operation === operation)!
    faultTargets[row.faultTarget].mockRejectedValueOnce(failure)
    const captured = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const response = await routes[row.path][row.method](request(row.method), authContext, { params: Promise.resolve({ id: "synthetic-id" }) })
    expect(response.status).toBe(status)
    expect(captured).not.toHaveBeenCalled()
    if (failure instanceof WorkforceTimesheetReadModelError) await expect(response.json()).resolves.toMatchObject({ code: failure.code })
  })
  it.each([
    { operation: "configuration-assignments-bulk-publish-post", make: (preview: unknown) => new service2.WorkforceShiftAssignmentBulkPublishError("WORKFORCE_CONFIGURATION_ASSIGNMENT_BULK_PREVIEW_BLOCKED", "Synthetic blocked preview", preview as never) },
    { operation: "configuration-site-assignments-bulk-publish-post", make: (preview: unknown) => new service5.WorkforceSiteAssignmentBulkPublishError("WORKFORCE_SITE_ASSIGNMENT_BULK_PREVIEW_BLOCKED", "Synthetic blocked preview", preview as never) },
  ])("$operation keeps409 preview data", async ({ operation, make }) => {
    const row = matrix.find(value => value.operation === operation)!
    const preview = { items: [], synthetic: true }
    faultTargets[row.faultTarget].mockRejectedValueOnce(make(preview))
    const captured = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const response = await routes[row.path][row.method](request(row.method), authContext, { params: Promise.resolve({ id: "synthetic-id" }) })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ data: { preview } })
    expect(captured).not.toHaveBeenCalled()
  })
})
