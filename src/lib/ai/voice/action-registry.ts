import type { z } from "zod"
import type { Module, Action } from "@/lib/permissions"
import type { ModuleId } from "@/lib/modules"
import { createTaskCommandSchema } from "@/lib/crm-commands/schemas/task"
import {
  convertLeadToDealCommandSchema,
  createLeadCommandSchema,
  updateLeadCommandSchema,
} from "@/lib/crm-commands/schemas/lead"
import { createDealCommandSchema } from "@/lib/crm-commands/schemas/deal"
import { DEFAULT_AI_ACTION_INTENT_TTL_MS } from "./action-intent"

export const AI_VOICE_ACTION_TYPES = [
  "create_task",
  "create_lead",
  "update_lead",
  "create_deal",
  "convert_lead_to_deal",
] as const

export type AiVoiceActionType = (typeof AI_VOICE_ACTION_TYPES)[number]
export type AiVoiceActionRisk = "standard" | "sensitive"
export type AiVoiceActionCommand =
  | "createTaskCommand"
  | "createLeadCommand"
  | "updateLeadCommand"
  | "createDealCommand"
  | "convertLeadToDealCommand"
export type AiVoiceActionDedupePolicy =
  | "idempotency_key"
  | "lead_contact_coordinates"
  | "deal_name_and_relations"
  | "target_revision"

export type AiVoiceActionPermission = Readonly<{
  module: Module
  action: Action
  tenantModule: ModuleId
}>

export type AiVoiceActionTarget = Readonly<{
  entityType: "lead"
  requestField: "targetEntityId"
  bindExpectedUpdatedAt: true
}>

export type AiVoiceActionPreviewField = Readonly<{
  key: string
  labelKey: string
  before?: unknown
  after: unknown
}>

export type AiVoiceActionPreview = Readonly<{
  contract: 1
  actionType: AiVoiceActionType
  operation: "create" | "update" | "convert"
  entityType: "task" | "lead" | "deal"
  titleKey: string
  target?: Readonly<{
    entityType: "lead"
    id: string
    label: string
  }>
  fields: readonly AiVoiceActionPreviewField[]
}>

type JsonObject = Record<string, unknown>

export type AiVoiceActionPreviewContext = Readonly<{
  target?: Readonly<{
    entityType: "lead"
    id: string
    label: string
    before: JsonObject
  }>
}>

export type AiVoiceActionRegistryEntry = Readonly<{
  actionType: AiVoiceActionType
  command: AiVoiceActionCommand
  commandSchema: z.ZodType
  allowedFields: readonly string[]
  permissions: readonly AiVoiceActionPermission[]
  fieldPermissionEntity: "task" | "lead" | "deal"
  fieldPermissionNames: (payload: JsonObject) => readonly string[]
  risk: AiVoiceActionRisk
  ttlMs: number
  dedupePolicy: AiVoiceActionDedupePolicy
  target: AiVoiceActionTarget | null
  operation: "create" | "update" | "convert"
  resultEntityType: "task" | "lead" | "deal"
  previewFields: readonly string[]
  renderPreview: (
    payload: JsonObject,
    context?: AiVoiceActionPreviewContext,
  ) => AiVoiceActionPreview
}>

const STANDARD_TTL_MS = DEFAULT_AI_ACTION_INTENT_TTL_MS
const SENSITIVE_TTL_MS = 5 * 60 * 1000

const CREATE_TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "dueDate",
  "assignedTo",
  "relatedType",
  "relatedId",
] as const

const CREATE_LEAD_FIELDS = [
  "contactName",
  "companyName",
  "email",
  "phone",
  "phoneWhatsApp",
  "telegramHandle",
  "source",
  "sourceDetail",
  "sourceProfileUrl",
  "interest",
  "brand",
  "category",
  "priority",
  "estimatedValue",
  "assignedTo",
  "pipelineId",
  "notes",
] as const

