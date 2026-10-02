/**
 * The talking guide's recordings match what it can say (owner, 2026-09-29).
 *
 * A recording is named after its text (guide-voice.ts). Edit a step or a
 * prepared answer and its old file stops matching: this test then fails until
 * `scripts/demo-guide/generate-voice.ts` records the new sentence — so the
 * guide never goes silent on a step, and never reads out yesterday's wording.
 */
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEMO_PREPARED_INTENTS, preparedAnswer, stepNarration } from "@/lib/demo-center/assistant/prepared-answers"
import { DEMO_GUIDE_VOICE_DIR, demoGuideVoiceTexts, demoVoiceKey, demoVoiceUrl, stepVoiceUrl } from "@/lib/demo-center/guide-voice"
import { PROSPECT_TO_CLOSED_WON, withLiveCall } from "@/lib/demo-center/journey"

const DIR = path.join(process.cwd(), "public", DEMO_GUIDE_VOICE_DIR)

describe("every sentence the guide can say is recorded", () => {
  it("has a file for each step and each prepared answer", () => {
    const missing = demoGuideVoiceTexts().filter((text) => !existsSync(path.join(DIR, `${demoVoiceKey(text)}.mp3`)))
    expect(missing, "run scripts/demo-guide/generate-voice.ts").toEqual([])
  })

  it("keeps no recording of a sentence it no longer says", () => {
    const wanted = new Set(demoGuideVoiceTexts().map((text) => `${demoVoiceKey(text)}.mp3`))
    expect(readdirSync(DIR).filter((file) => !wanted.has(file))).toEqual([])
  })

  it("covers both stories — with and without the real AI call", () => {
    const texts = new Set(demoGuideVoiceTexts())
    for (const manifest of [PROSPECT_TO_CLOSED_WON, withLiveCall(PROSPECT_TO_CLOSED_WON)]) {
      for (const step of manifest.sections.flatMap((section) => section.steps)) expect(texts.has(stepNarration(step))).toBe(true)
    }
  })
})

describe("one sentence, one recording", () => {
  it("«where do I click» plays the step's own narration", () => {
    const step = PROSPECT_TO_CLOSED_WON.sections.flatMap((section) => section.steps).find((candidate) => candidate.id === "deal-advance")!
    expect(demoVoiceUrl(preparedAnswer("screen_help", { step })!)).toBe(stepVoiceUrl(step))
  })

  it("a changed word is a new file, the same text the same one", () => {
    const text = DEMO_PREPARED_INTENTS.price.answer()
    expect(demoVoiceKey(text)).toBe(demoVoiceKey(`${text}`))
    expect(demoVoiceKey(text)).not.toBe(demoVoiceKey(`${text} `))
    expect(demoVoiceKey(text)).toMatch(/^[0-9a-f]{16}$/)
  })
})
