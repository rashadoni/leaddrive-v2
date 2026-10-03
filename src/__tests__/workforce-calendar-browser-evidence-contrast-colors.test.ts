import { describe, expect, it } from "vitest"
import { evaluateTextContrast } from "../../scripts/workforce-calendar-contrast-colors.mjs"

type Interval = [number, number]
type Color = {
  raw: string
  alpha: number
  channels: [Interval, Interval, Interval]
  conversion: string
  unsupportedReason?: string
}
type Run = {
  font: { sizePx: number | null; weight: number | null; family: string }
  foreground: Color
  backgroundLayers: Color[]
  failures: string[]
  textLength: number
  fragments: number
}
type Observation = {
  theme: Record<string, unknown>
  state: { stable: boolean }
  expectedTextMatched: boolean
  textLength: number
  textNodes: number
  renderedFragments: number
  runs: Run[]
  failures: string[]
}

function gray(value: number, alpha = 1): Color {
  return {
    raw: `color(srgb ${value} ${value} ${value} / ${alpha})`, alpha,
    channels: [[value, value], [value, value], [value, value]],
    conversion: "resolved-srgb-exact",
  }
}

function interval(low: number, high: number, alpha = 1): Color {
  return {
    raw: "oklch(0.5 0 0)", alpha,
    channels: [[low, high], [low, high], [low, high]],
    conversion: "off-dom-srgb-canvas-unorm8",
  }
}

function run(foreground = gray(0), backgroundLayers = [gray(1)]): Run {
  return {
    font: { sizePx: 14, weight: 400, family: "Arial" }, foreground, backgroundLayers,
    failures: [], fragments: 1, textLength: 5,
  }
}

function observation(runs = [run()]): Observation {
  return {
    theme: { colorScheme: "light" }, state: { stable: true }, expectedTextMatched: true,
    textLength: runs.reduce((total, value) => total + value.textLength, 0),
    textNodes: runs.length, renderedFragments: runs.reduce((total, value) => total + value.fragments, 0),
    runs, failures: [],
  }
}

