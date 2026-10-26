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

  it("finds nothing when the substance, the strength or the form is missing or unknown", () => {
    for (const text of ["substitute: ACETYLCYSTEINE", "substitute: ACETYLCYSTEINE; 600 mg", "substitute: ACETYLCYSTEINE; ; effervescent tablet",
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
