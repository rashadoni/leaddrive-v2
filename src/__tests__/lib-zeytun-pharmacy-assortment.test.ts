import { describe, expect, it, vi } from "vitest"

import { soundCodes, soundPartApart } from "@/lib/voice-agent/pharmacy/name-search"
import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { ASSORTMENT_EXTRA_MAX, assortmentExtras, productSound } from "@/lib/voice-agent/pharmacy/zeytun-assortment-ranking"
import { ASSORTMENT_MAX, combineAssortment, createCallAssortments } from "@/lib/voice-agent/pharmacy/zeytun-pharmacy-assortment"

import { context, payload, row } from "./fixtures/zeytun-balances"

// Synthetic names in 1C's shape (Cyrillic label, maker and country in brackets); never the tenant's export.
const NAMES = ["Адефа № 30 (Таблетки) (Тест Фарм) (Румыния)", "Амлесса 4 мг/5 мг № 30 (Таблетки) (Тест Фарм) (Словения)",
  "Амлесса 8 мг/10 мг № 30 (Таблетки) (Тест Фарм) (Словения)", "Энтерол 250 мг № 10 (Капсулы) (Тест Фарм) (Франция)",
  "Энтеросгель 225 гр (Гель) (Тест Фарм) (Россия)", "Кетонал 100 мг/ 2 мл № 10 (Ампулы) (Тест Фарм) (Словения)",
  "Кетонал 2,5% 50 гр (Гель) (Тест Фарм) (Словения)", "Этанол 70% 100 мл (Раствор) (Тест Фарм) (Азербайджан)",
  "Спазмалгон № 20 (Таблетки) (Тест Фарм) (Болгария)", "Баралгин 500 мг № 20 (Таблетки) (Тест Фарм) (Индия)"]
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ADEFA = id(0), ENTEROSGEL = id(4), KETONAL_AMP = id(5), KETONAL_GEL = id(6), SPAZMALGON = id(8)
function feed() {
  const rows = NAMES.map((name, n) => {
    const item = row()
    item.Номенклатура.Наименование = name
    item.Номенклатура.НаименованиеАз = ""
    item.Номенклатура.Guid = id(n)
    item.Номенклатура.Номер = `T-${n}`
    item.Номенклатура.МассивШтрихкодов = []
    return item
  })
  return new ZeytunAvailableBalances(payload(rows), context)
}
const ORG = context.organizationId
const names = (items: Array<{ name: string }> | undefined) => (items ?? []).map((item) => item.name.split(" ")[0])

