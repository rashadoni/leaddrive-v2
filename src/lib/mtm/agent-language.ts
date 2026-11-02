/**
 * The language text written FOR an agent goes out in (owner, 2026-10-31: «Да,
 * сделай» — an agent whose app is in Russian got the office's reminder and his
 * task notices in Azerbaijani, because the server knew only the CRM login's
 * language, and most agents have no CRM login at all).
 *
 * The phone app reports the language it shows (PUT /api/v1/mtm/mobile/language,
 * `MtmAgent.appLanguage`); that comes first. Then the CRM login's
 * `preferredLanguage`. Then each caller's own fallback, as before. A new
 * notice for an agent selects both fields and asks this, not the user alone.
 */
export const MTM_APP_LANGUAGES = ["az", "ru", "en"] as const
export type MtmAppLanguage = (typeof MTM_APP_LANGUAGES)[number]

/** One of the app's three languages, from what the app sends («ru», «ru-RU»…), or null. */
export function mtmAppLanguage(value: unknown): MtmAppLanguage | null {
  if (typeof value !== "string") return null
  const code = value.trim().toLowerCase().split(/[-_]/)[0]
  return (MTM_APP_LANGUAGES as readonly string[]).includes(code) ? code as MtmAppLanguage : null
}

/** Select both, wherever an agent's language is read. */
export const AGENT_LANGUAGE_SELECT = { appLanguage: true, user: { select: { preferredLanguage: true } } } as const

export function agentLanguage(
  agent: { appLanguage?: string | null; user?: { preferredLanguage?: string | null } | null } | null | undefined,
): string | null {
  return mtmAppLanguage(agent?.appLanguage) ?? agent?.user?.preferredLanguage ?? null
}
