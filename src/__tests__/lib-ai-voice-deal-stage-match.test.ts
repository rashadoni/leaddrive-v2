import { describe, expect, it } from "vitest"

import { matchDealStage, type PipelineStageOption } from "@/lib/ai/voice/deal-stage-match"

/**
 * Moving a deal by voice (owner request, 2026-09-28). The destination is always
 * one of the stages the organisation configured for that deal's pipeline —
 * `Deal.stage` is a free string, and a model guessing "Qualified" for an org
 * that calls it something else is how a deal lands in no column at all.
 */
const stage = (over: Partial<PipelineStageOption> & { name: string }): PipelineStageOption => ({
  displayName: over.name,
  isWon: false,
  isLost: false,
  ...over,
})

const DEFAULT: PipelineStageOption[] = [
  stage({ name: "LEAD", displayName: "Lead" }),
  stage({ name: "QUALIFIED", displayName: "Qualified" }),
  stage({ name: "PROPOSAL", displayName: "Proposal" }),
  stage({ name: "NEGOTIATION", displayName: "Negotiation" }),
  stage({ name: "WON", displayName: "Won", isWon: true }),
  stage({ name: "LOST", displayName: "Lost", isLost: true }),
]

describe("what stage the user named", () => {
  it.each([
    ["negotiation", "NEGOTIATION"],
    ["Negotiation", "NEGOTIATION"],
    ["переговоры", "NEGOTIATION"],
    ["в переговорах", "NEGOTIATION"],
    ["danışıqlar", "NEGOTIATION"],
    ["предложение", "PROPOSAL"],
    ["təklif", "PROPOSAL"],
    ["квалификация", "QUALIFIED"],
    ["выиграна", "WON"],
    ["qazanıldı", "WON"],
    ["проиграна", "LOST"],
    ["uduzdu", "LOST"],
  ])("%s → %s", (spoken, expected) => {
    const match = matchDealStage(spoken, DEFAULT)
    expect(match.ok && match.stage.name).toBe(expected)
  })

  // The organisation's own spelling is the authority; the built-in synonyms are
  // only a bridge from the spoken language to it.
  it("uses the organisation's own stage names when they are renamed", () => {
    const renamed = [
      stage({ name: "Yeni", displayName: "Yeni müştəri" }),
      stage({ name: "Danışıqlar", displayName: "Danışıqlar" }),
      stage({ name: "Qazanıldı", displayName: "Qazanıldı", isWon: true }),
    ]
    expect(matchDealStage("danışıqlar", renamed)).toMatchObject({ stage: { name: "Danışıqlar" } })
    expect(matchDealStage("переговоры", renamed)).toMatchObject({ stage: { name: "Danışıqlar" } })
    // "Won" is this pipeline's won stage, whatever it is called.
    expect(matchDealStage("выиграна", renamed)).toMatchObject({ stage: { name: "Qazanıldı" } })
  })

  it("cannot select a stage the pipeline does not have", () => {
    const short = [stage({ name: "LEAD" }), stage({ name: "WON", isWon: true })]
    const match = matchDealStage("переговоры", short)
    expect(match.ok).toBe(false)
    if (!match.ok) expect(match.options.map((option) => option.name)).toEqual(["LEAD", "WON"])
  })

  it("asks instead of guessing when several stages fit", () => {
    const twoWon = [
      stage({ name: "WON_SMALL", displayName: "Won small", isWon: true }),
      stage({ name: "WON_BIG", displayName: "Won big", isWon: true }),
    ]
    const match = matchDealStage("выиграна", twoWon)
    expect(match.ok).toBe(false)
    if (!match.ok) {
      expect(match.ambiguous).toBe(true)
      expect(match.options).toHaveLength(2)
    }
  })

  it("offers the whole list when the words mean nothing here", () => {
    const match = matchDealStage("на потом", DEFAULT)
    expect(match.ok).toBe(false)
    if (!match.ok) expect(match.options).toHaveLength(6)
  })

  it("has nothing to offer when the pipeline has no stages", () => {
    expect(matchDealStage("won", [])).toMatchObject({ ok: false, options: [] })
  })
})
