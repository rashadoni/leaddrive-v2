import { z } from "zod"

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
