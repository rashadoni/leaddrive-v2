import { z } from "zod"

/**
 * Запись в ленте карточки: заметка, звонок, письмо, встреча. Схема та же, что
 * принимал экран (`POST /api/v1/activities`).
 */
export const createActivityCommandSchema = z.object({
  type: z.string().min(1),
  subject: z.string().min(1).max(500),
  description: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
  scheduledAt: z.string().optional(),
})

export type CreateActivityCommandInput = z.infer<typeof createActivityCommandSchema>

/** Виды записей, которые голос пишет в карточку. */
export const VOICE_ACTIVITY_TYPES = ["note", "call", "email", "meeting"] as const

/**
 * Что голос кладёт в квитанцию. Карточку (контакт, компанию, сделку, лид)
 * сервер берёт из цели черновика, а не из полезной нагрузки.
 */
export const voiceActivityCommandSchema = z.strictObject({
  type: z.enum(VOICE_ACTIVITY_TYPES),
  subject: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
})
