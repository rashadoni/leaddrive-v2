import type { z } from "zod"
import type { Module, Action } from "@/lib/permissions"
import type { ModuleId } from "@/lib/modules"
import {
  addTaskChecklistItemCommandSchema,
  addTaskCommentCommandSchema,
  createTaskCommandSchema,
  logTaskTimeCommandSchema,
  setTaskChecklistItemDoneCommandSchema,
  updateTaskCommandSchema,
} from "@/lib/crm-commands/schemas/task"
import {
  convertLeadToDealCommandSchema,
  createLeadCommandSchema,
  updateLeadCommandSchema,
} from "@/lib/crm-commands/schemas/lead"
import { createDealCommandSchema, updateDealCommandSchema } from "@/lib/crm-commands/schemas/deal"
import { createCompanyCommandSchema } from "@/lib/crm-commands/schemas/company"
import { createContactCommandSchema, updateContactCommandSchema } from "@/lib/crm-commands/schemas/contact"
import { voiceActivityCommandSchema } from "@/lib/crm-commands/schemas/activity"
import { voiceTicketSchemas } from "@/lib/crm-commands/schemas/ticket"
import { voicePhoneOrderSchemas } from "@/lib/crm-commands/schemas/phone-order"
import {
  assignFieldContactCommandSchema,
  decideAttendanceRequestCommandSchema,
  giveFieldTaskCommandSchema,
  publishFieldRouteCommandSchema,
  sendFieldMessageCommandSchema,
} from "@/lib/crm-commands/schemas/mtm"
import { DEFAULT_AI_ACTION_INTENT_TTL_MS } from "./action-intent"
export { AI_VOICE_RECEIPT_EDIT_CLOSED } from "./receipt-edit-closed"

export const AI_VOICE_ACTION_TYPES = [
  "create_task",
  "create_lead",
  "update_lead",
  "create_deal",
  "convert_lead_to_deal",
  "update_task",
  "update_deal",
  "move_deal_stage",
  "create_company",
  // Работа внутри задачи (владелец 2026-11-08: «всё, что делают руками»).
  "add_task_comment",
  "add_task_checklist_item",
  "set_task_checklist_item_done",
  "log_task_time",
  // Начальник в «Маршрутах и поле» (этап 2, владелец 2026-11-08).
  "give_field_task",
  "send_field_message",
  "decide_attendance_request",
  // Этап 2б: маршрут и клиенты поля.
  "publish_field_route",
  "assign_field_contact",
  // Этап 3 (владелец 2026-11-09): клиенты — контакт и запись в карточке.
  "create_contact",
  "update_contact",
  "log_contact_activity",
  "log_company_activity",
  "log_deal_activity",
  "log_lead_activity",
  // Этап 4 (владелец 2026-11-09): тикеты. Ответ клиенту и смена статуса —
  // только кнопкой (voice-confirmation.ts: voiceMayConfirm).
  "create_ticket",
  "add_ticket_note",
  "reply_to_ticket",
  "update_ticket",
  // Этап 5: телефонные заказы аптек.
  "update_phone_order_line",
  "add_phone_order_line",
  "remove_phone_order_line",
  "confirm_phone_order",
  "reject_phone_order",
] as const

export type AiVoiceActionType = (typeof AI_VOICE_ACTION_TYPES)[number]
export type AiVoiceActionRisk = "standard" | "sensitive"
export type AiVoiceActionCommand =
  | "createTaskCommand"
  | "createLeadCommand"
  | "updateLeadCommand"
  | "createDealCommand"
  | "convertLeadToDealCommand"
  | "updateTaskCommand"
  | "updateDealCommand"
  | "moveDealStageCommand"
  | "createCompanyCommand"
  | "addTaskCommentCommand"
  | "addTaskChecklistItemCommand"
  | "setTaskChecklistItemDoneCommand"
  | "logTaskTimeCommand"
  | "giveFieldTaskCommand"
  | "sendFieldMessageCommand"
  | "decideAttendanceRequestCommand"
  | "publishFieldRouteCommand"
  | "assignFieldContactCommand"
  | "createContactCommand"
  | "updateContactCommand"
  | "createActivityCommand"
  | "createTicketCommand"
  | "addTicketCommentCommand"
  | "updateTicketCommand"
  | "phoneOrderCommand"
