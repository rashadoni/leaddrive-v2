import { describe, expect, it } from "vitest"

import {
  identifyPharmacy, matchPharmacyName, openingForCandidates, pharmacyHintWords, pharmacyNameMatches, spokenNumbers, spokenPharmacyName,
  type PharmacyCandidate,
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

// 1C names Zeytun's pharmacies by a number and the district (2026-11-04: 1 143 of 1 144); synthetic here.
const LIST: PharmacyCandidate[] = [
  { guid: "p1", name: "92 Yasamal", address: null }, { guid: "p2", name: "92 Xətai VIP+ class", address: null },
  { guid: "p3", name: "93 Yasamal", address: null }, { guid: "p4", name: "552 Xətai", address: null },
  { guid: "p5", name: "10 (Pharma Store) Masallı VIP+ class", address: null }, { guid: "p6", name: "10 Quba", address: null },
]

describe("a pharmacy named on the call by 1C's number and district", () => {
  it("reads a number said in words or with an ending", () => {
    expect(spokenNumbers("beş yüz əlli iki")).toEqual(["552"])
    expect(spokenNumbers("Yasamal doxsan ikidən")).toEqual(["yasamal", "92"])
    expect(spokenNumbers("92-dən zəng edirəm")).toEqual(["92", "den", "zeng", "edirem"])
    expect(spokenNumbers("iki üç")).toEqual(["2", "3"])
    expect(spokenNumbers("on beş qutu")).toEqual(["15", "qutu"])
  })

  it("lets a name word be one alike sound off, never a number", () => {
    expect(pharmacyNameMatches("Yasemal 92", "92 Yasamal")).toBe(true)
    expect(pharmacyNameMatches("doxsan iki nömrəli aptek", "92 Yasamal")).toBe(true)
    expect(pharmacyNameMatches("Zəhər aptekindən", zefer.name)).toBe(true)
    expect(pharmacyNameMatches("93 Yasamal", "92 Yasamal")).toBe(false)
    expect(pharmacyNameMatches("Xəzər 92", "92 Xətai")).toBe(false)
    // A shared number's pharmacies told apart by the number said.
    expect(identifyPharmacy([LIST[0], LIST[2]], "doxsan üç, Yasamal")).toEqual({ identification: "phone_shared", pharmacy: LIST[2] })
  })

  it("finds the one pharmacy of the whole list with that number and district, and nothing when unsure", () => {
    expect(matchPharmacyName(["Yasamal 92 aptekindən zəng edirəm"], LIST)).toEqual(LIST[0])
    expect(matchPharmacyName(["Salam, doxsan iki, Xətai"], LIST)).toEqual(LIST[1])
    expect(matchPharmacyName(["beş yüz əlli iki Xətai"], LIST)).toEqual(LIST[3])
    expect(matchPharmacyName(["Yasemal 92"], LIST)).toEqual(LIST[0])
    // A number without a district, a district without a number, the chain's tag: no one pharmacy.
    expect(matchPharmacyName(["92 nömrəli aptek"], LIST)).toBeNull()
    expect(matchPharmacyName(["Yasamal aptekindən"], LIST)).toBeNull()
    expect(matchPharmacyName(["Pharma Store 10"], LIST)).toBeNull()
    // An order is not a pharmacy; the owner's test pharmacy is not in 1C.
    expect(matchPharmacyName(["Ketonal on qutu", "Zəfər aptekindən"], LIST)).toBeNull()
    // The agent's words and the second ear's must agree.
    expect(matchPharmacyName(["92 Yasamal", "93 Yasamal aptekindən"], LIST)).toBeNull()
    expect(matchPharmacyName(["92 Yasamal", "Salam"], LIST)).toEqual(LIST[0])
    expect(identifyPharmacy([], "92 Yasamal")).toEqual({ identification: "named_on_call", spoken: "92 Yasamal" })
  })

  it("hints the second ear with the districts, never a whole name or the class", () => {
    const hints = pharmacyHintWords(LIST.map((pharmacy) => pharmacy.name))
    expect(hints.slice(0, 2).sort()).toEqual(["Xətai", "Yasamal"])
    expect(hints).toEqual(expect.arrayContaining(["Masallı", "Quba"]))
    expect(hints.some((word) => /\d|vip|class|pharma|store/iu.test(word))).toBe(false)
  })
})

