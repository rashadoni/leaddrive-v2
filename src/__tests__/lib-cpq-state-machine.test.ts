/**
 * S6 CPQ — state-machine pure-function tests.
 *
 * Covers every transition allowed by `QUOTE_TRANSITIONS` + every
 * illegal pair + boundary cases (unknown status string, no-op).
 */
import { describe, it, expect } from "vitest"
import { transitionQuote, timestampFieldFor } from "@/lib/cpq/state-machine"
import { QUOTE_TRANSITIONS, QUOTE_STATUSES } from "@/lib/cpq/types"

describe("transitionQuote — legal transitions", () => {
  it("draft → sent ✅", () => {
    expect(transitionQuote("draft", "sent")).toEqual({ ok: true })
  })
  it("draft → expired ✅", () => {
    expect(transitionQuote("draft", "expired")).toEqual({ ok: true })
  })
  it("sent → viewed ✅", () => {
    expect(transitionQuote("sent", "viewed")).toEqual({ ok: true })
  })
  it("sent → rejected ✅", () => {
    expect(transitionQuote("sent", "rejected")).toEqual({ ok: true })
  })
  it("sent → expired ✅", () => {
    expect(transitionQuote("sent", "expired")).toEqual({ ok: true })
  })
  it("viewed → accepted ✅", () => {
    expect(transitionQuote("viewed", "accepted")).toEqual({ ok: true })
  })
  it("viewed → rejected ✅", () => {
    expect(transitionQuote("viewed", "rejected")).toEqual({ ok: true })
  })
  it("viewed → expired ✅", () => {
    expect(transitionQuote("viewed", "expired")).toEqual({ ok: true })
  })
})

describe("transitionQuote — illegal transitions", () => {
  it("draft → viewed (must go through sent first)", () => {
    const r = transitionQuote("draft", "viewed")
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/illegal/)
  })
  it("draft → accepted", () => {
    const r = transitionQuote("draft", "accepted")
    expect(r.ok).toBe(false)
  })
  it("sent → accepted (must view first)", () => {
    const r = transitionQuote("sent", "accepted")
    expect(r.ok).toBe(false)
  })
  it("accepted → draft (no rollback from terminal)", () => {
    const r = transitionQuote("accepted", "draft")
    expect(r.ok).toBe(false)
  })
  it("rejected → sent (no rollback from terminal)", () => {
    const r = transitionQuote("rejected", "sent")
    expect(r.ok).toBe(false)
  })
  it("expired → sent (no rollback from terminal)", () => {
    const r = transitionQuote("expired", "sent")
    expect(r.ok).toBe(false)
  })
})

describe("transitionQuote — input validation", () => {
  it("rejects no-op transitions", () => {
    const r = transitionQuote("draft", "draft")
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no-op/)
  })
  it("rejects unknown source status", () => {
    const r = transitionQuote("invalid_state", "sent")
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unknown quote status/)
  })
  it("rejects unknown target status", () => {
    const r = transitionQuote("draft", "fubar")
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unknown quote target status/)
  })
  it("rejects non-string input", () => {
    const r = transitionQuote(42, "sent")
    expect(r.ok).toBe(false)
  })
})

describe("timestampFieldFor", () => {
  it("sent → sentAt", () => {
    expect(timestampFieldFor("sent")).toBe("sentAt")
  })
  it("viewed → viewedAt", () => {
    expect(timestampFieldFor("viewed")).toBe("viewedAt")
  })
  it("accepted → acceptedAt", () => {
    expect(timestampFieldFor("accepted")).toBe("acceptedAt")
  })
  it("rejected → rejectedAt", () => {
    expect(timestampFieldFor("rejected")).toBe("rejectedAt")
  })
  it("expired → null (no dedicated timestamp field)", () => {
    expect(timestampFieldFor("expired")).toBe(null)
  })
  it("draft → null (initial state, no timestamp)", () => {
    expect(timestampFieldFor("draft")).toBe(null)
  })
})

describe("QUOTE_TRANSITIONS structure", () => {
  it("covers every QUOTE_STATUS as a key", () => {
    for (const s of QUOTE_STATUSES) {
      expect(QUOTE_TRANSITIONS[s]).toBeDefined()
    }
  })
  it("terminal states have empty transition arrays", () => {
    expect(QUOTE_TRANSITIONS.accepted).toEqual([])
    expect(QUOTE_TRANSITIONS.rejected).toEqual([])
    expect(QUOTE_TRANSITIONS.expired).toEqual([])
  })
  it("never lists draft as a target (no rollback to draft)", () => {
    for (const s of QUOTE_STATUSES) {
      expect(QUOTE_TRANSITIONS[s]).not.toContain("draft")
    }
  })
})
