import { describe, expect, it } from "vitest"
import { compareSupportPerformance } from "../../scripts/support-ux-performance-compare.mjs"

const baseline = {
  performance: { loadP75: 1000, filterP50: 200, interactionP75: 120, cumulativeLayoutShift: 0.02 },
  metrics: { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
}

describe("Support UX performance comparison", () => {
  it("passes an unchanged or improved comparable matrix", () => {
    expect(compareSupportPerformance(
      { loadP75: 950, filterP50: 180, interactionP75: 110, cumulativeLayoutShift: 0.01 },
      { primaryWorkTop: 280, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
    )).toEqual({ status: "matched", regressions: [] })
  })

  it("uses the larger relative or absolute allowance for timing", () => {
    const within = compareSupportPerformance(
      { loadP75: 1100, filterP50: 250, interactionP75: 170, cumulativeLayoutShift: 0.02 },
      { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
    )
    expect(within.status).toBe("matched")
    const outside = compareSupportPerformance(
      { loadP75: 1101, filterP50: 251, interactionP75: 171, cumulativeLayoutShift: 0.02 },
      { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
    )
    expect(outside).toMatchObject({
      status: "regressed",
      regressions: [
        { metric: "loadP75", baseline: 1000, limit: 1100 },
        { metric: "filterP50", baseline: 200, limit: 250 },
        { metric: "interactionP75", baseline: 120, limit: 170 },
      ],
    })
  })

  it("uses an evidence-derived absolute budget when repeatability noise is wider", () => {
    const result = compareSupportPerformance(
      { loadP75: 1450, filterP50: 470, cumulativeLayoutShift: 0.02 },
      { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
      { loadP75: 1500, filterP50: 500 },
    )
    expect(result.status).toBe("matched")

    const outside = compareSupportPerformance(
      { loadP75: 1501, filterP50: 501, cumulativeLayoutShift: 0.02 },
      { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
      { loadP75: 1500, filterP50: 500 },
    )
    expect(outside).toMatchObject({
      status: "regressed",
      regressions: [
        { metric: "loadP75", limit: 1500 },
        { metric: "filterP50", limit: 500 },
      ],
    })
  })

  it("fails movement, density growth and layout-shift regressions", () => {
    const result = compareSupportPerformance(
      { loadP75: null, filterP50: null, interactionP75: null, cumulativeLayoutShift: 0.03 },
      { primaryWorkTop: 301, renderedRows: 51, borderedRoundedBlocks: 9 },
      baseline,
    )
    expect(result.status).toBe("regressed")
    expect(result.regressions.map((item: { metric: string }) => item.metric)).toEqual([
      "primaryWorkTop",
      "renderedRows",
      "borderedRoundedBlocks",
      "cumulativeLayoutShift",
    ])
  })

  it("ignores sub-millipoint CLS sampling noise but blocks a material increase", () => {
    const within = compareSupportPerformance(
      { cumulativeLayoutShift: 0.0209 },
      { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
    )
    expect(within.status).toBe("matched")

    const outside = compareSupportPerformance(
      { cumulativeLayoutShift: 0.0221 },
      { primaryWorkTop: 300, renderedRows: 50, borderedRoundedBlocks: 8 },
      baseline,
    )
    expect(outside).toMatchObject({
      status: "regressed",
      regressions: [{ metric: "cumulativeLayoutShift", baseline: 0.02, limit: 0.022 }],
    })
  })

  it("fails closed when comparable metrics are missing", () => {
    expect(compareSupportPerformance({}, {}, null)).toEqual({ status: "baseline_matrix_missing", regressions: [] })
  })
})
