import { describe, expect, it } from "vitest"
import {
  coerceMtmContactHiddenFields,
  contactFieldVisibility,
  MTM_CONTACT_SWITCHABLE_FIELD_KEYS,
} from "@/lib/mtm/contact-field-visibility"
import {
  coerceMtmContactRequiredFields,
  effectiveMtmContactRequiredFields,
  mergedMtmContactState,
  missingMtmContactRequiredFields,
  MTM_CONTACT_REQUIRED_FIELD_KEYS,
} from "@/lib/mtm/contact-required-fields"

describe("MTM contact required-field policy", () => {
  it("keeps the identity baseline and drops unknown or duplicate keys", () => {
    expect(coerceMtmContactRequiredFields([
      "mobilePhone",
      "firstName",
      "mobilePhone",
      "unsupported",
      42,
    ])).toEqual(["firstName", "lastName", "mobilePhone"])
  })

  it("treats null, whitespace and invalid dates as missing", () => {
    expect(missingMtmContactRequiredFields({
      firstName: "Leyla",
      lastName: " ",
      mobilePhone: null,
      birthDate: new Date("invalid"),
    }, ["lastName", "mobilePhone", "birthDate"])).toEqual([
      "lastName",
      "mobilePhone",
      "birthDate",
    ])
  })

  it("validates the resulting master card, not only the submitted patch", () => {
    const result = mergedMtmContactState(
      { firstName: "Leyla", lastName: "Aliyeva", mobilePhone: null },
      { mobilePhone: "+994501112233" },
    )
    expect(missingMtmContactRequiredFields(result, ["mobilePhone"])).toEqual([])
  })

  it("never demands a field the tenant switched off — hiding wins over «required»", () => {
    expect(effectiveMtmContactRequiredFields(["specialtyName", "mobilePhone"], ["specialtyName"]))
      .toEqual(["firstName", "lastName", "mobilePhone"])
    // A doctor's card saved without a specialty in a tenant that hid the field.
    expect(missingMtmContactRequiredFields(
      { firstName: "Leyla", lastName: "Aliyeva", specialtyName: null, mobilePhone: "+994501112233" },
      ["specialtyName", "mobilePhone"],
      ["specialtyName"],
    )).toEqual([])
    // The same card where the field is shown is still incomplete.
    expect(missingMtmContactRequiredFields(
      { firstName: "Leyla", lastName: "Aliyeva", specialtyName: null, mobilePhone: "+994501112233" },
      ["specialtyName", "mobilePhone"],
      [],
    )).toEqual(["specialtyName"])
  })
})

describe("client fields a tenant can switch off", () => {
  it("hides nothing until the tenant says so", () => {
    expect(coerceMtmContactHiddenFields(undefined)).toEqual([])
    const shows = contactFieldVisibility(undefined)
    for (const field of MTM_CONTACT_SWITCHABLE_FIELD_KEYS) expect(shows(field)).toBe(true)
  })

  it("keeps known fields only, each once; first and last name cannot be hidden", () => {
    expect(coerceMtmContactHiddenFields(["coverage", "specialtyName", "coverage", "firstName", "lastName", "nope", 7]))
      .toEqual(["specialtyName", "coverage"])
    expect(MTM_CONTACT_SWITCHABLE_FIELD_KEYS).not.toContain("firstName")
    expect(MTM_CONTACT_SWITCHABLE_FIELD_KEYS).not.toContain("lastName")
  })

  it("answers for one field at a time", () => {
    const shows = contactFieldVisibility(["specialtyName", "coverage"])
    expect(shows("specialtyName")).toBe(false)
    expect(shows("coverage")).toBe(false)
    expect(shows("phone")).toBe(true)
  })

  it("can switch off every field that can be required, except the name", () => {
    for (const field of MTM_CONTACT_REQUIRED_FIELD_KEYS) {
      if (field === "firstName" || field === "lastName") continue
      expect(MTM_CONTACT_SWITCHABLE_FIELD_KEYS).toContain(field)
    }
  })
})
