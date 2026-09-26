import { Prisma } from "@prisma/client"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { createTaskCommand } from "@/lib/crm-commands/task/create-task"
import { createLeadCommand } from "@/lib/crm-commands/lead/create-lead"
import { updateLeadCommand } from "@/lib/crm-commands/lead/update-lead"
import { createDealCommand } from "@/lib/crm-commands/deal/create-deal"
import { convertLeadToDealCommand } from "@/lib/crm-commands/lead/convert-lead-to-deal"
import { updateTaskCommand } from "@/lib/crm-commands/task/update-task"
import { updateDealCommand } from "@/lib/crm-commands/deal/update-deal"
import {
  dispatchCollectedCommandEffects,
  type CrmCommandPostCommitEffect,
} from "@/lib/crm-commands/execution-context"
import { hashAiActionIntentPayload } from "./action-intent"
import { hashAiVoiceActionExecutionLeaseToken } from "./action-execution-lease"
import {
  getAiVoiceActionDefinition,
  isAiVoiceActionType,
  parseAiVoiceActionPayload,
  type AiVoiceActionType,
} from "./action-registry"

type JsonObject = Record<string, unknown>

type ExecutableIntent = Readonly<{
  id: string
  organizationId: string
  userId: string
  voiceSessionId: string
  actionType: string
  normalizedPayload: unknown
  state: string
  revision: number
  payloadHash: string
  providerToolCallId: string | null
  targetEntityId: string | null
  resultEntityType: string | null
  resultEntityId: string | null
  resultPayload: unknown
  executionLeaseToken: string | null
  executionLeaseExpiresAt: Date | null
}>

export type ExecuteClaimedAiVoiceActionInput = Readonly<{
  intentId: string
  executionLeaseToken: string
}>

export type AiVoiceActionExecutionResult = Readonly<{
  intentId: string
  state: "succeeded"
  actionType: AiVoiceActionType
  revision: number
  payloadHash: string
  result: Readonly<{
    entityType: "task" | "lead" | "deal"
    entityId: string
  }>
  replayed: boolean
}>

type StoredResultPayload = Readonly<{
  contract: 1
  actionType: AiVoiceActionType
  entityType: "task" | "lead" | "deal"
  entityId: string
}>

export class AiVoiceActionExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message)
    this.name = "AiVoiceActionExecutionError"
  }
}

function storedResultPayload(intent: ExecutableIntent): StoredResultPayload {
  const payload = intent.resultPayload
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || (payload as JsonObject).contract !== 1
    || !isAiVoiceActionType((payload as JsonObject).actionType)
    || (payload as JsonObject).actionType !== intent.actionType
    || !["task", "lead", "deal"].includes(String((payload as JsonObject).entityType))
    || typeof (payload as JsonObject).entityId !== "string"
    || !(payload as JsonObject).entityId
    || intent.resultEntityType !== (payload as JsonObject).entityType
    || intent.resultEntityId !== (payload as JsonObject).entityId
  ) {
    throw new AiVoiceActionExecutionError(
      "INVALID_STORED_RESULT",
      "The stored action result is invalid",
      409,
    )
  }
  return payload as StoredResultPayload
}

function serializeSucceeded(
  intent: ExecutableIntent,
  result: StoredResultPayload,
  replayed: boolean,
): AiVoiceActionExecutionResult {
  return {
    intentId: intent.id,
    state: "succeeded",
    actionType: result.actionType,
    revision: intent.revision,
    payloadHash: intent.payloadHash,
    result: {
      entityType: result.entityType,
      entityId: result.entityId,
    },
    replayed,
  }
}

async function runCanonicalCommand(
  tx: Prisma.TransactionClient,
  auth: AuthResult,
  intent: ExecutableIntent & { actionType: AiVoiceActionType },
  payload: JsonObject,
  postCommitEffects: CrmCommandPostCommitEffect[],
): Promise<StoredResultPayload> {
  const actor = {
    organizationId: auth.orgId,
    userId: auth.userId,
    role: auth.role,
    source: "voice" as const,
    voiceSessionId: intent.voiceSessionId,
    actionIntentId: intent.id,
    ...(intent.providerToolCallId ? { providerToolCallId: intent.providerToolCallId } : {}),
  }
  const execution = { transaction: tx, postCommitEffects }

  let entityId: string
  if (intent.actionType === "create_task") {
    entityId = (await createTaskCommand(actor, payload, execution)).entity.id
  } else if (intent.actionType === "create_lead") {
    entityId = (await createLeadCommand(actor, payload, execution)).entity.id
  } else if (intent.actionType === "update_lead") {
    if (!intent.targetEntityId) {
      throw new AiVoiceActionExecutionError("TARGET_REQUIRED", "The action target is missing", 409)
    }
    entityId = (await updateLeadCommand(actor, intent.targetEntityId, payload, execution)).entity.id
  } else if (intent.actionType === "create_deal") {
    entityId = (await createDealCommand(actor, payload, execution)).entity.id
  } else if (intent.actionType === "update_task") {
    if (!intent.targetEntityId) {
      throw new AiVoiceActionExecutionError("TARGET_REQUIRED", "The action target is missing", 409)
    }
    entityId = (await updateTaskCommand(actor, intent.targetEntityId, payload, execution)).entity.id
  } else if (intent.actionType === "update_deal") {
    if (!intent.targetEntityId) {
      throw new AiVoiceActionExecutionError("TARGET_REQUIRED", "The action target is missing", 409)
    }
    entityId = (await updateDealCommand(actor, intent.targetEntityId, payload, execution)).entity.id
  } else {
    if (!intent.targetEntityId) {
      throw new AiVoiceActionExecutionError("TARGET_REQUIRED", "The action target is missing", 409)
    }
    entityId = (await convertLeadToDealCommand(
      actor,
      intent.targetEntityId,
      payload,
      execution,
    )).deal.id
  }

  const definition = getAiVoiceActionDefinition(intent.actionType)
  return {
    contract: 1,
    actionType: intent.actionType,
    entityType: definition.resultEntityType,
    entityId,
  }
}

