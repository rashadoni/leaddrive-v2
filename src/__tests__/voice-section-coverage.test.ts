/**
 * Every menu section must be classified, and every descriptor must be real.
 *
 * This test is the answer to a specific complaint. The owner kept finding
 * sections the assistant could not talk about — leads, quotes, boards — one at
 * a time, by asking. He was doing the QA. Attention was never going to fix
 * that; a gap has to fail here, before a conversation.
 *
 * "Classified" deliberately includes deciding a section has nothing to report.
 * An unclassified section and a deliberate omission look identical unless the
 * omission is written down, so writing it down is the requirement.
 */
import { describe, it, expect } from "vitest"
import { VOICE_SECTION_KEYS } from "@/lib/ai/voice/sections"
import {
  SECTION_DESCRIPTORS,
  NO_DATA_SECTIONS,
  unclassifiedSections,
  pendingSections,
} from "@/lib/ai/voice/section-registry"

describe("voice section coverage", () => {
  it("classifies every section in the menu", () => {
    expect(unclassifiedSections()).toEqual([])
  })

  it("classifies nothing that is not in the menu", () => {
    const menu = new Set<string>(VOICE_SECTION_KEYS)
    const ghosts = [...Object.keys(SECTION_DESCRIPTORS), ...Object.keys(NO_DATA_SECTIONS)]
      .filter((k) => !menu.has(k))
    // A key here that the menu does not have is a rename nobody followed
    // through — it silently describes a page that no longer exists.
    expect(ghosts).toEqual([])
  })

  it("gives every descriptor a currency whenever it has an amount", () => {
    // Money without its currency is the mistake that lets 10 000 AZN and
    // 10 000 USD be added into "20 000 of nothing".
    const broken = Object.entries(SECTION_DESCRIPTORS)
      .filter(([, d]) => Boolean(d.amountField) !== Boolean(d.currencyField))
      .map(([k]) => k)
    expect(broken).toEqual([])
  })

  it("only marks closed statuses on entities that have a status field", () => {
    const broken = Object.entries(SECTION_DESCRIPTORS)
      .filter(([, d]) => d.closedStatuses && !d.statusField)
      .map(([k]) => k)
    expect(broken).toEqual([])
  })

  it("gives every descriptor a role permission, not just a paid module", () => {
    // The two are different questions and both must be answered. Without the
    // permission axis, voice becomes a way around the role matrix: the org owns
    // the module, so a role that cannot see the screen still hears the numbers.
    const missing = Object.entries(SECTION_DESCRIPTORS)
      .filter(([, d]) => !d.permission)
      .map(([k]) => k)
    expect(missing).toEqual([])
  })

  it("reports how much is still undescribed", () => {
    // Not an assertion — a visible number. Pending means "a real data surface
    // nobody has described yet", and it should shrink, not hide.
    const pending = pendingSections()
    // eslint-disable-next-line no-console
    console.log(`voice: ${Object.keys(SECTION_DESCRIPTORS).length} described, ${pending.length} pending: ${pending.join(", ")}`)
    expect(Array.isArray(pending)).toBe(true)
  })
})
