import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  WorkforceConfigurationManagementError,
  WorkforcePolicyDraftCreateSchema,
  WorkforcePolicyDraftUpdateSchema,
  WorkforceShiftAssignmentScheduleSchema,
  WorkforceShiftTemplateDraftCreateSchema,
  WorkforceShiftTemplateDraftUpdateSchema,
  activateWorkforcePolicyDraft,
  activateWorkforceShiftTemplateDraft,
  createWorkforcePolicyDraft,
  createWorkforceShiftTemplateDraft,
  scheduleWorkforceShiftAssignment,
  updateWorkforcePolicyDraft,
  updateWorkforceShiftTemplateDraft,
} from "@/lib/workforce/configuration-management"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"

const organizationId = "org-workforce"
const userId = "admin-1"
const audit = {
  actorUserId: userId,
  ipAddress: "203.0.113.4",
  userAgent: "Vitest",
}
const policyDefinition = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 5 * 60,
  undertimeToleranceSeconds: 5 * 60,
  overtimeThresholdSeconds: 15 * 60,
  longPauseThresholdSeconds: 60 * 60,
  retentionHint: "one-year",
}
const shiftDefinition = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
}

beforeEach(() => vi.clearAllMocks())

describe("safe Workforce configuration drafts", () => {
  it("creates a canonical unpublished policy with the next scope version", async () => {
    vi.mocked(prisma.workforcePolicy.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforcePolicy.create).mockResolvedValue({
      id: "policy-1",
      teamId: null,
      version: 1,
      status: "DRAFT",
      name: "Standard workday",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    } as never)
    const draft = WorkforcePolicyDraftCreateSchema.parse({
      name: "Standard workday",
      effectiveFrom: "2026-09-01",
      definition: policyDefinition,
    })

    await expect(createWorkforcePolicyDraft({ organizationId, createdByUserId: userId, draft, audit }))
      .resolves.toMatchObject({ id: "policy-1", status: "DRAFT", version: 1 })

    expect(prisma.workforcePolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        teamId: null,
        version: 1,
        status: "DRAFT",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: null,
        definition: policyDefinition,
        definitionHash: workforcePolicyDefinitionHash(policyDefinition),
        provenance: "TENANT_ADMIN",
        systemProfileVersion: null,
        createdByUserId: userId,
      }),
    }))
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        action: "WORKFORCE_POLICY_DRAFT_CREATED",
        entity: "workforce_policy",
        entityId: "policy-1",
        metadataKind: "workforce_configuration",
        newData: expect.objectContaining({ actorUserId: userId, definitionHash: workforcePolicyDefinitionHash(policyDefinition) }),
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      }),
    }))
  })

  it("accepts only a real, non-reversed policy date range", () => {
    expect(() => WorkforcePolicyDraftCreateSchema.parse({
      name: "Invalid range",
      effectiveFrom: "2026-09-05",
      effectiveTo: "2026-09-01",
      definition: policyDefinition,
    })).toThrow(/effectiveTo/i)
    expect(() => WorkforcePolicyDraftCreateSchema.parse({
      name: "Invalid date",
      effectiveFrom: "2026-02-30",
      definition: policyDefinition,
    })).toThrow(/real calendar date/i)
  })

  it("updates only a DRAFT policy and derives a new immutable definition hash", async () => {
    const changedDefinition = { ...policyDefinition, overtimeThresholdSeconds: 30 * 60 }
    const existing = {
        id: "policy-1",
        teamId: null,
        version: 1,
        status: "DRAFT",
        name: "Standard workday",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: null,
        definitionHash: workforcePolicyDefinitionHash(policyDefinition),
      }
    vi.mocked(prisma.workforcePolicy.findFirst)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce({
        id: "policy-1",
        teamId: null,
        version: 1,
        status: "DRAFT",
        name: "Standard workday revised",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: null,
        definitionHash: workforcePolicyDefinitionHash(changedDefinition),
      } as never)
    vi.mocked(prisma.workforcePolicy.updateMany).mockResolvedValue({ count: 1 } as never)
    const draft = WorkforcePolicyDraftUpdateSchema.parse({ definition: changedDefinition })

    await expect(updateWorkforcePolicyDraft({ organizationId, policyId: "policy-1", draft, audit }))
      .resolves.toMatchObject({ id: "policy-1", status: "DRAFT" })

    expect(prisma.workforcePolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "policy-1", organizationId, status: "DRAFT" },
      data: expect.objectContaining({
        definitionHash: workforcePolicyDefinitionHash(changedDefinition),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_POLICY_DRAFT_UPDATED",
        oldData: expect.objectContaining({ definitionHash: workforcePolicyDefinitionHash(policyDefinition) }),
        newData: expect.objectContaining({ definitionHash: workforcePolicyDefinitionHash(changedDefinition) }),
      }),
    }))
  })

  it("will not revise a published policy", async () => {
    vi.mocked(prisma.workforcePolicy.findFirst).mockResolvedValue({
      id: "policy-1",
      status: "ACTIVE",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
    } as never)
    const draft = WorkforcePolicyDraftUpdateSchema.parse({ name: "Renamed policy" })

    await expect(updateWorkforcePolicyDraft({ organizationId, policyId: "policy-1", draft, audit }))
      .rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
        code: "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT",
      })
    expect(prisma.workforcePolicy.updateMany).not.toHaveBeenCalled()
  })

  it("activates a first future-effective policy and records the immutable transition", async () => {
    const draft = {
      id: "policy-1",
      teamId: null,
      version: 1,
      status: "DRAFT",
      name: "Standard workday",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }
    const activated = { ...draft, status: "ACTIVE" }
    vi.mocked(prisma.workforcePolicy.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(activated as never)
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.workforcePolicy.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(activateWorkforcePolicyDraft({
      organizationId,
      policyId: "policy-1",
      currentDateKey: "2026-08-29",
      now: new Date("2026-08-29T10:00:00.000Z"),
      audit,
    })).resolves.toMatchObject({ id: "policy-1", status: "ACTIVE" })

    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.workforcePolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "policy-1", organizationId, status: "DRAFT" },
      data: {
        status: "ACTIVE",
        activatedByUserId: userId,
        activatedAt: new Date("2026-08-29T10:00:00.000Z"),
      },
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_POLICY_SCHEDULED",
        oldData: expect.objectContaining({ status: "DRAFT", definitionHash: draft.definitionHash }),
        newData: expect.objectContaining({
          actorUserId: userId,
          status: "ACTIVE",
          definitionHash: draft.definitionHash,
          activatedAt: "2026-08-29T10:00:00.000Z",
        }),
      }),
    }))
  })

  it("rejects current-day policy activation", async () => {
    const currentDraft = {
      id: "policy-current",
      teamId: null,
      version: 1,
      status: "DRAFT",
      name: "Current day",
      effectiveFrom: new Date("2026-08-29T00:00:00.000Z"),
      effectiveTo: null,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }
    vi.mocked(prisma.workforcePolicy.findFirst).mockResolvedValue(currentDraft as never)

    await expect(activateWorkforcePolicyDraft({
      organizationId,
      policyId: "policy-current",
      currentDateKey: "2026-08-29",
      audit,
    })).rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
      code: "WORKFORCE_CONFIGURATION_POLICY_EFFECTIVE_DATE_NOT_FUTURE",
    })
    expect(prisma.workforcePolicy.updateMany).not.toHaveBeenCalled()

  })

  it("rechecks a draft under the scope lock before publishing it", async () => {
    const futureDraft = {
      id: "policy-race",
      teamId: null,
      version: 1,
      status: "DRAFT",
      name: "Future before lock",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }
    const changedAfterLock = {
      ...futureDraft,
      name: "Changed concurrently",
      effectiveFrom: new Date("2026-08-29T00:00:00.000Z"),
    }
    vi.mocked(prisma.workforcePolicy.findFirst)
      .mockResolvedValueOnce(futureDraft as never)
      .mockResolvedValueOnce(changedAfterLock as never)

    await expect(activateWorkforcePolicyDraft({
      organizationId,
      policyId: "policy-race",
      currentDateKey: "2026-08-29",
      audit,
    })).rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
      code: "WORKFORCE_CONFIGURATION_POLICY_EFFECTIVE_DATE_NOT_FUTURE",
    })
    expect(prisma.workforcePolicy.findMany).not.toHaveBeenCalled()
    expect(prisma.workforcePolicy.updateMany).not.toHaveBeenCalled()
  })

  it("schedules a replacement for a future date and closes only the predecessor window", async () => {
    const futureDraft = {
      id: "policy-future",
      teamId: null,
      version: 2,
      status: "DRAFT",
      name: "Revised policy",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }
    const predecessor = {
      id: "policy-current",
      teamId: null,
      version: 1,
      status: "ACTIVE",
      name: "Current policy",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      definitionHash: workforcePolicyDefinitionHash(policyDefinition),
    }
    const activated = { ...futureDraft, status: "ACTIVE" }
    vi.mocked(prisma.workforcePolicy.findFirst)
      .mockResolvedValueOnce(futureDraft as never)
      .mockResolvedValueOnce(futureDraft as never)
      .mockResolvedValueOnce(activated as never)
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([predecessor] as never)
    vi.mocked(prisma.workforcePolicy.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(activateWorkforcePolicyDraft({
      organizationId,
      policyId: "policy-future",
      currentDateKey: "2026-08-29",
      audit,
    })).resolves.toMatchObject({ id: "policy-future", status: "ACTIVE" })
    expect(prisma.workforcePolicy.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: "policy-current", status: "ACTIVE" }),
      data: { effectiveTo: new Date("2026-08-31T00:00:00.000Z") },
    }))
    expect(prisma.workforcePolicy.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "policy-future", organizationId, status: "DRAFT" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "WORKFORCE_POLICY_EFFECTIVE_WINDOW_CLOSED", entityId: "policy-current" }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "WORKFORCE_POLICY_SCHEDULED", entityId: "policy-future" }),
    }))
  })

  it("creates a non-default draft shift and derives the storage timezone from its definition", async () => {
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue({ version: 3 } as never)
    vi.mocked(prisma.workforceShiftTemplate.create).mockResolvedValue({
      id: "shift-4",
      teamId: "team-1",
      code: "STANDARD",
      status: "DRAFT",
      version: 4,
      isDefault: false,
      name: "Standard shift",
      timezone: "Asia/Baku",
      definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    } as never)
    const draft = WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "STANDARD",
      name: "Standard shift",
      teamId: "team-1",
      definition: shiftDefinition,
    })

    await expect(createWorkforceShiftTemplateDraft({ organizationId, createdByUserId: userId, draft, audit }))
      .resolves.toMatchObject({ id: "shift-4", status: "DRAFT", version: 4, isDefault: false })

    expect(prisma.workforceShiftTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        teamId: "team-1",
        code: "STANDARD",
        isDefault: false,
        version: 4,
        status: "DRAFT",
        timezone: "Asia/Baku",
        definitionHash: workforceShiftDefinitionHash(shiftDefinition),
        provenance: "TENANT_ADMIN",
        systemProfileVersion: null,
        createdByUserId: userId,
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_SHIFT_TEMPLATE_DRAFT_CREATED",
        entity: "workforce_shift_template",
        entityId: "shift-4",
        newData: expect.objectContaining({ actorUserId: userId, isDefault: false }),
      }),
    }))
  })

  it("creates one reproducible multi-site day as ordered draft segments", async () => {
    const segmentedDefinition = {
      ...shiftDefinition,
      plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
    }
    const segments = [
      { mode: "SITE" as const, siteId: "site-a", startTime: "09:00", endTime: "13:00", lateGraceSeconds: 15 * 60, proofPolicyReference: "office-v1" },
      { mode: "SITE" as const, siteId: "site-b", startTime: "14:00", endTime: "18:00", lateGraceSeconds: 15 * 60, proofPolicyReference: "office-v1" },
    ]
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([{ id: "site-a" }, { id: "site-b" }] as never)
    vi.mocked(prisma.workforceShiftTemplate.create).mockResolvedValue({
      id: "shift-segmented",
      teamId: null,
      code: "MULTI_SITE",
      status: "DRAFT",
      version: 1,
      isDefault: false,
      name: "Multi-site day",
      timezone: "Asia/Baku",
      definitionHash: workforceShiftDefinitionHash(segmentedDefinition),
      segments: segments.map((segment, index) => ({ id: `segment-${index + 1}`, sequence: index + 1, ...segment })),
    } as never)
    const draft = WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "MULTI_SITE",
      name: "Multi-site day",
      definition: segmentedDefinition,
      segments,
    })

    await expect(createWorkforceShiftTemplateDraft({ organizationId, createdByUserId: userId, draft, audit }))
      .resolves.toMatchObject({ id: "shift-segmented", segments: [{ sequence: 1 }, { sequence: 2 }] })

    expect(prisma.workforceSite.findMany).toHaveBeenCalledWith({
      where: { organizationId, id: { in: ["site-a", "site-b"] }, status: "ACTIVE" },
      select: { id: true },
    })
    expect(prisma.workforceShiftTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        segments: {
          create: [
            expect.objectContaining({ organizationId, sequence: 1, mode: "SITE", siteId: "site-a", lateGraceSeconds: 15 * 60 }),
            expect.objectContaining({ organizationId, sequence: 2, mode: "SITE", siteId: "site-b", lateGraceSeconds: 15 * 60 }),
          ],
        },
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newData: expect.objectContaining({ segmentCount: 2, segmentDefinitionHash: expect.any(String) }),
      }),
    }))
  })

  it("rejects a multi-site draft with unsafe segment ownership, overlap or an active-site mismatch", async () => {
    expect(WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "TRAVEL_ONLY_CONTRACT",
      name: "Travel without a Route customer",
      definition: shiftDefinition,
      segments: [
        { mode: "SITE", siteId: "site-a", startTime: "09:00", endTime: "12:00" },
        { mode: "TRAVEL", startTime: "12:00", endTime: "13:00", proofPolicyReference: "travel-review-v1" },
        { mode: "SITE", siteId: "site-b", startTime: "13:00", endTime: "18:00" },
      ],
    }).segments?.[1]).toMatchObject({ mode: "TRAVEL", siteId: undefined, lateGraceSeconds: 0 })
    expect(() => WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "INVALID_SITE",
      name: "Invalid site mode",
      definition: shiftDefinition,
      segments: [{ mode: "REMOTE", siteId: "site-a", startTime: "09:00", endTime: "18:00" }],
    })).toThrow(/only a SITE segment/i)
    expect(() => WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "OVERLAP",
      name: "Overlapping segments",
      definition: shiftDefinition,
      segments: [
        { mode: "REMOTE", startTime: "09:00", endTime: "14:00" },
        { mode: "FIELD", startTime: "13:00", endTime: "18:00" },
      ],
    })).toThrow(/non-overlapping/i)

    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([] as never)
    const draft = WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "MISSING_SITE",
      name: "Missing active site",
      definition: shiftDefinition,
      segments: [{ mode: "SITE", siteId: "missing-site", startTime: "09:00", endTime: "18:00" }],
    })
    await expect(createWorkforceShiftTemplateDraft({ organizationId, createdByUserId: userId, draft, audit }))
      .rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
        code: "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_SITE_INVALID",
      })
    expect(prisma.workforceShiftTemplate.create).not.toHaveBeenCalled()
  })

  it("replaces the complete segment timeline only while the template remains a draft", async () => {
    const beforeLock = {
      id: "shift-1", teamId: null, code: "STANDARD", isDefault: false, version: 1,
      status: "DRAFT", name: "Standard shift", timezone: "Asia/Baku", definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    }
    const existing = {
      ...beforeLock,
      definition: shiftDefinition,
      segments: [{
        id: "segment-old", sequence: 1, mode: "REMOTE", siteId: null,
        startTime: "09:00", endTime: "18:00", lateGraceSeconds: 0, proofPolicyReference: null,
      }],
    }
    const replacementSegments = [
      { mode: "SITE" as const, siteId: "site-a", startTime: "09:00", endTime: "13:00", lateGraceSeconds: 15 * 60 },
      { mode: "SITE" as const, siteId: "site-b", startTime: "13:00", endTime: "18:00", lateGraceSeconds: 15 * 60 },
    ]
    const result = {
      ...existing,
      segments: replacementSegments.map((segment, index) => ({
        id: `segment-${index + 1}`, sequence: index + 1, proofPolicyReference: null, ...segment,
      })),
    }
    vi.mocked(prisma.workforceShiftTemplate.findFirst)
      .mockResolvedValueOnce(beforeLock as never)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce(result as never)
    vi.mocked(prisma.workforceSite.findMany).mockResolvedValue([{ id: "site-a" }, { id: "site-b" }] as never)
    vi.mocked(prisma.workforceShiftTemplate.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.workforceShiftSegment.deleteMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.workforceShiftSegment.createMany).mockResolvedValue({ count: 2 } as never)
    const draft = WorkforceShiftTemplateDraftUpdateSchema.parse({ segments: replacementSegments })

    await expect(updateWorkforceShiftTemplateDraft({ organizationId, templateId: "shift-1", draft, audit }))
      .resolves.toMatchObject({ id: "shift-1", segments: [{ sequence: 1 }, { sequence: 2 }] })

    expect(prisma.workforceShiftSegment.deleteMany).toHaveBeenCalledWith({
      where: { organizationId, templateId: "shift-1" },
    })
    expect(prisma.workforceShiftSegment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ organizationId, templateId: "shift-1", sequence: 1, siteId: "site-a" }),
        expect.objectContaining({ organizationId, templateId: "shift-1", sequence: 2, siteId: "site-b" }),
      ],
    })
  })

  it("will not revise a published shift or allow a scope/code change through patch input", async () => {
    expect(() => WorkforceShiftTemplateDraftUpdateSchema.parse({ code: "CHANGED" })).toThrow()
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue({
      id: "shift-1",
      status: "RETIRED",
    } as never)
    const draft = WorkforceShiftTemplateDraftUpdateSchema.parse({ name: "Renamed shift" })

    await expect(updateWorkforceShiftTemplateDraft({ organizationId, templateId: "shift-1", draft, audit }))
      .rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
        code: "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT",
      })
    expect(prisma.workforceShiftTemplate.updateMany).not.toHaveBeenCalled()
  })

  it("activates a first shift template without making it a default or assigning an employee", async () => {
    const draft = {
      id: "shift-1",
      teamId: "team-1",
      code: "STANDARD",
      isDefault: false,
      version: 1,
      status: "DRAFT",
      name: "Standard shift",
      timezone: "Asia/Baku",
      definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    }
    const activated = { ...draft, status: "ACTIVE" }
    vi.mocked(prisma.workforceShiftTemplate.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(activated as never)
    vi.mocked(prisma.workforceShiftTemplate.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(activateWorkforceShiftTemplateDraft({
      organizationId,
      templateId: "shift-1",
      now: new Date("2026-08-29T10:00:00.000Z"),
      audit,
    })).resolves.toMatchObject({ id: "shift-1", status: "ACTIVE", isDefault: false })

    expect(prisma.workforceShiftTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "shift-1", organizationId, status: "DRAFT" },
      data: expect.objectContaining({
        status: "ACTIVE",
        isDefault: false,
        activatedByUserId: userId,
      }),
    }))
    expect(prisma.workforceShiftAssignment.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_SHIFT_TEMPLATE_ACTIVATED",
        newData: expect.objectContaining({ status: "ACTIVE", isDefault: false }),
      }),
    }))
  })

  it("will not replace an active shift template with the same reusable code", async () => {
    vi.mocked(prisma.workforceShiftTemplate.findFirst)
      .mockResolvedValueOnce({
        id: "shift-1",
        teamId: null,
        code: "STANDARD",
        isDefault: false,
        version: 2,
        status: "DRAFT",
        name: "Replacement",
        timezone: "Asia/Baku",
        definitionHash: workforceShiftDefinitionHash(shiftDefinition),
      } as never)
      .mockResolvedValueOnce({
        id: "shift-1",
        teamId: null,
        code: "STANDARD",
        isDefault: false,
        version: 2,
        status: "DRAFT",
        name: "Replacement",
        timezone: "Asia/Baku",
        definitionHash: workforceShiftDefinitionHash(shiftDefinition),
      } as never)
      .mockResolvedValueOnce({ id: "existing-active" } as never)

    await expect(activateWorkforceShiftTemplateDraft({
      organizationId,
      templateId: "shift-1",
      audit,
    })).rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
      code: "WORKFORCE_CONFIGURATION_SHIFT_ACTIVE_EXISTS",
    })
    expect(prisma.workforceShiftTemplate.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("schedules a future individual assignment and only closes its future predecessor window", async () => {
    const predecessor = {
      id: "assignment-current",
      agentId: "agent-1",
      templateId: "shift-current",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      assignedByUserId: userId,
    }
    const created = {
      id: "assignment-next",
      agentId: "agent-1",
      templateId: "shift-next",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: null,
      assignedByUserId: userId,
    }
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)
    vi.mocked(prisma.workforceShiftTemplate.findFirst).mockResolvedValue({
      id: "shift-next",
      teamId: "team-1",
      code: "STANDARD_V2",
      isDefault: false,
      version: 1,
      status: "ACTIVE",
      name: "Next shift",
      timezone: "Asia/Baku",
      definitionHash: workforceShiftDefinitionHash(shiftDefinition),
    } as never)
    vi.mocked(prisma.workforceShiftAssignment.findMany).mockResolvedValue([predecessor] as never)
    vi.mocked(prisma.workforceShiftAssignment.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.workforceShiftAssignment.create).mockResolvedValue(created as never)
    const assignment = WorkforceShiftAssignmentScheduleSchema.parse({
      agentId: "agent-1",
      templateId: "shift-next",
      effectiveFrom: "2026-09-01",
    })

    await expect(scheduleWorkforceShiftAssignment({
      organizationId,
      assignment,
      currentDateKey: "2026-08-29",
      audit,
    })).resolves.toMatchObject({ id: "assignment-next" })
    expect(prisma.workforceShiftAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "assignment-current", organizationId },
      data: { effectiveTo: new Date("2026-08-31T00:00:00.000Z") },
    }))
    expect(prisma.workforceShiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentId: "agent-1",
        templateId: "shift-next",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: null,
        assignedByUserId: userId,
      }),
    }))
  })

  it("rejects an assignment for today before it can change any schedule", async () => {
    const assignment = WorkforceShiftAssignmentScheduleSchema.parse({
      agentId: "agent-1",
      templateId: "shift-next",
      effectiveFrom: "2026-08-29",
    })

    await expect(scheduleWorkforceShiftAssignment({
      organizationId,
      assignment,
      currentDateKey: "2026-08-29",
      audit,
    })).rejects.toMatchObject<Partial<WorkforceConfigurationManagementError>>({
      code: "WORKFORCE_CONFIGURATION_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE",
    })
    expect(prisma.workforceShiftAssignment.create).not.toHaveBeenCalled()
  })
})
