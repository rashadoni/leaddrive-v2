/**
 * D1/D2 — MEDDPICC shape parsing and rollup. The status thresholds drive the
 * deal-tab badge AND the list-column sort, so they are pinned here.
 */
import { describe, it, expect } from "vitest"
import { parseMeddpicc, summarizeMeddpicc, scoreBucket, MEDDPICC_BLOCKS } from "@/lib/meddpicc"

describe("parseMeddpicc", () => {
  it("keeps only known blocks with valid scores and bounded strings", () => {
    const parsed = parseMeddpicc({
      metrics: { score: 4, note: "ROI 30%", next: "confirm with CFO" },
      champion: { score: 99, note: 42, next: "call" }, // bad score + bad note
      bogusBlock: { score: 5 },
      economicBuyer: "not-an-object",
    })
    expect(parsed.metrics).toEqual({ score: 4, note: "ROI 30%", next: "confirm with CFO" })
    expect(parsed.champion).toEqual({ score: undefined, note: undefined, next: "call" })
    expect(parsed).not.toHaveProperty("bogusBlock")
    expect(parsed).not.toHaveProperty("economicBuyer")
  })

  it("survives garbage input", () => {
    for (const bad of [null, undefined, 42, "x", [1, 2]]) {
      expect(parseMeddpicc(bad)).toEqual({})
    }
  })
})

describe("summarizeMeddpicc", () => {
  const all = (score: number) =>
    Object.fromEntries(MEDDPICC_BLOCKS.map((k) => [k, { score }]))

  it("nothing scored → unscored", () => {
    expect(summarizeMeddpicc({}).status).toBe("unscored")
    expect(summarizeMeddpicc({}).avgScore).toBeNull()
  })

  it("all 5s → green, 40/40", () => {
    const s = summarizeMeddpicc(all(5))
    expect(s).toMatchObject({ scored: 8, totalScore: 40, maxScore: 40, status: "green" })
  })

  it("low average → red", () => {
    expect(summarizeMeddpicc(all(2)).status).toBe("red")
  })

  it("middling average → yellow", () => {
    expect(summarizeMeddpicc(all(3)).status).toBe("yellow")
  })

  it("high average with an UNSCORED block caps at yellow (a gap is a risk)", () => {
    const data = all(5)
    delete (data as Record<string, unknown>).paperProcess
    const s = summarizeMeddpicc(data)
    expect(s.scored).toBe(7)
    expect(s.avgScore).toBe(5)
    expect(s.status).toBe("yellow")
  })
})

describe("scoreBucket", () => {
  it("maps the roadmap's color rule: red 1-2 / yellow 3 / green 4-5", () => {
    expect(scoreBucket(undefined)).toBe("none")
    expect(scoreBucket(1)).toBe("red")
    expect(scoreBucket(2)).toBe("red")
    expect(scoreBucket(3)).toBe("yellow")
    expect(scoreBucket(4)).toBe("green")
    expect(scoreBucket(5)).toBe("green")
  })
})
