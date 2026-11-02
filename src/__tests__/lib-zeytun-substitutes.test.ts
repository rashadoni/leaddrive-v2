import { describe, expect, it } from "vitest"

import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { formKey, parseSubstituteRequest, strengthOf } from "@/lib/voice-agent/pharmacy/zeytun-substitutes"

import { context, payload, row } from "./fixtures/zeytun-balances"

// Synthetic items in the feed's shape (never the tenant's export): one
// substance in several strengths and forms, as 1C lists acetylcysteine.
let n = 0
function item(name: string, nameAz: string, form: string, inn: string, flags: Partial<Record<"Психотропное" | "Сильнодействующее" | "Дефектура", boolean>> = {}) {
  const r = row()
  n += 1
  const id = `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`
  r.Номенклатура = { ...r.Номенклатура, ...flags, Наименование: name, НаименованиеАз: nameAz, Guid: id, Номер: `SN-${n}`,
    ВидНоменклатуры: { Наименование: form, Guid: id },
    ФармакологическиеНаименования: { Наименование: inn, Guid: id }, МассивШтрихкодов: [] }
  return r
}
const feed = new ZeytunAvailableBalances(payload([
  item("Мукорин лонг 600 мг № 10 (Шипучие таблетки) (Тест) (Германия)", "Mukorin long 600 mq №10 (fışıldayan tablet)", "Шипучие таблетки", "ACETYLCYSTEINE"),
  item("Мукорин 200 мг № 20 (Шипучие таблетки) (Тест) (Германия)", "Mukorin 200 mq №20", "Шипучие таблетки", "ACETYLCYSTEINE"),
  item("Мукорин 600 мг № 10 (Саше) (Тест) (Германия)", "Mukorin 600 mq №10 (Saşe)", "Саше", "ACETYLCYSTEINE"),
  item("Ацетин 0,6 г № 20 (Шипучие таблетки) (Тест) (Индия)", "", "Шипучие таблетки", "ACETYLCYSTEINE"),
  item("Мукостоп 600 мг № 10 (Шипучие таблетки) (Тест) (Турция)", "", "Шипучие таблетки", "ACETYLCYSTEINE", { Дефектура: true }),
  item("Брониксин 600 мг № 10 (Шипучие таблетки) (Тест) (Турция)", "", "Шипучие таблетки", "AMBROXOL"),
  item("Сонорил 600 мг № 10 (Таблетки) (Тест)", "", "Таблетки", "ACETYLCYSTEINE", { Психотропное: true }),
]), context)
const names = (text: string) => feed.search("tenant-test", { text }).candidates.map(candidate => candidate.name)

describe("substitutes on the phone line: same substance, same strength, same form", () => {
  it("offers only the same substance in the same strength and form, a gram written as milligrams included", () => {
    expect(names("substitute: ACETYLCYSTEINE; 600 mg; effervescent tablet")).toEqual([
      "Мукорин лонг 600 мг № 10 (Шипучие таблетки) (Тест) (Германия)",
      "Ацетин 0,6 г № 20 (Шипучие таблетки) (Тест) (Индия)",
    ])
    // The agent may say the form in Azerbaijani or Russian; the substance in any letter case.
    expect(names("substitute: acetylcysteine; 600 mq; fışıldayan tablet")).toHaveLength(2)
    expect(names("substitute: Acetylcysteine; 600 мг; шипучие таблетки")).toHaveLength(2)
  })

  it("never offers another strength, another form, another substance, an out-of-stock or a restricted item", () => {
    expect(names("substitute: ACETYLCYSTEINE; 200 mg; effervescent tablet")).toEqual(["Мукорин 200 мг № 20 (Шипучие таблетки) (Тест) (Германия)"])
    expect(names("substitute: ACETYLCYSTEINE; 600 mg; sachet")).toEqual(["Мукорин 600 мг № 10 (Саше) (Тест) (Германия)"])
    // Plain tablets are a different form from effervescent ones, and the only one is psychotropic.
    expect(names("substitute: ACETYLCYSTEINE; 600 mg; tablet")).toEqual([])
    expect(names("substitute: AMBROXOL; 600 mg; effervescent tablet")).toEqual(["Брониксин 600 мг № 10 (Шипучие таблетки) (Тест) (Турция)"])
    expect(names("substitute: ACETYLCYSTEINE; 300 mg; effervescent tablet")).toEqual([])
  })

  it("without a form offers every form of that strength, each to be named to the caller", () => {
    // The caller said only "Fluimucil 600": effervescent tablets and sachets, never 200 mg, never out of stock or restricted.
    expect(names("substitute: ACETYLCYSTEINE; 600 mg")).toEqual([
      "Мукорин лонг 600 мг № 10 (Шипучие таблетки) (Тест) (Германия)",
      "Мукорин 600 мг № 10 (Саше) (Тест) (Германия)",
      "Ацетин 0,6 г № 20 (Шипучие таблетки) (Тест) (Индия)",
    ])
  })

  it("finds nothing when the substance or the strength is missing, or the form is unknown", () => {
    for (const text of ["substitute: ACETYLCYSTEINE", "substitute: ACETYLCYSTEINE; ; effervescent tablet",
      "substitute: ; 600 mg; effervescent tablet", "substitute: ACETYLCYSTEINE; 600 mg; something", "substitute: АЦЕТИЛЦИСТЕИН; 600 mg; effervescent tablet"]) {
      expect(names(text), text).toEqual([])
    }
    // Without the prefix the substance is not a name: a plain search does not find by it.
    expect(names("ACETYLCYSTEINE")).toEqual([])
  })

  it("reads strengths and forms the way 1C and an agent write them", () => {
    expect(strengthOf("А,Ц,Ц лонг  600 мг № 10")).toEqual({ amount: 600, unit: "mg" })
    expect(strengthOf("Глипсидан 100 100 мг № 30")).toEqual({ amount: 100, unit: "mg" })
    expect(strengthOf("Kids 20mg/ml 100 мл")).toEqual({ amount: 20, unit: "mg" })
    expect(strengthOf("Asetilsistein 1 q №10")).toEqual({ amount: 1000, unit: "mg" })
    expect(strengthOf("№ 20 (Таблетки)")).toBeNull()
    expect(formKey("Свечи вагинальные")).toBe(formKey("Ваг.суп."))
    expect(formKey("Свечи")).not.toBe(formKey("Вагинальные свечи"))
    expect(formKey("Глазные капли")).not.toBe(formKey("Капли"))
    expect(formKey("Жеват.таб")).not.toBe(formKey("Таблетки"))
    expect(parseSubstituteRequest("substitute: SITAGLIPTIN; 100 mg; tablet")).toEqual({ inn: "SITAGLIPTIN", strength: { amount: 100, unit: "mg" }, form: "tablet" })
  })
})

