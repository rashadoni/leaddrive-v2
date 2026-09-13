import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAdminAuth: vi.fn((handler) => handler),
  withWorkforceSessionScheduleConfigurationAuth: vi.fn((_permission, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/configuration-management", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/configuration-management")>(
    "@/lib/workforce/configuration-management",
  )
  return {
    ...actual,
    createWorkforcePolicyDraft: vi.fn(),
    createWorkforceShiftTemplateDraft: vi.fn(),
    updateWorkforcePolicyDraft: vi.fn(),
    updateWorkforceShiftTemplateDraft: vi.fn(),
    activateWorkforcePolicyDraft: vi.fn(),
    activateWorkforceShiftTemplateDraft: vi.fn(),
    scheduleWorkforceShiftAssignment: vi.fn(),
    previewWorkforceShiftAssignments: vi.fn(),
    publishWorkforceShiftAssignments: vi.fn(),
    publishWorkforceShiftDefault: vi.fn(),
    publishWorkforceShiftTeamDefault: vi.fn(),
  }
})

import { POST as createPolicy } from "@/app/api/v1/workforce/configuration/policies/route"
import { PATCH as updatePolicy } from "@/app/api/v1/workforce/configuration/policies/[id]/route"
import { POST as activatePolicy } from "@/app/api/v1/workforce/configuration/policies/[id]/activate/route"
import { POST as createShift } from "@/app/api/v1/workforce/configuration/shifts/route"
import { PATCH as updateShift } from "@/app/api/v1/workforce/configuration/shifts/[id]/route"
import { POST as activateShift } from "@/app/api/v1/workforce/configuration/shifts/[id]/activate/route"
import { GET as listAssignments, POST as scheduleAssignment } from "@/app/api/v1/workforce/configuration/assignments/route"
import { POST as previewAssignments } from "@/app/api/v1/workforce/configuration/assignments/preview/route"
import { POST as publishAssignments } from "@/app/api/v1/workforce/configuration/assignments/bulk/publish/route"
import { GET as listDefaultAssignments, POST as scheduleDefaultAssignment } from "@/app/api/v1/workforce/configuration/shifts/default/route"
import { GET as listTeamDefaultAssignments, POST as scheduleTeamDefaultAssignment } from "@/app/api/v1/workforce/configuration/shifts/team-default/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import {
  withWorkforceSessionAdminAuth,
  withWorkforceSessionScheduleConfigurationAuth,
} from "@/lib/with-workforce-rls-auth"
import {
  activateWorkforcePolicyDraft,
  activateWorkforceShiftTemplateDraft,
  createWorkforcePolicyDraft,
  createWorkforceShiftTemplateDraft,
  previewWorkforceShiftAssignments,
  publishWorkforceShiftAssignments,
  scheduleWorkforceShiftAssignment,
  publishWorkforceShiftDefault,
  publishWorkforceShiftTeamDefault,
  updateWorkforcePolicyDraft,
  updateWorkforceShiftTemplateDraft,
} from "@/lib/workforce/configuration-management"

const AUTH = {
  orgId: "org-workforce",
  userId: "admin-1",
  role: "admin",
}
type ConfigurationRouteContext = { params: Promise<{ id: string }> }
type ConfigurationUpdateHandler = (
  request: NextRequest,
  auth: typeof AUTH,
  context: ConfigurationRouteContext,
) => Promise<Response>
const callUpdatePolicy = updatePolicy as unknown as ConfigurationUpdateHandler
const callUpdateShift = updateShift as unknown as ConfigurationUpdateHandler
const callActivatePolicy = activatePolicy as unknown as ConfigurationUpdateHandler
const callActivateShift = activateShift as unknown as ConfigurationUpdateHandler
const callScheduleAssignment = scheduleAssignment as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callListAssignments = listAssignments as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callPreviewAssignments = previewAssignments as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callPublishAssignments = publishAssignments as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callScheduleDefaultAssignment = scheduleDefaultAssignment as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callListDefaultAssignments = listDefaultAssignments as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callScheduleTeamDefaultAssignment = scheduleTeamDefaultAssignment as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const callListTeamDefaultAssignments = listTeamDefaultAssignments as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const policyDefinition = {
  expectedWorkSeconds: 28800,
  lateGraceSeconds: 300,
  undertimeToleranceSeconds: 300,
  overtimeThresholdSeconds: 900,
  longPauseThresholdSeconds: null,
}
const shiftDefinition = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

