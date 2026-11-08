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

/** Опубликовать черновик маршрута (этап 2б). Версию сервер кладёт сам. */
export const publishFieldRouteCommandSchema = z.strictObject({
  routeId: z.string().trim().min(1).max(128),
  /** Версия, которую видел человек; после ручной правки квитанции — текущая. */
  expectedVersion: z.number().int().positive().optional(),
  /** Только когда начальник сознательно публикует маршрут с конфликтом. */
  overrideReason: z.string().trim().min(3).max(1000).optional(),
})

/** Привязать клиента поля к сотруднику (этап 2б). */
export const assignFieldContactCommandSchema = z.strictObject({
  fieldContactId: z.string().trim().min(1).max(128),
  agentId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(3).max(500).optional(),
  /** Отпечаток предпросмотра, который видел человек; без него — текущий. */
  previewToken: z.string().length(64).optional(),
})
