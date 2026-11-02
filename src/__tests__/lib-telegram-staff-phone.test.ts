/** A phone as an employee types it to the bot: Azerbaijan by default, the country first, never a guessed digit. */
import { describe, expect, it } from "vitest"
import { displayPhone, readLeadPhone } from "@/lib/telegram-staff/actions"

describe("reading a phone typed to the bot", () => {
  it("makes every local spelling of an Azerbaijani mobile +994", () => {
    for (const typed of ["050 333 09 28", "0503330928", "50 333 09 28", "+994 50 333 09 28", "994503330928", "00994503330928"]) {
      expect(readLeadPhone(typed)).toEqual({ ok: true, phone: "+994503330928" })
    }
  })

  it("asks for the code of seven digits instead of guessing it, and refuses what is not a number", () => {
    expect(readLeadPhone("333 09 28")).toEqual({ ok: false, reason: "NEEDS_CODE" })
    expect(readLeadPhone("9943330928")).toEqual({ ok: false, reason: "INVALID" })
    expect(readLeadPhone("012 333 09 28")).toEqual({ ok: false, reason: "INVALID" })
  })

  it("keeps a foreign number written with its country code", () => {
    expect(readLeadPhone("+7 916 123 45 67")).toEqual({ ok: true, phone: "+79161234567" })
    expect(readLeadPhone("+90 532 123 45 67")).toEqual({ ok: true, phone: "+905321234567" })
  })

  it("shows the country first", () => {
    expect(displayPhone("+994503330928")).toBe("+994 50 333 09 28")
    expect(displayPhone("+79161234567")).toBe("+79161234567")
  })
})
