import { describe, expect, it } from "vitest"

import { extractPhonesFromText, extractPrimaryPhone } from "@/lib/social/phone-extractor"

describe("social phone extractor", () => {
  it("normalizes Azerbaijani local mobile numbers", () => {
    expect(extractPrimaryPhone("Nomrem 050 111 22 33")).toMatchObject({
      raw: "050 111 22 33",
      normalized: "+994501112233",
      country: "AZ",
      confidence: "high",
    })
  })

  it("normalizes +994 and bare 994 international formats", () => {
    expect(extractPhonesFromText("Elaqe: +994 (51) 234-56-78 ve 994701112233")).toEqual([
      expect.objectContaining({ normalized: "+994512345678", confidence: "high" }),
      expect.objectContaining({ normalized: "+994701112233", confidence: "high" }),
    ])
  })

  it("deduplicates the same number in different formats", () => {
    expect(extractPhonesFromText("0501112233 / +994 50 111 22 33")).toEqual([
      expect.objectContaining({ normalized: "+994501112233" }),
    ])
  })

  it("rejects dates, prices, short ids, and unsupported prefixes", () => {
    expect(extractPhonesFromText("2026-06-29 qiymet 50 manat, id 12345, 040 111 22 33")).toEqual([])
  })

  it("returns null when no phone is present", () => {
    expect(extractPrimaryPhone("Salam, qiymet necedir?")).toBeNull()
  })
})
