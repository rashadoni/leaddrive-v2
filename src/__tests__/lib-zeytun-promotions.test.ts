import { describe, expect, it } from "vitest"

import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { activePromotion } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { parsePromotionsRequest } from "@/lib/voice-agent/pharmacy/zeytun-promotions"

import { context, payload, row } from "./fixtures/zeytun-balances"

// Synthetic items in the feed's shape (never the tenant's export): 1C's
// promotion columns as it writes them, 0/0 for its other kinds included.
let n = 0
type Promo = { buy: number; get: number; from?: string; to?: string; enabled?: boolean }
function item(name: string, nameAz: string, inn: string, promo: Promo | null, quantity = 50) {
  const r = row()
  n += 1
  const id = `22222222-3333-4444-8555-${String(n).padStart(12, "0")}`
  r.Номенклатура = { ...r.Номенклатура, Наименование: name, НаименованиеАз: nameAz, Guid: id, Номер: `PR-${n}`,
    ФармакологическиеНаименования: { Наименование: inn, Guid: id }, МассивШтрихкодов: [],
    РекламнаяАкция: promo ? promo.enabled ?? true : false,
    Купи: promo?.buy ?? 0, Получи: promo?.get ?? 0,
    ДействительноС: promo?.from ?? "20261001", ДействительноДо: promo?.to ?? "20261130" }
  r.Количество = quantity
  return r
}
const rows = [
  item("Кетонал 2,5% 50 гр (Гель) (LEK) (Словения)", "Ketonal 2,5% 50 q (Gel) (LEK) (Sloveniya)", "KETOPROFEN", { buy: 10, get: 2, to: "20261130" }),
  item("Кетонал 5% 50 гр (Крем) (LEK) (Словения)", "", "KETOPROFEN", { buy: 10, get: 2, to: "20261201" }),
  // 1C's other kinds of promotion: the flag with 0/0, or one number only.
  item("Кетонал 100 мг № 10 (Ампулы) (LEK) (Словения)", "", "KETOPROFEN", { buy: 0, get: 0 }),
  item("Кетонал экстра 25 мг (Саше) (LEK) (Словения)", "", "KETOPROFEN", { buy: 5, get: 0 }),
  // Ended, not yet started, flag off.
  item("Кетонал 50 мг № 25 (Капсулы) (LEK) (Словения)", "", "KETOPROFEN", { buy: 10, get: 3, from: "20220101", to: "20220131" }),
  item("Кетонал форте 100 мг (Таблетки) (LEK) (Словения)", "", "KETOPROFEN", { buy: 10, get: 3, from: "20261201", to: "20261231" }),
  item("Кетонал ретард 150 мг (Таблетки) (LEK) (Словения)", "", "KETOPROFEN", { buy: 10, get: 3, enabled: false }),
  // Nothing in stock: not offered.
  item("Кетонал дуо 150 мг (Капсулы) (LEK) (Словения)", "", "KETOPROFEN", { buy: 10, get: 1 }, 0),
  // A maker in the Russian label's groups and the Azerbaijani label's stars.
  item("Аллердес 150 мл (Сироп) (SANOFI ILAC) (Турция)", "Allerdes 150 ml (Şərbət) (Terra ilac.) (Türkiyə)", "DESLORATADINE", { buy: 5, get: 1, to: "20261231" }),
  item("Амарил 2 мг № 30 (Таблетки) (Hoechst) (Италия)", "Amaril 2 mq № 30 /*qutu/* \\*Sanofi Aventis ,İtaliya\\*", "GLIMEPIRIDE", { buy: 3, get: 1, to: "20261110" }),
  // A product whose name holds a maker's word: the name comes first.
  item("Санофикс 10 мг (Таблетки) (Тест) (Германия)", "Sanofiks 10 mq", "TESTOLOL", { buy: 2, get: 1, to: "20270131" }),
  item("Ибупрофен Санофи 200 мг (Таблетки) (Тест) (Индия)", "İbuprofen Sanofi 200 mq", "IBUPROFEN", { buy: 4, get: 1, to: "20261231" }),
  item("Нурофен 200 мг (Таблетки) (Reckitt) (Великобритания)", "Nurofen 200 mq", "IBUPROFEN", { buy: 6, get: 1, to: "20261215" }),
  // A word near a misheard name in another product's label (Zeytun's linseed oil reads "Ketan toxumu yağı").
  item("Масло льна (Ketan toxumu yagi) 30 мл (Масло) (Тест) (Турция)", "", "", { buy: 4, get: 1, to: "20261231" }),
  // A product with no promotion whose name is near a promoted one.
  item("Нурофикс 200 мг (Таблетки) (Тест) (Германия)", "Nurofiks 200 mq", "IBUPROFEN", null),
  item("Без акции 10 мг (Таблетки) (Тест) (Германия)", "", "IBUPROFEN", null),
]
const feed = new ZeytunAvailableBalances(payload(rows), context)
// 2026-11-04 12:00 in Baku (UTC+4).
const now = Date.parse("2026-11-04T08:00:00Z")
const search = (text: string, at = now) => feed.search("tenant-test", { text }, at)
const names = (text: string, at = now) => search(text, at).candidates.map(candidate => candidate.name.split(" (")[0])

