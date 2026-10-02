import { describe, expect, it } from "vitest"
import {
  coerceMtmContactSpecialties,
  contactSpecialtyKey,
  contactSpecialtyOptions,
  MTM_CONTACT_SPECIALTY_DEFAULTS,
  MTM_CONTACT_SPECIALTY_MAX_COUNT,
  parseMtmContactSpecialties,
  splitContactSpecialtyInput,
} from "@/lib/mtm/contact-specialties"

describe("the tenant's list of client specialties", () => {
  it("starts from the owner's list of 34, each one once", () => {
    expect(MTM_CONTACT_SPECIALTY_DEFAULTS).toHaveLength(34)
    expect(new Set(MTM_CONTACT_SPECIALTY_DEFAULTS.map(contactSpecialtyKey)).size).toBe(34)
    expect(MTM_CONTACT_SPECIALTY_DEFAULTS).toContain("İnfeksionist")
    expect(MTM_CONTACT_SPECIALTY_DEFAULTS).toContain("Cərrah ümumi")
    expect(coerceMtmContactSpecialties(undefined)).toEqual([...MTM_CONTACT_SPECIALTY_DEFAULTS])
  })

  it("keeps an emptied list empty: a tenant without doctors has no specialties", () => {
    expect(coerceMtmContactSpecialties([])).toEqual([])
    expect(parseMtmContactSpecialties([])).toEqual({ success: true, data: [] })
  })

  it("treats spellings that differ in case, spacing or the dotted İ as one specialty", () => {
    expect(coerceMtmContactSpecialties(["Pediatr", " pediatr ", "Cərrah  ümumi", "cərrah ümumi", "İnfeksionist", "INFEKSIONIST", "infeksionist"]))
      .toEqual(["Pediatr", "Cərrah ümumi", "İnfeksionist"])
  })

  it("refuses a list that is not a list of names, instead of trimming it silently", () => {
    expect(parseMtmContactSpecialties("Pediatr").success).toBe(false)
    expect(parseMtmContactSpecialties(["Pediatr", 7]).success).toBe(false)
    expect(parseMtmContactSpecialties(["x".repeat(81)]).success).toBe(false)
    expect(parseMtmContactSpecialties(Array.from({ length: MTM_CONTACT_SPECIALTY_MAX_COUNT + 1 }, (_, index) => `S${index}`)).success).toBe(false)
    expect(parseMtmContactSpecialties([" Lor ", "Lor", ""])).toEqual({ success: true, data: ["Lor"] })
  })

  it("splits a column pasted from Excel into separate specialties", () => {
    expect(splitContactSpecialtyInput("Ginekoloq\r\nQastroenteroloq\n\n Proktoloq ")).toEqual(["Ginekoloq", "Qastroenteroloq", "Proktoloq"])
    expect(splitContactSpecialtyInput("Lor, Uroloq; Nefroloq")).toEqual(["Lor", "Uroloq", "Nefroloq"])
    expect(splitContactSpecialtyInput("Cərrah ümumi")).toEqual(["Cərrah ümumi"])
  })

  it("offers the list first and then what contacts carry beyond it, so a removed specialty stays filterable", () => {
    expect(contactSpecialtyOptions(["Pediatr", "Lor"], ["Cardiology", "pediatr", null, "Allerqoloq", " "]))
      .toEqual(["Pediatr", "Lor", "Allerqoloq", "Cardiology"])
    expect(contactSpecialtyOptions([], ["Lor"])).toEqual(["Lor"])
  })
})
