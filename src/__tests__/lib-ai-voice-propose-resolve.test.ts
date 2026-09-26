import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findManyUsers: vi.fn(),
  findManyLeads: vi.fn(),
  findManyCompanies: vi.fn(),
  findManyContacts: vi.fn(),
  findManyTasks: vi.fn(),
  findManyDeals: vi.fn(),
  findFirstPipeline: vi.fn(),
  findFirstStage: vi.fn(),
  applyRecordFilter: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.findManyUsers },
    lead: { findMany: mocks.findManyLeads },
    company: { findMany: mocks.findManyCompanies },
    contact: { findMany: mocks.findManyContacts },
    task: { findMany: mocks.findManyTasks },
    deal: { findMany: mocks.findManyDeals },
    pipeline: { findFirst: mocks.findFirstPipeline },
    pipelineStage: { findFirst: mocks.findFirstStage },
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
  mocks.findManyCompanies.mockReset()
  mocks.findManyContacts.mockReset()
  mocks.findFirstPipeline.mockReset()
  mocks.findFirstStage.mockReset()
  mocks.findManyCompanies.mockResolvedValue([])
  mocks.findManyContacts.mockResolvedValue([])
  mocks.findManyTasks.mockReset()
  mocks.findManyDeals.mockReset()
  mocks.findManyTasks.mockResolvedValue([{ id: "task-1", title: "Call Ali", divisionId: null }])
  mocks.findManyDeals.mockResolvedValue([{ id: "deal-1", name: "Azmart" }])
  mocks.findFirstPipeline.mockResolvedValue(null)
  mocks.findFirstStage.mockResolvedValue(null)
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

describe("creating a deal that does not come from a lead", () => {
  it("resolves company and contact names into ids the server read", async () => {
    mocks.findManyCompanies.mockResolvedValue([{ id: "co-1", name: "Azmart MMC" }])
    mocks.findManyContacts.mockResolvedValue([{ id: "ct-1", fullName: "Ali Mammadov" }])

    const result = await resolveVoiceProposal(
      auth,
      "propose_create_deal",
      { name: "Azmart tyres Q4", companyName: "Azmart", contactName: "Ali", valueAmount: 12000 },
      {},
    )

    expect(result).toMatchObject({
      kind: "resolved",
      actionType: "create_deal",
      payload: { name: "Azmart tyres Q4", companyId: "co-1", contactId: "ct-1", valueAmount: 12000 },
    })
    if (result.kind !== "resolved") return
    // The spoken names are not CRM fields and must not reach the payload.
    expect(Object.keys(result.payload)).not.toContain("companyName")
    expect(Object.keys(result.payload)).not.toContain("contactName")
  })

  it("asks which company instead of taking the first match", async () => {
    mocks.findManyCompanies.mockResolvedValue([
      { id: "co-1", name: "Azmart MMC" },
      { id: "co-2", name: "Azmart Logistics" },
    ])
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_deal",
      { name: "Q4", companyName: "Azmart" },
      {},
    )
    expect(result).toMatchObject({
      kind: "clarify",
      code: "COMPANY_AMBIGUOUS",
      field: "companyName",
      candidates: [
        { id: "co-1", label: "Azmart MMC" },
        { id: "co-2", label: "Azmart Logistics" },
      ],
    })
  })

  it("says when no such company exists rather than creating a nameless deal", async () => {
    mocks.findManyCompanies.mockResolvedValue([])
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_deal",
      { name: "Q4", companyName: "Nowhere" },
      {},
    )
    expect(result).toMatchObject({ kind: "clarify", code: "COMPANY_NOT_FOUND", candidates: [] })
  })

  it("asks which contact when several share a name", async () => {
    mocks.findManyContacts.mockResolvedValue([
      { id: "ct-1", fullName: "Ali Mammadov" },
      { id: "ct-2", fullName: "Ali Huseynov" },
    ])
    const result = await resolveVoiceProposal(
      auth,
      "propose_create_deal",
      { name: "Q4", contactName: "Ali" },
      {},
    )
    expect(result).toMatchObject({ kind: "clarify", code: "CONTACT_AMBIGUOUS", field: "contactName" })
  })

  // createDealCommand falls back to the literal stage name "LEAD" and then
  // validates it against the pipeline's own stage names, so an organization
  // whose first stage is called something else could not create a deal at all.
  it("passes the organization's own first stage, never a hardcoded name", async () => {
    mocks.findFirstPipeline.mockResolvedValue({ id: "pipe-1" })
    mocks.findFirstStage.mockResolvedValue({ name: "Yeni" })

    const result = await resolveVoiceProposal(auth, "propose_create_deal", { name: "Q4" }, {})

    expect(result).toMatchObject({ payload: { name: "Q4", stage: "Yeni" } })
    expect(mocks.findFirstPipeline.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      isDefault: true,
      isActive: true,
    })
    expect(mocks.findFirstStage.mock.calls[0][0].orderBy).toEqual({ sortOrder: "asc" })
  })

  it("sends no stage when the organization has no default pipeline", async () => {
    mocks.findFirstPipeline.mockResolvedValue(null)
    const result = await resolveVoiceProposal(auth, "propose_create_deal", { name: "Q4" }, {})
    expect(result).toEqual({ kind: "resolved", actionType: "create_deal", payload: { name: "Q4" } })
  })

  it("refuses a stage, pipeline or probability from the model", async () => {
    for (const extra of [{ stage: "LEAD" }, { pipelineId: "pipe-1" }, { probability: 50 }]) {
      const result = await resolveVoiceProposal(
        auth,
        "propose_create_deal",
        { name: "Q4", ...extra },
        {},
      )
      expect(result.kind, JSON.stringify(extra)).toBe("invalid")
    }
  })

  it("refuses a company or contact id from the model", async () => {
    for (const extra of [{ companyId: "co-1" }, { contactId: "ct-1" }, { assignedTo: "user-1" }]) {
      const result = await resolveVoiceProposal(
        auth,
        "propose_create_deal",
        { name: "Q4", ...extra },
        {},
      )
      expect(result.kind, JSON.stringify(extra)).toBe("invalid")
    }
  })
})

