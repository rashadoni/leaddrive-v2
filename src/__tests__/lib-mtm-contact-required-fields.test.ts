import { describe, expect, it } from "vitest"
import {
  coerceMtmContactRequiredFields,
  mergedMtmContactState,
  missingMtmContactRequiredFields,
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
})
