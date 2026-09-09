import { describe, expect, it } from "vitest"
import {
  DEFAULT_RELEVANCE_GATES,
  evaluateGoldDataset,
  evaluateRelevanceGates,
  GOLD_DATASET_SCHEMA_VERSION,
  type GoldDataset,
} from "@/lib/social/relevance-evaluator"
import { RELEVANCE_GOLD_SEED } from "@/lib/social/relevance-gold-seed"

function itemResult(report: ReturnType<typeof evaluateGoldDataset>, id: string) {
  const found = report.items.find((i) => i.id === id)
  if (!found) throw new Error(`item ${id} missing`)
  return found
}

describe("offline relevance evaluator — synthetic seed", () => {
  const report = evaluateGoldDataset(RELEVANCE_GOLD_SEED)

  it("scores the synthetic seed with honest aggregate metrics", () => {
    expect(report.schemaVersion).toBe(GOLD_DATASET_SCHEMA_VERSION)
    expect(report.total).toBe(15)
    expect(report.recall).toBeCloseTo(0.9, 5)
    expect(report.precision).toBeCloseTo(1, 5)
    expect(report.reviewRate).toBeCloseTo(1 / 15, 5)
    expect(report.falseNegativeDiscovery).toBe(1)
    expect(report.falseNegativeRelevance).toBe(0)
  })

  it("classifies clear mentions as ACCEPTED across alias/handle/translit/typo/sarcasm", () => {
    for (const id of ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g15"]) {
      expect(itemResult(report, id).predicted, id).toBe("ACCEPTED")
    }
  })

  it("rejects short-ambiguous and missing-context cases fail-closed", () => {
    for (const id of ["g8", "g9"]) {
      expect(itemResult(report, id).predicted, id).toBe("REJECTED")
    }
    expect(itemResult(report, "g10").predicted).toBe("REVIEW")
  })

  it("rejects negative-alias, exclusion and off-topic items", () => {
    for (const id of ["g12", "g13"]) {
      expect(itemResult(report, id).predicted, id).toBe("REJECTED")
    }
  })

  it("accepts a mention discovered only via a trusted owned source", () => {
    const g11 = itemResult(report, "g11")
    expect(g11.predicted).toBe("ACCEPTED")
    expect(g11.matchedExpectedSubject).toBe(true)
  })

  it("flags the declension miss as a false-negative discovery", () => {
    const g14 = itemResult(report, "g14")
    expect(g14.predicted).toBe("REJECTED")
    expect(g14.falseNegativeType).toBe("discovery")
    expect(report.byChallenge.declension?.recall).toBe(0)
  })

  it("breaks metrics down by locale", () => {
    expect(report.byLocale.en.recall).toBeCloseTo(1, 5)
    expect(report.byLocale.az.recall).toBeCloseTo(1, 5)
    // ru recall is dragged down by the declension miss (g14)
    expect(report.byLocale.ru.recall).toBeCloseTo(0.5, 5)
  })
})

describe("relevance gates", () => {
  const report = evaluateGoldDataset(RELEVANCE_GOLD_SEED)

  it("blocks the default gate when one locale misses despite a passing aggregate", () => {
    const gates = evaluateRelevanceGates(report)
    expect(DEFAULT_RELEVANCE_GATES).toEqual({ minRecall: 0.9, minPrecision: 0.9 })
    expect(gates.pass).toBe(false)
    expect(gates.recall.pass).toBe(true)
    expect(gates.precision.pass).toBe(true)
    expect(gates.cohorts.find(cohort => cohort.dimension === "locale" && cohort.key === "ru")).toMatchObject({
      pass: false,
      recall: { value: 0.5, threshold: 0.9, pass: false },
    })
  })

  it("fails when a stricter recall threshold is demanded", () => {
    const gates = evaluateRelevanceGates(report, { minRecall: 0.95, minPrecision: 0.85 })
    expect(gates.pass).toBe(false)
    expect(gates.recall.pass).toBe(false)
    expect(gates.precision.pass).toBe(true)
  })
})

describe("recall/precision math on a controlled fixture", () => {
  // One true positive, one false negative (relevant → rejected), one false
  // positive (irrelevant → accepted): recall 1/2, precision 1/2.
  const dataset: GoldDataset = {
    schemaVersion: GOLD_DATASET_SCHEMA_VERSION,
    datasetVersion: "math-fixture",
    locales: ["en"],
    subjects: [
      {
        id: "subj",
        aliases: [
          { value: "Zenithcorp", kind: "IDENTITY", weight: 0.9 },
          { value: "Zed", kind: "IDENTITY", weight: 0.9, isAmbiguous: false },
        ],
      },
    ],
    items: [
      { id: "tp", locale: "en", kind: "POST", text: "Zenithcorp shipped a great update", expected: "ACCEPTED", expectedSubjectId: "subj" },
      { id: "fn", locale: "en", kind: "POST", text: "totally unrelated gardening tips", expected: "ACCEPTED", expectedSubjectId: "subj" },
      { id: "fp", locale: "en", kind: "POST", text: "Zed shipped a great update", expected: "REJECTED" },
    ],
  }

  it("computes recall and precision from the confusion of expected vs predicted", () => {
    const report = evaluateGoldDataset(dataset)
    // tp accepted; fn has no alias → rejected; fp matches "Zed" identity → accepted
    expect(report.recall).toBeCloseTo(0.5, 5)
    expect(report.precision).toBeCloseTo(0.5, 5)
    expect(report.falseNegativeDiscovery).toBe(1)
  })
})