export type AiVoiceActionDedupePolicy =
  | "idempotency_key"
  | "lead_contact_coordinates"
  | "deal_name_and_relations"
  | "target_revision"

export type AiVoiceActionPermission = Readonly<{
  module: Module
  action: Action
  /** Модуль тенанта, без которого действия нет. */
  tenantModule?: ModuleId
  /**
   * Возможность тенанта («Маршруты и поле», «Персонал»): эти разделы
   * включаются не модулем, а возможностью, и её же проверяет экран
   * (with-mtm-rls-auth.ts). Скрытая от человека возможность — тоже отказ.
   */
  tenantCapability?: "route-field" | "personnel"
  /**
   * Флаг организации (Organization.features), без которого раздела нет:
   * телефонные заказы открывает `pharmacy_phone_orders`, как экран.
   */
  tenantFeature?: "pharmacy_phone_orders"
}>

/**
 * Запись, которой заканчивается действие. Компания появилась здесь
 * 2026-11-06: «создай клиента» до этого превращалось в ЛИД, потому что
 * создавать компанию голосом было нечем.
 */
export type AiVoiceActionEntityType =
  | "task" | "lead" | "deal" | "company"
  // Записи «Маршрутов и поля» (этап 2): полевая задача, сообщение агенту,
  // заявка сотрудника.
  | "mtm_task" | "mtm_message" | "mtm_attendance_request"
  // Этап 2б: маршрут дня и клиент поля.
  | "mtm_route" | "mtm_contact"
  // Этап 3: контакт (человек у клиента).
  | "contact"
  // Этап 4: тикет поддержки.
  | "ticket"
  // Этап 5: телефонный заказ аптеки.
  | "phone_order"

/** Все виды результата — для проверки сохранённого результата при повторе. */
export const AI_VOICE_ACTION_ENTITY_TYPES: readonly AiVoiceActionEntityType[] = [
  "task", "lead", "deal", "company",
  "mtm_task", "mtm_message", "mtm_attendance_request",
  "mtm_route", "mtm_contact",
  "contact",
  "ticket",
  "phone_order",
]

/** The kinds of record a voice update may target. */
export type AiVoiceActionTargetType = "lead" | "task" | "deal" | "contact" | "company" | "ticket"

export type AiVoiceActionTarget = Readonly<{
  entityType: AiVoiceActionTargetType
  requestField: "targetEntityId"
  /**
   * Привязать черновик к версии записи: изменилась запись, пока квитанция на
   * экране, — подтверждать нечего, считается заново. Нужно, когда действие
   * МЕНЯЕТ поля записи (иначе голос затёр бы чужую правку).
   *
   * Не нужно, когда действие лишь добавляет к записи своё — сообщение,
   * подзадачу, время: чужая правка срока задачи не делает сообщение в ней
   * неверным, а отказ «запись изменилась» на каждое движение карточки сделал
   * бы голосовые сообщения в живой задаче почти невозможными.
   */
  bindExpectedUpdatedAt: boolean
}>

export type AiVoiceActionPreviewField = Readonly<{
  key: string
  labelKey: string
  before?: unknown
  after: unknown
  /**
   * The name behind an id-valued field (assignee, company, contact), read by
   * the server when the draft is written. A receipt that says "clx9…" asks the
   * user to confirm something they cannot check.
   */
  beforeLabel?: string
  afterLabel?: string
}>

export type AiVoiceActionPreview = Readonly<{
  contract: 1
  actionType: AiVoiceActionType
  operation: "create" | "update" | "convert"
  entityType: AiVoiceActionEntityType
  titleKey: string
  target?: Readonly<{
    entityType: AiVoiceActionTargetType
    id: string
    label: string
  }>
  fields: readonly AiVoiceActionPreviewField[]
}>

type JsonObject = Record<string, unknown>

