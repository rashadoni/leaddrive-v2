import { describe, expect, it } from "vitest"
import { historyErrorMessage } from "@/lib/mtm/location-history-errors"

/**
 * What the manager reads when the day will not load. `MTM_GPS_INVALID_RANGE`
 * on screen is our internal name for their mistyped date — it names the
 * problem to us and to nobody else.
 */
const t = (key: string) => `[${key}]`

describe("what a failed history load says out loud", () => {
  it("turns every refusal code into a sentence", () => {
    expect(historyErrorMessage("MTM_GPS_INVALID_RANGE", t)).toBe("[errorInvalidRange]")
    expect(historyErrorMessage("MTM_GPS_AGENT_NOT_FOUND", t)).toBe("[errorAgentNotFound]")
    expect(historyErrorMessage("MTM_GPS_AGENT_OUT_OF_SCOPE", t)).toBe("[errorAgentOutOfScope]")
    expect(historyErrorMessage("MTM_GPS_TIMEZONE_FIXED", t)).toBe("[errorTimezoneFixed]")
  })

  /** An unknown code is still a code: it must not reach the screen. */
  it("never shows an internal name it does not recognise", () => {
    expect(historyErrorMessage("MTM_GPS_SOMETHING_NEW", t)).toBe("[loadFailed]")
    expect(historyErrorMessage("", t)).toBe("[loadFailed]")
    expect(historyErrorMessage("   ", t)).toBe("[loadFailed]")
  })

  /** A gateway that already wrote a sentence is quoted rather than hidden. */
  it("keeps a message that is already words", () => {
    expect(historyErrorMessage("Bad Gateway", t)).toBe("Bad Gateway")
  })
})
