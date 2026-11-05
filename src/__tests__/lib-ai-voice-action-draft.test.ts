import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthResult } from "@/lib/api-auth"

const deps = vi.hoisted(() => ({
  intentFindFirst: vi.fn(),
  intentUpdateMany: vi.fn(async () => ({ count: 0 })),
  intentCreate: vi.fn(),
  intentFindMany: vi.fn(async (_args?: unknown) => [] as unknown[]),
  eventCreate: vi.fn(async () => ({ id: "draft-event-1" })),
  sessionFindFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => ({ id: "voice-1" })),
  leadFindFirst: vi.fn(),
  leadFindMany: vi.fn(async () => []),
  dealFindMany: vi.fn(async () => []),
  taskFindFirst: vi.fn(),
  dealFindFirst: vi.fn(),
  userFindMany: vi.fn(async () => [] as Array<{ id: string; name: string | null; email: string }>),
  companyFindMany: vi.fn(async () => [] as Array<{ id: string; name: string }>),
  pipelineStageFindFirst: vi.fn<() => Promise<{ isWon: boolean; isLost: boolean } | null>>(async () => null),
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
      findMany: deps.intentFindMany,
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
      pipelineStage: { findFirst: deps.pipelineStageFindFirst },
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
  cancelUnfinishedSessionDrafts,
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
    executionLeaseExpiresAt: null,
    errorCode: null,
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

  // Winning a deal pays cashback, surveys the customer and awards loyalty.
  // "stage: Negotiation → WON" says none of that, so the receipt carries a
  // warning the assistant reads out before the user answers.
  it("warns on the receipt when a stage move wins or loses the deal", async () => {
    const dealRow = {
      id: "deal-1", name: "Azmart", companyId: null, contactId: null, valueAmount: 1000,
      currency: "AZN", expectedClose: null, assignedTo: null, notes: null, stage: "Negotiation",
      updatedAt: new Date("2026-09-28T09:00:00.000Z"),
    }
    deps.dealFindFirst.mockResolvedValue(dealRow)
    deps.pipelineStageFindFirst.mockResolvedValueOnce({ isWon: true, isLost: false })

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "move_deal_stage",
      targetEntityId: "deal-1",
      payload: { stage: "WON" },
      idempotencyKey: "draft:stage:0001",
    })
    const won = deps.intentCreate.mock.calls[0]?.[0]?.data
    expect(won.warnings).toEqual([{ code: "DEAL_STAGE_WON" }])
    // And it shows what the stage is moving from, not just where to.
    expect(won.preview.fields).toEqual([
      { key: "stage", labelKey: "ai.voice.actions.fields.stage", before: "Negotiation", after: "WON" },
    ])

    deps.intentCreate.mockClear()
    deps.pipelineStageFindFirst.mockResolvedValueOnce({ isWon: false, isLost: true })
    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "move_deal_stage",
      targetEntityId: "deal-1",
      payload: { stage: "LOST", lostReason: "too expensive" },
      idempotencyKey: "draft:stage:0002",
    })
    expect(deps.intentCreate.mock.calls[0]?.[0]?.data.warnings).toEqual([{ code: "DEAL_STAGE_LOST" }])
  })

  it("says nothing extra for an ordinary stage move", async () => {
    deps.dealFindFirst.mockResolvedValue({
      id: "deal-1", name: "Azmart", companyId: null, contactId: null, valueAmount: 1000,
      currency: "AZN", expectedClose: null, assignedTo: null, notes: null, stage: "LEAD",
      updatedAt: new Date("2026-09-28T09:00:00.000Z"),
    })
    deps.pipelineStageFindFirst.mockResolvedValueOnce({ isWon: false, isLost: false })
    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "move_deal_stage",
      targetEntityId: "deal-1",
      payload: { stage: "NEGOTIATION" },
      idempotencyKey: "draft:stage:0003",
    })
    expect(deps.intentCreate.mock.calls[0]?.[0]?.data.warnings).toEqual([])
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

/**
 * Один черновик на разговор — и что с ним делают поправка, другая задача и
 * конец разговора (владелец, 2026-11-05).
 *
 * Корень разобранного в тот день класса проблем: черновик жил как состояние
 * сессии без хозяина конца. Поправка упиралась в него («попросил добавить цену
 * к сделке» — сделка не создалась, следом не создался и лид), а закрытие
 * квитанции и конец разговора его не трогали вовсе.
 *
 * Моки отвечают ПО АРГУМЕНТАМ, а не по порядку вызовов: порядок внутри
 * функции — её дело, и тест не должен ломаться от его перестановки.
 */
