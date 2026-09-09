/**
 * The language of the crash page, worked out without next-intl.
 *
 * Field UX audit 2026-09-05, task C3 tail. `src/app/global-error.tsx` replaces
 * the root layout when that layout itself fails, so it renders its own `<html>`
 * — and it rendered it with no `lang` at all and two hard-coded English
 * sentences. A screen reader then announces the one page where something has
 * already gone wrong in whatever voice it happens to default to, and an
 * Azerbaijani rep reads "Something went wrong" at the worst possible moment.
 *
 * The provider is gone by definition here: if the layout crashed, the locale
 * context crashed with it. So the language is read from the same cookie the
 * language switcher writes (`NEXT_LOCALE`), then from what the browser asks
 * for, and only then from the product default.
 *
 * Every step is total: this file runs while the application is already broken,
 * and a crash page that throws leaves a blank window.
 */

import { defaultLocale, locales, type Locale } from "@/i18n/routing"

const SUPPORTED = new Set<string>(locales)

function normalize(tag: string | null | undefined): Locale | null {
  const base = String(tag ?? "").trim().split(/[-_]/)[0].toLowerCase()
  return SUPPORTED.has(base) ? (base as Locale) : null
}

/** Reads `NEXT_LOCALE` out of a raw `document.cookie` string. */
export function localeFromCookieString(cookie: string | null | undefined): Locale | null {
  if (typeof cookie !== "string" || !cookie) return null
  for (const part of cookie.split(";")) {
    const row = part.trim()
    if (!row.startsWith("NEXT_LOCALE=")) continue
    const raw = row.slice("NEXT_LOCALE=".length)
    let value = raw
    try {
      value = decodeURIComponent(raw)
    } catch {
      // A malformed percent-escape is not a reason to give up on the cookie.
    }
    return normalize(value)
  }
  return null
}

export function crashPageLocale(input: {
  cookie?: string | null
  languages?: readonly string[] | null
}): Locale {
  const fromCookie = localeFromCookieString(input.cookie)
  if (fromCookie) return fromCookie
  for (const tag of input.languages ?? []) {
    const match = normalize(tag)
    if (match) return match
  }
  return defaultLocale
}

/**
 * The two sentences the page needs. Kept here rather than in `messages/*.json`
 * on purpose: loading a message bundle is exactly the kind of work that is not
 * available once the layout has failed, and three short strings inline cannot
 * fail to load.
 */
export const CRASH_PAGE_TEXT: Record<Locale, { title: string; retry: string }> = {
  ru: { title: "Что-то пошло не так", retry: "Попробовать снова" },
  az: { title: "Nəsə səhv getdi", retry: "Yenidən cəhd edin" },
  en: { title: "Something went wrong", retry: "Try again" },
}

/** What the page shows, in one call, safe to run in any environment. */
export function crashPageCopy(input: { cookie?: string | null; languages?: readonly string[] | null }): {
  locale: Locale
  title: string
  retry: string
} {
  let locale: Locale = defaultLocale
  try {
    locale = crashPageLocale(input)
  } catch {
    // Detection must never be the reason the crash page does not render.
  }
  return { locale, ...CRASH_PAGE_TEXT[locale] }
}