export type AiVoiceActionPreviewContext = Readonly<{
  target?: Readonly<{
    entityType: AiVoiceActionTargetType
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
  fieldPermissionEntity: AiVoiceActionEntityType
  fieldPermissionNames: (payload: JsonObject) => readonly string[]
  risk: AiVoiceActionRisk
  ttlMs: number
  dedupePolicy: AiVoiceActionDedupePolicy
  target: AiVoiceActionTarget | null
  operation: "create" | "update" | "convert"
  resultEntityType: AiVoiceActionEntityType
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

// The voice subset of the task update. Status is here with its values mapped
// by the resolver to the task's own vocabulary (board: todo/in_progress/done,
// list: pending/in_progress/completed/cancelled), so the board's move gate
// in updateTaskCommand applies exactly as for a drag.
const UPDATE_TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "dueDate",
  "assignedTo",
  "status",
  "expectedUpdatedAt",
] as const

// No stage, pipeline or probability: a stage move can mark a deal won, which
// pays cashback and surveys the customer. See update-deal.ts.
const UPDATE_DEAL_FIELDS = [
  "name",
  "companyId",
  "contactId",
  "valueAmount",
  "currency",
  "expectedClose",
  "assignedTo",
  "notes",
  "expectedUpdatedAt",
] as const

// Its own action, not a field of update_deal: entering the won stage pays
// cashback, surveys the customer and awards loyalty. The receipt says so.
const MOVE_DEAL_STAGE_FIELDS = [
  "stage",
  "lostReason",
  "expectedUpdatedAt",
] as const

// Подмножество экрана компании: закрытые словари (статус, категория),
// налоговый номер, представитель, кредитный лимит и SLA голосом не диктуются —
// см. schemas/company.ts.
const CREATE_COMPANY_FIELDS = [
  "name",
  "industry",
  "website",
  "phone",
  "email",
  "address",
  "city",
  "country",
  "description",
] as const

// Работа внутри задачи. Голосом — только то, что человек произносит:
// упоминания (@) выбираются на экране, порядок подзадач — перетаскиванием.
const ADD_TASK_COMMENT_FIELDS = ["content"] as const
const ADD_TASK_CHECKLIST_ITEM_FIELDS = ["title", "assignedTo", "dueDate"] as const
// `checklistItemId` сервер находит сам по названию, которое сказал человек
// (propose-resolve.ts); модель идентификатора не видит и не присылает.
const SET_TASK_CHECKLIST_ITEM_DONE_FIELDS = ["checklistItemId", "completed"] as const
const LOG_TASK_TIME_FIELDS = ["minutes", "date", "note"] as const

// Начальник в «Маршрутах и поле». Агента и заявку сервер находит сам по
// словам человека (propose-resolve.ts); модель идентификаторов не видит.
const GIVE_FIELD_TASK_FIELDS = ["agentId", "title", "dueDate"] as const
const SEND_FIELD_MESSAGE_FIELDS = ["agentId", "body"] as const
const DECIDE_ATTENDANCE_REQUEST_FIELDS = ["attendanceRequestId", "decision", "note", "expectedUpdatedAt"] as const
// Версия маршрута и отпечаток предпросмотра — служебные: их кладёт сервер,
// человеку в квитанции они не показываются (как expectedUpdatedAt).
const PUBLISH_FIELD_ROUTE_FIELDS = ["routeId", "overrideReason", "expectedVersion"] as const
const ASSIGN_FIELD_CONTACT_FIELDS = ["fieldContactId", "agentId", "reason", "previewToken"] as const
// Этап 3: контакт — то, что говорят вслух; компанию сервер находит по имени.
const CREATE_CONTACT_FIELDS = ["fullName", "email", "phone", "position", "companyId"] as const
const UPDATE_CONTACT_FIELDS = [...CREATE_CONTACT_FIELDS, "expectedUpdatedAt"] as const
// Запись в карточке: карточку сервер берёт из цели черновика, не из полей.
const LOG_ACTIVITY_FIELDS = ["type", "subject", "description", "scheduledAt"] as const
// Этап 4: тикет. Клиента, компанию и ответственного сервер находит по имени.
const CREATE_TICKET_FIELDS = ["subject", "description", "priority", "contactId", "companyId", "assignedTo"] as const
const TICKET_COMMENT_FIELDS = ["comment"] as const
const UPDATE_TICKET_FIELDS = ["status", "priority", "assignedTo", "expectedUpdatedAt"] as const
/** Служебные поля квитанции: сервер их ставит, человек их не правит. */
const PHONE_ORDER_PRODUCT_FIELDS = ["externalId", "itemCode", "productName", "sourceName", "unitPrice"] as const
const UPDATE_PHONE_ORDER_LINE_FIELDS = ["orderId", "revision", "lineId", "quantity", ...PHONE_ORDER_PRODUCT_FIELDS] as const
const ADD_PHONE_ORDER_LINE_FIELDS = ["orderId", "revision", ...PHONE_ORDER_PRODUCT_FIELDS, "quantity", "unit"] as const
const REMOVE_PHONE_ORDER_LINE_FIELDS = ["orderId", "revision", "lineId"] as const
const CONFIRM_PHONE_ORDER_FIELDS = ["orderId", "revision"] as const
const REJECT_PHONE_ORDER_FIELDS = ["orderId", "revision", "reason"] as const

const SERVER_SIDE_FIELDS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt", "expectedVersion", "previewToken",
  // Заказ: версия и данные каталога за названием товара — служебные.
  "revision", "externalId", "itemCode", "sourceName",
])

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
  entityType: AiVoiceActionEntityType
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