type FindFirstWhere = {
  idempotencyKey?: string
  providerToolCallId?: string
  expiresAt?: { lte?: Date }
  state?: string | { in: string[] }
  actionType?: string
  id?: string
  executionLeaseExpiresAt?: { lte?: Date }
}

/** Какое состояние спрашивает выборка: строку «executing» или набор черновиков. */
function askedState(args: unknown): unknown {
  return (args as { where?: { state?: unknown } } | undefined)?.where?.state
}

function routeFindFirst(rows: {
  replay?: unknown
  expired?: unknown
  abandoned?: unknown
  open?: unknown
  active?: unknown
  owned?: unknown
}) {
  return async (args: { where?: FindFirstWhere }) => {
    const where = args?.where ?? {}
    if (where.idempotencyKey || where.providerToolCallId) return rows.replay ?? null
    if (where.expiresAt?.lte) return rows.expired ?? null
    // брошенное исполнение: лиза истекла, результата нет
    if (where.state === "executing" && where.executionLeaseExpiresAt?.lte) {
      return rows.abandoned ?? null
    }
    // findAmendableDraft: открытый черновик ТОГО ЖЕ действия
    if (where.state === "awaiting_confirmation" && where.actionType) return rows.open ?? null
    // проверка «есть ли вообще незавершённый черновик»
    if (typeof where.state === "object" && where.state?.in) return rows.active ?? null
    if (where.id) return rows.owned ?? null
    return null
  }
}

describe("поправка к той же задаче дополняет черновик", () => {
  function openDraft(over: Record<string, unknown> = {}) {
    return storedIntent({
      id: "intent-open",
      actionType: "create_deal",
      state: "awaiting_confirmation",
      targetEntityId: null,
      rawPayload: { name: "Azmart", companyId: "company-1" },
      normalizedPayload: { name: "Azmart", companyId: "company-1" },
      // Живой черновик: срок считается от настоящего «сейчас», а фикстура
      // storedIntent() приколочена к сентябрю.
      expiresAt: new Date(Date.now() + 600_000),
      ...over,
    })
  }

  it("добавляет цену, не теряя названного раньше", async () => {
    const draft = openDraft()
    deps.intentFindFirst.mockImplementation(routeFindFirst({ open: draft, owned: draft }))
    deps.intentUpdateMany.mockResolvedValue({ count: 1 })

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_deal",
      payload: { valueAmount: 5000 },
      idempotencyKey: "draft:deal:add-price",
    })

    // Второго черновика нет — правится тот же.
    expect(deps.intentCreate).not.toHaveBeenCalled()
    const [{ data }] = deps.intentUpdateMany.mock.calls.at(-1) as [{ data: Record<string, unknown> }]
    expect(data.normalizedPayload).toMatchObject({
      name: "Azmart",
      companyId: "company-1",
      valueAmount: 5000,
    })
    // Ревизия растёт: подтверждение остаётся привязанным к тому, что на экране.
    expect(data.revision).toBe(2)
  })

  it("новое значение поля побеждает прежнее", async () => {
    const draft = openDraft()
    deps.intentFindFirst.mockImplementation(routeFindFirst({ open: draft, owned: draft }))
    deps.intentUpdateMany.mockResolvedValue({ count: 1 })

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_deal",
      payload: { name: "Azmart MMC" },
      idempotencyKey: "draft:deal:rename",
    })

    const [{ data }] = deps.intentUpdateMany.mock.calls.at(-1) as [{ data: Record<string, unknown> }]
    expect(data.normalizedPayload).toMatchObject({ name: "Azmart MMC", companyId: "company-1" })
  })

  // Другая задача — не поправка: лид после сделки заменяет квитанцию, а не
  // подмешивается в неё.
  it("другая задача не смешивается с открытой, а заменяет её", async () => {
    const draft = openDraft()
    deps.intentFindFirst.mockImplementation(routeFindFirst({ active: draft }))
    deps.intentUpdateMany.mockResolvedValue({ count: 1 })

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali" },
      idempotencyKey: "draft:lead:after-deal",
    })

    expect(deps.intentCreate).toHaveBeenCalled()
    const created = deps.intentCreate.mock.calls[0]?.[0]?.data
    expect(created.normalizedPayload).toEqual({ contactName: "Ali" })
    // Прежний отменён — именно отменён, в журнале видно, чем заменён.
    expect(deps.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "cancelled",
        eventData: expect.objectContaining({ reason: "superseded_by_draft" }),
      }),
    }))
  })

  // Исполняемый черновик — не поправка: вторая запись в CRM это дубль.
  it("не трогает черновик, который уже исполняется", async () => {
    deps.intentFindFirst.mockImplementation(routeFindFirst({
      active: storedIntent({ id: "intent-exec", state: "executing", actionType: "create_deal" }),
    }))

    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali" },
      idempotencyKey: "draft:lead:while-executing",
    })).rejects.toMatchObject({ code: "ACTIVE_EXECUTION_IN_PROGRESS" })

    expect(deps.intentCreate).not.toHaveBeenCalled()
  })

  // Исполнение, начатое и брошенное: лиза истекла, в CRM ничего не записано,
  // а разговор до этой правки был заперт до конца — «предыдущее действие
  // выполняется прямо сейчас» уже неправда.
  it("закрывает брошенное исполнение и не запирает разговор", async () => {
    deps.intentFindFirst.mockImplementation(routeFindFirst({
      abandoned: storedIntent({
        id: "intent-exec",
        state: "executing",
        actionType: "create_deal",
        executionLeaseExpiresAt: new Date(Date.now() - 1),
      }),
    }))
    deps.intentUpdateMany.mockResolvedValue({ count: 1 })

    await createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali" },
      idempotencyKey: "draft:lead:after-abandoned-execution",
    })

    expect(deps.intentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ state: "executing" }),
      data: expect.objectContaining({ state: "failed", errorCode: "EXECUTION_ABANDONED" }),
    }))
    expect(deps.intentCreate).toHaveBeenCalled()
  })

  // Гонка: черновик ушёл в исполнение между чтением и отменой.
  it("не создаёт второй черновик, если отмена не состоялась", async () => {
    deps.intentFindFirst.mockImplementation(routeFindFirst({
      active: storedIntent({ id: "intent-active", state: "awaiting_confirmation", actionType: "create_deal" }),
    }))
    deps.intentUpdateMany.mockResolvedValue({ count: 0 })

    await expect(createAiVoiceActionDraft(auth, {
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      payload: { contactName: "Ali" },
      idempotencyKey: "draft:lead:race",
    })).rejects.toMatchObject({ code: "ACTIVE_INTENT_EXISTS" })
    expect(deps.intentCreate).not.toHaveBeenCalled()
  })
})

