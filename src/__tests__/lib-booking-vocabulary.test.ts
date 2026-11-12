/**
 * What an organisation calls what it books.
 *
 * The module was written for salons, so «service» and «master» were facts of
 * the code. A coworking books a room and nobody does it; a clinic books an
 * appointment with a doctor (owner, 2026-11-12). What is checked here is the
 * reading of that setting, because every screen and the client's own WhatsApp
 * form read it — and a setting that says one thing on one screen and another
 * on the next is worse than no setting at all.
 */
import { describe, expect, it } from "vitest"
import {
  BOOKING_VOCABULARY_PRESETS,
  BOOKING_VOCABULARY_SETTING,
  matchingPreset,
  readBookingVocabulary,
} from "@/lib/booking/vocabulary"

const stored = (value: unknown) => readBookingVocabulary({ [BOOKING_VOCABULARY_SETTING]: value })

describe("the two nouns an organisation books by", () => {
  it("are nothing at all until the organisation says otherwise", () => {
    // An organisation that never opened the screen must read exactly as it
    // did before the setting existed: null is «use your own translation».
    for (const settings of [undefined, null, {}, { [BOOKING_VOCABULARY_SETTING]: null }, { [BOOKING_VOCABULARY_SETTING]: "Otaq" }]) {
      expect(readBookingVocabulary(settings)).toEqual({ item: null, host: null, noHost: false })
    }
  })

  it("are kept as typed, trimmed and bounded", () => {
    expect(stored({ item: "  Otaq  ", host: "Zal" })).toMatchObject({ item: "Otaq", host: "Zal" })
    expect(stored({ item: "Toplantı    otağı" }).item).toBe("Toplantı otağı")
    // Thirty characters is what a dropdown label and a WhatsApp row both hold.
    expect(stored({ item: "o".repeat(80) }).item).toHaveLength(30)
    // An empty field is «not filled in», never a word.
    expect(stored({ item: "   ", host: "" })).toEqual({ item: null, host: null, noHost: false })
  })

  it("cannot both name the other side and say there is none", () => {
    // The screens read one field. A name kept for a row that is hidden is a
    // trap for whoever reads the setting next — and for the published form,
    // which would carry a dropdown nobody can see.
    expect(stored({ item: "Otaq", host: "Zal", noHost: true })).toEqual({ item: "Otaq", host: null, noHost: true })
  })

  it("come ready-made for the businesses that ask for them", () => {
    // One tap is the whole setting for most organisations: the fields exist
    // for the ones none of these fit.
    expect(BOOKING_VOCABULARY_PRESETS.length).toBeGreaterThanOrEqual(4)
    for (const preset of BOOKING_VOCABULARY_PRESETS) {
      for (const locale of ["az", "ru", "en"] as const) {
        const words = preset.words[locale]
        expect(words.item, `${preset.id}/${locale}`).toBeTruthy()
        expect(words.item.length).toBeLessThanOrEqual(30)
        // «Nobody does it» and «they are called this» are the same two states
        // the reader enforces; a preset that disagreed would save a setting
        // the reader then changes under it.
        expect(Boolean(words.host), `${preset.id}/${locale}`).toBe(!preset.noHost)
      }
    }
    // Somebody must book rooms with nobody on the other side.
    expect(BOOKING_VOCABULARY_PRESETS.some((preset) => preset.noHost)).toBe(true)
  })

  it("tells the screen which pair is chosen, and when none is", () => {
    const rooms = BOOKING_VOCABULARY_PRESETS.find((preset) => preset.noHost)!
    const words = rooms.words.ru
    expect(matchingPreset({ item: words.item, host: null, noHost: true }, "ru")).toBe(rooms.id)
    expect(matchingPreset({ item: "Станок", host: "Цех", noHost: false }, "ru")).toBeNull()
    expect(matchingPreset({ item: null, host: null, noHost: false }, "ru")).toBeNull()
  })
})
