import { z } from "zod"

/** A break kind's id: built-in ("smoke", "lunch", "personal") or the company's own ("k-…"). */
export const ATTENDANCE_BREAK_KIND_ID = /^[a-z0-9-]{1,40}$/
/** The kind the employee chose for a PAUSE (`attendance-break-kinds.ts`); only PAUSE carries it. */
export const AttendanceBreakInputSchema = z.object({ version: z.literal(1), kindId: z.string().regex(ATTENDANCE_BREAK_KIND_ID) }).strict()
export type AttendanceBreakInput = z.infer<typeof AttendanceBreakInputSchema>
