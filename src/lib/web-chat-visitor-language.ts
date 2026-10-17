import { locales, type Locale } from "@/i18n/routing"

/**
 * The language a website chat visitor reads the chat in, when the site chose it.
 *
 * The widget's language comes from the `data-lang` of the site's <script> tag
 * (widget.js → /embed/chat/<key>?lang=…). Without one the widget falls back to
 * English — and the embed code the CRM hands to tenants has no `data-lang`
 * (settings/web-chat), so "en" from a widget is just as often nobody's choice.
 * Only a language the page asked for is the visitor's; it is kept on each
 * visitor message, because neither the session nor an agent's later escalation
 * request carries it. Without it the visitor is written to in the language of
 * their contact or organization (`loadCustomerLanguage`).
 */

function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (locales as readonly string[]).includes(value) ? (value as Locale) : null
}

/** The metadata of a visitor's message: the widget's language, when the page set it. */
export function visitorMessageLanguageMetadata(input: { lang?: string | null; langChosen?: boolean | null }): { widgetLang: Locale } | undefined {
  const lang = input.langChosen === true ? asLocale(input.lang) : null
  return lang ? { widgetLang: lang } : undefined
}

/** The language the site set for the visitor's latest message, or null. */
export function webChatVisitorLocale(messages: ReadonlyArray<{ fromRole: string; metadata?: unknown }>): Locale | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.fromRole !== "visitor") continue
    const metadata = message.metadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue
    const lang = asLocale((metadata as Record<string, unknown>).widgetLang)
    if (lang) return lang
  }
  return null
}