describe("bounded rendered text contrast color math", () => {
  it.each([[0, 1], [1, 0]])("measures known black/white contrast as 21 in either direction (%s, %s)", (foreground, background) => {
    const actual = evaluateTextContrast(observation([run(gray(foreground), [gray(background)])]))
    expect(actual.status).toBe("PASS")
    expect(actual.failures).toEqual([])
    expect(actual.runs[0]).toMatchObject({ ratioLower: 21, ratioUpper: 21, threshold: 4.5 })
    expect(actual.minimumRatioLower).toBe(21)
  })

  it("measures equal opaque colors as 1 and fails", () => {
    const actual = evaluateTextContrast(observation([run(gray(0.4), [gray(0.4)])]))
    expect(actual.status).toBe("FAIL")
    expect(actual.runs[0]).toMatchObject({ ratioLower: 1, ratioUpper: 1, status: "FAIL" })
  })

  it("does not round a 4.499 contrast ratio up to 4.5", () => {
    // This fixture fixes the independent target ratio against black, then
    // converts its known linear grayscale luminance to an encoded sRGB value.
    const targetLuminance = 4.499 * 0.05 - 0.05
    const encodedGray = 1.055 * targetLuminance ** (1 / 2.4) - 0.055
    const actual = evaluateTextContrast(observation([run(gray(0), [gray(encodedGray)])]))
    expect(actual.runs[0].ratioLower).toBeCloseTo(4.499, 12)
    expect(actual.runs[0].ratioUpper).toBeLessThan(4.5)
    expect(actual.status).toBe("FAIL")
  })

  it("resolves foreground alpha onto the actual opaque backdrop", () => {
    const actual = evaluateTextContrast(observation([run(gray(0, 0.5), [gray(1)])]))
    expect(actual.runs[0].effectiveForeground).toEqual([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]])
    expect(actual.runs[0].ratioLower).toBeCloseTo(3.976653024912438, 12)
    expect(actual.status).toBe("FAIL")
  })

  it("composites several owner-first backdrop layers in the correct order", () => {
    const actual = evaluateTextContrast(observation([
      run(gray(0, 0.5), [gray(1, 0.25), gray(0, 0.5), gray(1)]),
    ]))
    expect(actual.runs[0].opaqueAncestorIndex).toBe(2)
    expect(actual.runs[0].background).toEqual([[0.625, 0.625], [0.625, 0.625], [0.625, 0.625]])
    expect(actual.runs[0].effectiveForeground).toEqual([[0.3125, 0.3125], [0.3125, 0.3125], [0.3125, 0.3125]])
    expect(actual.runs[0].ratioLower).toBeGreaterThan(3)
    expect(actual.runs[0].ratioUpper).toBeLessThan(4.5)
    expect(actual.status).toBe("FAIL")
  })

  it("uses the nearest opaque layer instead of the outer background", () => {
    const actual = evaluateTextContrast(observation([run(gray(1), [gray(0, 0), gray(0), gray(1)])]))
    expect(actual.status).toBe("PASS")
    expect(actual.runs[0]).toMatchObject({ opaqueAncestorIndex: 1, ratioLower: 21 })
    expect(actual.runs[0].background).toEqual([[0, 0], [0, 0], [0, 0]])
  })

  it("does not assume a white background when no opaque ancestor was observed", () => {
    const actual = evaluateTextContrast(observation([run(gray(0), [gray(1, 0), gray(1, 0.5)])]))
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.minimumRatioLower).toBeNull()
    expect(actual.runs[0].background).toBeNull()
    expect(actual.failures).toContainEqual({ code: "opaque-backdrop-not-observed", path: "runs[0].backgroundLayers" })
  })

  it("measures fully transparent foreground as equal to its backdrop", () => {
    const actual = evaluateTextContrast(observation([run(gray(0, 0), [gray(1)])]))
    expect(actual.status).toBe("FAIL")
    expect(actual.runs[0]).toMatchObject({ ratioLower: 1, ratioUpper: 1 })
  })

  it("retains interval uncertainty when the contrast threshold is crossed", () => {
    const actual = evaluateTextContrast(observation([run(gray(0), [interval(0.4, 0.5)])]))
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.runs[0].ratioLower).toBeLessThan(4.5)
    expect(actual.runs[0].ratioUpper).toBeGreaterThan(4.5)
  })

  it("fails an interval whose maximum possible contrast is below threshold", () => {
    const actual = evaluateTextContrast(observation([run(gray(0), [interval(0.3, 0.4)])]))
    expect(actual.runs[0].ratioUpper).toBeLessThan(4.5)
    expect(actual.status).toBe("FAIL")
  })

  it("passes only when the entire converted color interval meets threshold", () => {
    const actual = evaluateTextContrast(observation([run(gray(1), [interval(0, 1 / 255)])]))
    expect(actual.runs[0].ratioLower).toBeGreaterThan(20)
    expect(actual.runs[0].ratioUpper).toBe(21)
    expect(actual.status).toBe("PASS")
  })

  it("keeps contrast 1 possible for overlapping luminance intervals", () => {
    const actual = evaluateTextContrast(observation([run(interval(0, 1), [gray(1)])]))
    expect(actual.runs[0]).toMatchObject({ ratioLower: 1, ratioUpper: 21 })
    expect(actual.status).toBe("NOT_PROVEN")
  })

  it.each([
    [23.999, 400, 4.5, "FAIL"],
    [24, 400, 3, "PASS"],
    [24, null, 3, "PASS"],
    [18.666666666666664, 700, 4.5, "FAIL"],
    [18.666666666666668, 700, 3, "PASS"],
    [18.666666666666668, 600, 4.5, "FAIL"],
    [18.666666666666668, null, 4.5, "FAIL"],
    [null, 700, 4.5, "FAIL"],
    [Number.NaN, 700, 4.5, "FAIL"],
    [18.666666666666668, Number.POSITIVE_INFINITY, 4.5, "FAIL"],
  ] as const)("uses the exact large-text cutoff for size %s and weight %s", (sizePx, weight, threshold, status) => {
    const sample = run(gray(0), [gray(0.4)])
    sample.font = { sizePx, weight, family: "Arial" }
    const actual = evaluateTextContrast(observation([sample]))
    expect(actual.runs[0].threshold).toBe(threshold)
    expect(actual.status).toBe(status)
  })

  it.each([
    ["NaN channel", (color: Color) => { color.channels[0][0] = Number.NaN }],
    ["infinite channel", (color: Color) => { color.channels[0][1] = Number.POSITIVE_INFINITY }],
    ["negative channel", (color: Color) => { color.channels[1][0] = -0.001 }],
    ["channel above one", (color: Color) => { color.channels[1][1] = 1.001 }],
    ["reversed interval", (color: Color) => { color.channels[2] = [0.8, 0.2] }],
    ["NaN alpha", (color: Color) => { color.alpha = Number.NaN }],
    ["negative alpha", (color: Color) => { color.alpha = -0.1 }],
    ["alpha above one", (color: Color) => { color.alpha = 1.1 }],
    ["unsupported conversion", (color: Color) => { color.conversion = "guessed-color" }],
    ["reported unsupported paint", (color: Color) => { color.unsupportedReason = "unsupported-color-space" }],
  ] as const)("rejects %s instead of calculating a PASS", (_name, mutate) => {
    const color = gray(0)
    mutate(color)
    const actual = evaluateTextContrast(observation([run(color)]))
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.runs[0].ratioLower).toBeNull()
    expect(actual.failures.length).toBeGreaterThan(0)
  })

  it("rejects null channels and alpha after JSON nonfinite serialization", () => {
    const sample = run(gray(0))
    sample.foreground.alpha = Number.NaN
    sample.foreground.channels[0][0] = Number.POSITIVE_INFINITY
    const serialized: unknown = JSON.parse(JSON.stringify(observation([sample])))
    const actual = evaluateTextContrast(serialized)
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.runs[0].ratioLower).toBeNull()
  })

  it("does not hide an unsupported ancestor behind a nearer opaque layer", () => {
    const outer = gray(1)
    outer.unsupportedReason = "unsupported-gradient"
    const actual = evaluateTextContrast(observation([run(gray(1), [gray(0), outer])]))
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.runs[0].ratioLower).toBeNull()
  })

  it("retains reported group-opacity/effect failures despite passing color math", () => {
    const sample = run()
    sample.failures = ["unsupported-group-opacity:2"]
    const actual = evaluateTextContrast(observation([sample]))
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.runs[0].ratioLower).toBe(21)
    expect(actual.failures[0]).toMatchObject({ code: "reported-paint-failure", reason: "unsupported-group-opacity:2" })
  })

  it("retains observation-level theme or focus failures despite passing runs", () => {
    const sample = observation()
    sample.failures = ["default-light-srgb-fixture-not-proven"]
    const actual = evaluateTextContrast(sample)
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.runs[0].status).toBe("PASS")
  })

  it.each([
    ["empty runs", (sample: Observation) => { sample.runs = []; sample.textNodes = 0; sample.renderedFragments = 0 }],
    ["zero text nodes", (sample: Observation) => { sample.textNodes = 0 }],
    ["node count mismatch", (sample: Observation) => { sample.textNodes = 2 }],
    ["fragment count mismatch", (sample: Observation) => { sample.renderedFragments = 2 }],
    ["unrendered run", (sample: Observation) => { sample.runs[0].fragments = 0; sample.renderedFragments = 0 }],
    ["empty run text", (sample: Observation) => { sample.runs[0].textLength = 0 }],
    ["unmatched actual text", (sample: Observation) => { sample.expectedTextMatched = false }],
    ["unstable paint", (sample: Observation) => { sample.state.stable = false }],
  ] as const)("prevents a vacuous PASS for %s", (_name, mutate) => {
    const sample = observation()
    mutate(sample)
    const actual = evaluateTextContrast(sample)
    expect(actual.status).toBe("NOT_PROVEN")
    expect(actual.failures.length).toBeGreaterThan(0)
  })

  it.each([
    null,
    {},
    { ...observation(), theme: null },
    { ...observation(), failures: null },
    { ...observation(), runs: [null] },
    { ...observation(), runs: [{ ...run(), failures: null }] },
    { ...observation(), runs: [{ ...run(), backgroundLayers: [] }] },
    { ...observation(), runs: [{ ...run(), foreground: { ...gray(0), channels: [[0, 0], [0, 0]] } }] },
  ])("does not accept missing or malformed observation fields (%j)", (sample) => {
    expect(evaluateTextContrast(sample).status).toBe("NOT_PROVEN")
  })

  it("reports a failing run and the minimum across all nonempty rendered runs", () => {
    const actual = evaluateTextContrast(observation([run(), run(gray(0.4), [gray(0.4)])]))
    expect(actual.status).toBe("FAIL")
    expect(actual.runs.map(value => value.status)).toEqual(["PASS", "FAIL"])
    expect(actual.minimumRatioLower).toBe(1)
  })

  it("keeps a known failed run blocking when another run is unsupported", () => {
    const unsupported = run()
    unsupported.failures.push("unsupported-filter:0")
    const actual = evaluateTextContrast(observation([unsupported, run(gray(1), [gray(1)])]))
    expect(actual.status).toBe("FAIL")
    expect(actual.runs.map(value => value.status)).toEqual(["NOT_PROVEN", "FAIL"])
  })

  it("does not mutate the browser observation when resolving layers and intervals", () => {
    const sample = observation([run(gray(0), [gray(0, 0.25), interval(0.9, 1)])])
    const before: unknown = structuredClone(sample)
    evaluateTextContrast(sample)
    expect(sample).toEqual(before)
  })
})