beforeEach(() => {
  // Keep the route-construction calls intact: they prove each exported handler
  // is session-only and cannot use the API-key authorization path.
  vi.mocked(createWorkforcePolicyDraft).mockReset()
  vi.mocked(createWorkforceShiftTemplateDraft).mockReset()
  vi.mocked(updateWorkforcePolicyDraft).mockReset()
  vi.mocked(updateWorkforceShiftTemplateDraft).mockReset()
  vi.mocked(activateWorkforcePolicyDraft).mockReset()
  vi.mocked(activateWorkforceShiftTemplateDraft).mockReset()
  vi.mocked(scheduleWorkforceShiftAssignment).mockReset()
  vi.mocked(previewWorkforceShiftAssignments).mockReset()
  vi.mocked(publishWorkforceShiftAssignments).mockReset()
  vi.mocked(publishWorkforceShiftDefault).mockReset()
  vi.mocked(publishWorkforceShiftTeamDefault).mockReset()
  vi.mocked(getMtmSettings).mockReset()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
})

describe("Workforce draft configuration API", () => {
  it("binds every configuration route to an accountable Workforce session boundary", () => {
    expect(withWorkforceSessionAdminAuth).toHaveBeenCalledTimes(7)
    expect(withWorkforceSessionScheduleConfigurationAuth).toHaveBeenCalledTimes(9)
    expect(
      vi.mocked(withWorkforceSessionScheduleConfigurationAuth).mock.calls.map(([permission]) => permission).sort(),
    ).toEqual([
      "SCHEDULE_READ", "SCHEDULE_READ", "SCHEDULE_READ",
      "SCHEDULE_WRITE", "SCHEDULE_WRITE", "SCHEDULE_WRITE",
      "SCHEDULE_WRITE", "SCHEDULE_WRITE", "SCHEDULE_WRITE",
    ])
  })

  it("creates only validated draft policy and shift records", async () => {
    vi.mocked(createWorkforcePolicyDraft).mockResolvedValue({ id: "policy-1", status: "DRAFT" } as never)
    vi.mocked(createWorkforceShiftTemplateDraft).mockResolvedValue({ id: "shift-1", status: "DRAFT", isDefault: false } as never)

    const policyResponse = await createPolicy(post("/api/v1/workforce/configuration/policies", {
      name: "Standard policy", effectiveFrom: "2026-09-01", definition: policyDefinition,
    }, {
      "x-forwarded-for": "198.51.100.72",
      "x-real-ip": "203.0.113.72",
      "user-agent": "configuration-test-agent".repeat(40),
    }), AUTH as never)
    const shiftResponse = await createShift(post("/api/v1/workforce/configuration/shifts", {
      code: "STANDARD", name: "Standard shift", definition: shiftDefinition,
    }), AUTH as never)

    expect(policyResponse.status).toBe(201)
    expect(shiftResponse.status).toBe(201)
    expect(createWorkforcePolicyDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      createdByUserId: AUTH.userId,
      draft: expect.objectContaining({ name: "Standard policy" }),
      audit: expect.objectContaining({
        actorUserId: AUTH.userId,
        ipAddress: "203.0.113.72",
        userAgent: "configuration-test-agent".repeat(40).slice(0, 500),
      }),
    }))
    expect(createWorkforceShiftTemplateDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      createdByUserId: AUTH.userId,
      draft: expect.objectContaining({ code: "STANDARD" }),
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
  })

  it("accepts an ordered Workforce-only multi-site timeline and rejects an ambiguous site mode", async () => {
    vi.mocked(createWorkforceShiftTemplateDraft).mockResolvedValue({
      id: "shift-segmented",
      status: "DRAFT",
      isDefault: false,
      segments: [{ sequence: 1 }, { sequence: 2 }],
    } as never)
    const response = await createShift(post("/api/v1/workforce/configuration/shifts", {
      code: "MULTI_SITE",
      name: "Multi-site day",
      definition: {
        ...shiftDefinition,
        plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
      },
      segments: [
        { mode: "SITE", siteId: "site-a", startTime: "09:00", endTime: "13:00", lateGraceSeconds: 900 },
        { mode: "SITE", siteId: "site-b", startTime: "14:00", endTime: "18:00", lateGraceSeconds: 900 },
      ],
    }), AUTH as never)
    const invalid = await createShift(post("/api/v1/workforce/configuration/shifts", {
      code: "INVALID_MODE",
      name: "Invalid mode",
      definition: shiftDefinition,
      segments: [{ mode: "REMOTE", siteId: "site-a", startTime: "09:00", endTime: "18:00" }],
    }), AUTH as never)

    expect(response.status).toBe(201)
    expect(invalid.status).toBe(400)
    expect(createWorkforceShiftTemplateDraft).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({
        segments: [
          expect.objectContaining({ mode: "SITE", siteId: "site-a", lateGraceSeconds: 900 }),
          expect.objectContaining({ mode: "SITE", siteId: "site-b", lateGraceSeconds: 900 }),
        ],
      }),
    }))
  })

  it("cannot use patch to change a published configuration through an unchecked body", async () => {
    const invalidPolicy = await callUpdatePolicy(post("/api/v1/workforce/configuration/policies/policy-1", {
      teamId: "other-team",
    }), AUTH, { params: Promise.resolve({ id: "policy-1" }) })
    const invalidShift = await callUpdateShift(post("/api/v1/workforce/configuration/shifts/shift-1", {
      code: "CHANGED",
    }), AUTH, { params: Promise.resolve({ id: "shift-1" }) })

    expect(invalidPolicy.status).toBe(400)
    expect(invalidShift.status).toBe(400)
    expect(updateWorkforcePolicyDraft).not.toHaveBeenCalled()
    expect(updateWorkforceShiftTemplateDraft).not.toHaveBeenCalled()
  })

  it("activates only through the session-admin boundary with a server-derived organization date", async () => {
    vi.mocked(activateWorkforcePolicyDraft).mockResolvedValue({ id: "policy-1", status: "ACTIVE" } as never)
    vi.mocked(activateWorkforceShiftTemplateDraft).mockResolvedValue({ id: "shift-1", status: "ACTIVE", isDefault: false } as never)

    const policyResponse = await callActivatePolicy(post("/api/v1/workforce/configuration/policies/policy-1/activate", {}), AUTH, {
      params: Promise.resolve({ id: "policy-1" }),
    })
    const shiftResponse = await callActivateShift(post("/api/v1/workforce/configuration/shifts/shift-1/activate", {}), AUTH, {
      params: Promise.resolve({ id: "shift-1" }),
    })

    expect(policyResponse.status).toBe(200)
    expect(shiftResponse.status).toBe(200)
    expect(getMtmSettings).toHaveBeenCalledWith(AUTH.orgId)
    expect(activateWorkforcePolicyDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      policyId: "policy-1",
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
    expect(activateWorkforceShiftTemplateDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      templateId: "shift-1",
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
  })

  it("schedules an individual shift only through the session-admin boundary and a server-derived date", async () => {
    vi.mocked(scheduleWorkforceShiftAssignment).mockResolvedValue({
      id: "assignment-1",
      agentId: "agent-1",
      templateId: "shift-1",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    } as never)

    const response = await callScheduleAssignment(post("/api/v1/workforce/configuration/assignments", {
      agentId: "agent-1",
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
    }), AUTH)

    expect(response.status).toBe(201)
    expect(getMtmSettings).toHaveBeenCalledWith(AUTH.orgId)
    expect(scheduleWorkforceShiftAssignment).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      assignment: { agentId: "agent-1", templateId: "shift-1", effectiveFrom: "2026-09-01" },
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
  })

  it("provides a read-only bulk impact preview through the session-admin boundary", async () => {
    vi.mocked(previewWorkforceShiftAssignments).mockResolvedValue({
      effectiveFrom: "2026-09-01",
      templateId: "shift-1",
      items: [{ agentId: "agent-1", outcome: "READY", currentAssignmentId: null, closesAssignmentId: null }],
      summary: { READY: 1, NO_CHANGE: 0, EMPLOYEE_UNAVAILABLE: 0, TEMPLATE_TEAM_MISMATCH: 0, CONFLICT: 0 },
    } as never)

    const response = await callPreviewAssignments(post("/api/v1/workforce/configuration/assignments/preview", {
      agentIds: ["agent-1"], templateId: "shift-1", effectiveFrom: "2026-09-01",
    }), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { summary: { READY: 1 }, items: [{ outcome: "READY" }] },
    })
    expect(getMtmSettings).toHaveBeenCalledWith(AUTH.orgId)
    expect(previewWorkforceShiftAssignments).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      preview: { agentIds: ["agent-1"], templateId: "shift-1", effectiveFrom: "2026-09-01" },
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
    expect(scheduleWorkforceShiftAssignment).not.toHaveBeenCalled()
  })

  it("publishes a rechecked bulk shift draft only through the exact schedule write boundary", async () => {
    vi.mocked(publishWorkforceShiftAssignments).mockResolvedValue({
      operationId: "bulk-shift-operation-1",
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
      requestedCount: 1,
      createdCount: 1,
      unchangedCount: 0,
      idempotent: false,
    } as never)

    const response = await callPublishAssignments(post("/api/v1/workforce/configuration/assignments/bulk/publish", {
      operationId: "bulk-shift-operation-1",
      agentIds: ["agent-1"],
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
    }), AUTH)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { operation: { operationId: "bulk-shift-operation-1", createdCount: 1 } },
    })
    expect(publishWorkforceShiftAssignments).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      publishedByUserId: AUTH.userId,
      publish: expect.objectContaining({ operationId: "bulk-shift-operation-1", agentIds: ["agent-1"] }),
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
  })

  it("returns a named active roster and effective-date preview without asking the web client for raw IDs", async () => {
    const listed = {
      id: "assignment-history",
      agentId: "agent-1",
      templateId: "shift-1",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      agent: { id: "agent-1", name: "Aysel Aliyeva", email: "aysel@example.test", externalCode: "EMP-01", teamId: null, status: "ACTIVE" },
      template: { id: "shift-1", code: "BAKU", name: "Baku workday", timezone: "Asia/Baku", teamId: null, status: "ACTIVE", isDefault: true },
    }
    vi.mocked(prisma.workforceShiftAssignment.findMany)
      .mockResolvedValueOnce([listed] as never)
      .mockResolvedValueOnce([listed] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel Aliyeva", email: "aysel@example.test", externalCode: "EMP-01", teamId: null, status: "ACTIVE", team: null },
    ] as never)
    vi.mocked(prisma.workforceShiftTemplate.findMany).mockResolvedValue([
      { id: "shift-1", code: "BAKU", name: "Baku workday", timezone: "Asia/Baku", teamId: null, isDefault: true },
    ] as never)

    const response = await callListAssignments(get("/api/v1/workforce/configuration/assignments?effectiveDate=2026-09-01"), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        roster: {
          employees: [{ id: "agent-1", name: "Aysel Aliyeva" }],
          teams: [],
          shiftTemplates: [{ id: "shift-1", name: "Baku workday" }],
        },
        directoryEmployees: [{ id: "agent-1", status: "ACTIVE" }],
        assignments: [expect.objectContaining({ agent: expect.objectContaining({ name: "Aysel Aliyeva" }) })],
        preview: {
          effectiveDate: "2026-09-01",
          assignments: [expect.objectContaining({ template: expect.objectContaining({ name: "Baku workday" }) })],
        },
      },
    })
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId, status: "ACTIVE" },
      select: expect.objectContaining({ name: true }),
    }))
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
      take: 250,
      select: expect.objectContaining({ status: true, team: expect.any(Object) }),
    }))
    expect(prisma.mtmTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
      select: expect.objectContaining({ name: true, isActive: true }),
    }))
    expect(prisma.workforceShiftAssignment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: AUTH.orgId,
        effectiveFrom: { lte: new Date("2026-09-01T00:00:00.000Z") },
      }),
    }))
  })

  it("bounds named active-roster search and tells the browser to refine it", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockReset()
    vi.mocked(prisma.mtmAgent.findMany).mockImplementation(async (query: unknown) => {
      const where = (query as { where?: { status?: string } }).where
      return where?.status === "ACTIVE"
        ? [
            { id: "agent-1", name: "Aysel Aliyeva", email: "aysel@example.test", externalCode: "EMP-01", teamId: null, status: "ACTIVE", team: null },
            { id: "agent-2", name: "Aydin Aliyev", email: "aydin@example.test", externalCode: "EMP-02", teamId: null, status: "ACTIVE", team: null },
          ]
        : []
    })

    const response = await callListAssignments(get("/api/v1/workforce/configuration/assignments?rosterLimit=1&rosterQuery=ays"), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        roster: {
          employees: [{ id: "agent-1", name: "Aysel Aliyeva" }],
          query: "ays",
          limit: 1,
          hasMore: true,
        },
      },
    })
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: AUTH.orgId,
        status: "ACTIVE",
        OR: [
          { name: { contains: "ays", mode: "insensitive" } },
          { email: { contains: "ays", mode: "insensitive" } },
          { externalCode: { contains: "ays", mode: "insensitive" } },
        ],
      },
      take: 2,
    }))
  })

  it("rejects an invalid effective-date preview before reading Workforce records", async () => {
    vi.mocked(prisma.workforceShiftAssignment.findMany).mockClear()
    vi.mocked(prisma.mtmAgent.findMany).mockClear()
    const response = await callListAssignments(get("/api/v1/workforce/configuration/assignments?effectiveDate=2026-02-30"), AUTH)

    expect(response.status).toBe(400)
    expect(prisma.workforceShiftAssignment.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  it("publishes a confirmed default only through the session-admin boundary and a server-derived date", async () => {
    vi.mocked(publishWorkforceShiftDefault).mockResolvedValue({
      operationId: "default-publish-route-1",
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
      defaultAssignmentId: "default-1",
      predecessorClosed: false,
      idempotent: false,
    } as never)

    const response = await callScheduleDefaultAssignment(post("/api/v1/workforce/configuration/shifts/default", {
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
      operationId: "default-publish-route-1",
    }), AUTH)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(getMtmSettings).toHaveBeenCalledWith(AUTH.orgId)
    expect(publishWorkforceShiftDefault).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      publishedByUserId: AUTH.userId,
      publish: {
        templateId: "shift-1",
        effectiveFrom: "2026-09-01",
        operationId: "default-publish-route-1",
      },
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
  })

  it("rejects an organization-default write without an opaque replay key", async () => {
    const response = await callScheduleDefaultAssignment(post("/api/v1/workforce/configuration/shifts/default", {
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
    }), AUTH)
    expect(response.status).toBe(400)
    expect(publishWorkforceShiftDefault).not.toHaveBeenCalled()
  })

  it("publishes a confirmed team default through the session boundary and server-derived date", async () => {
    vi.mocked(publishWorkforceShiftTeamDefault).mockResolvedValue({
      operationId: "team-default-route-1",
      teamId: "team-a",
      templateId: "team-a-shift",
      effectiveFrom: "2026-09-01",
      teamDefaultAssignmentId: "team-default-1",
      predecessorClosed: false,
      idempotent: false,
    } as never)

    const response = await callScheduleTeamDefaultAssignment(post("/api/v1/workforce/configuration/shifts/team-default", {
      operationId: "team-default-route-1",
      teamId: "team-a",
      templateId: "team-a-shift",
      effectiveFrom: "2026-09-01",
    }), AUTH)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(publishWorkforceShiftTeamDefault).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      publishedByUserId: AUTH.userId,
      publish: {
        operationId: "team-default-route-1",
        teamId: "team-a",
        templateId: "team-a-shift",
        effectiveFrom: "2026-09-01",
      },
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
  })

  it("rejects a team-default write without an opaque replay key", async () => {
    const response = await callScheduleTeamDefaultAssignment(post("/api/v1/workforce/configuration/shifts/team-default", {
      teamId: "team-a",
      templateId: "team-a-shift",
      effectiveFrom: "2026-09-01",
    }), AUTH)
    expect(response.status).toBe(400)
    expect(publishWorkforceShiftTeamDefault).not.toHaveBeenCalled()
  })

  it("lists the named organization-default timeline through the session-admin boundary", async () => {
    vi.mocked(prisma.workforceShiftDefaultAssignment.findMany).mockResolvedValue([
      {
        id: "default-history",
        templateId: "shift-1",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: null,
        assignedByUserId: "admin-1",
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        template: {
          id: "shift-1",
          code: "BAKU",
          name: "Baku workday",
          timezone: "Asia/Baku",
          teamId: null,
          status: "ACTIVE",
          isDefault: true,
        },
      },
    ] as never)

    const response = await callListDefaultAssignments(get("/api/v1/workforce/configuration/shifts/default"), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        defaultAssignments: [expect.objectContaining({
          template: expect.objectContaining({ name: "Baku workday" }),
        })],
      },
    })
    expect(prisma.workforceShiftDefaultAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      select: expect.objectContaining({ template: expect.any(Object) }),
    }))
  })

  it("lists team defaults with named team and template context through the session boundary", async () => {
    vi.mocked(prisma.workforceShiftTeamDefaultAssignment.findMany).mockResolvedValue([{
      id: "team-default-history",
      teamId: "team-a",
      templateId: "team-a-shift",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      assignedByUserId: "admin-1",
      createdAt: new Date("2026-08-30T00:00:00.000Z"),
      team: { id: "team-a", name: "Field team A", code: "A", isActive: true },
      template: {
        id: "team-a-shift", code: "TEAM_A", name: "Team A workday", timezone: "Asia/Baku",
        teamId: "team-a", status: "ACTIVE", isDefault: false,
      },
    }] as never)

    const response = await callListTeamDefaultAssignments(get("/api/v1/workforce/configuration/shifts/team-default"), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { teamDefaultAssignments: [expect.objectContaining({ team: expect.objectContaining({ name: "Field team A" }) })] },
    })
    expect(prisma.workforceShiftTeamDefaultAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
      select: expect.objectContaining({ team: expect.any(Object), template: expect.any(Object) }),
    }))
  })
})
