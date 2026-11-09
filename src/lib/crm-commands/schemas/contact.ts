import { z } from "zod"
import { CONTACT_LIFECYCLE_STAGES } from "@/lib/contact-lifecycle"

/**
 * Контакт — человек у клиента. Схемы те же, что принимал экран
 * (`/api/v1/contacts`, `/api/v1/contacts/[id]`), перенесены сюда без
 * изменения границ, чтобы экран и голос (этап 3, владелец 2026-11-09)
 * проверяли одно и то же.
 */

const contactLifecycleStageSchema = z.enum(CONTACT_LIFECYCLE_STAGES)

export const createContactCommandSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  position: z.string().max(200).optional(),
  // D8 Loyalty birthday trigger — "" / absent → undefined; "1990-05-15" → Date.
  dateOfBirth: z
    .preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date())
    .optional(),
  companyId: z.string().optional(),
  source: z.string().max(50).optional(),
  brand: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  lifecycleStage: contactLifecycleStageSchema.optional(),
  tags: z.array(z.string()).optional(),
  preferredLanguage: z.enum(["ru", "en", "az"]).nullable().optional(),
})

export type CreateContactCommandInput = z.infer<typeof createContactCommandSchema>

export const updateContactCommandSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  phone: z.string().max(50).nullable().optional(),
  phones: z.array(z.string().max(50)).optional(),
  position: z.string().max(200).nullable().optional(),
  // D8 Loyalty birthday trigger. .optional() is OUTERMOST so an ABSENT key
  // short-circuits before preprocess (never clears the column); "" → null
  // (clear); "1990-05-15" → Date.
  dateOfBirth: z
    .preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable())
    .optional(),
  companyId: z.string().nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  lifecycleStage: contactLifecycleStageSchema.optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  portalAccessEnabled: z.boolean().optional(),
  preferredLanguage: z.enum(["ru", "en", "az"]).nullable().optional(),
  /**
   * Версия, которую видел подтверждающий. Голос обязан её передать: правка,
   * пришедшая поверх чужой, — отказ, а не тихая перезапись. Экран не передаёт
   * (как и раньше).
   */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export type UpdateContactCommandInput = z.infer<typeof updateContactCommandSchema>

/** Что голос может записать в контакт: то, что говорят вслух. */
export const VOICE_CONTACT_FIELDS = ["fullName", "email", "phone", "position", "companyId"] as const
