import { z } from "zod"

export const AttendancePhoneMatchInput = z.object({
  phone: z.string().transform(value => value.replace(/[\s\-()]/g, "")).pipe(z.string().regex(/^\+[1-9]\d{6,14}$/)),
}).strict()

export const AttendancePhoneMatchResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("ambiguous") }),
  z.object({ kind: z.literal("other"), name: z.string().max(200) }),
  z.object({ kind: z.literal("attendance"), agentId: z.string().min(1).max(191), name: z.string().max(200), enrolled: z.boolean() }),
])
export type AttendancePhoneMatch = z.infer<typeof AttendancePhoneMatchResult>
