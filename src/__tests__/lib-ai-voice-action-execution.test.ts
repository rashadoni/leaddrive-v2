import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthResult } from "@/lib/api-auth"

type CommandExecution = {
  transaction: unknown
  postCommitEffects: Array<() => void>
}

const deps = vi.hoisted(() => {
  const intentFindFirst = vi.fn()
  const intentUpdateMany = vi.fn(async () => ({ count: 1 }))
  const eventCreate = vi.fn(async () => ({ id: "event-1" }))
  const transactionClient = {
    aiActionIntent: {
      findFirst: intentFindFirst,
      updateMany: intentUpdateMany,
    },
    aiActionIntentEvent: { create: eventCreate },
  }
  return {
    intentFindFirst,
    intentUpdateMany,
    eventCreate,
    transactionClient,
    transaction: vi.fn(async (
      callback: (tx: typeof transactionClient) => Promise<unknown>,
    ) => callback(transactionClient)),
    createTask: vi.fn(),
    createLead: vi.fn(),
    updateLead: vi.fn(),
    createDeal: vi.fn(),
    convertLead: vi.fn(),
    updateTask: vi.fn(),
    updateDeal: vi.fn(),
    effect: vi.fn(),
    commandExecutions: [] as CommandExecution[],
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: deps.transaction,
  },
}))

vi.mock("@/lib/crm-commands/task/create-task", () => ({
  createTaskCommand: deps.createTask,
}))
vi.mock("@/lib/crm-commands/lead/create-lead", () => ({
  createLeadCommand: deps.createLead,
}))
vi.mock("@/lib/crm-commands/lead/update-lead", () => ({
  updateLeadCommand: deps.updateLead,
}))
vi.mock("@/lib/crm-commands/deal/create-deal", () => ({
  createDealCommand: deps.createDeal,
}))
vi.mock("@/lib/crm-commands/task/update-task", () => ({
  updateTaskCommand: deps.updateTask,
}))
vi.mock("@/lib/crm-commands/deal/update-deal", () => ({
  updateDealCommand: deps.updateDeal,
}))
vi.mock("@/lib/crm-commands/lead/convert-lead-to-deal", () => ({
  convertLeadToDealCommand: deps.convertLead,
}))

import {
  AiVoiceActionExecutionError,
  executeClaimedAiVoiceAction,
} from "@/lib/ai/voice/action-execution"
import { hashAiActionIntentPayload } from "@/lib/ai/voice/action-intent"
import type { AiVoiceActionType } from "@/lib/ai/voice/action-registry"

const auth: AuthResult = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "manager@example.com",
  name: "Manager",
  principalType: "session",
}

const leaseToken = "11111111-1111-4111-8111-111111111111"

