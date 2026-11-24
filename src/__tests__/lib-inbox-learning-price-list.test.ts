import { describe, expect, it } from "vitest"
import { packageBody, parsePriceListReply } from "@/lib/inbox/learning/price-list"

/** «Вставить прайс»: the model's answer is kept only where its prices are the pasted text's own. */
const SOURCE = `Sizin üçün xüsusi paket: 160 AZN / ay
Daxildir: AI zəng köməkçisi, 500 dəqiqə (təxminən 250 zəng); Kanada nömrəsi
Biznes paket — 1 500 AZN / il`

const reply = (packages: unknown) => JSON.stringify({ packages })

describe("the pasted price list", () => {
  it("keeps packages whose prices are in the text, with what is included", () => {
    expect(parsePriceListReply(reply([
      { title: "Xüsusi paket", price: "160 AZN / ay", includes: ["AI zəng köməkçisi, 500 dəqiqə", "Kanada nömrəsi"] },
      { title: "Biznes", price: "1500 AZN / il", includes: [] },
    ]), SOURCE)).toEqual([
      { title: "Xüsusi paket", price: "160 AZN / ay", includes: ["AI zəng köməkçisi, 500 dəqiqə", "Kanada nömrəsi"] },
      { title: "Biznes", price: "1500 AZN / il", includes: [] },
    ])
  })

  it("drops a package whose price the text never named — no rounding, no invented discount", () => {
    expect(parsePriceListReply(reply([
      { title: "Xüsusi paket", price: "150 AZN / ay", includes: [] },
      { title: "Endirim", price: "120 AZN", includes: [] },
      { title: "Pulsuz", price: "pulsuz", includes: [] },
    ]), SOURCE)).toEqual([])
  })

  it("drops anything malformed rather than half-keeping it", () => {
    expect(parsePriceListReply("not json", SOURCE)).toEqual([])
    expect(parsePriceListReply('{"packages":"x"}', SOURCE)).toEqual([])
    expect(parsePriceListReply(reply([{ title: "", price: "160 AZN" }, { price: "160 AZN" }, null]), SOURCE)).toEqual([])
  })

  it("reads the answer even with words around the JSON", () => {
    expect(parsePriceListReply(`Here:\n${reply([{ title: "Paket", price: "160 AZN", includes: ["x"] }])}\nDone`, SOURCE)).toHaveLength(1)
  })

  it("writes one knowledge row: the price, then what is included", () => {
    expect(packageBody({ title: "Paket", price: "160 AZN / ay", includes: ["500 dəqiqə", "Kanada nömrəsi"] }))
      .toBe("160 AZN / ay\n• 500 dəqiqə\n• Kanada nömrəsi")
  })
})