const TASK_TARGET: AiVoiceActionTarget = {
  entityType: "task",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: true,
}

/** Задача, К КОТОРОЙ что-то добавляют (см. bindExpectedUpdatedAt). */
const TASK_PARENT_TARGET: AiVoiceActionTarget = {
  entityType: "task",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: false,
}

const DEAL_TARGET: AiVoiceActionTarget = {
  entityType: "deal",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: true,
}

const WRITE_TASKS: readonly AiVoiceActionPermission[] = [
  { module: "tasks", action: "write", tenantModule: "crm" },
]
// Писать в задаче может тот, кто её читает, — как на экране
// (POST /api/v1/tasks/[id]/comments стоит на tasks:read).
const READ_TASKS: readonly AiVoiceActionPermission[] = [
  { module: "tasks", action: "read", tenantModule: "crm" },
]
const WRITE_LEADS: readonly AiVoiceActionPermission[] = [
  { module: "leads", action: "write", tenantModule: "sales" },
]
const WRITE_DEALS: readonly AiVoiceActionPermission[] = [
  { module: "deals", action: "write", tenantModule: "sales" },
]
const WRITE_COMPANIES: readonly AiVoiceActionPermission[] = [
  { module: "companies", action: "write", tenantModule: "crm" },
]
// Тикеты живут в модуле «Поддержка», права — как у экрана (tickets:write).
const WRITE_TICKETS: readonly AiVoiceActionPermission[] = [
  { module: "tickets", action: "write", tenantModule: "support" },
]
const WRITE_CONTACTS: readonly AiVoiceActionPermission[] = [
  { module: "contacts", action: "write", tenantModule: "crm" },
]
const CONTACT_TARGET: AiVoiceActionTarget = {
  entityType: "contact",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: true,
}

/**
 * Карточки, в ленту которых пишется заметка, звонок или встреча. К версии
 * карточки запись не привязана: чужая правка телефона не делает заметку о
 * звонке неверной (см. bindExpectedUpdatedAt).
 */
function activityParentTarget(entityType: AiVoiceActionTargetType): AiVoiceActionTarget {
  return { entityType, requestField: "targetEntityId", bindExpectedUpdatedAt: false }
}

const TICKET_TARGET: AiVoiceActionTarget = {
  entityType: "ticket",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: true,
}

/** Тикет, в который пишут комментарий: к его версии не привязывается. */
const TICKET_PARENT_TARGET: AiVoiceActionTarget = {
  entityType: "ticket",
  requestField: "targetEntityId",
  bindExpectedUpdatedAt: false,
}

// Телефонные заказы — права экрана заказа (deals:write) и флаг организации.
const WRITE_PHONE_ORDERS: readonly AiVoiceActionPermission[] = [
  { module: "deals", action: "write", tenantModule: "sales", tenantFeature: "pharmacy_phone_orders" },
]

const WRITE_ROUTE_FIELD: readonly AiVoiceActionPermission[] = [
  { module: "mtm", action: "write", tenantCapability: "route-field" },
]
// Сообщение агенту живёт на «Операциях» — под модулем mtm, как экран
// (POST /api/v1/mtm/operations/messages стоит на withMtmRlsAuth("mtm")).
const WRITE_MTM: readonly AiVoiceActionPermission[] = [
  { module: "mtm", action: "write", tenantModule: "mtm" },
]
const WRITE_PERSONNEL: readonly AiVoiceActionPermission[] = [
  { module: "mtm", action: "write", tenantCapability: "personnel" },
]
const CONVERT_LEAD_PERMISSIONS: readonly AiVoiceActionPermission[] = [
  ...WRITE_LEADS,
  ...WRITE_DEALS,
]

