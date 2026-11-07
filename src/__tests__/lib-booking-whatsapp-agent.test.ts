/**
 * The pure half of the WhatsApp booking agent: which three times a client is
 * offered, what a button says, how a day is written in their language, and
 * what is left of a model decision once it is checked against the salon's own
 * lists. What only a database can show — holds, one tap one meeting — is in
 * online-booking-postgres.test.ts.
 */
import { describe, expect, it } from "vitest"
import { dayLabel, offerButtonTitle, pickOfferTimes, readDecision, PART_OF_DAY } from "@/lib/booking/whatsapp-agent"
import { readWhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"
import type { Slot } from "@/lib/booking/availability"

const TZ = "Asia/Baku"
/** In Baku (UTC+4, no daylight saving) this clock time is that instant. */
const at = (local: string) => new Date(`${local}:00+04:00`).toISOString()
const slot = (local: string, minutes: number, hostIds = ["leyla"]): Slot => ({
  startsAt: at(local), endsAt: new Date(Date.parse(at(local)) + minutes * 60_000).toISOString(), hostIds,
})
const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso))

describe("the three times a client is offered", () => {
  // Saturday 7 November 2026: a 45-minute service every 45 minutes from 09:00.
  const day = ["09:00", "09:45", "10:30", "11:15", "12:00", "12:45", "13:30", "14:15", "15:00", "17:15", "18:00"]
    .map((time) => slot(`2026-11-07T${time}`, 45))

  it("are the earliest, at least an hour apart — a time of day, not three quarter-hours", () => {
    const offered = pickOfferTimes(day, { timezone: TZ, window: PART_OF_DAY.any })
    expect(offered.map((choice) => clock(choice.startsAt))).toEqual(["09:00", "10:30", "12:00"])
    expect(offered.every((choice) => choice.date === "2026-11-07")).toBe(true)
  })

  it("stay inside the part of the day the client asked for", () => {
    expect(pickOfferTimes(day, { timezone: TZ, window: PART_OF_DAY.morning }).map((choice) => clock(choice.startsAt))).toEqual(["09:00", "10:30", "11:15"])
    expect(pickOfferTimes(day, { timezone: TZ, window: PART_OF_DAY.evening }).map((choice) => clock(choice.startsAt))).toEqual(["17:15", "18:00"])
    expect(pickOfferTimes(day, { timezone: TZ, window: [15 * 60, 24 * 60] }).map((choice) => clock(choice.startsAt))).toEqual(["15:00", "17:15", "18:00"])
  })

  it("fill a short window with the rest rather than offer less than the day has", () => {
    // Morning has four times; an hour apart gives 09:00 and 10:30, so 11:15 fills the third.
    const morning = pickOfferTimes(day, { timezone: TZ, window: PART_OF_DAY.morning })
    expect(morning).toHaveLength(3)
    expect(pickOfferTimes([], { timezone: TZ, window: PART_OF_DAY.any })).toEqual([])
  })

  it("keep a master the client named, and otherwise take the first free one in the service's order", () => {
    const shared = [slot("2026-11-07T10:00", 45, ["leyla", "aysel"]), slot("2026-11-07T11:30", 45, ["aysel"]), slot("2026-11-07T13:00", 45, ["leyla"])]
    expect(pickOfferTimes(shared, { timezone: TZ, window: PART_OF_DAY.any }).map((choice) => choice.hostId)).toEqual(["leyla", "aysel", "leyla"])
    const withAysel = pickOfferTimes(shared, { timezone: TZ, window: PART_OF_DAY.any, hostId: "aysel" })
    expect(withAysel.map((choice) => [clock(choice.startsAt), choice.hostId])).toEqual([["10:00", "aysel"], ["11:30", "aysel"]])
  })
})

describe("what a button says", () => {
  const choice = { startsAt: at("2026-11-07T11:30"), endsAt: at("2026-11-07T12:15"), hostId: "leyla", date: "2026-11-07" }

  it("is the time and the master's first name, within WhatsApp's twenty characters", () => {
    expect(offerButtonTitle(choice, "Leyla Məmmədova", TZ, false)).toBe("11:30 · Leyla")
    expect(offerButtonTitle(choice, "Leyla", TZ, true)).toBe("7.11 11:30 · Leyla")
    const long = offerButtonTitle(choice, "Gülnarəxanım", TZ, true)
    expect(long.length).toBeLessThanOrEqual(20)
    expect(long.startsWith("7.11 11:30 · ")).toBe(true)
    // The time never gives way; a nameless host is just the time.
    expect(offerButtonTitle(choice, "", TZ, false)).toBe("11:30")
  })
})

