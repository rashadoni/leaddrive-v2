import { describe, expect, it } from "vitest"
import { contactRequestHash, rankContactDuplicates, splitContactName } from "@/lib/mtm/contact-create-request"

describe("contact create request helpers", () => {
  it("finds name and normalized-phone duplicates", () => {
    expect(rankContactDuplicates(
      { displayName: " Dr  Aydin Aliyev ", phone: "+994 50 111 22 33" },
      [
        { id: "c1", displayName: "dr aydin aliyev", phone: "0501112233" },
        { id: "c2", displayName: "Other", phone: "+994501112233" },
        { id: "c3", displayName: "Unrelated", phone: "123" },
      ],
    )).toEqual([
      expect.objectContaining({ id: "c1", exact: true, reasons: ["NAME", "PHONE"] }),
      expect.objectContaining({ id: "c2", exact: false, reasons: ["PHONE"] }),
    ])
  })

  it("splits the simple mobile full-name field without losing a one-word name", () => {
    expect(splitContactName("Aydin Aliyev")).toEqual({ firstName: "Aydin", lastName: "Aliyev" })
    expect(splitContactName("Aydin")).toEqual({ firstName: "Aydin", lastName: "—" })
  })

  it("hashes the reviewed payload deterministically", () => {
    const payload = { displayName: "Aydin", clinicName: "Clinic" }
    expect(contactRequestHash(payload)).toBe(contactRequestHash(payload))
    expect(contactRequestHash(payload)).not.toBe(contactRequestHash({ ...payload, clinicName: "Other" }))
  })
})
