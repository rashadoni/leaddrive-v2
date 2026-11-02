import { locales, type Locale } from "@/i18n/routing"

/**
 * The language a website chat visitor reads the chat in.
 *
 * The widget's language is the `data-lang` of the site's <script> tag
 * (widget.js → /embed/chat/<key>?lang=…) when the page set one, else the
 * organization's (`organizationLocale`). The embed code the CRM hands to
 * tenants has no `data-lang` (settings/web-chat), so for most sites it is the
 * organization's. Until 2026-10-17 it was English instead — every visitor of
 * both production widgets, whose organizations write Azerbaijani, got an
 * English chat window and English AI replies.
 *
 * One chat, one language: the window's text, its greeting, the AI's replies and
 * the line telling the visitor about their ticket all use it. It is kept on the
 * greeting and on each visitor message, because neither the session nor an
 * agent's later escalation request carries it. A chat without it (one started
 * before 2026-10-17) is written to in the language of the visitor's contact or
 * organization (`loadCustomerLanguage`).
 */

function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (locales as readonly string[]).includes(value) ? (value as Locale) : null
}

/**
 * The language the page set, as the widget reports it with a message: `langChosen`
 * says the page set it. A widget opened before the flag existed sends "en" without
 * it — that was its fallback, not anyone's choice.
 */
export function pageChosenWidgetLang(input: { lang?: string | null; langChosen?: boolean | null }): Locale | null {
  return input.langChosen === true ? asLocale(input.lang) : null
}

/** The metadata of the greeting and of a visitor's message: the language the widget showed. */
export function widgetLangMetadata(widgetLang: Locale): { widgetLang: Locale } {
  return { widgetLang }
}

/** The widget's language on the chat's latest message that records it, or null. */
export function webChatVisitorLocale(messages: ReadonlyArray<{ metadata?: unknown }>): Locale | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata = messages[i].metadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue
    const lang = asLocale((metadata as Record<string, unknown>).widgetLang)
    if (lang) return lang
  }
  return null
}
