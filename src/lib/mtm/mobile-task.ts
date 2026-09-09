import { z } from "zod"
import { nextMtmTaskRecurrenceOccurrence } from "./task-recurrence"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"

export const MOBILE_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"] as const
export const MOBILE_TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const
export const MOBILE_TASK_RECURRENCE = ["DAILY", "WEEKLY", "MONTHLY"] as const

export type MobileTaskStatus = typeof MOBILE_TASK_STATUSES[number]
export type MobileTaskPriority = typeof MOBILE_TASK_PRIORITIES[number]
export type MobileTaskRecurrenceRule = typeof MOBILE_TASK_RECURRENCE[number]

const entityId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/)
const nullableIsoDate = z.string().datetime({ offset: true }).nullable()

const recurrence = z.object({
  rule: z.enum(MOBILE_TASK_RECURRENCE),
  interval: z.number().int().min(1).max(30).default(1),
  until: nullableIsoDate.optional(),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, "Invalid recurrence timezone").optional(),
})

export const MobileTaskCreateSchema = z.object({
  id: entityId,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable().optional(),
  customerId: entityId.nullable().optional(),
  visitId: entityId.nullable().optional(),
  priority: z.enum(MOBILE_TASK_PRIORITIES).default("MEDIUM"),
  scheduledStartAt: nullableIsoDate.optional(),
  dueDate: nullableIsoDate.optional(),
  copiedFromId: entityId.nullable().optional(),
  recurrence: recurrence.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.copiedFromId && value.recurrence) {
    ctx.addIssue({ code: "custom", path: ["recurrence"], message: "A duplicated task must be one-off" })
  }
  if (value.recurrence && !value.scheduledStartAt && !value.dueDate) {
    ctx.addIssue({ code: "custom", path: ["dueDate"], message: "A recurring task requires a scheduled start or due date" })
  }
  if (value.scheduledStartAt && value.dueDate && new Date(value.scheduledStartAt) > new Date(value.dueDate)) {
    ctx.addIssue({ code: "custom", path: ["dueDate"], message: "dueDate must not precede scheduledStartAt" })
  }
  const recurrenceIdentity = value.dueDate ?? value.scheduledStartAt
  if (value.recurrence?.until && recurrenceIdentity && value.recurrence.timezone) {
    const timezone = value.recurrence.timezone
    if (
      dateInputValueInTimezone(value.recurrence.until, timezone)
      < dateInputValueInTimezone(recurrenceIdentity, timezone)
    ) {
      ctx.addIssue({ code: "custom", path: ["recurrence", "until"], message: "Recurrence end must not be before the due date" })
    }
  }
})

export const MobileTaskUpdateSchema = z.object({
  id: entityId,
  expectedVersion: z.number().int().min(1).optional(),
  status: z.enum(MOBILE_TASK_STATUSES).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  priority: z.enum(MOBILE_TASK_PRIORITIES).optional(),
  dueDate: nullableIsoDate.optional(),
  result: z.string().trim().max(5_000).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  acceptedAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, ctx) => {
  if (value.status === "OVERDUE") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Overdue status is computed by the server" })
  }
  const mutationKeys: Array<keyof typeof value> = [
    "status",
    "title",
    "description",
    "priority",
    "dueDate",
    "result",
    "progress",
    "acceptedAt",
  ]
  if (!mutationKeys.some((key) => value[key] !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Task update has no changes" })
  }
})

export const MobileTaskEventSchema = z.object({
  taskId: entityId,
  type: z.enum(["COMMENTED", "EVIDENCE_ADDED"]),
  occurredAt: z.string().datetime({ offset: true }),
  comment: z.string().trim().min(1).max(2_000).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
}).superRefine((value, ctx) => {
  if (new Date(value.occurredAt).getTime() > Date.now() + 5 * 60 * 1_000) {
    ctx.addIssue({ code: "custom", path: ["occurredAt"], message: "Task event time is too far in the future" })
  }
  if (value.type === "COMMENTED" && !value.comment) {
    ctx.addIssue({ code: "custom", path: ["comment"], message: "A task comment is required" })
  }
  if (value.type === "EVIDENCE_ADDED" && !value.evidence) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "Task evidence is required" })
  }
  if (value.evidence && JSON.stringify(value.evidence).length > 25_000) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "Task evidence metadata is too large" })
  }
})

