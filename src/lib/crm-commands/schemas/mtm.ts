import { z } from "zod"

/*
 * Действия начальника в «Маршрутах и поле» (manager-actions.ts) — только
 * схемы, без базы и рассылок: их читает и реестр голосовых действий.
 */

export const giveFieldTaskCommandSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  /** Мгновение срока (правило «дня» — task-quick-due.ts) или null: без срока. */
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
})

export const sendFieldMessageCommandSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(128),
  body: z.string().trim().min(1).max(4000),
})

export const decideAttendanceRequestCommandSchema = z.strictObject({
  attendanceRequestId: z.string().uuid(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).nullable().optional(),
  /** Версия заявки, которую человек видел; без неё — текущая. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})
