import { z } from "zod"

/** Renaming a department or a section (attendance-unit-rename.ts); the same limit as typing a new one on a card. */
export const ATTENDANCE_UNIT_NAME_MAX = 120
export const AttendanceUnitRenameSchema = z.object({
  kind: z.enum(["DEPARTMENT", "SECTION"]),
  id: z.string().trim().min(1).max(191),
  name: z.string().trim().min(1).max(ATTENDANCE_UNIT_NAME_MAX),
}).strict()
export type AttendanceUnitRename = z.infer<typeof AttendanceUnitRenameSchema>