function storedIntent(
  actionType: AiVoiceActionType,
  normalizedPayload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const revision = 1
  return {
    id: "intent-1",
    organizationId: "org-1",
    userId: "user-1",
    voiceSessionId: "voice-1",
    actionType,
    normalizedPayload,
    state: "executing",
    revision,
    payloadHash: hashAiActionIntentPayload({ actionType, revision, normalizedPayload }),
    providerToolCallId: "tool-1",
    targetEntityId: null,
    resultEntityType: null,
    resultEntityId: null,
    resultPayload: null,
    executionLeaseToken: leaseToken,
    executionLeaseExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function captureEffect(execution: CommandExecution): void {
  deps.commandExecutions.push(execution)
  execution.postCommitEffects.push(deps.effect)
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.commandExecutions.length = 0
  deps.intentUpdateMany.mockResolvedValue({ count: 1 })
  deps.eventCreate.mockResolvedValue({ id: "event-1" })
  deps.createTask.mockImplementation(async (
    _actor: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { entity: { id: "task-1" } }
  })
  deps.createLead.mockImplementation(async (
    _actor: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { entity: { id: "lead-1" } }
  })
  deps.updateLead.mockImplementation(async (
    _actor: unknown,
    _targetId: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { entity: { id: "lead-1" } }
  })
  deps.createDeal.mockImplementation(async (
    _actor: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { entity: { id: "deal-1" } }
  })
  deps.updateTask.mockImplementation(async (
    _actor: unknown,
    _targetId: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { entity: { id: "task-1" } }
  })
  deps.updateDeal.mockImplementation(async (
    _actor: unknown,
    _targetId: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { entity: { id: "deal-1" } }
  })
  deps.convertLead.mockImplementation(async (
    _actor: unknown,
    _targetId: unknown,
    _payload: unknown,
    execution: CommandExecution,
  ) => {
    captureEffect(execution)
    return { deal: { id: "deal-1" } }
  })
})

describe("AI voice claimed action execution boundary", () => {
  it.each([
    ["create_task", { title: "Call Ali" }, null, deps.createTask, "task", "task-1"],
    ["create_lead", { contactName: "Ali" }, null, deps.createLead, "lead", "lead-1"],
    [
      "update_lead",
      { notes: "Follow up", expectedUpdatedAt: "2026-09-20T00:00:00.000Z" },
      "lead-1",
      deps.updateLead,
      "lead",
      "lead-1",
    ],
    ["create_deal", { name: "Ali deal" }, null, deps.createDeal, "deal", "deal-1"],
    [
      "update_task",
      { status: "completed", expectedUpdatedAt: "2026-09-20T00:00:00.000Z" },
      "task-1",
      deps.updateTask,
      "task",
      "task-1",
    ],
    [
      "update_deal",
      { valueAmount: 2000, expectedUpdatedAt: "2026-09-20T00:00:00.000Z" },
      "deal-1",
      deps.updateDeal,
      "deal",
      "deal-1",
    ],
    [
      "convert_lead_to_deal",
      { dealTitle: "Ali deal", expectedUpdatedAt: "2026-09-20T00:00:00.000Z" },
      "lead-1",
      deps.convertLead,
      "deal",
      "deal-1",
    ],
  ] as const)(
    "stores %s mutation, result and event in one transaction",
    async (actionType, payload, targetEntityId, command, entityType, entityId) => {
      deps.intentFindFirst.mockResolvedValueOnce(storedIntent(actionType, payload, {
        targetEntityId,
      }))

      const result = await executeClaimedAiVoiceAction(auth, {
        intentId: "intent-1",
        executionLeaseToken: leaseToken,
      })

      expect(result).toMatchObject({
        state: "succeeded",
        actionType,
        result: { entityType, entityId },
        replayed: false,
      })
      expect(command).toHaveBeenCalledOnce()
      expect(deps.commandExecutions).toHaveLength(1)
      expect(deps.commandExecutions[0]?.transaction).toBe(deps.transactionClient)
      expect(deps.intentUpdateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: "intent-1",
          state: "executing",
          executionLeaseToken: leaseToken,
        }),
        data: expect.objectContaining({
          state: "succeeded",
          resultEntityType: entityType,
          resultEntityId: entityId,
        }),
      })
      expect(deps.eventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: "succeeded",
          correlationId: expect.stringMatching(/^[0-9a-f]{64}$/),
          eventData: { resultEntityType: entityType, resultEntityId: entityId },
        }),
      })
      expect(JSON.stringify(deps.eventCreate.mock.calls)).not.toContain(leaseToken)
      expect(deps.effect).toHaveBeenCalledOnce()
    },
  )

  it("does not dispatch effects when terminal CAS loses", async () => {
    const payload = { title: "Call Ali" }
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent("create_task", payload))
    deps.intentUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(executeClaimedAiVoiceAction(auth, {
      intentId: "intent-1",
      executionLeaseToken: leaseToken,
    })).rejects.toMatchObject({ code: "EXECUTION_CLAIM_LOST", status: 409 })

    expect(deps.createTask).toHaveBeenCalledOnce()
    expect(deps.eventCreate).not.toHaveBeenCalled()
    expect(deps.effect).not.toHaveBeenCalled()
  })

  it("does not store a terminal receipt or dispatch effects when the command fails", async () => {
    const payload = { title: "Call Ali" }
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent("create_task", payload))
    deps.createTask.mockRejectedValueOnce(new Error("database write failed"))

    await expect(executeClaimedAiVoiceAction(auth, {
      intentId: "intent-1",
      executionLeaseToken: leaseToken,
    })).rejects.toThrow("database write failed")

    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
    expect(deps.eventCreate).not.toHaveBeenCalled()
    expect(deps.effect).not.toHaveBeenCalled()
  })

  it("replays a stored result without invoking the CRM command again", async () => {
    const payload = { title: "Call Ali" }
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent("create_task", payload, {
      state: "succeeded",
      resultEntityType: "task",
      resultEntityId: "task-1",
      resultPayload: {
        contract: 1,
        actionType: "create_task",
        entityType: "task",
        entityId: "task-1",
      },
    }))

    const replay = await executeClaimedAiVoiceAction(auth, {
      intentId: "intent-1",
      executionLeaseToken: leaseToken,
    })

    expect(replay).toMatchObject({ replayed: true, result: { entityId: "task-1" } })
    expect(deps.createTask).not.toHaveBeenCalled()
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("rejects a mismatched lease before invoking a command", async () => {
    const payload = { title: "Call Ali" }
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent("create_task", payload))

    await expect(executeClaimedAiVoiceAction(auth, {
      intentId: "intent-1",
      executionLeaseToken: "22222222-2222-4222-8222-222222222222",
    })).rejects.toBeInstanceOf(AiVoiceActionExecutionError)

    expect(deps.createTask).not.toHaveBeenCalled()
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
  })
})

describe("task and deal updates reach the record the receipt named", () => {
  it.each([
    ["update_task", deps.updateTask, "task-7", { title: "x" }],
    ["update_deal", deps.updateDeal, "deal-7", { notes: "x" }],
  ] as const)("%s runs as the voice actor against the stored target", async (actionType, command, target, fields) => {
    const payload = { ...fields, expectedUpdatedAt: "2026-09-20T00:00:00.000Z" }
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent(actionType, payload, { targetEntityId: target }))
    await executeClaimedAiVoiceAction(auth, { intentId: "intent-1", executionLeaseToken: leaseToken })
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ source: "voice", userId: "user-1", actionIntentId: "intent-1" }),
      target,
      payload,
      expect.objectContaining({ transaction: deps.transactionClient }),
    )
  })

  it.each([
    ["update_task", { title: "x" }],
    ["update_deal", { notes: "x" }],
  ] as const)("%s without a stored target runs nothing", async (actionType, fields) => {
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent(
      actionType,
      { ...fields, expectedUpdatedAt: "2026-09-20T00:00:00.000Z" },
    ))
    await expect(executeClaimedAiVoiceAction(auth, { intentId: "intent-1", executionLeaseToken: leaseToken }))
      .rejects.toBeInstanceOf(AiVoiceActionExecutionError)
    expect(deps.updateTask).not.toHaveBeenCalled()
    expect(deps.updateDeal).not.toHaveBeenCalled()
  })
})
