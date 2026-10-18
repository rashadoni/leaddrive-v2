/**
 * The demo form's bot check (owner, 2026-10-18: «защита от спама нужна чтоб
 * боты не заполняли формы»): what a person's browser does passes, and every
 * shortcut a script could take is refused.
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  DEMO_FORM_CHALLENGE_TTL_MS,
  DEMO_FORM_MIN_FILL_MS,
  issueDemoFormChallenge,
  verifyDemoFormSolution,
  type DemoFormChallenge,
} from "@/lib/demo-center/form-challenge"

const NOW = Date.parse("2026-10-18T10:00:00.000Z")

function solve(challenge: DemoFormChallenge): number {
  for (let number = 0; number <= challenge.maxNumber; number += 1) {
    if (createHash("sha256").update(`${challenge.salt}${number}`).digest("hex") === challenge.challenge) return number
  }
  throw new Error("unsolvable challenge")
}

describe("the demo form's bot check", () => {
  const challenge = issueDemoFormChallenge(NOW)
  const solved = { ...challenge, number: solve(challenge) }

  it("lets in what the page's script sends after a person has filled the form", () => {
    expect(verifyDemoFormSolution(solved, NOW + 20_000)).toBe("ok")
  })

  it("asks a person without a usable one to send again", () => {
    expect(verifyDemoFormSolution(undefined, NOW)).toBe("missing")
    expect(verifyDemoFormSolution(null, NOW)).toBe("missing")
    expect(verifyDemoFormSolution(solved, NOW + DEMO_FORM_CHALLENGE_TTL_MS + 1)).toBe("expired")
  })

  it("refuses a form sent faster than a person fills it", () => {
    expect(verifyDemoFormSolution(solved, NOW + DEMO_FORM_MIN_FILL_MS - 1)).toBe("too_fast")
  })

  it("refuses a guessed number", () => {
    expect(verifyDemoFormSolution({ ...solved, number: (solved.number + 1) % (challenge.maxNumber + 1) }, NOW + 20_000)).toBe("unsolved")
  })

  it("refuses a challenge it did not sign, an eased difficulty, or a moved clock", () => {
    // A challenge a bot made up for itself, with a number it already knows.
    const invented = { ...solved, challenge: createHash("sha256").update(`${challenge.salt}7`).digest("hex"), number: 7 }
    expect(verifyDemoFormSolution(invented, NOW + 20_000)).toBe("forged")
    expect(verifyDemoFormSolution({ ...solved, maxNumber: 10 }, NOW + 20_000)).toBe("forged")
    expect(verifyDemoFormSolution({ ...solved, issuedAt: NOW - 60_000 }, NOW + 1_000)).toBe("forged")
    expect(verifyDemoFormSolution({ ...solved, signature: "0".repeat(64) }, NOW + 20_000)).toBe("forged")
    expect(verifyDemoFormSolution("yes", NOW)).toBe("forged")
  })

  it("issues a fresh challenge every time", () => {
    const other = issueDemoFormChallenge(NOW)
    expect(other.salt).not.toBe(challenge.salt)
    expect(other.challenge).not.toBe(challenge.challenge)
  })
})
