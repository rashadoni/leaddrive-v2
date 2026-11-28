import { describe, expect, it } from "vitest"

import { learnNames, spokenProductName, withPopular } from "@/lib/voice-agent/pharmacy/zeytun-learned-names"

// Owner, 2026-11-03 («товаров 9к»): the line learns from orders its managers
// confirmed — a rule for every product, not a fix per product.
describe("names the line learns from confirmed orders", () => {
  const ADEFA = "adefa-guid", AMLESSA = "amlessa-guid", NOSPA = "nospa-40", NOSPA_FORTE = "nospa-80"

  it("knows a wording by its product words, whatever quantity, case or alphabet came with it", () => {
    const learned = learnNames([{ spoken: "Adessa beş qutu", externalId: ADEFA }])
    for (const text of ["Adessa", "adessa", "ADESSA 10 qutu", "Адесса"]) expect(learned.productFor(text), text).toBe(ADEFA)
    expect(learned.productFor("Amlessa")).toBeNull()
  })

  it("takes no side where confirmed lines disagree", () => {
    const learned = learnNames([{ spoken: "Noşpa", externalId: NOSPA }, { spoken: "noşpa iki qutu", externalId: NOSPA_FORTE }])
    expect(learned.productFor("Noşpa")).toBeNull()
  })

  it("ignores lines nobody said and counts every ordered product", () => {
    // "—": a line the manager added in the card.
    const learned = learnNames([{ spoken: "—", externalId: AMLESSA }, { spoken: "Adefa", externalId: ADEFA },
      { spoken: "Adefa", externalId: ADEFA }, { spoken: "Amlessa", externalId: AMLESSA }, { spoken: "Amlessa", externalId: AMLESSA },
      { spoken: "Noşpa", externalId: NOSPA }])
    expect(learned.productFor("—")).toBeNull()
    expect(learned.ordered(2)).toEqual([AMLESSA, ADEFA])
    expect(learned.ordered(10)).toEqual([AMLESSA, ADEFA, NOSPA])
  })

  it("hints every product the line wrote, before any order is confirmed", () => {
    // Owner's call 2026-11-03: no confirmed order yet, no hint at all — "etanol" for Ketonal.
    const learned = learnNames([], [NOSPA, ADEFA, NOSPA])
    expect(learned.ordered(5)).toEqual([NOSPA, ADEFA])
    // Wordings still come only from confirmed lines.
    expect(learned.productFor("Noşpa")).toBeNull()
  })

  it("says a product's name as a caller in Baku does", () => {
    expect(spokenProductName({ name: "Адефа № 30 (Таблетки) (Pharmex Rom Industry Srl) (Румыния)", nameAz: null })).toBe("Adefa")
    expect(spokenProductName({ name: "Аджиколд № 4 (Таблетки)", nameAz: "Adjikold № 4 (Həb)" })).toBe("Acikold")
    expect(spokenProductName({ name: "Агемо 150 мл (Сироп)", nameAz: null })).toBe("Aqemo")
    // The Azerbaijani label often starts with the substance, not the brand.
    expect(spokenProductName({ name: "Но-шпа  40 мг № 24 (Таблетки)", nameAz: "Drotaverin hidroxlorid 40 mq" })).toBe("No-şpa")
    expect(spokenProductName({ name: "Mezim forte № 20", nameAz: null })).toBe("Mezim")
    expect(spokenProductName({ name: "5-НОК № 50", nameAz: null })).toBeNull()
  })
})

// Owner, 2026-11-28: «Smekta» heard as «Demək olar» — the recognizer had a handful of hints.
describe("the hints: the line's own orders first, then what 1C sold most", () => {
  const OWN = "own-guid", SOLD1 = "sold-1", SOLD2 = "sold-2"

  it("keeps the line's own orders first and adds the best sellers it lacks, up to the limit", () => {
    const hints = withPopular(learnNames([{ spoken: "Adefa", externalId: OWN }]), [SOLD1, OWN, SOLD2])!
    expect(hints.ordered(10)).toEqual([OWN, SOLD1, SOLD2])
    expect(hints.ordered(2)).toEqual([OWN, SOLD1])
    // Wordings are still taught only by confirmed lines.
    expect(hints.productFor("Adefa")).toBe(OWN)
  })

  it("gives the best sellers alone when the line has no orders yet, and changes nothing without them", () => {
    expect(withPopular(null, [SOLD1, SOLD2])!.ordered(5)).toEqual([SOLD1, SOLD2])
    expect(withPopular(null, [SOLD1])!.productFor("anything")).toBeNull()
    const learned = learnNames([{ spoken: "Adefa", externalId: OWN }])
    expect(withPopular(learned, [])).toBe(learned)
    expect(withPopular(null, [])).toBeNull()
  })
})