describe("a day in the client's language", () => {
  it("reads naturally in Azerbaijani, Russian and English", () => {
    const saturday = at("2026-11-07T11:30")
    expect(dayLabel(saturday, "az", TZ)).toBe("Şənbə, 7 noyabr")
    expect(dayLabel(saturday, "ru", TZ)).toBe("Суббота, 7 ноября")
    expect(dayLabel(saturday, "en", TZ)).toBe("Saturday, November 7")
  })

  it("is the salon's day, not the server's", () => {
    // 22:30 in Baku on Saturday is still Saturday there, though UTC says 18:30.
    expect(dayLabel(at("2026-11-07T23:30"), "az", TZ)).toBe("Şənbə, 7 noyabr")
  })
})

describe("a model decision, checked against the salon's own lists", () => {
  const context = {
    services: [{ id: "haircut" }, { id: "colouring" }] as never[],
    hosts: [{ id: "leyla", name: "Leyla" }],
    dates: ["2026-11-07", "2026-11-08"],
    liveOffers: [{ id: "offer-1", label: "Saturday 11:30 · Leyla · Haircut" }],
    timezone: TZ,
    closedDates: [],
    today: "2026-11-07",
  }

  it("keeps what is on the lists", () => {
    expect(readDecision({ action: "offer", language: "az", serviceId: "haircut", date: "2026-11-08", partOfDay: "morning", hostId: "leyla" }, context))
      .toEqual({ action: "offer", language: "az", serviceId: "haircut", date: "2026-11-08", partOfDay: "morning", notBefore: null, notAfter: null, hostId: "leyla" })
    expect(readDecision({ action: "choose", language: "ru", offerId: "offer-1" }, context)).toEqual({ action: "choose", language: "ru", offerId: "offer-1" })
  })

  it("drops what is not: an invented service or offer is no decision, an unknown date or master is no constraint", () => {
    expect(readDecision({ action: "offer", serviceId: "massage" }, context)).toEqual({ action: "not_booking" })
    expect(readDecision({ action: "choose", offerId: "offer-9" }, context)).toEqual({ action: "not_booking" })
    expect(readDecision({ action: "offer", serviceId: "haircut", date: "2027-01-01", hostId: "someone", partOfDay: "night", notBefore: "25:00" }, context))
      .toMatchObject({ action: "offer", date: null, hostId: null, partOfDay: "any", notBefore: null })
    expect(readDecision({ action: "anything" }, context)).toEqual({ action: "not_booking" })
    expect(readDecision(null, context)).toEqual({ action: "not_booking" })
  })

  it("keeps a question short, with at most three choices that fit a button", () => {
    const asked = readDecision({ action: "ask", language: "az", question: "Hansı manikür?", choices: ["Örtüklü manikür 90 dəq", "Örtüksüz", "", "Pedikür", "Dördüncü"] }, context)
    expect(asked).toEqual({ action: "ask", language: "az", question: "Hansı manikür?", choices: ["Örtüklü manikür 90 d", "Örtüksüz", "Pedikür"] })
    expect(readDecision({ action: "ask", question: "  " }, context)).toEqual({ action: "not_booking" })
  })

  it("answers in Azerbaijani unless the client wrote Russian or English", () => {
    expect(readDecision({ action: "choose", offerId: "offer-1", language: "tr" }, context)).toMatchObject({ language: "az" })
  })
})

describe("the organization's switch", () => {
  it("is off unless it says book, and names a number only when it names one", () => {
    // The rules ride along in the same setting; they have their own suite.
    expect(readWhatsAppBookingSetting(null)).toMatchObject({ mode: "off", channelConfigId: null })
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "yes" } })).toMatchObject({ mode: "off", channelConfigId: null })
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", channelConfigId: "" } })).toMatchObject({ mode: "book", channelConfigId: null })
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", channelConfigId: "wa-1" }, other: 1 })).toMatchObject({ mode: "book", channelConfigId: "wa-1" })
  })
})