/**
 * Действие, которое добавляет что-то В задачу: результат — сама задача (на
 * неё ведёт ссылка «готово»), цель — задача, к версии которой черновик не
 * привязан. Права на поля задачи не проверяются: сообщение, подзадача и время
 * — не поля карточки, а свои записи со своими правами (READ/WRITE_TASKS).
 */
function taskWorkEntry(input: {
  actionType: AiVoiceActionType
  command: AiVoiceActionCommand
  commandSchema: z.ZodType
  fields: readonly string[]
  permissions: readonly AiVoiceActionPermission[]
}): AiVoiceActionRegistryEntry {
  return {
    actionType: input.actionType,
    command: input.command,
    commandSchema: input.commandSchema,
    allowedFields: input.fields,
    permissions: input.permissions,
    fieldPermissionEntity: "task",
    fieldPermissionNames: () => [],
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: TASK_PARENT_TARGET,
    operation: "create",
    resultEntityType: "task",
    previewFields: input.fields,
    renderPreview: createPreviewRenderer({
      actionType: input.actionType,
      operation: "create",
      entityType: "task",
      previewFields: input.fields,
    }),
  }
}

/**
 * Запись в ленту карточки (заметка, звонок, письмо, встреча). Результат — сама
 * карточка: на неё ведёт «готово», там запись и видна. Право — писать в эту
 * карточку: экран ленты прав не спрашивал вовсе, голос строже.
 */
function activityEntry(input: {
  actionType: AiVoiceActionType
  target: AiVoiceActionTargetType & AiVoiceActionEntityType
  permissions: readonly AiVoiceActionPermission[]
}): AiVoiceActionRegistryEntry {
  return {
    actionType: input.actionType,
    command: "createActivityCommand",
    commandSchema: voiceActivityCommandSchema,
    allowedFields: LOG_ACTIVITY_FIELDS,
    permissions: input.permissions,
    fieldPermissionEntity: input.target,
    fieldPermissionNames: () => [],
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: activityParentTarget(input.target),
    operation: "create",
    resultEntityType: input.target,
    previewFields: LOG_ACTIVITY_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: input.actionType,
      operation: "create",
      entityType: input.target,
      previewFields: LOG_ACTIVITY_FIELDS,
    }),
  }
}

/** Комментарий в тикете: внутренняя заметка или ответ клиенту. Результат — тикет. */
function ticketCommentEntry(actionType: "add_ticket_note" | "reply_to_ticket"): AiVoiceActionRegistryEntry {
  const risk: AiVoiceActionRisk = actionType === "reply_to_ticket" ? "sensitive" : "standard"
  return {
    actionType,
    command: "addTicketCommentCommand",
    commandSchema: voiceTicketSchemas.comment,
    allowedFields: TICKET_COMMENT_FIELDS,
    permissions: WRITE_TICKETS,
    fieldPermissionEntity: "ticket",
    fieldPermissionNames: () => [],
    risk,
    ttlMs: risk === "sensitive" ? SENSITIVE_TTL_MS : STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: TICKET_PARENT_TARGET,
    operation: "create",
    resultEntityType: "ticket",
    previewFields: TICKET_COMMENT_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType,
      operation: "create",
      entityType: "ticket",
      previewFields: TICKET_COMMENT_FIELDS,
    }),
  }
}

/**
 * Действие начальника в «Маршрутах и поле»: без цели-записи CRM (агента и
 * заявку сервер кладёт в полезную нагрузку сам), результат — запись MTM.
 * Права на поля CRM не при чём: команды MTM проверяют роль и команду
 * начальника сами.
 */
