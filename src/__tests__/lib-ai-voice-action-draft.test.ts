import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthResult } from "@/lib/api-auth"

const deps = vi.hoisted(() => ({
  intentFindFirst: vi.fn(),
  intentUpdateMany: vi.fn(async () => ({ count: 0 })),
  intentCreate: vi.fn(),
  sessionFindFirst: vi.fn(async () => ({ id: "voice-1" })),
  leadFindFirst: vi.fn(),
  leadFindMany: vi.fn(async () => []),
  dealFindMany: vi.fn(async () => []),
  fieldPermissionFindMany: vi.fn(async () => []),
  applyRecordFilter: vi.fn(async (_orgId, _userId, _role, _entityType, where) => where),
  logAudit: vi.fn(async () => {}),
  org: {
    plan: "enterprise",
    addons: [] as string[],
    modules: { ai: true, crm: true, sales: true } as Record<string, boolean>,
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiActionIntent: {
      findFirst: deps.intentFindFirst,
      updateMany: deps.intentUpdateMany,
      create: deps.intentCreate,
    },
    voiceSession: { findFirst: deps.sessionFindFirst },
    lead: { findFirst: deps.leadFindFirst, findMany: deps.leadFindMany },
    deal: { findMany: deps.dealFindMany },
    fieldPermission: { findMany: deps.fieldPermissionFindMany },
  },
  logAudit: deps.logAudit,
}))

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
