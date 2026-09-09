/**
 * Every navigable section must have a guide entry, and every entry must be
 * about a section that exists.
 *
 * The owner counted and caught me: I described 39 sections and reported the
 * number as though it were the job, when the menu has 124. Counting is exactly
 * what he should not have to do.
 */
import { describe, it, expect } from "vitest"
import { VOICE_SECTION_KEYS } from "@/lib/ai/voice/sections"
import { SECTION_GUIDE } from "@/lib/ai/voice/section-guide"

describe("voice section guide coverage", () => {
  it("describes every section in the menu", () => {
    const missing = VOICE_SECTION_KEYS.filter((k) => !(k in SECTION_GUIDE))
    expect(missing).toEqual([])
  })

  it("describes nothing that left the menu", () => {
    const menu = new Set<string>(VOICE_SECTION_KEYS)
    const ghosts = Object.keys(SECTION_GUIDE).filter((k) => !menu.has(k))
    // Was "at most one", tolerating contacts_list — a key left behind by a
    // rename, describing a page the menu reaches as "contacts". That duplicate
    // is gone, so the allowance goes with it: an entry matching nothing is an
    // entry the assistant can read aloud about a page that does not exist.
    expect(ghosts).toEqual([])
  })

  it("gives every entry something to say", () => {
    const thin = Object.entries(SECTION_GUIDE)
      .filter(([, g]) => !g.whatItIs?.trim() || !g.howItWorks?.trim())
      .map(([k]) => k)
    expect(thin).toEqual([])
  })

  it("keeps entries short enough to speak", () => {
    // A sentence that reads fine in review is unusable read aloud. These caps
    // are what the generator trims to; a regression here means raw agent output
    // reached the file.
    const tooLong = Object.entries(SECTION_GUIDE)
      .filter(([, g]) => g.whatItIs.length > 420 || g.howItWorks.length > 720)
      .map(([k]) => k)
    expect(tooLong).toEqual([])
  })
})