/**
 * Tasks and deals by voice (owner request, 2026-09-21). Same rules as leads:
 * the record is the one on screen or one the user names, never an id from the
 * model; a spoken status is a meaning mapped onto the task's own vocabulary.
 */
describe("changing a task or a deal", () => {
  const onTask = { recordType: "task", recordId: "task-1" }
  const onDeal = { recordType: "deal", recordId: "deal-1" }

  it("changes the task on screen when no title is given", async () => {
    const result = await resolveVoiceProposal(auth, "propose_update_task", { dueDate: "2026-09-26" }, onTask)
    expect(result).toEqual({
      kind: "resolved",
      actionType: "update_task",
      payload: { dueDate: "2026-09-26" },
      targetEntityId: "task-1",
    })
  })

  it("asks which task when none is open and none is named", async () => {
    const result = await resolveVoiceProposal(auth, "propose_update_task", { dueDate: "2026-09-26" }, {})
    expect(result).toMatchObject({ kind: "clarify", code: "TASK_TARGET_REQUIRED" })
  })

  it("asks which task when the title matches several", async () => {
    mocks.findManyTasks.mockResolvedValue([
      { id: "task-1", title: "Call Ali" },
      { id: "task-2", title: "Call Ali again" },
    ])
    const result = await resolveVoiceProposal(auth, "propose_update_task", { taskTitle: "Ali", status: "done" }, {})
    expect(result).toMatchObject({ kind: "clarify", code: "TASK_AMBIGUOUS", field: "taskTitle" })
  })

  // "Закрой задачу": a list task is completed, a board task is done. The
  // wrong word would leave a board task in no column.
  it("maps done onto the task's own vocabulary", async () => {
    const list = await resolveVoiceProposal(auth, "propose_update_task", { status: "done" }, onTask)
    expect(list).toMatchObject({ payload: { status: "completed" } })

    mocks.findManyTasks.mockResolvedValue([{ id: "task-1", divisionId: "board-1" }])
    const board = await resolveVoiceProposal(auth, "propose_update_task", { status: "done" }, onTask)
    expect(board).toMatchObject({ payload: { status: "done" } })

    const reopened = await resolveVoiceProposal(auth, "propose_update_task", { status: "open" }, onTask)
    expect(reopened).toMatchObject({ payload: { status: "todo" } })
  })

  it("does not invent a cancelled column a board does not have", async () => {
    mocks.findManyTasks.mockResolvedValue([{ id: "task-1", divisionId: "board-1" }])
    const result = await resolveVoiceProposal(auth, "propose_update_task", { status: "cancelled" }, onTask)
    expect(result.kind).toBe("invalid")
  })

  it("refuses a change that changes nothing", async () => {
    expect((await resolveVoiceProposal(auth, "propose_update_task", {}, onTask)).kind).toBe("invalid")
    expect((await resolveVoiceProposal(auth, "propose_update_deal", {}, onDeal)).kind).toBe("invalid")
  })

  it("changes the deal on screen, resolving company and contact by name", async () => {
    mocks.findManyCompanies.mockResolvedValue([{ id: "company-1", name: "Azmart MMC" }])
    const result = await resolveVoiceProposal(
      auth,
      "propose_update_deal",
      { valueAmount: 2000, companyName: "Azmart" },
      onDeal,
    )
    expect(result).toEqual({
      kind: "resolved",
      actionType: "update_deal",
      payload: { valueAmount: 2000, companyId: "company-1" },
      targetEntityId: "deal-1",
    })
    // An update is not a creation: it never gets the entry stage.
    expect(mocks.findFirstPipeline).not.toHaveBeenCalled()
  })

  it("finds a named deal among the deals the user may see", async () => {
    const result = await resolveVoiceProposal(auth, "propose_update_deal", { dealName: "Azmart", notes: "call" }, {})
    expect(result).toMatchObject({ targetEntityId: "deal-1" })
    expect(mocks.applyRecordFilter).toHaveBeenCalledWith("org-1", "user-1", "manager", "deal", expect.anything())
  })

  it("does not target a deal from a lead's screen", async () => {
    const result = await resolveVoiceProposal(
      auth,
      "propose_update_deal",
      { notes: "call" },
      { recordType: "lead", recordId: "lead-1" },
    )
    expect(result).toMatchObject({ kind: "clarify", code: "DEAL_TARGET_REQUIRED" })
  })
})
