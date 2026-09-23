import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Owner 2026-09-23: «if the clients are in this section, rename it: here write
 * clients, and where «müştərilər» is now write objects or institutions».
 * A pharmacy is a site; a pharmacist is a client.
 */
const messages = Object.fromEntries(["az", "ru", "en"].map((locale) => [
  locale,
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")),
]))

describe("what the field sections are called", () => {
  it("calls the people clients and the places sites", () => {
    expect(messages.ru.nav.mtmContacts).toBe("Клиенты")
    expect(messages.ru.nav.mtmCustomers).toBe("Объекты")
    expect(messages.az.nav.mtmContacts).toBe("Müştərilər")
    expect(messages.az.nav.mtmCustomers).toBe("Obyektlər")
    expect(messages.en.nav.mtmContacts).toBe("Clients")
    expect(messages.en.nav.mtmCustomers).toBe("Sites")
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
