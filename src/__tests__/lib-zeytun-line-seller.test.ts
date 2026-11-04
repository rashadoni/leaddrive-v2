import { describe, expect, it } from "vitest"

import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { createDepartedSearch, nextDeparted } from "@/lib/voice-agent/pharmacy/zeytun-departed-items"
import type { InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { promotionSay } from "@/lib/voice-agent/pharmacy/zeytun-promotions"

import { crmFor, type Save } from "../../scripts/zeytun-line/stand-crm"
import { context, payload, row } from "./fixtures/zeytun-balances"

/**
 * The seller's lookups the line's search and save answer by themselves
 * (owner, 2026-11-04: «продумай по этим акциям, аналогам какое-то решение,
 * чтоб не сжирало токены»). Synthetic items in the feed's shape, never the
 * tenant's export.
 */
let n = 0
type Promo = { buy: number; get: number; to?: string }
function item(name: string, nameAz: string, inn: string, kind: string, promo: Promo | null, quantity = 50,
  flags: { potent?: boolean } = {}) {
  const r = row()
  n += 1
  const id = `33333333-4444-4555-8666-${String(n).padStart(12, "0")}`
  r.Номенклатура = { ...r.Номенклатура, Наименование: name, НаименованиеАз: nameAz, Guid: id, Номер: `SL-${n}`,
    ФармакологическиеНаименования: { Наименование: inn, Guid: id }, ВидНоменклатуры: { Наименование: kind, Guid: id },
    МассивШтрихкодов: [], БазоваяЕдиницаИзмерения: "шт", Сильнодействующее: flags.potent ?? false,
    РекламнаяАкция: promo !== null, Купи: promo?.buy ?? 0, Получи: promo?.get ?? 0,
    ДействительноС: "20261001", ДействительноДо: promo?.to ?? "20261130" }
  r.Количество = quantity
  return r
}
const rows = [
  item("Кетонал 100 мг/ 2 мл № 10 (Ампулы) (LEK) (Словения)", "Ketonal 100 mq (Ampul) (LEK) (Sloveniya)", "KETOPROFEN", "Ампулы", null),
  item("Кетонал 2,5% 50 гр (Гель) (LEK) (Словения)", "", "KETOPROFEN", "Гель", { buy: 10, get: 2, to: "20261130" }),
  item("Кетонал 5% 50 гр (Крем) (LEK) (Словения)", "", "KETOPROFEN", "Крем", { buy: 10, get: 2, to: "20261201" }),
  item("Кетонал 50 мг № 25 (Капсулы) (LEK) (Словения)", "", "KETOPROFEN", "Капсулы", null),
  item("Кетонал форте 100 мг № 20 (Таблетки) (LEK) (Словения)", "", "KETOPROFEN", "Таблетки", null),
  item("Бронхо-мунал 3,5 мг № 10 (Капсулы) (LEK) (Словения)", "", "BACTERIAL LYSATE", "Капсулы", { buy: 5, get: 1, to: "20261120" }),
  item("Артрозан 100 мг № 10 (Ампулы) (Тест) (Россия)", "", "KETOPROFEN", "Ампулы", null, 30),
  item("Фламакс 100 мг № 10 (Ампулы) (Другой) (Россия)", "", "KETOPROFEN", "Ампулы", null, 80),
  // Not offered as a substitute: potent, none in stock, another strength.
  item("Кетопрофен форте 100 мг № 10 (Ампулы) (Тест) (Индия)", "", "KETOPROFEN", "Ампулы", null, 50, { potent: true }),
  item("Кетанов 100 мг № 10 (Ампулы) (Тест) (Индия)", "", "KETOPROFEN", "Ампулы", null, 0.5),
  item("Профенид 50 мг № 10 (Ампулы) (Тест) (Индия)", "", "KETOPROFEN", "Ампулы", null),
  item("Бисакодил 5 мг № 30 (Таблетки) (Hemopharma) (Сербия)", "Bisakodil 5 mq № 30 (Həb) (Hemopharma) (Serbiya)", "BISACODYL", "Таблетки", null),
  item("Омнитус 200 мл (Сироп) (Hemopharma) (Сербия)", "", "BUTAMIRATE", "Сироп", { buy: 10, get: 1, to: "20261201" }),
  item("Диклофенак 50 мг № 20 (Таблетки) (Hemopharma) (Сербия)", "", "DICLOFENAC", "Таблетки", { buy: 10, get: 1, to: "20261105" }),
  item("Бисептол 480 мг (Таблетки) (Polfa) (Польша)", "", "CO-TRIMOXAZOLE", "Таблетки", { buy: 3, get: 1, to: "20261101" }),
]
const feed = new ZeytunAvailableBalances(payload(rows), context)
const org = context.organizationId
// 2026-11-04 12:00 in Baku.
const now = Date.parse("2026-11-04T08:00:00Z")
const idOf = (prefix: string) => feed.search(org, { text: prefix }).candidates.find(candidate => candidate.name.startsWith(prefix))!.externalId
const short = (name: string) => name.split(" (")[0]

describe("the seller's lookups in the catalog", () => {
  it("writes the offer in Azerbaijani, the date in words", () => {
    expect(promotionSay({ buy: 5, get: 1, per: "qutu", until: "2026-11-30" })).toBe("5 qutu alana 1 qutu hədiyyə, 30 noyabra qədər")
    expect(promotionSay({ buy: 10, get: 2, until: "2026-04-01" })).toBe("10 alana 2 hədiyyə, 1 aprelə qədər")
  })

  it("finds the promotion on another form of the same name, never the item itself", () => {
    const ampoules = idOf("Кетонал 100")
    expect(feed.sameNamePromotions(org, ampoules, now, new Set()).map(found => short(found.name))).toEqual(["Кетонал 2,5% 50 гр"])
    expect(feed.sameNamePromotions(org, idOf("Кетонал 2,5"), now, new Set()).map(found => short(found.name))).toEqual(["Кетонал 5% 50 гр"])
    // Bronchomunal is LEK's too, not Ketonal: the maker is no name.
    expect(feed.sameNamePromotions(org, ampoules, now, new Set(), 5).map(found => short(found.name))).not.toContain("Бронхо-мунал 3,5 мг № 10")
    // After the gel's last day only the cream is left.
    expect(feed.sameNamePromotions(org, ampoules, Date.parse("2026-11-30T21:00:00Z"), new Set()).map(found => short(found.name))).toEqual(["Кетонал 5% 50 гр"])
  })

  it("offers substitutes of the same substance, strength and form, in stock, most in stock first", () => {
    const found = feed.substitutesFor(org, { inn: "Ketoprofen", strength: { amount: 100, unit: "mg" }, form: "ampoule" }, new Set([idOf("Кетонал 100")]))
    expect(found.map(item => short(item.name))).toEqual(["Фламакс 100 мг № 10", "Артрозан 100 мг № 10"])
    expect(feed.substitutesFor(org, { inn: "KETOPROFEN", strength: { amount: 50, unit: "mg" }, form: "ampoule" }, new Set()).map(item => short(item.name)))
      .toEqual(["Профенид 50 мг № 10"])
    expect(feed.substitutesFor(org, { inn: "NOTHING", strength: null, form: null }, new Set())).toEqual([])
  })

  it("offers one promotion of the order's makers at the end, none of its products nor of their names", () => {
    expect(short(feed.promotionOffer(org, [idOf("Бисакодил")], now)!.name)).toBe("Диклофенак 50 мг № 20")
    // Ordered Ketonal ampoules: Ketonal gel and cream are said when the ampoules are confirmed; LEK's other product is offered.
    expect(short(feed.promotionOffer(org, [idOf("Кетонал 100")], now)!.name)).toBe("Бронхо-мунал 3,5 мг № 10")
    expect(feed.promotionOffer(org, [idOf("Кетонал 100"), idOf("Бронхо-мунал")], now)).toBeNull()
    // Ended promotions are not offered: Biseptol ended on 2026-11-01.
    expect(feed.promotionOffer(org, [idOf("Бисептол")], now)).toBeNull()
    expect(feed.promotionOffer(org, [], now)).toBeNull()
  })

  it("keeps a sold-out product's substance and kind for its substitutes", () => {
    const labels = feed.labels(org)
    const gone = nextDeparted({ previous: [], before: labels, now: labels.filter(label => !label.name.startsWith("Кетонал 100")), at: now })
    expect(gone).toEqual([expect.objectContaining({ name: rows[0].Номенклатура.Наименование, pharmacologicalName: "KETOPROFEN", kind: "Ампулы" })])
  })
})

type Found = { name: string; externalId: string; promotionSay?: string; promotion?: unknown; stock?: unknown }
type Answer = { candidates: Found[]; sameNamePromotion?: Found; substitutes?: Found[]; offer?: Found }

describe("the seller's extras in the line's answers", () => {
  // The line's own handler on this feed, as the stands run it (scripts/zeytun-line/stand-crm.ts).
  const catalogOf = (departed?: ReturnType<typeof createDepartedSearch>): InboundPilotCatalog => ({
    organizationId: org, scopeKey: "a".repeat(64), version: "b".repeat(64), observedAt: new Date().toISOString(), source: "live",
    search: query => feed.search(org, query, now), seller: feed.seller(org), ...(departed ? { departed } : {}),
  } as InboundPilotCatalog)
  const line = async (catalog = catalogOf()) => {
    const saves: Save[] = []
    const crm = crmFor(catalog, saves)
    const callId = crypto.randomUUID()
    await crm({ action: "session", callId })
    return { search: (text: string) => crm({ action: "search", callId, query: { text } }) as Promise<Answer>,
      save: (ids: string[], final?: true) => crm({ action: "order", callId, ...(final ? { final } : {}),
        lines: ids.map(externalId => ({ externalId, quantity: 2, unit: "qutu", spoken: "iki qutu" })) }) as Promise<Answer> }
  }

  it("gives each promoted candidate its sentence and the product another form's promotion", async () => {
    const call = await line()
    const body = await call.search("Ketonal ampula")
    expect(short(body.candidates[0].name)).toBe("Кетонал 100 мг/ 2 мл № 10")
    expect(body.candidates[0]).not.toHaveProperty("promotion")
    expect(body.candidates.find((found: Found) => found.name.startsWith("Кетонал 2,5"))?.promotionSay).toBe("10 qutu alana 2 qutu hədiyyə, 30 noyabra qədər")
    expect(short(body.sameNamePromotion!.name)).toBe("Кетонал 2,5% 50 гр")
    expect(body).not.toHaveProperty("substitutes")
    // A product with its own promotion needs no other form's.
    expect(await call.search("Ketonal krem")).not.toHaveProperty("sameNamePromotion")
  })

  it("adds substitutes only when the caller's own product lacks their strength or form", async () => {
    const call = await line()
    const missing = await call.search("Ketonal 100 mq şam")
    expect(missing.substitutes).toBeUndefined()
    const fifty = await call.search("Ketonal ampula 50 mq")
    expect(fifty.substitutes!.map((found: Found) => short(found.name))).toEqual(["Профенид 50 мг № 10"])
    // The caller's strength and form are there: nothing to add.
    expect(await call.search("Ketonal ampula 100 mq")).not.toHaveProperty("substitutes")
    // A name that is not the closest product's own: never that product's substance.
    expect(await call.search("Fluimucil 50 mq")).not.toHaveProperty("substitutes")
  })

  it("offers substitutes for a sold-out product", async () => {
    const labels = feed.labels(org)
    const ampoules = labels.find(label => label.name.startsWith("Кетонал 100"))!
    const gone = nextDeparted({ previous: [], before: [{ ...ampoules, externalId: "44444444-4444-4444-8444-444444444444", name: "Кетонал дуо 100 мг № 10 (Ампулы) (LEK) (Словения)", nameAz: null }], now: labels, at: now })
    const call = await line(catalogOf(createDepartedSearch(gone)))
    const body = await call.search("Ketonal duo")
    expect(body.candidates.at(-1)).toMatchObject({ name: "Кетонал дуо 100 мг № 10 (Ампулы) (LEK) (Словения)", stock: { quantity: 0 } })
    // The ampoules the search shows anyway are no substitute of their own.
    expect(body.substitutes!.map((found: Found) => short(found.name))).toEqual(["Фламакс 100 мг № 10", "Артрозан 100 мг № 10"])
  })

  it("attaches the one end-of-order offer to an ordinary save, never the final one", async () => {
    const call = await line()
    const bisakodil = idOf("Бисакодил")
    const { offer } = await call.save([bisakodil])
    expect(short(offer!.name)).toBe("Диклофенак 50 мг № 20")
    // A product the caller never named: its name in Azerbaijani letters opens the sentence.
    expect(offer!.promotionSay).toBe("Diklofenak, 10 qutu alana 1 qutu hədiyyə, 5 noyabra qədər")
    expect(await call.save([bisakodil], true)).not.toHaveProperty("offer")
  })
})
