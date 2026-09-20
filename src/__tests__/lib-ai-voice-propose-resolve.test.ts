import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findManyUsers: vi.fn(),
  findManyLeads: vi.fn(),
  applyRecordFilter: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.findManyUsers },
    lead: { findMany: mocks.findManyLeads },
  },
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: mocks.applyRecordFilter,
}))

import { resolveVoiceProposal } from "@/lib/ai/voice/propose-resolve"
import type { AuthResult } from "@/lib/api-auth"

const auth = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "me@example.com",
  name: "Me",
} as unknown as AuthResult

beforeEach(() => {
  mocks.findManyUsers.mockReset()
  mocks.findManyLeads.mockReset()
  mocks.applyRecordFilter.mockReset()
  mocks.applyRecordFilter.mockImplementation(async (_o, _u, _r, _t, where) => where)
})

describe("what the model is allowed to say", () => {
  it("rejects arguments that do not match the tool schema", async () => {
    const result = await resolveVoiceProposal(auth, "propose_create_task", { title: "" }, {})
    expect(result.kind).toBe("invalid")
  })

  it("rejects a field the tool does not declare", async () => {
    // Strict schemas: an unknown field is a sign the model invented something,
    // and silently dropping it would hide that from the receipt.
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", assignedTo: "user-9" },
      {},
    )
    expect(result.kind).toBe("invalid")
  })

  it("insists on an absolute due date rather than guessing at 'tomorrow'", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", dueDate: "tomorrow" },
      {},
    )
    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.issues[0].message).toMatch(/YYYY-MM-DD/)
  })

  it("passes plain fields straight through to the draft payload", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call Ali back", priority: "high", dueDate: "2026-09-25" },
      {},
    )
    expect(result).toEqual({
      kind: "resolved",
      actionType: "create_task",
      payload: { title: "Call Ali back", priority: "high", dueDate: "2026-09-25" },
    })
    expect(mocks.findManyUsers).not.toHaveBeenCalled()
  })
})

describe("resolving a colleague's name", () => {
  it("turns one match into an id read from the database", async () => {
    mocks.findManyUsers.mockResolvedValue([{ id: "user-7", name: "Aysel Memmedova", email: "a@x.az" }])

    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", assigneeName: "Aysel" },
      {},
    )

    expect(result).toMatchObject({ kind: "resolved", payload: { assignedTo: "user-7" } })
    // Tenant-scoped, active users only.
    expect(mocks.findManyUsers.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      isActive: true,
    })
  })

  it("asks instead of choosing when two colleagues match", async () => {
    mocks.findManyUsers.mockResolvedValue([
      { id: "user-7", name: "Aysel Memmedova", email: "a@x.az" },
      { id: "user-8", name: "Aysel Qasimova", email: "b@x.az" },
    ])

    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", assigneeName: "Aysel" },
      {},
    )

    expect(result).toEqual({
      kind: "clarify",
      code: "ASSIGNEE_AMBIGUOUS",
      field: "assigneeName",
      candidates: [
        { id: "user-7", label: "Aysel Memmedova" },
        { id: "user-8", label: "Aysel Qasimova" },
      ],
    })
  })

  it("takes an exact full-name match over its own near-misses", async () => {
    mocks.findManyUsers.mockResolvedValue([
      { id: "user-7", name: "Aysel", email: "a@x.az" },
      { id: "user-8", name: "Aysel Qasimova", email: "b@x.az" },
    ])

    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", assigneeName: "Aysel" },
      {},
    )
    expect(result).toMatchObject({ kind: "resolved", payload: { assignedTo: "user-7" } })
  })

  it("asks when nobody matches", async () => {
    mocks.findManyUsers.mockResolvedValue([])
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", assigneeName: "Nobody" },
      {},
    )
    expect(result).toMatchObject({ kind: "clarify", code: "ASSIGNEE_NOT_FOUND", candidates: [] })
  })
})

describe("which lead an update touches", () => {
  it("uses the lead the user has open when no name is spoken", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { phone: "+994501234567" },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(result).toEqual({
      kind: "resolved",
      actionType: "update_lead",
      payload: { phone: "+994501234567" },
      targetEntityId: "lead-5",
    })
    expect(mocks.findManyLeads).not.toHaveBeenCalled()
  })

  it("will not guess a lead when the user is not looking at one", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { phone: "+994501234567" },
      { recordType: "deal", recordId: "deal-1" },
    )
    expect(result).toMatchObject({ kind: "clarify", code: "LEAD_TARGET_REQUIRED" })
  })

  it("resolves a spoken lead name through the caller's record filter", async () => {
    mocks.findManyLeads.mockResolvedValue([
      { id: "lead-9", contactName: "Ali Mammadov", companyName: "Azmart" },
    ])

    const result = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { leadName: "Ali", interest: "Tyres" },
      {},
    )

    expect(result).toMatchObject({ kind: "resolved", targetEntityId: "lead-9" })
    expect(mocks.applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "manager",
      "lead",
      expect.objectContaining({ organizationId: "org-1" }),
    )
  })

  it("asks which lead when several match the spoken name", async () => {
    mocks.findManyLeads.mockResolvedValue([
      { id: "lead-9", contactName: "Ali Mammadov", companyName: "Azmart" },
      { id: "lead-10", contactName: "Ali Huseynov", companyName: null },
    ])

    const result = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { leadName: "Ali", interest: "Tyres" },
      {},
    )

    expect(result).toEqual({
      kind: "clarify",
      code: "LEAD_AMBIGUOUS",
      field: "leadName",
      candidates: [
        { id: "lead-9", label: "Ali Mammadov (Azmart)" },
        { id: "lead-10", label: "Ali Huseynov" },
      ],
    })
  })

  it("refuses an update that changes nothing", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { leadName: undefined },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(result.kind).toBe("invalid")
  })

  it("carries a status change through, but cannot convert a lead", async () => {
    const ok = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { status: "qualified" },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(ok).toMatchObject({ kind: "resolved", payload: { status: "qualified" } })

    const converted = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { status: "converted" },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(converted.kind).toBe("invalid")
  })
})

