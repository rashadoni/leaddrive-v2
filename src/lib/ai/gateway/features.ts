/**
 * Every place the CRM spends money on AI, as the spend report names it. A
 * gateway call must say which one it is; the report groups `ai_usage` by
 * these ids, by provider and by agent.
 */
export const AI_FEATURES = {
  "davinci-chat": "Da Vinci — чат",
  "ai-actions": "ИИ-действия (тексты, задачи, тональность)",
  "inbox-reply": "Переписка — ответы ИИ",
  "inbox-assist": "Переписка — подсказки оператору",
  "inbox-lead-qualification": "Переписка — квалификация лидов",
  "inbox-customer-stage": "Переписка — стадия клиента",
  "inbox-reply-score": "Переписка — оценка ответа",
  "whatsapp-reply": "WhatsApp — ответы ИИ",
  "web-chat": "Чат на сайте",
  "portal-chat": "Портал клиента — чат",
  "booking-agent": "Встречи — агент WhatsApp",
  "telegram-staff": "Telegram-бот сотрудников",
  "demo-assistant": "Демо — ассистент",
  "tickets": "Тикеты",
  "complaints": "Жалобы",
  "deals": "Сделки — анализ и подсказки",
  "contracts": "Договоры",
  "reports": "Отчёты и аналитика",
  "lead-scoring": "Оценка лидов",
  "email-analysis": "Анализ писем",
  "cost-model": "Модель затрат",
  "products": "Товары — заполнение",
  "booking-pages": "Встречи — описание страницы",
  "meeting-recap": "Итоги встреч",
  "daily-briefing": "Утренняя сводка",
  "automation": "Автоматизации ИИ",
  "renewal": "Продления",
  "social": "Соцмониторинг",
  "agent-test": "Проверка ИИ-агента",
  "embeddings": "Поиск по смыслу",
} as const

export type AiFeature = keyof typeof AI_FEATURES

/** The providers an organization can bring its own key for. */
export const AI_PROVIDERS = ["anthropic", "gemini", "openai", "voyage", "google_vision", "google_speech"] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]
