import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createTranslator, IntlErrorCode } from "next-intl"

/**
 * Every message in every language must be a message next-intl can read.
 *
 * 2026-11-26, contracts E2E: the reminder dialog of an invoice threw
 * INVALID_MESSAGE in the browser, and the contract templates page printed raw
 * keys such as «contractTemplates.clauseBodyHint» — 53 messages in az/ru/en
 * wrote placeholders as «{{name}}» or a tag-like «<company>», which ICU reads
 * as a broken argument. A literal brace is written «'{{'name'}}'»; a value the
 * code fills in is «{name}» with the value passed to t().
 *
 * Only malformed messages fail here: a message that needs values it was not
 * given is the caller's business, not the catalogue's.
 */
const LOCALES = ["az", "ru", "en"] as const

function leafKeys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === "string" ? [path] : leafKeys(value, path)
  })
}

describe("message catalogues", () => {
  it.each(LOCALES)("%s: every message parses", (locale) => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
    const malformed: string[] = []
    const t = createTranslator({
      locale,
      messages,
      onError: (error) => {
        if (error.code === IntlErrorCode.INVALID_MESSAGE) malformed.push(error.message.slice(0, 160))
      },
      getMessageFallback: ({ key }) => key,
    })
    for (const key of leafKeys(messages)) t(key as never)
    expect(malformed).toEqual([])
  })
})