describe("конец разговора закрывает его незавершённый черновик", () => {
  it("отменяет незавершённые и не трогает исполняемый", async () => {
    deps.intentFindMany.mockImplementation(async (args?: unknown) => (
      askedState(args) === "executing" ? [] : [
        storedIntent({ id: "intent-1", state: "awaiting_confirmation" }),
        storedIntent({ id: "intent-2", state: "collecting" }),
      ]
    ))
    deps.intentUpdateMany.mockResolvedValue({ count: 1 })

    const cancelled = await cancelUnfinishedSessionDrafts("org-1", "voice-1", "session_ended")

    expect(cancelled).toBe(2)
    // Выборка не включает исполняемые: их отмена на полпути оставила бы
    // запись в CRM без квитанции.
    const [{ where }] = deps.intentFindMany.mock.calls[0] as [{ where: { state: { in: string[] } } }]
    expect(where.state.in).toEqual(["collecting", "awaiting_confirmation"])
    expect(deps.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "cancelled",
        eventData: expect.objectContaining({ reason: "session_ended" }),
      }),
    }))
  })

  // Тот же конец, последнее место, где его не было: исполнение, начатое и
  // брошенное. Разговор кончился — кончилось и оно.
  it("закрывает брошенное исполнение, у которого истекла лиза", async () => {
    deps.intentFindMany.mockImplementation(async (args?: unknown) => (
      askedState(args) === "executing"
        ? [storedIntent({
            id: "intent-exec",
            state: "executing",
            executionLeaseExpiresAt: new Date(Date.now() - 1),
          })]
        : []
    ))
    deps.intentUpdateMany.mockResolvedValue({ count: 1 })

    expect(await cancelUnfinishedSessionDrafts("org-1", "voice-1", "session_ended")).toBe(1)
    expect(deps.intentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ state: "executing" }),
      data: expect.objectContaining({ state: "failed", errorCode: "EXECUTION_ABANDONED" }),
    }))
    expect(deps.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "failed",
        eventData: expect.objectContaining({ reason: "execution_lease_expired" }),
      }),
    }))
  })

  it("ничего не делает, когда черновиков нет", async () => {
    deps.intentFindMany.mockResolvedValue([])
    expect(await cancelUnfinishedSessionDrafts("org-1", "voice-1", "session_abandoned")).toBe(0)
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
  })
})
