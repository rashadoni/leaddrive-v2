import { describe, expect, it } from "vitest"

import { normalizeCallSource } from "@/app/api/internal/voice-agent/call-source/route"

describe("voice agent call source", () => {
  it("maps the channels a customer would recognise", () => {
    expect(normalizeCallSource("tiktok")).toBe("tiktok")
    expect(normalizeCallSource("TikTok")).toBe("tiktok")
    expect(normalizeCallSource("  Instagram  ")).toBe("instagram")
    // Several spellings of the same origin have to land on one answer, or the
    // assistant says "web_form" out loud to a customer.
    expect(normalizeCallSource("web-to-lead")).toBe("web")
    expect(normalizeCallSource("Web Form")).toBe("web")
  })

  it("refuses to speak anything it was not taught", () => {
    // source is free text in the wild: imports, campaign names, whatever an
    // operator typed. The assistant may only name a channel from the fixed
    // list, and otherwise says nothing rather than reading data aloud.
    expect(normalizeCallSource("Summer campaign 2026")).toBeNull()
    expect(normalizeCallSource("referral from Elvin")).toBeNull()
    expect(normalizeCallSource("")).toBeNull()
    expect(normalizeCallSource(null)).toBeNull()
    expect(normalizeCallSource(undefined)).toBeNull()
    expect(normalizeCallSource(42)).toBeNull()
  })
})
