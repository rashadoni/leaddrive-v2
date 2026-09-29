import { z } from "zod"

const requiredValue = z.string().trim().min(1)

export const macroActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_status"), value: z.enum(["new", "in_progress", "waiting", "resolved", "closed"]) }).strict(),
  z.object({ type: z.literal("set_priority"), value: z.enum(["low", "medium", "high", "critical"]) }).strict(),
  z.object({ type: z.literal("set_assignee"), value: requiredValue.max(200) }).strict(),
  z.object({ type: z.literal("add_comment"), value: requiredValue.max(5_000) }).strict(),
  z.object({ type: z.literal("add_internal_note"), value: requiredValue.max(5_000) }).strict(),
  z.object({ type: z.literal("add_tag"), value: requiredValue.max(100) }).strict(),
  z.object({ type: z.literal("remove_tag"), value: requiredValue.max(100) }).strict(),
])

export const macroActionsSchema = z.array(macroActionSchema).min(1).max(25)