describe("the calling pharmacy's products next to the line's search", () => {
  it("adds what the ear lost, after the five, and never changes the five", () => {
    const catalog = feed()
    const list = { ordered: [ADEFA, KETONAL_GEL, SPAZMALGON, ENTEROSGEL] }
    for (const text of ["Adessa", "etanol gel", "Adım Alqum", "Enterol"]) {
      const before = catalog.search(ORG, { text }), after = catalog.search(ORG, { text }, undefined, { assortment: list })
      // The five: the same items in the same order, the same count.
      expect(after.candidates).toEqual(before.candidates)
      expect(after.candidateCount).toBe(before.candidateCount)
      expect(before).not.toHaveProperty("preferredExtra")
    }
    // Plan 4.2: "Adessa" was Adefa, "Alqum" the end of Spazmalgon.
    expect(names(catalog.search(ORG, { text: "Adessa" }, undefined, { assortment: list }).preferredExtra)).toEqual(["Адефа"])
    expect(names(catalog.search(ORG, { text: "Adım Alqum" }, undefined, { assortment: list }).preferredExtra)).toEqual(["Спазмалгон"])
    // Of one name the one with more of the words said: Ketonal gel for "etanol gel", before the ampoules more often ordered.
    const labels = new Map([[KETONAL_AMP, NAMES[5]], [KETONAL_GEL, NAMES[6]]])
    expect(assortmentExtras("etanol gel", [], [KETONAL_AMP, KETONAL_GEL], (key) => productSound({ name: labels.get(key)! })))
      .toEqual([KETONAL_GEL, KETONAL_AMP])
    // But a name the five already sound exactly like ("etanol" is Этанол) keeps a further one of the list out.
    expect(catalog.search(ORG, { text: "etanol" }, undefined, { assortment: { ordered: [KETONAL_AMP] } })).not.toHaveProperty("preferredExtra")
  })

  it("adds nothing without a list, for a product the pharmacy does not order, or when the caller clearly said a name", () => {
    const catalog = feed()
    const without = catalog.search(ORG, { text: "Adessa" })
    expect(catalog.search(ORG, { text: "Adessa" }, undefined, { assortment: null })).toEqual(without)
    expect(catalog.search(ORG, { text: "Adessa" }, undefined, { assortment: { ordered: [] } })).toEqual(without)
    expect(catalog.search(ORG, { text: "Adessa" }, undefined, { assortment: { ordered: [KETONAL_GEL] } })).toEqual(without)
    // "Baralgin" is a name of the catalog, spelled as heard: the list does not second-guess it.
    expect(catalog.search(ORG, { text: "Baralgin" }, undefined, { assortment: { ordered: [SPAZMALGON] } })).not.toHaveProperty("preferredExtra")
    // Codes and requests other than a name are searched as before.
    expect(catalog.search(ORG, { externalId: ADEFA }, undefined, { assortment: { ordered: [ADEFA] } })).not.toHaveProperty("preferredExtra")
  })

  it("adds at most two, closest first, and a product already in the five never twice", () => {
    const shown = [{ id: id(99), covered: 1, full: 0, whole: 0, exact: 0, words: 1 }]
    const sound = (code: string) => productSound({ name: `${code} 10 мг` })
    const many = ["Адефа", "Адефан", "Адефо", "Адеса"]
    const extra = assortmentExtras("Adessa", shown, many.map((_, n) => id(n)), (key) => sound(many[Number(key.slice(-2))]), 0.35, ASSORTMENT_EXTRA_MAX, 1)
    expect(extra).toHaveLength(2)
    expect(extra[0]).toBe(id(3))
    expect(assortmentExtras("Adessa", [{ ...shown[0], id: id(3) }], [id(3)], () => sound("Адеса"))).toEqual([])
  })

  it("measures a heard word against a name's beginning or end, not only the whole of it", () => {
    expect(soundPartApart(soundCodes("enterol"), soundCodes("энтеросгель"), 0.35)).toBeLessThan(0.2)
    expect(soundPartApart(soundCodes("alqum"), soundCodes("спазмалгон"), 0.35)).toBeLessThan(0.35)
    expect(soundPartApart(soundCodes("adessa"), soundCodes("адефа"), 0.35)).toBeLessThanOrEqual(0.35)
    expect(soundPartApart(soundCodes("ketonal"), soundCodes("амлесса"), 0.35)).toBe(1)
  })
})

describe("one pharmacy's list", () => {
  it("joins the sources most ordered first, without repeats, up to its size", () => {
    expect(combineAssortment([{ source: "crm_confirmed", products: [] }])).toBeNull()
    const list = combineAssortment([{ source: "crm_confirmed", products: ["a", "b"] }, { source: "1c_sales", products: ["b", "c"] }])
    expect(list).toMatchObject({ ordered: ["a", "b", "c"], sources: ["crm_confirmed", "1c_sales"] })
    expect(list!.ids.has("c")).toBe(true)
    const long = combineAssortment([{ source: "x", products: Array.from({ length: ASSORTMENT_MAX + 50 }, (_, n) => `p${n}`) }])
    expect(long!.ordered).toHaveLength(ASSORTMENT_MAX)
  })

  it("is read once per call in the background, never waited for, and again only for another pharmacy", async () => {
    const clock = { now: 0 }
    const calls = createCallAssortments(() => clock.now)
    const list = combineAssortment([{ source: "crm_confirmed", products: ["a"] }])
    const load = vi.fn(async () => ({ pharmacy: "g1", assortment: list }))
    expect(calls.get("call-1", load)).toBeNull()
    await vi.waitFor(() => expect(calls.get("call-1", load)).toBe(list))
    expect(load).toHaveBeenCalledOnce()
    // The order named the same pharmacy: kept.
    calls.refresh("call-1", "g1", load)
    expect(load).toHaveBeenCalledOnce()
    // Another one: read again; until then, no list.
    const other = vi.fn(async () => ({ pharmacy: "none", assortment: null }))
    calls.refresh("call-1", "none", other)
    expect(other).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(calls.get("call-1", load)).toBeNull())
    calls.refresh("call-1", "none", other)
    expect(other).toHaveBeenCalledOnce()
    // A list that cannot be read is no list: the call searches as before.
    const broken = vi.fn(async () => { throw new Error("db") })
    expect(calls.get("call-2", broken)).toBeNull()
    await Promise.resolve()
    expect(calls.get("call-2", broken)).toBeNull()
    expect(broken).toHaveBeenCalledOnce()
    // Forgotten after twenty minutes.
    clock.now += 20 * 60_000
    calls.get("call-1", load)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
