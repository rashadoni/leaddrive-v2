import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAdminAuth: vi.fn((handler) => handler),
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
    scheduleWorkforceShiftDefault: vi.fn(),
  }
})

import { POST as createPolicy } from "@/app/api/v1/workforce/configuration/policies/route"
import { PATCH as updatePolicy } from "@/app/api/v1/workforce/configuration/policies/[id]/route"
import { POST as activatePolicy } from "@/app/api/v1/workforce/configuration/policies/[id]/activate/route"
import { POST as createShift } from "@/app/api/v1/workforce/configuration/shifts/route"
import { PATCH as updateShift } from "@/app/api/v1/workforce/configuration/shifts/[id]/route"
import { POST as activateShift } from "@/app/api/v1/workforce/configuration/shifts/[id]/activate/route"
import { POST as scheduleAssignment } from "@/app/api/v1/workforce/configuration/assignments/route"
import { POST as previewAssignments } from "@/app/api/v1/workforce/configuration/assignments/preview/route"
import { GET as listDefaultAssignments, POST as scheduleDefaultAssignment } from "@/app/api/v1/workforce/configuration/shifts/default/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  activateWorkforcePolicyDraft,
  activateWorkforceShiftTemplateDraft,
  createWorkforcePolicyDraft,
  createWorkforceShiftTemplateDraft,
  previewWorkforceShiftAssignments,
  scheduleWorkforceShiftAssignment,
  scheduleWorkforceShiftDefault,
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
const callPreviewAssignments = previewAssignments as unknown as (
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
  vi.mocked(scheduleWorkforceShiftDefault).mockReset()
  vi.mocked(getMtmSettings).mockReset()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
})

describe("Workforce draft configuration API", () => {
  it("binds every configuration route to the session-only Workforce admin boundary", () => {
    expect(withWorkforceSessionAdminAuth).toHaveBeenCalledTimes(13)
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
  it("schedules a default only through the session-admin boundary and a server-derived date", async () => {
    vi.mocked(scheduleWorkforceShiftDefault).mockResolvedValue({
      id: "default-1", templateId: "shift-1", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    } as never)

    const response = await callScheduleDefaultAssignment(post("/api/v1/workforce/configuration/shifts/default", {
      templateId: "shift-1",
      effectiveFrom: "2026-09-01",
    }), AUTH)

    expect(response.status).toBe(201)
    expect(getMtmSettings).toHaveBeenCalledWith(AUTH.orgId)
    expect(scheduleWorkforceShiftDefault).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      defaultAssignment: { templateId: "shift-1", effectiveFrom: "2026-09-01" },
      currentDateKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      audit: expect.objectContaining({ actorUserId: AUTH.userId }),
    }))
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
})