describe("promotions: on the phone line", () => {
  it("reads the request: the prefix alone or with a filter word", () => {
    expect(parsePromotionsRequest("promotions:")).toBe("")
    expect(parsePromotionsRequest("  Promotions :  Ketonal ")).toBe("Ketonal")
    expect(parsePromotionsRequest("Ketonal")).toBeNull()
    expect(parsePromotionsRequest("substitute: KETOPROFEN; 50 mg")).toBeNull()
  })

  it("lists only promotions running today, buy and get both set, in stock; the soonest to end first, at most five", () => {
    const all = search("promotions:")
    expect(all.candidateCount).toBe(8)
    expect(all.candidates).toHaveLength(5)
    expect(all.candidates.map(candidate => candidate.name.split(" (")[0])).toEqual([
      "Амарил 2 мг № 30", "Кетонал 2,5% 50 гр", "Кетонал 5% 50 гр", "Нурофен 200 мг", "Аллердес 150 мл",
    ])
    // The same rule as the candidate's own promotion: every listed one has it, every left-out Кетонал has none.
    for (const candidate of all.candidates) expect(activePromotion(candidate, now)).not.toBeNull()
    for (const text of ["Кетонал 100 мг", "Кетонал экстра", "Кетонал 50 мг", "Кетонал форте", "Кетонал ретард"]) {
      const other = feed.search("tenant-test", { text }).candidates.find(candidate => candidate.name.startsWith(text))!
      expect(activePromotion(other, now)).toBeNull()
    }
  })

  it("filters by the product's name in either alphabet", () => {
    expect(names("promotions: Ketonal")).toEqual(["Кетонал 2,5% 50 гр", "Кетонал 5% 50 гр"])
    expect(names("promotions: кетонал")).toEqual(["Кетонал 2,5% 50 гр", "Кетонал 5% 50 гр"])
    // A misheard name falls back to the closest promoted product and those of its name, never a near word elsewhere.
    expect(names("promotions: Ketanol")).toEqual(["Кетонал 2,5% 50 гр", "Кетонал 5% 50 гр"])
  })

  it("filters by the maker, wherever 1C wrote it, the product's own name first", () => {
    expect(names("promotions: Sanofi")).toEqual(["Ибупрофен Санофи 200 мг", "Амарил 2 мг № 30", "Аллердес 150 мл"])
    expect(names("promotions: LEK")).toEqual(["Кетонал 2,5% 50 гр", "Кетонал 5% 50 гр"])
  })

  it("filters by the active substance", () => {
    expect(names("promotions: ibuprofen")).toEqual(["Ибупрофен Санофи 200 мг", "Нурофен 200 мг"])
    expect(names("promotions: Desloratadine")).toEqual(["Аллердес 150 мл"])
  })

  it("dates by Baku's day, both ends included", () => {
    // 2026-11-30 23:30 in Baku: the gel's last day. 2026-12-01 00:30 in Baku: it has ended.
    expect(names("promotions: Ketonal", Date.parse("2026-11-30T19:30:00Z"))).toEqual(["Кетонал 2,5% 50 гр", "Кетонал 5% 50 гр"])
    expect(names("promotions: Ketonal", Date.parse("2026-11-30T20:30:00Z"))).toEqual(["Кетонал 5% 50 гр", "Кетонал форте 100 мг"])
    // 2026-10-01 00:30 in Baku is the first day; 2026-09-30 23:30 is not yet.
    expect(search("promotions:", Date.parse("2026-09-30T20:30:00Z")).candidateCount).toBe(8)
    expect(search("promotions:", Date.parse("2026-09-30T19:30:00Z")).candidateCount).toBe(0)
  })

  it("finds nothing for a filter that names nothing promoted, and never the whole list in its place", () => {
    expect(search("promotions: Paracetamol").status).toBe("not_found_in_snapshot")
    // Нурофикс has no promotion: never the promoted Нурофен next to it in spelling.
    expect(search("promotions: Nurofiks").candidates).toEqual([])
    expect(search("promotions: 10").candidates).toEqual([])
    expect(search("promotions: B").candidates).toEqual([])
  })

  it("leaves the product search as it was", () => {
    expect(names("Ketonal").length).toBeGreaterThan(2)
    expect(search("Без акции").candidates[0].name).toMatch(/^Без акции/)
  })
})