describe("attaching a task to what is on screen", () => {
  it("relates the task to the open record when asked", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", relateToCurrentRecord: true },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(result).toMatchObject({
      kind: "resolved",
      payload: { title: "Call back", relatedType: "lead", relatedId: "lead-5" },
    })
  })

  it("still prepares the task when the screen is not a record page", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", relateToCurrentRecord: true },
      {},
    )
    expect(result).toEqual({
      kind: "resolved",
      actionType: "create_task",
      payload: { title: "Call back" },
    })
  })

  it("never leaks the resolver's own instruction fields into the payload", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_task",
      { title: "Call back", relateToCurrentRecord: false },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(result).toMatchObject({ kind: "resolved", payload: { title: "Call back" } })
    if (result.kind !== "resolved") return
    for (const key of ["relateToCurrentRecord", "assigneeName", "leadName"]) {
      expect(Object.keys(result.payload)).not.toContain(key)
    }
  })
})

describe("turning a lead into a deal", () => {
  it("names the deal after the lead when the user did not name it", async () => {
    mocks.findManyLeads.mockResolvedValue([
      { id: "lead-5", contactName: "Ali Mammadov", companyName: "Azmart" },
    ])

    const result = await resolveVoiceProposal(
      auth,
      "propose_convert_lead_to_deal",
      {},
      { recordType: "lead", recordId: "lead-5" },
    )

    expect(result).toEqual({
      kind: "resolved",
      actionType: "convert_lead_to_deal",
      payload: { dealTitle: "Azmart" },
      targetEntityId: "lead-5",
    })
  })

  it("falls back to the contact when the lead has no company", async () => {
    mocks.findManyLeads.mockResolvedValue([
      { id: "lead-5", contactName: "Ali Mammadov", companyName: null },
    ])
    const result = await resolveVoiceProposal(
      auth,
      "propose_convert_lead_to_deal",
      {},
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(result).toMatchObject({ payload: { dealTitle: "Ali Mammadov" } })
  })

  it("keeps a title the user actually said, without reading the lead", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_convert_lead_to_deal",
      { dealTitle: "Azmart tyres Q4", dealValue: 12000 },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(result).toMatchObject({
      payload: { dealTitle: "Azmart tyres Q4", dealValue: 12000 },
      targetEntityId: "lead-5",
    })
    expect(mocks.findManyLeads).not.toHaveBeenCalled()
  })

  it("resolves a spoken lead name the same way an update does", async () => {
    mocks.findManyLeads.mockResolvedValue([
      { id: "lead-9", contactName: "Ali Mammadov", companyName: "Azmart" },
    ])
    const result = await resolveVoiceProposal(
      auth,
      "propose_convert_lead_to_deal",
      { leadName: "Ali", dealTitle: "Azmart" },
      {},
    )
    expect(result).toMatchObject({ targetEntityId: "lead-9" })
  })

  it("asks which lead when the user is not looking at one", async () => {
    const result = await resolveVoiceProposal(auth, "propose_convert_lead_to_deal", {}, {})
    expect(result).toMatchObject({ kind: "clarify", code: "LEAD_TARGET_REQUIRED" })
  })

  it("does not invent a title for a lead the caller cannot see", async () => {
    // The record filter returns nothing, so there is no lead to name it after.
    mocks.findManyLeads.mockResolvedValue([])
    const result = await resolveVoiceProposal(
      auth,
      "propose_convert_lead_to_deal",
      {},
      { recordType: "lead", recordId: "someone-elses-lead" },
    )
    expect(result).toMatchObject({ kind: "clarify", code: "LEAD_NOT_FOUND" })
  })

  it("refuses a stage or a pipeline from the model", async () => {
    for (const extra of [{ dealStage: "QUALIFIED" }, { pipelineId: "pipe-1" }]) {
      const result = await resolveVoiceProposal(
        auth,
        "propose_convert_lead_to_deal",
        { dealTitle: "Azmart", ...extra },
        { recordType: "lead", recordId: "lead-5" },
      )
      expect(result.kind, JSON.stringify(extra)).toBe("invalid")
    }
  })
})