const UPDATE_LEAD_FIELDS = [
  "contactName",
  "companyName",
  "email",
  "phone",
  "phoneWhatsApp",
  "telegramHandle",
  "sourceDetail",
  "interest",
  "brand",
  "category",
  // Status is here and `converted` is not reachable through it: conversion is
  // its own transactional command, and setting the word directly would mark a
  // lead converted with no deal behind it. The voice schema in
  // propose-tools.ts omits `converted`, and update-lead.ts refuses it again.
  "status",
  "priority",
  "estimatedValue",
  "assignedTo",
  "pipelineId",
  "notes",
  "expectedUpdatedAt",
] as const

const CREATE_DEAL_FIELDS = [
  "name",
  "companyId",
  "contactId",
  "campaignId",
  "stage",
  "pipelineId",
  "valueAmount",
  "currency",
  "probability",
  "expectedClose",
  "assignedTo",
  "notes",
  "tags",
] as const

const CONVERT_LEAD_FIELDS = [
  "dealTitle",
  "dealStage",
  "dealValue",
  "createCompany",
  "pipelineId",
  "expectedUpdatedAt",
] as const

function ownPayloadFields(payload: JsonObject, excluded: readonly string[] = []): string[] {
  const excludedSet = new Set(excluded)
  return Object.keys(payload).filter((field) => !excludedSet.has(field))
}

function conversionPermissionFields(payload: JsonObject): string[] {
  const mapped = new Set<string>(["name"])
  if (payload.dealStage !== undefined) mapped.add("stage")
  if (payload.dealValue !== undefined) mapped.add("valueAmount")
  if (payload.pipelineId !== undefined) mapped.add("pipelineId")
  return [...mapped]
}

function createPreviewRenderer(input: {
  actionType: AiVoiceActionType
  operation: "create" | "update" | "convert"
  entityType: "task" | "lead" | "deal"
  previewFields: readonly string[]
}) {
  return (payload: JsonObject, context?: AiVoiceActionPreviewContext): AiVoiceActionPreview => {
    const fields = input.previewFields.flatMap((key) => {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) return []
      return [{
        key,
        labelKey: `ai.voice.actions.fields.${key}`,
        ...(input.operation === "update" && context?.target
          ? { before: context.target.before[key] ?? null }
          : {}),
        after: payload[key] ?? null,
      }]
    })

    return {
      contract: 1,
      actionType: input.actionType,
      operation: input.operation,
      entityType: input.entityType,
      titleKey: `ai.voice.actions.${input.actionType}.title`,
      ...(context?.target
        ? {
            target: {
              entityType: context.target.entityType,
              id: context.target.id,
              label: context.target.label,
            },
          }
        : {}),
      fields,
    }
  }
}

const LEAD_TARGET: AiVoiceActionTarget = {
  entityType: "lead",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: true,
}

const WRITE_TASKS: readonly AiVoiceActionPermission[] = [
  { module: "tasks", action: "write", tenantModule: "crm" },
]
const WRITE_LEADS: readonly AiVoiceActionPermission[] = [
  { module: "leads", action: "write", tenantModule: "sales" },
]
const WRITE_DEALS: readonly AiVoiceActionPermission[] = [
  { module: "deals", action: "write", tenantModule: "sales" },
]
const CONVERT_LEAD_PERMISSIONS: readonly AiVoiceActionPermission[] = [
  ...WRITE_LEADS,
  ...WRITE_DEALS,
]

