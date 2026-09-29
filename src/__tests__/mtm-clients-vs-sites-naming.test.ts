import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Owner 2026-09-23: «if the clients are in this section, rename it: here write
 * clients, and where «müştərilər» is now write objects or institutions».
 * A pharmacy is a site; a pharmacist is a client.
 *
 * Owner 2026-09-26, asked which of «Объекты / Организации / Добавить клиента»
 * the places directory is: «Учреждения». One name for the menu, the page, its
 * heading and its buttons.
 */
const messages = Object.fromEntries(["az", "ru", "en"].map((locale) => [
  locale,
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")),
]))

/** What a reader sees: the texts, not the keys (organizationKind… are code). */
function texts(node: unknown): string {
  if (typeof node === "string") return node
  if (node && typeof node === "object") return Object.values(node).map(texts).join("\n")
  return ""
}

describe("what the field sections are called", () => {
  it("calls the people clients and the places institutions", () => {
    expect(messages.ru.nav.mtmContacts).toBe("Клиенты")
    expect(messages.ru.nav.mtmCustomers).toBe("Учреждения")
    expect(messages.az.nav.mtmContacts).toBe("Müştərilər")
    expect(messages.az.nav.mtmCustomers).toBe("Müəssisələr")
    expect(messages.en.nav.mtmContacts).toBe("Clients")
    expect(messages.en.nav.mtmCustomers).toBe("Institutions")
  })

  it("names the places directory one way on every surface of it", () => {
    for (const locale of ["az", "ru", "en"]) {
      expect(messages[locale].mtmCustomers.explorer.title).toBe(messages[locale].nav.mtmCustomers)
    }
    expect(messages.ru.mtmCustomers.add).toBe("Добавить учреждение")
    expect(texts(messages.ru.mtmCustomers)).not.toMatch(/[Оо]рганизац|клиент|Объект/)
    expect(texts(messages.az.mtmCustomers)).not.toMatch(/[Tt]əşkilat|[Mm]üştəri|Obyekt/)
    expect(texts(messages.en.mtmCustomers)).not.toMatch(/[Oo]rganization|[Cc]ustomer|\bSites?\b/)
  })

  it("keeps the page headings and the menu hints in step", () => {
    for (const locale of ["az", "ru", "en"]) {
      expect(messages[locale].mtmCustomers.title).toBe(messages[locale].nav.mtmCustomers)
      expect(messages[locale].mtmContactExplorer.title).toBe(messages[locale].nav.mtmContacts)
      expect(messages[locale].navDesc.mtmCustomers).not.toBe(messages[locale].navDesc.mtmContacts)
    }
    // No section says «customers» about places any more.
    expect(messages.az.navDesc.mtmCustomers).not.toContain("üştəri")
    expect(messages.ru.navDesc.mtmCustomers).not.toContain("клиент")
  })
})
