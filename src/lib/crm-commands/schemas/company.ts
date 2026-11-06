import { z } from "zod"

/**
 * Поля компании, которые можно создать одной командой.
 *
 * Это ПОДМНОЖЕСТВО того, что принимает экран (`/api/v1/companies`), и границы
 * здесь те же, что там: имя обязательно и не длиннее 200, сайт — настоящий
 * URL, почта — настоящая почта. Чего здесь намеренно нет:
 *
 *  - `status`, `category`, `leadStatus` — у них в базе свои значения по
 *    умолчанию, и произнесённое слово («клиент», «партнёр») — не то же, что
 *    хранимое значение; закрытые словари не диктуются голосом;
 *  - `voen`, `director`, `creditLimit`, `slaPolicyId` — налоговый номер,
 *    законный представитель и кредитный лимит проверяются и заводятся на
 *    экране компании, где рядом видно предупреждение о дубле ВÖEN;
 *  - `managerId` — это ссылка на человека, а ссылки сервер находит сам по
 *    имени; голосом она пока не передаётся.
 */
export const createCompanyCommandSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(100).optional(),
  website: z.string().trim().url().max(1000).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  description: z.string().trim().max(5000).optional(),
})

export type CreateCompanyCommandInput = z.infer<typeof createCompanyCommandSchema>
