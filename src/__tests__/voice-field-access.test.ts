import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { fieldPermission: { findFirst: mocks.findFirst } },
}))

import {
  canUseVoiceDataFields,
  voiceFieldEntitiesForTool,
} from "@/lib/ai/voice/field-access"
import { VOICE_TOOL_NAMES } from "@/lib/ai/voice/read-tools"

beforeEach(() => vi.clearAllMocks())

describe("voice field-permission boundary", () => {
  it("maps data tools to every configurable entity they can speak", () => {
    expect(voiceFieldEntitiesForTool("get_forecast_summary", {})).toEqual(["deal"])
    expect(voiceFieldEntitiesForTool("get_overdue", {})).toEqual(["task", "invoice", "deal"])
    expect(voiceFieldEntitiesForTool("get_workload_by_person", { focus: "all" }))
      .toEqual(["task", "lead", "deal", "ticket"])
    expect(voiceFieldEntitiesForTool("find_record", { type: "complaint" })).toEqual(["ticket"])
    expect(voiceFieldEntitiesForTool("get_lead_coverage", {})).toEqual(["lead"])
    expect(voiceFieldEntitiesForTool("describe_section", { section: "invoices" })).toEqual(["invoice"])
    expect(voiceFieldEntitiesForTool("describe_section", { section: "mtm_tasks" }))
      .toEqual(["mtm_task"])
  })

  it("keeps documentation tools outside the data-field gate", () => {
    expect(voiceFieldEntitiesForTool("explain_section", { section: "deals" })).toEqual([])
  })

  it("maps every declared voice tool to a field-entity list", () => {
    // A tool missing from the switch returns undefined, which the strict
    // checker turns into a TypeError and the route masks as a silent
    // ACCESS_SCOPE_UNAVAILABLE for every non-admin role — get_lead_coverage
    // and read_record each shipped that way once.
    for (const tool of VOICE_TOOL_NAMES) {
      expect(voiceFieldEntitiesForTool(tool, {}), tool).toBeInstanceOf(Array)
    }
  })

  it("denies a manager when any touched entity has a hidden field", async () => {
    mocks.findFirst.mockResolvedValue({ id: "hidden-rule" })
    await expect(canUseVoiceDataFields("org-1", "manager", ["deal", "invoice"]))
      .resolves.toBe(false)
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        roleId: "manager",
        entityType: { in: ["deal", "invoice"] },
        access: "hidden",
      },
      select: { id: true },
    })
  })

  it("does not query rules for admin or documentation-only calls", async () => {
    await expect(canUseVoiceDataFields("org-1", "admin", ["deal"])).resolves.toBe(true)
    await expect(canUseVoiceDataFields("org-1", "manager", [])).resolves.toBe(true)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it("fails closed for a spoken data family without a permission matrix", async () => {
    await expect(canUseVoiceDataFields("org-1", "manager", ["mtm_visit", "mtm_task"]))
      .resolves.toBe(false)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })
})
