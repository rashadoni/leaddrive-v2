import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthResult } from "@/lib/api-auth"

const deps = vi.hoisted(() => ({
  intentFindFirst: vi.fn(),
  intentUpdateMany: vi.fn(async () => ({ count: 0 })),
  intentCreate: vi.fn(),
  eventCreate: vi.fn(async () => ({ id: "draft-event-1" })),
  sessionFindFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => ({ id: "voice-1" })),
  leadFindFirst: vi.fn(),
  leadFindMany: vi.fn(async () => []),
  dealFindMany: vi.fn(async () => []),
  taskFindFirst: vi.fn(),
  dealFindFirst: vi.fn(),
  userFindMany: vi.fn(async () => [] as Array<{ id: string; name: string | null; email: string }>),
  companyFindMany: vi.fn(async () => [] as Array<{ id: string; name: string }>),
  contactFindMany: vi.fn(async () => [] as Array<{ id: string; fullName: string }>),
  fieldPermissionFindMany: vi.fn<
    () => Promise<Array<{ fieldName: string; access: string }>>
  >(async () => []),
  applyRecordFilter: vi.fn(async (_orgId, _userId, _role, _entityType, where) => where),
  logAudit: vi.fn(async () => {}),
  org: {
    plan: "enterprise",
    addons: [] as string[],
    modules: { ai: true, crm: true, sales: true } as Record<string, boolean>,
  },
}))

