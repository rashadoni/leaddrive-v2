import { describe, expect, it } from "vitest"

import {
  identifyPharmacy, openingForCandidates, pharmacyNameMatches, spokenPharmacyName, type PharmacyCandidate,
} from "@/lib/voice-agent/pharmacy/zeytun-pharmacy-identity"

const BASE = "Salam! Hansı aptekdən zəng edirsiniz?"
const zefer: PharmacyCandidate = { guid: "g1", name: "\"Zəfər Aptek\" №3", address: "Bakı, Nəsimi" }
const nur: PharmacyCandidate = { guid: "g2", name: "Nur Aptek MMC", address: null }
const sefa: PharmacyCandidate = { guid: "g3", name: "Səfa-Farm", address: null }

describe("who is calling the line, from 1C's pharmacy list", () => {
  it("matches the caller's words to a 1C name whatever the letters, suffixes and the word aptek", () => {
    expect(pharmacyNameMatches("Zəfər aptekindən", zefer.name)).toBe(true)
    expect(pharmacyNameMatches("Zefer aptek nomre 3", "Zəfər Aptek 3")).toBe(true)
    expect(pharmacyNameMatches("Zəfər", "Zəfərli Aptek")).toBe(true)
    expect(pharmacyNameMatches("Nur", zefer.name)).toBe(false)
    expect(pharmacyNameMatches("aptek", zefer.name)).toBe(false)
    expect(spokenPharmacyName(zefer.name)).toBe("Zəfər Aptek №3")
  })

  it("greets by the number's pharmacy, lists a shared number's, and otherwise asks", () => {
    expect(openingForCandidates(BASE, [zefer])).toContain("«Zəfər Aptek №3» kimi qeydə alınıb. Düzdürsə, sifarişinizi deyin.")
    const shared = openingForCandidates(BASE, [zefer, nur, sefa])
    expect(shared).toContain("«Zəfər Aptek №3», «Nur Aptek MMC» və «Səfa-Farm»")
    expect(shared.length).toBeLessThanOrEqual(500)
    expect(openingForCandidates(BASE, [])).toBe(BASE)
    expect(openingForCandidates(BASE, [zefer, nur, sefa, zefer, nur])).toBe(BASE)
    // Owner, 2026-10-30: the company's sales desk answers, not «süni intellekt».
    for (const opening of [openingForCandidates(BASE, [zefer]), shared]) {
      expect(opening.startsWith("Zeytun Pharmaceuticals, satış şöbəsi, salam!")).toBe(true)
      expect(opening).not.toMatch(/süni intellekt/i)
    }
  })

  it("takes the 1C pharmacy only when the caller did not name another", () => {
    expect(identifyPharmacy([zefer], undefined)).toEqual({ identification: "phone_unique", pharmacy: zefer })
    expect(identifyPharmacy([zefer], "Zəfər aptek")).toEqual({ identification: "phone_unique", pharmacy: zefer })
    // Calling from a phone 1C files under another pharmacy: the words win.
    expect(identifyPharmacy([zefer], "Nur aptek")).toEqual({ identification: "named_on_call", spoken: "Nur aptek" })
    expect(identifyPharmacy([zefer, nur], "Nur")).toEqual({ identification: "phone_shared", pharmacy: nur })
    expect(identifyPharmacy([zefer, nur], undefined)).toEqual({ identification: "unidentified" })
    expect(identifyPharmacy([], "Səfa")).toEqual({ identification: "named_on_call", spoken: "Səfa" })
  })
})
