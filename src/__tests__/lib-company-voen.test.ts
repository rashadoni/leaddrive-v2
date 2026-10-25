/** VÖEN as typed into a form, and the tax registry's capitals turned into a person's name. */
import { describe, expect, it } from "vitest"
import { normaliseVoen, personName, readTaxpayer, voenInput } from "@/lib/companies/az-taxpayer-registry"

describe("reading a VÖEN", () => {
  it("keeps the ten digits, whatever spaces or dashes surround them", () => {
    expect(normaliseVoen("1700000001")).toBe("1700000001")
    expect(normaliseVoen(" 17 0000-0001 ")).toBe("1700000001")
    expect(normaliseVoen("170000001")).toBeNull()
    expect(normaliseVoen("17000000011")).toBeNull()
    expect(normaliseVoen(1700000001)).toBeNull()
  })

  it("an empty field clears the VÖEN, a missing one leaves it, a wrong one is refused", () => {
    expect(voenInput(undefined)).toEqual({ ok: true, value: undefined })
    expect(voenInput("  ")).toEqual({ ok: true, value: null })
    expect(voenInput(null)).toEqual({ ok: true, value: null })
    expect(voenInput("17-0000-0001")).toEqual({ ok: true, value: "1700000001" })
    expect(voenInput("12345")).toEqual({ ok: false })
  })
})

describe("the registry's card", () => {
  it("writes the legal representative as a name, with the patronymic word in lower case", () => {
    expect(personName("ƏLİ MƏMMƏDOV VÜQAR OĞLU")).toBe("Əli Məmmədov Vüqar oğlu")
    expect(personName("LEYLA İSMAYILOVA RAMİZ QIZI")).toBe("Leyla İsmayılova Ramiz qızı")
    expect(personName(null)).toBeNull()
  })

  it("finds nothing when the registry's list holds another VÖEN or nothing usable", () => {
    expect(readTaxpayer("1700000001", { taxpayers: [{ tin: "1700000002", name: "X" }] })).toBeNull()
    expect(readTaxpayer("1700000001", { taxpayers: [{ tin: "1700000001" }] })).toBeNull()
    expect(readTaxpayer("1700000001", null)).toBeNull()
  })
})
