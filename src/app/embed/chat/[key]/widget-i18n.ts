// Minimal i18n dictionary for the embeddable widget: every string a visitor sees
// that the organization did not write itself.

export type WidgetLang = "en" | "ru" | "az"

export const WIDGET_TRANSLATIONS: Record<WidgetLang, Record<string, string>> = {
  en: {
    nameOptional: "Your name (optional)",
    emailOptional: "Email (optional)",
    phoneOptional: "Phone (optional)",
    nameRequired: "Your name *",
    emailRequired: "Email *",
    phoneRequired: "Phone *",
    fillRequired: "Please fill in the required fields",
    invalidEmail: "Please enter a valid email",
    startFailed: "Could not start the chat. Please try again.",
    startChat: "Start chat",
    starting: "Starting…",
    typeMessage: "Type a message…",
    attachFile: "Attach file",
    agentTyping: "agent is typing…",
    uploadFailed: "Upload failed",
    defaultTitle: "Support",
    defaultGreeting: "Hi! How can we help?",
  },
  ru: {
    nameOptional: "Ваше имя (необязательно)",
    emailOptional: "Email (необязательно)",
    phoneOptional: "Телефон (необязательно)",
    nameRequired: "Ваше имя *",
    emailRequired: "Email *",
    phoneRequired: "Телефон *",
    fillRequired: "Заполните обязательные поля",
    invalidEmail: "Введите корректный email",
    startFailed: "Не удалось начать чат. Попробуйте ещё раз.",
    startChat: "Начать чат",
    starting: "Запуск…",
    typeMessage: "Введите сообщение…",
    attachFile: "Прикрепить файл",
    agentTyping: "оператор печатает…",
    uploadFailed: "Не удалось загрузить файл",
    defaultTitle: "Поддержка",
    defaultGreeting: "Здравствуйте! Чем можем помочь?",
  },
  az: {
    nameOptional: "Adınız (istəyə bağlı)",
    emailOptional: "Email (istəyə bağlı)",
    phoneOptional: "Telefon (istəyə bağlı)",
    nameRequired: "Adınız *",
    emailRequired: "Email *",
    phoneRequired: "Telefon *",
    fillRequired: "Zəhmət olmasa, vacib xanaları doldurun",
    invalidEmail: "Düzgün email daxil edin",
    startFailed: "Çatı başlatmaq alınmadı. Yenidən cəhd edin.",
    startChat: "Çatı başlat",
    starting: "Başlayır…",
    typeMessage: "Mesajınızı yazın…",
    attachFile: "Fayl əlavə et",
    agentTyping: "operator yazır…",
    uploadFailed: "Yükləmə alınmadı",
    defaultTitle: "Dəstək",
    defaultGreeting: "Salam! Sizə necə kömək edə bilərik?",
  },
}

/**
 * The language the embedding page asked for (`data-lang`), or null when it set none —
 * the widget then speaks the organization's language (embed page, web-chat-visitor-language.ts).
 */
export function chosenWidgetLang(raw: unknown): WidgetLang | null {
  const v = String(raw || "").toLowerCase().slice(0, 2)
  return v === "en" || v === "ru" || v === "az" ? v : null
}

// `WebChatWidget.title` / `greeting` defaults in prisma/schema.prisma. A widget still carrying
// them was never given its own text, so the visitor reads the widget's language instead of
// English (on 2026-10-17 one of the two enabled widgets on production, an Azerbaijani
// organization's, still had both).
export const SCHEMA_DEFAULT_TITLE = "Support"
export const SCHEMA_DEFAULT_GREETING = "Hi! How can we help?"

/** The chat window's title: the organization's own, else the default in the widget's language. */
export function widgetTitle(stored: string | null | undefined, lang: WidgetLang): string {
  return ownText(stored, SCHEMA_DEFAULT_TITLE) ?? t(lang, "defaultTitle")
}

/** The greeting: the organization's own, else the default in the widget's language. */
export function widgetGreeting(stored: string | null | undefined, lang: WidgetLang): string {
  return ownText(stored, SCHEMA_DEFAULT_GREETING) ?? t(lang, "defaultGreeting")
}

function ownText(stored: string | null | undefined, schemaDefault: string): string | null {
  const text = stored?.trim()
  return text && text !== schemaDefault ? stored! : null
}

export function t(lang: WidgetLang, key: string): string {
  return WIDGET_TRANSLATIONS[lang]?.[key] ?? WIDGET_TRANSLATIONS.en[key] ?? key
}
