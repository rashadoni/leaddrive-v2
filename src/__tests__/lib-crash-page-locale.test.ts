import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CRASH_PAGE_TEXT, crashPageCopy, crashPageLocale, localeFromCookieString } from "@/lib/crash-page-locale"
import { locales } from "@/i18n/routing"

/**
 * Field UX audit 2026-09-05, C3 tail: the crash page rendered its own `<html>`
 * with no `lang` and two hard-coded English sentences.
 */
describe("crash page locale", () => {
  it("takes the language the switcher wrote", () => {
    expect(localeFromCookieString("NEXT_LOCALE=az")).toBe("az")
    expect(localeFromCookieString("theme=dark; NEXT_LOCALE=en; other=1")).toBe("en")
    expect(localeFromCookieString("NEXT_LOCALE=ru-RU")).toBe("ru")
  })

  it("ignores a cookie it cannot use instead of trusting it", () => {
    expect(localeFromCookieString("NEXT_LOCALE=tr")).toBeNull()
    expect(localeFromCookieString("NEXT_LOCALE=")).toBeNull()
    expect(localeFromCookieString("")).toBeNull()
    expect(localeFromCookieString(null)).toBeNull()
    // A cookie for a different key must not be mistaken for ours.
    expect(localeFromCookieString("MY_NEXT_LOCALE=az")).toBeNull()
  })

  it("falls back to the browser, then to the product default", () => {
    expect(crashPageLocale({ cookie: null, languages: ["az-AZ", "en"] })).toBe("az")
    expect(crashPageLocale({ cookie: null, languages: ["tr", "en-GB"] })).toBe("en")
    expect(crashPageLocale({ cookie: null, languages: [] })).toBe("ru")
    expect(crashPageLocale({})).toBe("ru")
  })

  it("prefers the explicit choice over what the browser asks for", () => {
    // Someone who switched the interface to Azerbaijani on a Russian laptop
    // chose once; the crash page is not the place to overrule them.
    expect(crashPageLocale({ cookie: "NEXT_LOCALE=az", languages: ["ru-RU"] })).toBe("az")
  })

  it("still renders when detection throws", () => {
    const exploding = { get cookie(): string { throw new Error("no document") } }
    const copy = crashPageCopy(exploding as unknown as { cookie: string })
    expect(copy.locale).toBe("ru")
    expect(copy.title).toBe(CRASH_PAGE_TEXT.ru.title)
  })

  it("has both sentences in every language the product ships", () => {
    for (const locale of locales) {
      const text = CRASH_PAGE_TEXT[locale]
      expect(text?.title, `${locale} title`).toEqual(expect.any(String))
      expect(text?.retry, `${locale} retry`).toEqual(expect.any(String))
      expect(text.title.trim().length).toBeGreaterThan(0)
      expect(text.retry.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("crash page wiring", () => {
  const page = readFileSync("src/app/global-error.tsx", "utf8")

  it("declares the language it is actually written in", () => {
    expect(page).toContain("<html lang={copy.locale}")
    expect(page).not.toContain("<html>")
  })

  it("keeps no English sentence hard-coded in the markup", () => {
    // The strings live in the dictionary above; a literal here would be the
    // one the reader gets whatever language they chose.
    expect(page).not.toContain("Something went wrong")
    expect(page).not.toContain(">Try again<")
  })

  it("still reports the crash", () => {
    // The whole point of this page: whatever else changes, Sentry keeps hearing.
    expect(page).toContain("Sentry.captureException(error)")
  })
})
