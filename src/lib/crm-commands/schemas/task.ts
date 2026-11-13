import { z } from "zod"
import { MAX_DESCRIPTION_HTML, MAX_DESCRIPTION_TEXT } from "@/lib/tasks/rich-description"

export const createTaskCommandSchema = z.strictObject({
  // CRM tasks share this route and accept short titles; board UI applies 3..200.
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.enum([
    "backlog", "todo", "in_progress", "testing", "review", "done",
    "pending", "completed", "cancelled",
  ]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent", "critical"]).optional(),
  type: z.string().max(60).optional(),
  eventType: z.string().max(60).nullable().optional(),
  category: z.enum(["Q1", "Q2", "Q3", "Q4", "yearly", "normal"]).nullable().optional(),
  dueDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid dueDate").optional(),
  assignedTo: z.string().min(1).optional(),
  divisionId: z.string().min(1).nullable().optional(),
  estimatedHours: z.number().min(0).max(1000).nullable().optional(),
  estimatedPrice: z.number().min(0).max(100_000_000).nullable().optional(),
  relatedType: z.enum(["company", "contact", "deal", "lead", "ticket"]).optional(),
  relatedId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  recurrenceEndAt: z.string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid recurrenceEndAt")
    .nullable()
    .optional(),
  recurrenceCount: z.number().int().min(0).max(10_000).nullable().optional(),
  customFields: z.record(z.string(), z.json()).optional(),
  collaboratorIds: z.array(z.string().min(1)).max(20).optional(),
}).superRefine((data, context) => {
  if (Boolean(data.relatedType) !== Boolean(data.relatedId)) {
    context.addIssue({
      code: "custom",
      path: data.relatedType ? ["relatedId"] : ["relatedType"],
      message: "relatedType and relatedId must be provided together",
    })
  }
})

export type CreateTaskCommandInput = z.infer<typeof createTaskCommandSchema>

/**
 * A partial task update — the PATCH /api/v1/tasks/:id contract, moved here so
 * the REST route and a voice receipt run the same command (roadmap C1.13).
 * `expectedUpdatedAt` is the optimistic lock a reviewed voice draft carries.
 */
export const updateTaskCommandSchema = z.object({
  title:        z.string().min(1).max(300).optional(),
  // 5 000 refused an edit of the longer descriptions that came from Bordio (Zeytun has five, up to ~9 000).
  description:  z.string().max(MAX_DESCRIPTION_TEXT).optional(),
  // The description with its formatting (rich-description.ts). The command cleans it and derives
  // `description` from it; null drops the formatting and keeps the text.
  descriptionHtml: z.string().max(MAX_DESCRIPTION_HTML).nullable().optional(),
  status:       z.enum(["backlog", "todo", "in_progress", "testing", "review", "done", "pending", "completed", "cancelled"]).optional(),
  priority:     z.enum(["low", "medium", "high", "urgent", "critical"]).optional(),
  // type validated dynamically against the org's active TaskType.name (see
  // isValidTaskType) — no longer a frozen enum (Bordio configurable types).
  type:         z.string().max(60).optional(),
  // eventType: configurable channel/source axis; validated via isValidEventType.
  eventType:    z.string().max(60).nullable().optional(),
  category:     z.enum(["Q1", "Q2", "Q3", "Q4", "yearly", "normal"]).nullable().optional(),
  estimatedHours: z.number().min(0).max(1000).nullable().optional(),
  estimatedPrice: z.number().min(0).max(100_000_000).nullable().optional(),
  dueDate:      z.string().nullable().optional(),
  assignedTo:   z.string().nullable().optional(),
  relatedType:  z.enum(["company", "contact", "deal", "lead", "ticket"]).nullable().optional(),
  relatedId:    z.string().nullable().optional(),
  projectId:    z.string().nullable().optional(),
  // Recurrence — Roadmap #22. Validated via the parser to keep the wire
  // contract symmetric with the lib. Rule is null to clear; string is
  // checked at run time against parseRecurrenceRule in the command.
  recurrenceRule:  z.string().nullable().optional(),
  recurrenceEndAt: z.string().nullable().optional(),
  recurrenceCount: z.number().int().min(0).max(10_000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  // Board move co-write: which BoardColumn lane the task now sits in. Validated
  // against the task's own board; null clears it. status stays canonical
  // and a move sends status = the target column's mapsToStatus alongside this.
  boardColumnKey: z.string().max(64).nullable().optional(),
  boardPosition: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  // Another board for the task (Xayala, 2026-11-12: «bu task dijitala aiddir ama
  // traditional yazilib… dijitala deyişə bilmirəm»). A board the caller sees.
  divisionId:   z.string().min(1).optional(),
  // Co-assignees (replace-set; [] clears). Primary stays assignedTo; ids must
  // be org members (validated in the command); the primary is filtered out.
  collaboratorIds: z.array(z.string()).max(20).optional(),
  // Bordio-style card (2026-11-07): when work starts, who set the task (apart
  // from its author), free tags.
  startDate:    z.string().nullable().optional(),
  reporterId:   z.string().nullable().optional(),
  tags:         z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export type UpdateTaskCommandInput = z.infer<typeof updateTaskCommandSchema>

/*
 * Работа ВНУТРИ задачи — сообщение, подзадача, отметка подзадачи, время.
 *
 * Владелец 2026-11-08: «всё, что работник и начальник делают руками в CRM,
 * должно делаться через голосового помощника». В Zeytun за 60 дней руками
 * написано больше тысячи сообщений в задачах и сотни подзадач — это самая
 * частая ручная работа в CRM. Схемы — те же, что у экрана
 * (`/api/v1/tasks/[id]/comments|checklist|time`): экран и голос зовут одну
 * команду, поэтому права, журнал задачи и уведомления у них не расходятся.
 */
const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")

export const addTaskCommentCommandSchema = z.strictObject({
  content: z.string().trim().min(1).max(5000),
  // Люди, отмеченные @ в сообщении (ids, выбраны в поле ввода экрана).
  mentions: z.array(z.string().min(1).max(64)).max(20).optional(),
})
export type AddTaskCommentCommandInput = z.infer<typeof addTaskCommentCommandSchema>

export const addTaskChecklistItemCommandSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().optional(),
  assignedTo: z.string().min(1).max(64).nullable().optional(),
  dueDate: isoDateString.nullable().optional(),
})
export type AddTaskChecklistItemCommandInput = z.infer<typeof addTaskChecklistItemCommandSchema>

export const setTaskChecklistItemDoneCommandSchema = z.strictObject({
  checklistItemId: z.string().min(1).max(64),
  completed: z.boolean(),
})
export type SetTaskChecklistItemDoneCommandInput = z.infer<typeof setTaskChecklistItemDoneCommandSchema>

export const logTaskTimeCommandSchema = z.strictObject({
  minutes: z.number().int().min(1).max(24 * 60),
  date: isoDateString.optional(),
  note: z.string().trim().max(500).optional(),
})
export type LogTaskTimeCommandInput = z.infer<typeof logTaskTimeCommandSchema>
