import { describe, it, expect } from "vitest"
import { resolveStageVocabulary } from "@/lib/deal-stage-normalization"

/**
 * The stage list below is not invented — it is what the production tenant
 * actually stores, read off the database while chasing a dashboard that showed
 * zeros. Seven spellings for five stages, because deals arrive from a
 * configurable pipeline, from imports and from seed scripts, and nothing ever
 * forced them to agree.
 *
 * A synthetic list would have proved the function works on inputs I chose. The
 * point of the bug was that I chose wrong.
 */
const PRODUCTION_STAGES = [
  "WON",
  "LEAD",
  "lead",
  "PROPOSAL",
  "QUALIFIED",
  "CLOSED_WON",
  "LOST",
]

describe("resolveStageVocabulary", () => {
  it("collects every spelling of won, not just the canonical one", () => {
    const { wonStages } = resolveStageVocabulary(PRODUCTION_STAGES)
    expect(wonStages).toContain("WON")
    // The deal that was missing from revenue while being counted as open.
    expect(wonStages).toContain("CLOSED_WON")
  })

  it("keeps open stages out of the closed set even when case differs", () => {
    const { closedStages } = resolveStageVocabulary(PRODUCTION_STAGES)
    expect(closedStages).not.toContain("lead")
    expect(closedStages).not.toContain("LEAD")
    expect(closedStages).not.toContain("PROPOSAL")
    expect(closedStages).not.toContain("QUALIFIED")
  })

  it("treats WON and LOST as closed for an org with no deals at all", () => {
    const { wonStages, lostStages, closedStages } = resolveStageVocabulary([])
    expect(wonStages).toEqual(["WON"])
    expect(lostStages).toEqual(["LOST"])
    expect(closedStages).toEqual(["WON", "LOST"])
  })

  it("honours per-org pipeline stages that carry no recognisable name", () => {
    const { wonStages, lostStages } = resolveStageVocabulary(
      ["Müqavilə imzalandı", "İmtina"],
      ["Müqavilə imzalandı"],
      ["İmtina"],
    )
    expect(wonStages).toContain("Müqavilə imzalandı")
    expect(lostStages).toContain("İmtina")
  })

  it("does not report a stage as both won and lost", () => {
    const { wonStages, lostStages } = resolveStageVocabulary(PRODUCTION_STAGES)
    expect(wonStages.filter((s) => lostStages.includes(s))).toEqual([])
  })
})

describe("resolveStageVocabulary — настроенные стадии", () => {
  it("держит объявленную организацией стадию победы, даже если в ней пока нет сделок", () => {
    // Регрессия: словарь собирался только из написаний, встреченных в сделках,
    // поэтому настроенная стадия исчезала из фильтра ровно до момента, когда в
    // неё кто-нибудь что-нибудь положит. Набор фильтра не имеет права зависеть
    // от сегодняшних данных. Поймано тестом api-campaign-roi.
    const { wonStages, lostStages } = resolveStageVocabulary([], ["Closed Won"], ["Отказ"])
    expect(wonStages).toContain("Closed Won")
    expect(lostStages).toContain("Отказ")
    expect(wonStages).toContain("WON")
  })
})