vi.mock("@/lib/prisma", () => {
  const transactionClient = {
    aiActionIntent: {
      findFirst: deps.intentFindFirst,
      updateMany: deps.intentUpdateMany,
      create: deps.intentCreate,
    },
    aiActionIntentEvent: { create: deps.eventCreate },
  }
  return {
    prisma: {
      ...transactionClient,
      $transaction: async (
        callback: (tx: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
      voiceSession: { findFirst: deps.sessionFindFirst },
      lead: { findFirst: deps.leadFindFirst, findMany: deps.leadFindMany },
      deal: { findMany: deps.dealFindMany, findFirst: deps.dealFindFirst },
      task: { findFirst: deps.taskFindFirst },
      user: { findMany: deps.userFindMany },
      company: { findMany: deps.companyFindMany },
      contact: { findMany: deps.contactFindMany },
      fieldPermission: { findMany: deps.fieldPermissionFindMany },
    },
    logAudit: deps.logAudit,
  }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(async () => deps.org),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: deps.applyRecordFilter,
}))

import {
  AiVoiceActionDraftError,
  createAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"

const auth: AuthResult = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "manager@example.com",
  name: "Manager",
  principalType: "session",
}

function storedIntent(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-09-19T12:00:00.000Z")
  return {
    id: "intent-1",
    organizationId: "org-1",
    userId: "user-1",
    voiceSessionId: "voice-1",
    actionType: "create_task",
    rawPayload: { title: "Call Ali" },
    normalizedPayload: { title: "Call Ali" },
    state: "awaiting_confirmation",
    revision: 1,
    payloadHash: "a".repeat(64),
    preview: { contract: 1 },
    warnings: [],
    targetEntityType: null,
    targetEntityId: null,
    expiresAt: new Date(now.getTime() + 600_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.intentFindFirst.mockResolvedValue(null)
  deps.intentUpdateMany.mockResolvedValue({ count: 0 })
  deps.sessionFindFirst.mockResolvedValue({ id: "voice-1" })
  deps.leadFindMany.mockResolvedValue([])
  deps.dealFindMany.mockResolvedValue([])
  deps.fieldPermissionFindMany.mockResolvedValue([])
  Object.assign(deps.org.modules, { ai: true, crm: true, sales: true })
  deps.intentCreate.mockImplementation(async ({ data }) => storedIntent({
    ...data,
    id: "intent-created",
    createdAt: new Date("2026-09-19T12:00:00.000Z"),
    updatedAt: new Date("2026-09-19T12:00:00.000Z"),
  }))
})

describe("AI voice action draft service", () => {
  it("creates only an unconfirmed receipt bound to server auth and an active voice session", async () => {
    const result = await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_task",
      payload: { title: "Call Ali", priority: "high" },
      idempotencyKey: "draft:task:0001",
    })

    expect(result).toMatchObject({
      id: "intent-created",
      actionType: "create_task",
      state: "awaiting_confirmation",
      replayed: false,
    })
    expect(deps.sessionFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "voice-1",
        organizationId: "org-1",
        userId: "user-1",
        status: "active",
      }),
      select: { id: true },
    })
    expect(deps.intentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        voiceSessionId: "voice-1",
        actionType: "create_task",
        state: "awaiting_confirmation",
      }),
    })
    expect(deps.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        intentId: "intent-created",
        userId: "user-1",
        eventType: "drafted",
        intentRevision: 1,
        eventData: {
          actionType: "create_task",
          voiceSessionId: "voice-1",
        },
      }),
    })
    const createData = deps.intentCreate.mock.calls[0]?.[0]?.data
    expect(createData).not.toHaveProperty("confirmedAt")
    expect(createData).not.toHaveProperty("executionStartedAt")
    expect(createData.preview).toMatchObject({
      contract: 1,
      actionType: "create_task",
      titleKey: "ai.voice.actions.create_task.title",
    })
  })

  it("replays the same idempotent request without creating a second intent", async () => {
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent({
      expiresAt: new Date(Date.now() + 60_000),
    }))

    const result = await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_task",
      payload: { title: "Call Ali" },
      idempotencyKey: "draft:task:0001",
    })

    expect(result.replayed).toBe(true)
    expect(deps.sessionFindFirst).not.toHaveBeenCalled()
    expect(deps.intentCreate).not.toHaveBeenCalled()
  })

  it("rejects reuse of an idempotency key with a changed payload", async () => {
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent({
      expiresAt: new Date(Date.now() + 60_000),
    }))

    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_task",
      payload: { title: "Different task" },
      idempotencyKey: "draft:task:0001",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 })
  })

  it("binds lead updates to the visible target revision and renders a diff", async () => {
    const updatedAt = new Date("2026-09-19T11:59:00.000Z")
    deps.leadFindFirst.mockResolvedValueOnce({
      id: "lead-1",
      contactName: "Ali",
      companyName: null,
      email: null,
      phone: "+994501234567",
      phoneWhatsApp: null,
      telegramHandle: null,
      sourceDetail: null,
      interest: null,
      brand: null,
      category: null,
      status: "new",
      priority: "medium",
      assignedTo: "user-1",
      estimatedValue: null,
      notes: "Old note",
      pipelineId: null,
      updatedAt,
    })

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "update_lead",
      targetEntityId: "lead-1",
      payload: { notes: "New note" },
      idempotencyKey: "draft:lead:0001",
    })

    const data = deps.intentCreate.mock.calls[0]?.[0]?.data
    expect(data).toMatchObject({
      targetEntityType: "lead",
      targetEntityId: "lead-1",
      expectedUpdatedAt: updatedAt,
      normalizedPayload: {
        notes: "New note",
        expectedUpdatedAt: updatedAt.toISOString(),
      },
    })
    expect(data.preview.fields).toEqual([{
      key: "notes",
      labelKey: "ai.voice.actions.fields.notes",
      before: "Old note",
      after: "New note",
    }])
    expect(deps.applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "manager",
      "lead",
      { id: "lead-1", organizationId: "org-1" },
    )
  })

  // Owner request 2026-09-21: tasks are edited by voice like leads — bound to
  // the task the user may see, at the version they saw, with a before/after.
  it("binds task updates to the visible task version and names the people in the diff", async () => {
    const updatedAt = new Date("2026-09-19T11:58:00.000Z")
    deps.taskFindFirst.mockResolvedValueOnce({
      id: "task-1",
      title: "Call Ali",
      description: null,
      priority: "medium",
      dueDate: new Date("2026-09-20T00:00:00.000Z"),
      assignedTo: "user-1",
      status: "pending",
      updatedAt,
    })
    deps.userFindMany.mockResolvedValueOnce([
      { id: "user-1", name: "Rashad", email: "r@example.com" },
      { id: "user-2", name: "Aysel", email: "a@example.com" },
    ])

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "update_task",
      targetEntityId: "task-1",
      payload: { dueDate: "2026-09-26", assignedTo: "user-2" },
      idempotencyKey: "draft:task-update:0001",
    })

    const data = deps.intentCreate.mock.calls[0]?.[0]?.data
    expect(data).toMatchObject({
      targetEntityType: "task",
      targetEntityId: "task-1",
      expectedUpdatedAt: updatedAt,
      normalizedPayload: { expectedUpdatedAt: updatedAt.toISOString() },
    })
    expect(data.preview.target).toEqual({ entityType: "task", id: "task-1", label: "Call Ali" })
    expect(data.preview.fields).toEqual([
      {
        key: "dueDate",
        labelKey: "ai.voice.actions.fields.dueDate",
        before: "2026-09-20T00:00:00.000Z",
        after: "2026-09-26",
      },
      {
        key: "assignedTo",
        labelKey: "ai.voice.actions.fields.assignedTo",
        before: "user-1",
        after: "user-2",
        // A receipt that says "user-2" asks the user to confirm what they
        // cannot check.
        beforeLabel: "Rashad",
        afterLabel: "Aysel",
      },
    ])
    expect(deps.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", id: { in: ["user-1", "user-2"] } },
    }))
    expect(deps.applyRecordFilter).toHaveBeenCalledWith(
      "org-1", "user-1", "manager", "task", { id: "task-1", organizationId: "org-1" },
    )
  })

  it("refuses to draft a change to a task the user cannot see", async () => {
    deps.taskFindFirst.mockResolvedValueOnce(null)
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "update_task",
      targetEntityId: "task-9",
      payload: { title: "x" },
      idempotencyKey: "draft:task-update:0002",
    })).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" })
    expect(deps.intentCreate).not.toHaveBeenCalled()
  })

  it("names a deal's company instead of printing its id", async () => {
    deps.dealFindFirst.mockResolvedValueOnce({
      id: "deal-1",
      name: "Azmart",
      companyId: null,
      contactId: null,
      valueAmount: 1000,
      currency: "AZN",
      expectedClose: null,
      assignedTo: "user-1",
      notes: null,
      stage: "Negotiation",
      updatedAt: new Date("2026-09-19T11:57:00.000Z"),
    })
    deps.companyFindMany.mockResolvedValueOnce([{ id: "company-1", name: "Azmart MMC" }])

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "update_deal",
      targetEntityId: "deal-1",
      payload: { companyId: "company-1", valueAmount: 2000 },
      idempotencyKey: "draft:deal-update:0001",
    })

    const fields = deps.intentCreate.mock.calls[0]?.[0]?.data.preview.fields
    expect(fields).toEqual([
      {
        key: "companyId",
        labelKey: "ai.voice.actions.fields.companyId",
        before: null,
        after: "company-1",
        afterLabel: "Azmart MMC",
      },
      { key: "valueAmount", labelKey: "ai.voice.actions.fields.valueAmount", before: 1000, after: 2000 },
    ])
  })

  it("fails closed when the role, tenant module, field, or session cannot authorize the draft", async () => {
    await expect(createAiVoiceActionDraft({ ...auth, role: "support" }, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali" },
      idempotencyKey: "draft:lead:0002",
    })).rejects.toMatchObject({ code: "ACTION_FORBIDDEN", status: 403 })

    deps.org.modules.sales = false
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali" },
      idempotencyKey: "draft:lead:0003",
    })).rejects.toMatchObject({ code: "ACTION_FORBIDDEN", status: 403 })
    deps.org.modules.sales = true

    deps.fieldPermissionFindMany.mockResolvedValueOnce([{ fieldName: "notes", access: "visible" }])
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali", notes: "Private" },
      idempotencyKey: "draft:lead:0004",
    })).rejects.toMatchObject({ code: "FORBIDDEN_FIELD", status: 403 })

    deps.sessionFindFirst.mockResolvedValueOnce(null)
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "other-session",
      actionType: "create_task",
      payload: { title: "Call Ali" },
      idempotencyKey: "draft:task:0002",
    })).rejects.toMatchObject({ code: "VOICE_SESSION_INACTIVE", status: 409 })
  })

  it("rejects empty updates and target records that changed or were converted", async () => {
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "update_lead",
      targetEntityId: "lead-1",
      payload: { expectedUpdatedAt: "2026-09-19T11:59:00.000Z" },
      idempotencyKey: "draft:lead:0005",
    })).rejects.toMatchObject({ code: "EMPTY_UPDATE", status: 400 })

    deps.leadFindFirst.mockResolvedValueOnce({
      id: "lead-1",
      contactName: "Ali",
      companyName: null,
      email: null,
      phone: null,
      phoneWhatsApp: null,
      telegramHandle: null,
      sourceDetail: null,
      interest: null,
      brand: null,
      category: null,
      status: "new",
      priority: "medium",
      assignedTo: null,
      estimatedValue: null,
      notes: null,
      pipelineId: null,
      updatedAt: new Date("2026-09-19T12:00:00.000Z"),
    })
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "update_lead",
      targetEntityId: "lead-1",
      payload: {
        notes: "New note",
        expectedUpdatedAt: "2026-09-19T11:59:00.000Z",
      },
      idempotencyKey: "draft:lead:0006",
    })).rejects.toMatchObject({ code: "STALE_TARGET", status: 409 })

    deps.leadFindFirst.mockResolvedValueOnce({
      id: "lead-1",
      contactName: "Ali",
      companyName: null,
      email: null,
      phone: null,
      phoneWhatsApp: null,
      telegramHandle: null,
      sourceDetail: null,
      interest: null,
      brand: null,
      category: null,
      status: "converted",
      priority: "medium",
      assignedTo: null,
      estimatedValue: null,
      notes: null,
      pipelineId: null,
      updatedAt: new Date("2026-09-19T12:00:00.000Z"),
    })
    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "convert_lead_to_deal",
      targetEntityId: "lead-1",
      payload: { dealTitle: "Ali deal" },
      idempotencyKey: "draft:lead:0007",
    })).rejects.toMatchObject({ code: "TARGET_ALREADY_CONVERTED", status: 409 })
  })

  it("never exposes a command execution function through draft errors", async () => {
    try {
      await createAiVoiceActionDraft(auth, {
        voiceSessionId: "voice-1",
        actionType: "update_lead",
        payload: { notes: "No target" },
        idempotencyKey: "draft:lead:0008",
      })
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(AiVoiceActionDraftError)
      expect(error).toMatchObject({ code: "TARGET_REQUIRED", status: 400 })
    }
    expect(deps.intentCreate).not.toHaveBeenCalled()
  })
})
