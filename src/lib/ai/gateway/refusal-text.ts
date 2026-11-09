/**
 * The words for a gateway refusal — no key, or the daily budget used up.
 * Pure, so a browser component can recognise them and show them as they are.
 */
export type AiRefusal = "not_connected" | "budget_exceeded"

const TEXT: Record<AiRefusal, Record<"ru" | "az" | "en", string>> = {
  not_connected: {
    ru: "ИИ не подключён для вашей организации. Администратор может ввести свой ключ в «Настройки → ИИ и расходы».",
    az: "Təşkilatınız üçün süni intellekt qoşulmayıb. Administrator öz açarını «Ayarlar → Sİ və xərclər» bölməsində daxil edə bilər.",
    en: "AI is not connected for your organization. An administrator can enter your own key in Settings → AI & spend.",
  },
  budget_exceeded: {
    ru: "Дневной лимит расходов на ИИ исчерпан. Администратор может поднять его в настройках.",
    az: "Süni intellekt üçün gündəlik xərc limiti bitib. Administrator onu ayarlarda artıra bilər.",
    en: "The daily AI spend limit is used up. An administrator can raise it in settings.",
  },
}

export function aiRefusalText(reason: AiRefusal, locale?: string | null): string {
  const lang = locale === "az" ? "az" : locale === "en" ? "en" : "ru"
  return TEXT[reason][lang]
}

/** Whether a server error is one of these refusals (any language). */
export function isAiRefusalText(message: string): boolean {
  return Object.values(TEXT).some((byLang) => Object.values(byLang).includes(message))
}
