import { describe, expect, it } from "vitest"
import { PharmacyNameSearch } from "@/lib/voice-agent/pharmacy/name-search"

// Labels copied in shape from the Zeytun feed (2026-10-23 live probe): the
// medicine shares its form word with hundreds of other items, and speech
// recognition delivers "Noşpa" for No-şpa and "Ketanol" for Ketonal.
const FEED: Array<[string, string]> = [
  ["nospa-amp", "No-şpa 2ml 40 mq № 25( drotaverin) (Ampula) (Sanofi Aventis) (Macarıstan)"],
  ["nospa-forte", "No-şpa forte 80 mq № 24 (Drotaverine) /*qutu/* \\*Xinoin, Macarıstan\\*"],
  ["ketonal-amp", "Ketonal 2 ml № 10  /*qutu/*  \\*LEK ,Sloveniya\\*"],
  ["ketonal-krem", "Ketonal 30 qr (Krem) (LEK) (Sloveniya)"],
  ["flax-oil", "Масло семян льна(Ketan toxumu yagi)(Zeyerek yagi) 100 ml (Yağ) (Biola) (Azərbaycan)"],
  ["retinol", "Artshine Retinol 0,5% 30 ml (Serum) (Vitamin Grup) (Türkiyə)"],
  ["diklofenak-sam", "Diklofenak 100 mq № 10 (Şam) (Farmaprim) (Moldova)"],
  ["diklofenak-gel", "Diklofenak 40 qr (Gel) (Hemopharma) (Serbiya)"],
  ["nimesil", "Nimesil 100 mq № 30 /*qutu/* \\* Berlin-Chemie ,Almaniya\\*"],
  ["persen", "Persen forte № 20 /*qutu/*  \\*Lek Farmasyutikals DD.Sloveniya\\*"],
]
for (let i = 0; i < 40; i++) FEED.push([`ampoule-${i}`, `Preparat${String.fromCharCode(97 + (i % 26))}${i} 1 qr № 1 (Ampula) (Firma) (Ölkə)`])

function search() {
  const index = new PharmacyNameSearch(true)
  for (const [id, label] of FEED) index.add(id, label)
  return index
}

describe("PharmacyNameSearch word ranking for spoken requests", () => {
  it("puts the named medicine above every other item sharing its form word", () => {
    const top = search().find("Noşpa ampula").slice(0, 2)
    expect(top).toEqual(["nospa-amp", "nospa-forte"])
    expect(search().find("No-şpa ampula")[0]).toBe("nospa-amp")
  })

  it("finds a hyphenated name spoken without the hyphen", () => {
    expect(search().find("Noşpa").slice(0, 2).sort()).toEqual(["nospa-amp", "nospa-forte"])
  })

  it("reads a misheard name as the closest catalog spelling, not a rarer or shorter one", () => {
    const top = search().find("Ketanol").slice(0, 2).sort()
    expect(top).toEqual(["ketonal-amp", "ketonal-krem"])
  })

  it("lets quantity words decide nothing", () => {
    const top = search().find("Ketanol üç qutu").slice(0, 2).sort()
    expect(top).toEqual(["ketonal-amp", "ketonal-krem"])
  })

  it("keeps a misheard form word harmless when the name is right", () => {
    expect(search().find("Diklofenak axşamı 100 mq")[0]).toBe("diklofenak-sam")
    expect(search().find("Diklofenak şam 100 mq")[0]).toBe("diklofenak-sam")
  })

  it("treats Azerbaijani letters and their Latin digraphs as one sound", () => {
    // 2026-10-23 live call: "No-şpa" was transcribed "Moshpa", "Ketonal" "Ketenal".
    expect(search().find("Moshpa ampula")[0]).toBe("nospa-amp")
    expect(search().find("Ketenal").slice(0, 2).sort()).toEqual(["ketonal-amp", "ketonal-krem"])
  })

  it("gives short words no spelling slack", () => {
    // "gel" must not reach "gal", "bel", ... by one edit.
    expect(search().find("Diklofenak gel")[0]).toBe("diklofenak-gel")
  })

  it("leaves whole-label search unchanged when words are not indexed", () => {
    const index = new PharmacyNameSearch()
    for (const [id, label] of FEED) index.add(id, label)
    expect(index.find("Noşpa ampula")).not.toContain("ketonal-amp")
    expect(index.find("Ketonal 30 qr (Krem) (LEK) (Sloveniya)")[0]).toBe("ketonal-krem")
  })
})