/**
 * Execute an already-claimed voice action. This function is intentionally not
 * exposed by an API route: proof consumption and execution claiming belong to
 * the later commit slice. The CRM mutation, terminal receipt and immutable
 * `succeeded` event share one transaction, so a crash cannot leave a committed
 * entity without a replayable result.
 */
export async function executeClaimedAiVoiceAction(
  auth: AuthResult,
  input: ExecuteClaimedAiVoiceActionInput,
): Promise<AiVoiceActionExecutionResult> {
  const completed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const intent = await tx.aiActionIntent.findFirst({
      where: {
        id: input.intentId,
        organizationId: auth.orgId,
        userId: auth.userId,
        parentIntentId: null,
      },
    }) as ExecutableIntent | null
    if (!intent) {
      throw new AiVoiceActionExecutionError("INTENT_NOT_FOUND", "The action intent was not found", 404)
    }
    if (intent.executionLeaseToken !== input.executionLeaseToken) {
      throw new AiVoiceActionExecutionError("EXECUTION_LEASE_MISMATCH", "The execution lease is invalid", 409)
    }
    if (intent.state === "succeeded") {
      return {
        response: serializeSucceeded(intent, storedResultPayload(intent), true),
        postCommitEffects: [] as CrmCommandPostCommitEffect[],
      }
    }
    if (!isAiVoiceActionType(intent.actionType)) {
      throw new AiVoiceActionExecutionError("INVALID_STORED_ACTION", "The stored action is invalid", 409)
    }
    if (intent.state !== "executing") {
      throw new AiVoiceActionExecutionError(
        "INTENT_NOT_EXECUTING",
        "The action intent has not been claimed for execution",
        409,
      )
    }
    const executionStartedAt = new Date()
    if (!intent.executionLeaseExpiresAt || intent.executionLeaseExpiresAt <= executionStartedAt) {
      throw new AiVoiceActionExecutionError("EXECUTION_LEASE_EXPIRED", "The execution lease has expired", 409)
    }

    const calculatedHash = hashAiActionIntentPayload({
      actionType: intent.actionType,
      revision: intent.revision,
      normalizedPayload: intent.normalizedPayload,
    })
    if (calculatedHash !== intent.payloadHash) {
      throw new AiVoiceActionExecutionError("INTENT_INTEGRITY_FAILED", "The action intent is invalid", 409)
    }
    const parsed = parseAiVoiceActionPayload(intent.actionType, intent.normalizedPayload)
    if (!parsed.success) {
      throw new AiVoiceActionExecutionError("INVALID_STORED_PAYLOAD", "The stored action is invalid", 409)
    }

    const postCommitEffects: CrmCommandPostCommitEffect[] = []
    const result = await runCanonicalCommand(
      tx,
      auth,
      intent as ExecutableIntent & { actionType: AiVoiceActionType },
      parsed.data,
      postCommitEffects,
    )
    const completedAt = new Date()
    const changed = await tx.aiActionIntent.updateMany({
      where: {
        id: intent.id,
        organizationId: auth.orgId,
        userId: auth.userId,
        state: "executing",
        revision: intent.revision,
        payloadHash: intent.payloadHash,
        executionLeaseToken: input.executionLeaseToken,
        executionLeaseExpiresAt: { gt: completedAt },
      },
      data: {
        state: "succeeded",
        resultEntityType: result.entityType,
        resultEntityId: result.entityId,
        resultPayload: result as Prisma.InputJsonValue,
        completedAt,
      },
    })
    if (changed.count !== 1) {
      throw new AiVoiceActionExecutionError(
        "EXECUTION_CLAIM_LOST",
        "The execution claim changed before the result could be stored",
        409,
      )
    }
    await tx.aiActionIntentEvent.create({
      data: {
        organizationId: auth.orgId,
        intentId: intent.id,
        userId: auth.userId,
        eventType: "succeeded",
        intentRevision: intent.revision,
        payloadHash: intent.payloadHash,
        correlationId: hashAiVoiceActionExecutionLeaseToken(input.executionLeaseToken),
        eventData: {
          resultEntityType: result.entityType,
          resultEntityId: result.entityId,
        },
      },
    })

    return {
      response: serializeSucceeded({
        ...intent,
        state: "succeeded",
        resultEntityType: result.entityType,
        resultEntityId: result.entityId,
        resultPayload: result,
      }, result, false),
      postCommitEffects,
    }
  }, { maxWait: 5_000, timeout: 15_000 })

  dispatchCollectedCommandEffects(completed.postCommitEffects)
  return completed.response
}