function managerEntry(input: {
  actionType: AiVoiceActionType
  command: AiVoiceActionCommand
  commandSchema: z.ZodType
  fields: readonly string[]
  permissions: readonly AiVoiceActionPermission[]
  resultEntityType: AiVoiceActionEntityType
  risk: AiVoiceActionRisk
}): AiVoiceActionRegistryEntry {
  const previewFields = input.fields.filter((field) => !SERVER_SIDE_FIELDS.has(field))
  return {
    actionType: input.actionType,
    command: input.command,
    commandSchema: input.commandSchema,
    allowedFields: input.fields,
    permissions: input.permissions,
    fieldPermissionEntity: input.resultEntityType,
    fieldPermissionNames: () => [],
    risk: input.risk,
    ttlMs: input.risk === "sensitive" ? SENSITIVE_TTL_MS : STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: null,
    operation: "create",
    resultEntityType: input.resultEntityType,
    previewFields,
    renderPreview: createPreviewRenderer({
      actionType: input.actionType,
      operation: "create",
      entityType: input.resultEntityType,
      previewFields,
    }),
  }
}

/**
 * Правка телефонного заказа: без цели-записи CRM (заказ, строку и товар
 * сервер кладёт в нагрузку сам, с версией заказа). Результат — заказ.
 * Подтверждение и отказ доходят до аптеки (WhatsApp) и до 1С: короткий срок
 * квитанции, и голосом их не подтвердить (voiceMayConfirm).
 */