describe("the price unit of an item 1C counts in «шт»", () => {
  it("prices «шт» per box, with or without the box mark in its name", async () => {
    const { listPrice } = await import("@/lib/voice-agent/pharmacy/zeytun-inbound-pilot")
    const asOf = "2026-10-26T12:00:00Z"
    // A.S.S. long 600 №10: «шт» in 1C, «/*qutu/*» in its name, 5.54 the box (2026-10-26 call).
    expect(listPrice({ priceAsReported: "5.54", baseUnitAsReported: "шт ", nameAz: "Asetilsistein 600 mq №10 (fışıldayan tablet) /*qutu/* \\*Salutas\\*" }, asOf))
      .toMatchObject({ amount: "5.54", per: "qutu" })
    // TS-1010 (2026-11-02): Bisakodil 5 mq №30 is «шт» at 0.92 with no mark — the box of thirty.
    expect(listPrice({ priceAsReported: "0.92", baseUnitAsReported: "шт ", nameAz: "Bisakodil 5 mq № 30 (Həb) (Hemopharma) (Yuqoslaviya)" }, asOf))
      .toMatchObject({ amount: "0.92", per: "qutu" })
    // The words 1C already gives keep their own unit.
    expect(listPrice({ priceAsReported: "5.67", baseUnitAsReported: "ədəd", nameAz: "Aspirator" }, asOf)).toMatchObject({ per: "ədəd" })
    expect(listPrice({ priceAsReported: "2.78", baseUnitAsReported: "флак", nameAz: "Almagel /*qutu/*" }, asOf)).toMatchObject({ per: "flakon" })
    expect(listPrice({ priceAsReported: "1.33", baseUnitAsReported: "упак", nameAz: "Parasetamol /*qutu/*" }, asOf)).toMatchObject({ per: "qutu" })
  })

  // Owner, 2026-11-02: «тут продажа b2b, там не бывает по ампуле, там всё в коробках».
  it("prices a line in 1C's units whatever word the pharmacy counted with", async () => {
    const { resolvePhoneOrderLines } = await import("@/lib/voice-agent/pharmacy/phone-orders")
    const bisakodil = { externalId: "362c5642-a1a4-11e2-b536-78acc0fe22c8", itemCode: "00000028688",
      name: "Бисакодил  5 мг № 30 (Таблетки) (Hemopharma) (Югославия)", nameAz: "Bisakodil 5 mq № 30 (Həb)",
      listPrice: { amount: "0.92", per: "qutu" } }
    const catalog = { find: (id: string) => id === bisakodil.externalId ? bisakodil : null } as never
    const line = (unit: string) => ({ spoken: "Bisakodil", externalId: bisakodil.externalId, quantity: 3, unit })
    const lines = resolvePhoneOrderLines(catalog, ["qutu", "ədəd", "ampula", "flakon"].map(line))
    // Three of 1C's units each time, and the pharmacy's own word stays on the line.
    expect(lines.map(resolved => [resolved.unit, resolved.lineTotal?.toFixed(2)])).toEqual([
      ["qutu", "2.76"], ["ədəd", "2.76"], ["ampula", "2.76"], ["flakon", "2.76"]])
    // Without a price in 1C nothing is guessed.
    const [unpriced] = resolvePhoneOrderLines({ find: () => ({ ...bisakodil, listPrice: null }) } as never, [line("qutu")])
    expect(unpriced).toMatchObject({ status: "resolved", unitPrice: null, lineTotal: null })
    // A unit with no spoken word (tube) still has its price for the order, as a box.
    const { orderPrice } = await import("@/lib/voice-agent/pharmacy/zeytun-inbound-pilot")
    const asOf = "2026-11-02T10:30:52Z"
    expect(orderPrice({ priceAsReported: "0.92", baseUnitAsReported: "шт " }, asOf)).toEqual({ amount: "0.92", per: "qutu" })
    expect(orderPrice({ priceAsReported: "3.20", baseUnitAsReported: "тюб" }, asOf)).toEqual({ amount: "3.20", per: "qutu" })
    expect(orderPrice({ priceAsReported: "2.78", baseUnitAsReported: "флак" }, asOf)).toEqual({ amount: "2.78", per: "flakon" })
    expect(orderPrice({ priceAsReported: "0", baseUnitAsReported: "упак" }, asOf)).toBeNull()
  })
})
