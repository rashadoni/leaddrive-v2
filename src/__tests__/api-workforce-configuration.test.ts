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
  }
})

import { POST as createPolicy } from "@/app/api/v1/workforce/configuration/policies/route"
import { PATCH as updatePolicy } from "@/app/api/v1/workforce/configuration/policies/[id]/route"
import { POST as activatePolicy } from "@/app/api/v1/workforce/configuration/policies/[id]/activate/route"
import { POST as createShift } from "@/app/api/v1/workforce/configuration/shifts/route"
import { PATCH as updateShift } from "@/app/api/v1/workforce/configuration/shifts/[id]/route"
import { POST as activateShift } from "@/app/api/v1/workforce/configuration/shifts/[id]/activate/route"
import { POST as scheduleAssignment } from "@/app/api/v1/workforce/configuration/assignments/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  activateWorkforcePolicyDraft,
  activateWorkforceShiftTemplateDraft,
  createWorkforcePolicyDraft,
  createWorkforceShiftTemplateDraft,
  scheduleWorkforceShiftAssignment,
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
  vi.mocked(getMtmSettings).mockReset()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
})

describe("Workforce draft configuration API", () => {
  it("binds every configuration route to the session-only Workforce admin boundary", () => {
    expect(withWorkforceSessionAdminAuth).toHaveBeenCalledTimes(10)
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
})
