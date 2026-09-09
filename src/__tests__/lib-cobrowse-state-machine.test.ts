/**
 * T8 Cobrowse — state machine tests.
 *
 * Pins the 4 invariants documented in `state-machine.ts`:
 *   1. consent gate — active requires consentGivenAt
 *   2. pending cannot leap to active
 *   3. paused ↔ active loop
 *   4. ended is terminal
 *
 * A regression in any of these is a behavioral bug surfaced as
 * a 409 cascade through the slice-2 signaling routes. Test the
 * pure helper here so it's not coupled to Prisma mocks.
 */
import { describe, it, expect } from "vitest"
import { allowedNextStates, canTransition } from "@/lib/cobrowse/state-machine"
import type { CobrowseStatus } from "@/lib/cobrowse/types"

function ctx(currentStatus: CobrowseStatus, consentGiven = false) {
  return { currentStatus, consentGiven }
}

describe("canTransition — pending", () => {
  it("→ awaiting_consent (customer joined)", () => {
    expect(canTransition(ctx("pending"), "awaiting_consent").ok).toBe(true)
  })

  it("→ ended (agent cancelled before customer joined)", () => {
    expect(canTransition(ctx("pending"), "ended").ok).toBe(true)
  })

  it("CANNOT → active directly (consent gate)", () => {
    const r = canTransition(ctx("pending", true), "active")
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("invalid_transition")
  })

  it("CANNOT → paused", () => {
    const r = canTransition(ctx("pending"), "paused")
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("invalid_transition")
  })
})

describe("canTransition — awaiting_consent", () => {
  it("→ active WITH consent", () => {
    expect(canTransition(ctx("awaiting_consent", true), "active").ok).toBe(true)
  })

  it("rejects → active WITHOUT consent", () => {
    const r = canTransition(ctx("awaiting_consent", false), "active")
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("consent_required")
  })

  it("→ ended (customer declined consent)", () => {
    expect(canTransition(ctx("awaiting_consent"), "ended").ok).toBe(true)
  })

  it("CANNOT → paused", () => {
    expect(canTransition(ctx("awaiting_consent", true), "paused").ok).toBe(false)
  })
})

describe("canTransition — active", () => {
  it("→ paused", () => {
    expect(canTransition(ctx("active", true), "paused").ok).toBe(true)
  })

  it("→ ended", () => {
    expect(canTransition(ctx("active", true), "ended").ok).toBe(true)
  })

  it("CANNOT → awaiting_consent (backwards)", () => {
    expect(canTransition(ctx("active", true), "awaiting_consent").ok).toBe(false)
  })

  it("CANNOT → pending (backwards)", () => {
    expect(canTransition(ctx("active", true), "pending").ok).toBe(false)
  })
})

describe("canTransition — paused ↔ active loop", () => {
  it("paused → active WITH consent", () => {
    expect(canTransition(ctx("paused", true), "active").ok).toBe(true)
  })

  it("paused → active WITHOUT consent (consent gate re-applies)", () => {
    const r = canTransition(ctx("paused", false), "active")
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("consent_required")
  })

  it("paused → ended", () => {
    expect(canTransition(ctx("paused"), "ended").ok).toBe(true)
  })
})

describe("canTransition — ended is terminal", () => {
  for (const target of ["pending", "awaiting_consent", "active", "paused"] as CobrowseStatus[]) {
    it(`ended CANNOT → ${target}`, () => {
      const r = canTransition(ctx("ended", true), target)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe("terminal")
    })
  }

  it("ended → ended itself is also rejected (terminal)", () => {
    const r = canTransition(ctx("ended"), "ended")
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("terminal")
  })
})

describe("allowedNextStates", () => {
  it("pending allows 2 next states", () => {
    expect(allowedNextStates("pending").sort()).toEqual(["awaiting_consent", "ended"])
  })

  it("active allows paused + ended", () => {
    expect(allowedNextStates("active").sort()).toEqual(["ended", "paused"])
  })

  it("ended allows nothing", () => {
    expect(allowedNextStates("ended")).toEqual([])
  })
})
