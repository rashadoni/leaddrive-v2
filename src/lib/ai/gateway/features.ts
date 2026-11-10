/**
 * Every place the CRM spends money on AI, as the spend report names it. A
 * gateway call must say which one it is; the report groups `ai_usage` by
 * these ids, by provider and by agent.
 *
 * Pure data: the settings page imports this file directly (not the gateway
 * index, which reaches the database), so the labels live here, in the three
 * languages of the CRM, next to the id they name.
 */
type Label = { ru: string; az: string; en: string }

export const AI_FEATURES = {
  "davinci-chat": { ru: "Da Vinci — чат", az: "Da Vinci — çat", en: "Da Vinci — chat" },
  "ai-actions": { ru: "ИИ-действия (тексты, задачи, тональность)", az: "AI əməliyyatları (mətnlər, tapşırıqlar, ton)", en: "AI actions (texts, tasks, sentiment)" },
  "inbox-reply": { ru: "Переписка — ответы ИИ", az: "Yazışma — AI cavabları", en: "Inbox — AI replies" },
  "inbox-assist": { ru: "Переписка — подсказки оператору", az: "Yazışma — operatora təkliflər", en: "Inbox — operator suggestions" },
  "inbox-lead-qualification": { ru: "Переписка — квалификация лидов", az: "Yazışma — lidlərin kvalifikasiyası", en: "Inbox — lead qualification" },
  "inbox-customer-stage": { ru: "Переписка — стадия клиента", az: "Yazışma — müştəri mərhələsi", en: "Inbox — customer stage" },
  "inbox-reply-score": { ru: "Переписка — оценка ответа", az: "Yazışma — cavabın qiymətləndirilməsi", en: "Inbox — reply scoring" },
  "whatsapp-reply": { ru: "WhatsApp — ответы ИИ", az: "WhatsApp — AI cavabları", en: "WhatsApp — AI replies" },
  "web-chat": { ru: "Чат на сайте", az: "Saytda çat", en: "Website chat" },
  "portal-chat": { ru: "Портал клиента — чат", az: "Müştəri portalı — çat", en: "Customer portal — chat" },
  "booking-agent": { ru: "Встречи — агент WhatsApp", az: "Görüşlər — WhatsApp agenti", en: "Bookings — WhatsApp agent" },
  "telegram-staff": { ru: "Telegram-бот сотрудников", az: "Əməkdaşların Telegram botu", en: "Staff Telegram bot" },
  "demo-assistant": { ru: "Демо — ассистент", az: "Demo — assistent", en: "Demo — assistant" },
  "tickets": { ru: "Тикеты", az: "Tiketlər", en: "Tickets" },
  "complaints": { ru: "Жалобы", az: "Şikayətlər", en: "Complaints" },
  "deals": { ru: "Сделки — анализ и подсказки", az: "Sövdələşmələr — təhlil və təkliflər", en: "Deals — analysis and tips" },
  "contracts": { ru: "Договоры", az: "Müqavilələr", en: "Contracts" },
  "reports": { ru: "Отчёты и аналитика", az: "Hesabatlar və analitika", en: "Reports and analytics" },
  "lead-scoring": { ru: "Оценка лидов", az: "Lidlərin qiymətləndirilməsi", en: "Lead scoring" },
  "email-analysis": { ru: "Анализ писем", az: "Məktubların təhlili", en: "Email analysis" },
  "cost-model": { ru: "Модель затрат", az: "Xərc modeli", en: "Cost model" },
  "products": { ru: "Товары — заполнение", az: "Məhsullar — doldurma", en: "Products — autofill" },
  "booking-pages": { ru: "Встречи — описание страницы", az: "Görüşlər — səhifə təsviri", en: "Bookings — page description" },
  "meeting-recap": { ru: "Итоги встреч", az: "Görüşlərin yekunları", en: "Meeting recaps" },
  "daily-briefing": { ru: "Утренняя сводка", az: "Səhər icmalı", en: "Morning briefing" },
  "automation": { ru: "Автоматизации ИИ", az: "AI avtomatlaşdırmaları", en: "AI automations" },
  "renewal": { ru: "Продления", az: "Yeniləmələr", en: "Renewals" },
  "social": { ru: "Соцмониторинг", az: "Sosial monitorinq", en: "Social monitoring" },
  "agent-test": { ru: "Проверка ИИ-агента", az: "AI agentinin yoxlanışı", en: "AI agent test" },
  "embeddings": { ru: "Поиск по смыслу", az: "Mənaya görə axtarış", en: "Semantic search" },
} as const satisfies Record<string, Label>

export type AiFeature = keyof typeof AI_FEATURES

/** The providers an organization can bring its own key for. */
export const AI_PROVIDERS = ["anthropic", "gemini", "openai", "voyage", "google_vision", "google_speech"] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

/**
 * Providers whose own key the organization can enter today: those whose every
 * call goes through the gateway. The others still run on the platform's key
 * (plan, stage 3), so a key entered for them would be stored and never used.
 */
export const SELF_KEY_PROVIDERS = ["anthropic"] as const satisfies readonly AiProvider[]

export function isSelfKeyProvider(provider: string): provider is (typeof SELF_KEY_PROVIDERS)[number] {
  return (SELF_KEY_PROVIDERS as readonly string[]).includes(provider)
}

function lang(locale?: string | null): keyof Label {
  return locale === "az" || locale === "en" ? locale : "ru"
}

/** The feature's name in the person's language; an unknown id reads as itself. */
export function aiFeatureLabel(feature: string, locale?: string | null): string {
  const label = (AI_FEATURES as Record<string, Label>)[feature]
  return label ? label[lang(locale)] : feature
}