function phoneOrderEntry(input: {
  actionType: AiVoiceActionType
  commandSchema: z.ZodType
  fields: readonly string[]
  risk: AiVoiceActionRisk
}): AiVoiceActionRegistryEntry {
  return managerEntry({
    actionType: input.actionType,
    command: "phoneOrderCommand",
    commandSchema: input.commandSchema,
    fields: input.fields,
    permissions: WRITE_PHONE_ORDERS,
    resultEntityType: "phone_order",
    risk: input.risk,
  })
}

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
  update_task: {
    actionType: "update_task",
    command: "updateTaskCommand",
    commandSchema: updateTaskCommandSchema.strict(),
    allowedFields: UPDATE_TASK_FIELDS,
    permissions: WRITE_TASKS,
    fieldPermissionEntity: "task",
    fieldPermissionNames: (payload) => ownPayloadFields(payload, ["expectedUpdatedAt"]),
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: TASK_TARGET,
    operation: "update",
    resultEntityType: "task",
    previewFields: UPDATE_TASK_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    renderPreview: createPreviewRenderer({
      actionType: "update_task",
      operation: "update",
      entityType: "task",
      previewFields: UPDATE_TASK_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    }),
  },
  update_deal: {
    actionType: "update_deal",
    command: "updateDealCommand",
    commandSchema: updateDealCommandSchema.strict(),
    allowedFields: UPDATE_DEAL_FIELDS,
    permissions: WRITE_DEALS,
    fieldPermissionEntity: "deal",
    fieldPermissionNames: (payload) => ownPayloadFields(payload, ["expectedUpdatedAt"]),
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: DEAL_TARGET,
    operation: "update",
    resultEntityType: "deal",
    previewFields: UPDATE_DEAL_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    renderPreview: createPreviewRenderer({
      actionType: "update_deal",
      operation: "update",
      entityType: "deal",
      previewFields: UPDATE_DEAL_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    }),
  },
  move_deal_stage: {
    actionType: "move_deal_stage",
    command: "updateDealCommand",
    commandSchema: updateDealCommandSchema.strict(),
    allowedFields: MOVE_DEAL_STAGE_FIELDS,
    permissions: WRITE_DEALS,
    fieldPermissionEntity: "deal",
    fieldPermissionNames: (payload) => ownPayloadFields(payload, ["expectedUpdatedAt"]),
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: DEAL_TARGET,
    operation: "update",
    resultEntityType: "deal",
    previewFields: MOVE_DEAL_STAGE_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    renderPreview: createPreviewRenderer({
      actionType: "move_deal_stage",
      operation: "update",
      entityType: "deal",
      previewFields: MOVE_DEAL_STAGE_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    }),
  },
  create_company: {
    actionType: "create_company",
    command: "createCompanyCommand",
    commandSchema: createCompanyCommandSchema,
    allowedFields: CREATE_COMPANY_FIELDS,
    permissions: WRITE_COMPANIES,
    fieldPermissionEntity: "company",
    fieldPermissionNames: (payload) => ownPayloadFields(payload),
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: null,
    operation: "create",
    resultEntityType: "company",
    previewFields: CREATE_COMPANY_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "create_company",
      operation: "create",
      entityType: "company",
      previewFields: CREATE_COMPANY_FIELDS,
    }),
  },
  add_task_comment: taskWorkEntry({
    actionType: "add_task_comment",
    command: "addTaskCommentCommand",
    commandSchema: addTaskCommentCommandSchema,
    fields: ADD_TASK_COMMENT_FIELDS,
    permissions: READ_TASKS,
  }),
  add_task_checklist_item: taskWorkEntry({
    actionType: "add_task_checklist_item",
    command: "addTaskChecklistItemCommand",
    commandSchema: addTaskChecklistItemCommandSchema,
    fields: ADD_TASK_CHECKLIST_ITEM_FIELDS,
    permissions: WRITE_TASKS,
  }),
  set_task_checklist_item_done: taskWorkEntry({
    actionType: "set_task_checklist_item_done",
    command: "setTaskChecklistItemDoneCommand",
    commandSchema: setTaskChecklistItemDoneCommandSchema,
    fields: SET_TASK_CHECKLIST_ITEM_DONE_FIELDS,
    permissions: WRITE_TASKS,
  }),
  log_task_time: taskWorkEntry({
    actionType: "log_task_time",
    command: "logTaskTimeCommand",
    commandSchema: logTaskTimeCommandSchema,
    fields: LOG_TASK_TIME_FIELDS,
    permissions: WRITE_TASKS,
  }),
  give_field_task: managerEntry({
    actionType: "give_field_task",
    command: "giveFieldTaskCommand",
    commandSchema: giveFieldTaskCommandSchema,
    fields: GIVE_FIELD_TASK_FIELDS,
    permissions: WRITE_ROUTE_FIELD,
    resultEntityType: "mtm_task",
    risk: "standard",
  }),
  send_field_message: managerEntry({
    actionType: "send_field_message",
    command: "sendFieldMessageCommand",
    commandSchema: sendFieldMessageCommandSchema,
    fields: SEND_FIELD_MESSAGE_FIELDS,
    permissions: WRITE_MTM,
    resultEntityType: "mtm_message",
    risk: "standard",
  }),
  // Решение о чужом рабочем времени и деньгах (отпуск, больничный): короткий
  // срок квитанции, как у правок записей.
  decide_attendance_request: managerEntry({
    actionType: "decide_attendance_request",
    command: "decideAttendanceRequestCommand",
    commandSchema: decideAttendanceRequestCommandSchema,
    fields: DECIDE_ATTENDANCE_REQUEST_FIELDS,
    permissions: WRITE_PERSONNEL,
    resultEntityType: "mtm_attendance_request",
    risk: "sensitive",
  }),
  publish_field_route: managerEntry({
    actionType: "publish_field_route",
    command: "publishFieldRouteCommand",
    commandSchema: publishFieldRouteCommandSchema,
    fields: PUBLISH_FIELD_ROUTE_FIELDS,
    permissions: WRITE_ROUTE_FIELD,
    resultEntityType: "mtm_route",
    risk: "standard",
  }),
  assign_field_contact: managerEntry({
    actionType: "assign_field_contact",
    command: "assignFieldContactCommand",
    commandSchema: assignFieldContactCommandSchema,
    fields: ASSIGN_FIELD_CONTACT_FIELDS,
    permissions: WRITE_ROUTE_FIELD,
    resultEntityType: "mtm_contact",
    risk: "standard",
  }),
  create_contact: {
    actionType: "create_contact",
    command: "createContactCommand",
    commandSchema: createContactCommandSchema,
    allowedFields: CREATE_CONTACT_FIELDS,
    permissions: WRITE_CONTACTS,
    fieldPermissionEntity: "contact",
    fieldPermissionNames: (payload) => ownPayloadFields(payload),
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: null,
    operation: "create",
    resultEntityType: "contact",
    previewFields: CREATE_CONTACT_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "create_contact",
      operation: "create",
      entityType: "contact",
      previewFields: CREATE_CONTACT_FIELDS,
    }),
  },
  update_contact: {
    actionType: "update_contact",
    command: "updateContactCommand",
    commandSchema: updateContactCommandSchema.strict(),
    allowedFields: UPDATE_CONTACT_FIELDS,
    permissions: WRITE_CONTACTS,
    fieldPermissionEntity: "contact",
    fieldPermissionNames: (payload) => ownPayloadFields(payload, ["expectedUpdatedAt"]),
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: CONTACT_TARGET,
    operation: "update",
    resultEntityType: "contact",
    previewFields: CREATE_CONTACT_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "update_contact",
      operation: "update",
      entityType: "contact",
      previewFields: CREATE_CONTACT_FIELDS,
    }),
  },
  log_contact_activity: activityEntry({ actionType: "log_contact_activity", target: "contact", permissions: WRITE_CONTACTS }),
  log_company_activity: activityEntry({ actionType: "log_company_activity", target: "company", permissions: WRITE_COMPANIES }),
  log_deal_activity: activityEntry({ actionType: "log_deal_activity", target: "deal", permissions: WRITE_DEALS }),
  log_lead_activity: activityEntry({ actionType: "log_lead_activity", target: "lead", permissions: WRITE_LEADS }),
  create_ticket: {
    actionType: "create_ticket",
    command: "createTicketCommand",
    commandSchema: voiceTicketSchemas.create,
    allowedFields: CREATE_TICKET_FIELDS,
    permissions: WRITE_TICKETS,
    fieldPermissionEntity: "ticket",
    fieldPermissionNames: (payload) => ownPayloadFields(payload),
    risk: "standard",
    ttlMs: STANDARD_TTL_MS,
    dedupePolicy: "idempotency_key",
    target: null,
    operation: "create",
    resultEntityType: "ticket",
    previewFields: CREATE_TICKET_FIELDS,
    renderPreview: createPreviewRenderer({
      actionType: "create_ticket",
      operation: "create",
      entityType: "ticket",
      previewFields: CREATE_TICKET_FIELDS,
    }),
  },
  add_ticket_note: ticketCommentEntry("add_ticket_note"),
  // Уходит клиенту (в WhatsApp, если тикет оттуда): короткий срок квитанции.
  reply_to_ticket: ticketCommentEntry("reply_to_ticket"),
  update_ticket: {
    actionType: "update_ticket",
    command: "updateTicketCommand",
    commandSchema: voiceTicketSchemas.update,
    allowedFields: UPDATE_TICKET_FIELDS,
    permissions: WRITE_TICKETS,
    fieldPermissionEntity: "ticket",
    fieldPermissionNames: (payload) => ownPayloadFields(payload, ["expectedUpdatedAt"]),
    risk: "sensitive",
    ttlMs: SENSITIVE_TTL_MS,
    dedupePolicy: "target_revision",
    target: TICKET_TARGET,
    operation: "update",
    resultEntityType: "ticket",
    previewFields: UPDATE_TICKET_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    renderPreview: createPreviewRenderer({
      actionType: "update_ticket",
      operation: "update",
      entityType: "ticket",
      previewFields: UPDATE_TICKET_FIELDS.filter((field) => field !== "expectedUpdatedAt"),
    }),
  },
  update_phone_order_line: phoneOrderEntry({
    actionType: "update_phone_order_line",
    commandSchema: voicePhoneOrderSchemas.updateLine,
    fields: UPDATE_PHONE_ORDER_LINE_FIELDS,
    risk: "standard",
  }),
  add_phone_order_line: phoneOrderEntry({
    actionType: "add_phone_order_line",
    commandSchema: voicePhoneOrderSchemas.addLine,
    fields: ADD_PHONE_ORDER_LINE_FIELDS,
    risk: "standard",
  }),
  remove_phone_order_line: phoneOrderEntry({
    actionType: "remove_phone_order_line",
    commandSchema: voicePhoneOrderSchemas.removeLine,
    fields: REMOVE_PHONE_ORDER_LINE_FIELDS,
    risk: "standard",
  }),
  confirm_phone_order: phoneOrderEntry({
    actionType: "confirm_phone_order",
    commandSchema: voicePhoneOrderSchemas.confirm,
    fields: CONFIRM_PHONE_ORDER_FIELDS,
    risk: "sensitive",
  }),
  reject_phone_order: phoneOrderEntry({
    actionType: "reject_phone_order",
    commandSchema: voicePhoneOrderSchemas.reject,
    fields: REJECT_PHONE_ORDER_FIELDS,
    risk: "sensitive",
  }),
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