export type MobileTaskCreateInput = z.infer<typeof MobileTaskCreateSchema>
export type MobileTaskUpdateInput = z.infer<typeof MobileTaskUpdateSchema>
export type MobileTaskEventInput = z.infer<typeof MobileTaskEventSchema>

export function parseMobileTaskCreate(value: unknown): { input: MobileTaskCreateInput | null; error: string | null } {
  const parsed = MobileTaskCreateSchema.safeParse(value)
  return parsed.success
    ? { input: parsed.data, error: null }
    : { input: null, error: parsed.error.issues[0]?.message ?? "Invalid task create payload" }
}

export function parseMobileTaskUpdate(value: unknown): { input: MobileTaskUpdateInput | null; error: string | null } {
  const parsed = MobileTaskUpdateSchema.safeParse(value)
  return parsed.success
    ? { input: parsed.data, error: null }
    : { input: null, error: parsed.error.issues[0]?.message ?? "Invalid task update payload" }
}

export function parseMobileTaskEvent(value: unknown): { input: MobileTaskEventInput | null; error: string | null } {
  const parsed = MobileTaskEventSchema.safeParse(value)
  return parsed.success
    ? { input: parsed.data, error: null }
    : { input: null, error: parsed.error.issues[0]?.message ?? "Invalid task event payload" }
}

const TRANSITIONS: Record<MobileTaskStatus, ReadonlySet<MobileTaskStatus>> = {
  PENDING: new Set(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  IN_PROGRESS: new Set(["PENDING", "COMPLETED", "CANCELLED"]),
  OVERDUE: new Set(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
}

export function canApplyMobileTaskTransition(from: MobileTaskStatus, to: MobileTaskStatus): boolean {
  return from === to || TRANSITIONS[from].has(to)
}

export function taskEventTypeForUpdate(input: MobileTaskUpdateInput, current: {
  status: MobileTaskStatus
  dueDate: Date | null
  acceptedAt: Date | null
}): "ACCEPTED" | "STARTED" | "COMPLETED" | "RESCHEDULED" | "CANCELLED" | "EDITED" {
  if (input.status === "IN_PROGRESS" && current.status !== "IN_PROGRESS") return "STARTED"
  if (input.status === "COMPLETED" && current.status !== "COMPLETED") return "COMPLETED"
  if (input.status === "CANCELLED" && current.status !== "CANCELLED") return "CANCELLED"
  if (input.acceptedAt && !current.acceptedAt) return "ACCEPTED"
  if (input.dueDate !== undefined) {
    const before = current.dueDate?.getTime() ?? null
    const after = input.dueDate ? new Date(input.dueDate).getTime() : null
    if (before !== after) return "RESCHEDULED"
  }
  return "EDITED"
}

export function nextRecurrenceDueDate(
  dueDate: Date,
  rule: MobileTaskRecurrenceRule,
  interval: number,
  recurrenceTimezone = "UTC",
  anchorDueDate: Date = dueDate,
): Date {
  const occurrence = nextMtmTaskRecurrenceOccurrence({
    scheduledStartAt: null,
    dueDate,
    recurrenceRule: rule,
    recurrenceInterval: interval,
    recurrenceUntil: null,
    recurrenceTimezone,
  }, {
    scheduledStartAt: null,
    dueDate: anchorDueDate,
  })
  if (!occurrence?.dueDate) {
    throw new RangeError("Unable to expand recurrence due date")
  }
  return occurrence.dueDate
}