export const AI_VOICE_ACTION_REGISTRY: Readonly<Record<AiVoiceActionType, AiVoiceActionRegistryEntry>> = Object.freeze({
  create_task: {
    actionType: "create_task",
    command: "createTaskCommand",
    commandSchema: createTaskCommandSchema,
    allowedFields: CREATE_TASK_FIELDS,
    permissions: WRITE_TASKS,
    fieldPermissionEntity: "task",
    fieldPermissionNames: (payload) => ownPayloadFields(payload),
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: null,
    operation: "create",
    resultEntityType: "task",
    previewFields: CREATE_TASK_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "create_task",
      operation: "create",
      entityType: "task",
      previewFields: CREATE_TASK_FIELDS,
    }),
  },
  create_lead: {
    actionType: "create_lead",
    command: "createLeadCommand",
    commandSchema: createLeadCommandSchema,
    allowedFields: CREATE_LEAD_FIELDS,
    permissions: WRITE_LEADS,
    fieldPermissionEntity: "lead",
    fieldPermissionNames: (payload) => ownPayloadFields(payload),
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "lead_contact_coordinates",
    target: null,
    operation: "create",
    resultEntityType: "lead",
    previewFields: CREATE_LEAD_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "create_lead",
      operation: "create",
      entityType: "lead",
      previewFields: CREATE_LEAD_FIELDS,
    }),
  },
  update_lead: {
    actionType: "update_lead",
    command: "updateLeadCommand",
    commandSchema: updateLeadCommandSchema,
    allowedFields: UPDATE_LEAD_FIELDS,
    permissions: WRITE_LEADS,
    fieldPermissionEntity: "lead",
    fieldPermissionNames: (payload) => ownPayloadFields(payload, ["expectedUpdatedAt"]),
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: LEAD_TARGET,
    operation: "update",
    resultEntityType: "lead",
    previewFields: UPDATE_LEAD_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    renderPreview: createPreviewRenderer({
      actionType: "update_lead",
      operation: "update",
      entityType: "lead",
      previewFields: UPDATE_LEAD_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    }),
  },
  create_deal: {
    actionType: "create_deal",
    command: "createDealCommand",
    commandSchema: createDealCommandSchema,
    allowedFields: CREATE_DEAL_FIELDS,
    permissions: WRITE_DEALS,
    fieldPermissionEntity: "deal",
    fieldPermissionNames: (payload) => ownPayloadFields(payload),
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "deal_name_and_relations",
    target: null,
    operation: "create",
    resultEntityType: "deal",
    previewFields: CREATE_DEAL_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "create_deal",
      operation: "create",
      entityType: "deal",
      previewFields: CREATE_DEAL_FIELDS,
    }),
  },
  convert_lead_to_deal: {
    actionType: "convert_lead_to_deal",
    command: "convertLeadToDealCommand",
    commandSchema: convertLeadToDealCommandSchema,
    allowedFields: CONVERT_LEAD_FIELDS,
    permissions: CONVERT_LEAD_PERMISSIONS,
    fieldPermissionEntity: "deal",
    fieldPermissionNames: conversionPermissionFields,
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: LEAD_TARGET,
    operation: "convert",
    resultEntityType: "deal",
    previewFields: CONVERT_LEAD_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    renderPreview: createPreviewRenderer({
      actionType: "convert_lead_to_deal",
      operation: "convert",
      entityType: "deal",
      previewFields: CONVERT_LEAD_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    }),
  },
})

const ACTION_TYPE_SET = new Set<string>(AI_VOICE_ACTION_TYPES)

export function isAiVoiceActionType(value: unknown): value is AiVoiceActionType {
  return typeof value === "string" && ACTION_TYPE_SET.has(value)
}

export function getAiVoiceActionDefinition(
  actionType: AiVoiceActionType,
): AiVoiceActionRegistryEntry {
  return AI_VOICE_ACTION_REGISTRY[actionType]
}

export type AiVoiceActionPayloadIssue = Readonly<{
  path: readonly PropertyKey[]
  message: string
}>

export type AiVoiceActionPayloadResult =
  | Readonly<{ success: true; data: JsonObject }>
  | Readonly<{ success: false; issues: readonly AiVoiceActionPayloadIssue[] }>

export function parseAiVoiceActionPayload(
  actionType: AiVoiceActionType,
  payload: unknown,
): AiVoiceActionPayloadResult {
  const definition = getAiVoiceActionDefinition(actionType)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { success: false, issues: [{ path: [], message: "Payload must be an object" }] }
  }

  const allowed = new Set<string>(definition.allowedFields)
  const rejectedFields = Object.keys(payload).filter((field) => !allowed.has(field))
  if (rejectedFields.length > 0) {
    return {
      success: false,
      issues: rejectedFields.map((field) => ({
        path: [field],
        message: `Field is not allowed for ${actionType}`,
      })),
    }
  }

  const parsed = definition.commandSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    }
  }

  return { success: true, data: parsed.data as JsonObject }
}
