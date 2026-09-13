import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import {
  activateWorkforceShiftTemplateDraft,
  WORKFORCE_SHIFT_RELEASED_SEGMENT_MODES,
} from "@/lib/workforce/configuration-management"
import { prisma } from "@/lib/prisma"

describe("Workforce release-one shift workflow scope", () => {
  it("keeps normal and multi-site segment modes released but excludes on-call activation", () => {
    expect(WORKFORCE_SHIFT_RELEASED_SEGMENT_MODES).toEqual([
      "SITE", "REMOTE", "FIELD", "TRAVEL", "EXCEPTION",
    ])
    expect(WORKFORCE_SHIFT_RELEASED_SEGMENT_MODES).not.toContain("ON_CALL")
  })

  it("rejects a pre-existing on-call draft under the activation lock before any write", async () => {
    const draft = {
      id: "shift-on-call",
      teamId: null,
      code: "ON_CALL_RELEASE_ONE",
      isDefault: false,
      version: 1,
      status: "DRAFT",
      name: "Unreleased on-call draft",
      timezone: "Asia/Baku",
      definition: { startTime: "09:00", endTime: "18:00", expectedWorkSeconds: 28_800, plannedBreaks: [] },
      definitionHash: "a".repeat(64),
      createdAt: new Date("2026-09-12T00:00:00.000Z"),
      updatedAt: new Date("2026-09-12T00:00:00.000Z"),
      segments: [{
        id: "segment-on-call",
        sequence: 1,
        mode: "ON_CALL",
        siteId: null,
        startTime: "09:00",
        endTime: "18:00",
        lateGraceSeconds: 0,
        proofPolicyReference: null,
        createdAt: new Date("2026-09-12T00:00:00.000Z"),
      }],
    }
    vi.mocked(prisma.workforceShiftTemplate.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(draft as never)

    await expect(activateWorkforceShiftTemplateDraft({
      organizationId: "org-1",
      templateId: draft.id,
      now: new Date("2026-09-13T00:00:00.000Z"),
      audit: { actorUserId: "admin-1" },
    })).rejects.toMatchObject({
      code: "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_INVALID",
      message: "This shift contains a segment mode that is not released for activation",
    })
    expect(prisma.workforceShiftTemplate.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
