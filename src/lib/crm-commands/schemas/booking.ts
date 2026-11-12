import { z } from "zod"

/**
 * Вход трёх голосовых действий над бронью — только zod, без базы.
 *
 * Отдельный файл, потому что реестр действий импортируется БРАУЗЕРОМ (через
 * контракт инструментов голосовой консоли): положи схемы рядом с командой, и
 * в клиентскую сборку уехал бы `@/lib/prisma` — на этом здесь уже ломали
 * `next build` (см. комментарий к VOICE_READABLE_TYPES в record-types.ts).
 *
 * `expectedVersion` кладёт сервер, а не модель: команда брони сверяет им
 * чужую правку. Имя служебное и в квитанции не показывается.
 */
/**
 * Необязательное здесь и обязательное при исполнении: схему проходит и
 * полезная нагрузка модели (где версии нет вовсе — она её не знает), а версию
 * кладёт сервер при подготовке квитанции. Что без неё ничего не исполнится,
 * держит `runVoiceBookingCommand`.
 */
const expectedVersion = z.number().int().nonnegative().optional()
/** Версия записи словами времени: её кладёт сервер при подготовке квитанции. */
const expectedUpdatedAt = z.string().min(1).max(40)

export const voiceBookingSchemas = {
  cancel: z.strictObject({
    expectedVersion,
    expectedUpdatedAt: expectedUpdatedAt.optional(),
    /** Причина уходит в журнал брони; клиенту сообщается сам факт отмены. */
    reason: z.string().trim().max(500).optional(),
    /** «Не сообщай клиенту» — осознанная тишина, а не значение по умолчанию. */
    notifyCustomer: z.boolean().optional(),
  }),
  outcome: z.strictObject({
    expectedVersion,
    expectedUpdatedAt: expectedUpdatedAt.optional(),
    outcome: z.enum(["completed", "no_show"]),
    note: z.string().trim().max(2000).optional(),
    /**
     * Исправление уже закрытой записи команда требует объяснить, и разрешено
     * оно только администратору или координатору с правом вести мастера.
     */
    reason: z.string().trim().max(500).optional(),
  }),
  deposit: z.strictObject({
    expectedVersion,
    expectedUpdatedAt: expectedUpdatedAt.optional(),
    deposit: z.enum(["paid", "refunded"]),
  }),
} as const
