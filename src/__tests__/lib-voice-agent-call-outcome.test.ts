import { describe, expect, it } from "vitest"

import { MISSED_PHONE_ORDERS_FEATURE, resolveMissedPeriod } from "@/lib/ai/voice/missed-summary"
import { moduleRecordFromOrgFields } from "@/lib/modules"
import { PHONE_ORDERS_FEATURE } from "@/lib/pharmacy-orders/orders"
import { DEMO_CALL_AUDIT_VIA } from "@/lib/demo-center/call-prompt"
import {
  DEMO_AUDIT_VIA,
  PHARMACY_CALLBACK_AUDIT_KEY,
  PHARMACY_PREVIEW_AUDIT_KEY,
  isLineOrDemoCall,
} from "@/lib/voice-agent/line-or-demo-call"
import { isPharmacyInboundPreview } from "@/lib/voice-agent/pharmacy/zeytun-inbound-audit"
import { CALLBACK_MARKER } from "@/lib/voice-agent/pharmacy/zeytun-waitlist-callback"
import {
  customerReallySpoke,
  matchRequestedEmployee,
  personNameTokens,
  readCallOutcome,
} from "@/lib/voice-agent/call-outcome"

const PEOPLE = [
  { id: "rashad", name: "Rəşad Əliyev" },
  { id: "leyla-a", name: "Leyla Məmmədova" },
  { id: "leyla-b", name: "Leyla Həsənova" },
  { id: "javid", name: "Cavid Quliyev" },
]

describe("isLineOrDemoCall", () => {
  it("uses the very keys the line and the demo write", () => {
    expect(PHARMACY_CALLBACK_AUDIT_KEY).toBe(CALLBACK_MARKER)
    expect(DEMO_AUDIT_VIA).toBe(DEMO_CALL_AUDIT_VIA)
    const marker = { [PHARMACY_PREVIEW_AUDIT_KEY]: { version: 1, grantId: "g", providerCallId: "c" } }
    expect(isPharmacyInboundPreview(marker, "c")).toBe(true)
    expect(isLineOrDemoCall(marker)).toBe(true)
  })

  it("excludes a malformed marker too, and leaves an ordinary call alone", () => {
    expect(isLineOrDemoCall({ [PHARMACY_PREVIEW_AUDIT_KEY]: "broken" })).toBe(true)
    expect(isLineOrDemoCall({ other: true })).toBe(false)
    expect(isLineOrDemoCall(null)).toBe(false)
  })
})

describe("the phone-orders flag the spoken summary reads", () => {
  it("is the flag the orders screen opens on, in either stored shape", () => {
    expect(MISSED_PHONE_ORDERS_FEATURE).toBe(PHONE_ORDERS_FEATURE)
    const asList = moduleRecordFromOrgFields({ features: [PHONE_ORDERS_FEATURE], modules: {} })
    const asJson = moduleRecordFromOrgFields({ features: JSON.stringify([PHONE_ORDERS_FEATURE]), modules: {} })
    expect(asList[MISSED_PHONE_ORDERS_FEATURE]).toBe(true)
    expect(asJson[MISSED_PHONE_ORDERS_FEATURE]).toBe(true)
  })
})

describe("readCallOutcome", () => {
  it("reads a call analysed before the outcome existed as having none", () => {
    expect(readCallOutcome({ version: 1, summary: "old" })).toEqual({ outcome: null, requestedEmployee: null, callerName: null })
    expect(readCallOutcome(null)).toEqual({ outcome: null, requestedEmployee: null, callerName: null })
  })

  it("drops values it does not know", () => {
    expect(readCallOutcome({ outcome: "maybe" }).outcome).toBeNull()
    expect(readCallOutcome({ requestedEmployee: { spokenName: "A", match: "probably" } }).requestedEmployee).toBeNull()
  })

  it("never reports a match without a person", () => {
    expect(readCallOutcome({ requestedEmployee: { spokenName: "Leyla", match: "matched", userId: null } }).requestedEmployee)
      .toEqual({ spokenName: "Leyla", userId: null, match: "not_found" })
  })
})

describe("matchRequestedEmployee", () => {
  it.each(["Rəşad", "Рашад", "Rashad", "rəşad bəy", "Рашад Алиев", "Rəşad müəllim"])("finds one person for «%s»", (spoken) => {
    expect(matchRequestedEmployee(spoken, PEOPLE)).toMatchObject({ userId: "rashad", match: "matched" })
  })

  it("reads the Azerbaijani c as the Russian дж", () => {
    expect(matchRequestedEmployee("Джавид", PEOPLE)).toMatchObject({ userId: "javid", match: "matched" })
  })

  it("does not choose between two people with one first name", () => {
    expect(matchRequestedEmployee("Leyla", PEOPLE)).toEqual({ spokenName: "Leyla", userId: null, match: "ambiguous" })
  })

  it("the full name settles it", () => {
    expect(matchRequestedEmployee("Leyla Həsənova", PEOPLE)).toMatchObject({ userId: "leyla-b", match: "matched" })
  })

  it("does not match on part of a word", () => {
    expect(matchRequestedEmployee("Ley", PEOPLE).match).toBe("not_found")
    expect(matchRequestedEmployee("Rəşadə", PEOPLE).match).toBe("not_found")
  })

  it("a form of address alone is not a name", () => {
    expect(matchRequestedEmployee("xanım", PEOPLE).match).toBe("not_found")
    expect(personNameTokens("Leyla xanım")).toEqual(["leyla"])
  })
})

describe("customerReallySpoke", () => {
  const said = (...lines: string[]) => lines.map((text) => ({ role: "customer" as const, text }))

  it.each([[["Алло", "алло"]], [["да"]], [["Alo, salam"]], [["Bəli", "hə"]], [[]]])("an open line is not a conversation: %j", (lines) => {
    expect(customerReallySpoke(said(...lines))).toBe(false)
  })

  it.each([[["Salam, qiymət nədir"]], [["Мне нужна консультация"]], [["alo", "kurs haqqında sualım var"]]])("a request is: %j", (lines) => {
    expect(customerReallySpoke(said(...lines))).toBe(true)
  })

  it("the assistant's words do not count", () => {
    expect(customerReallySpoke([{ role: "agent", text: "Sizə necə kömək edə bilərəm" }])).toBe(false)
  })
})

describe("resolveMissedPeriod", () => {
  const WEEKDAYS = Object.fromEntries(["mon", "tue", "wed", "thu", "fri"].map((day) => [day, { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] }]))
  const hours = (extra: Record<string, unknown> = {}) => ({ channelType: "all", timezone: "Asia/Baku", schedule: WEEKDAYS, holidays: [], ...extra })
  // Baku is UTC+4 all year.
  const at = (local: string) => new Date(`${local}:00+04:00`)

  it("in the morning, counts from yesterday's close", () => {
    expect(resolveMissedPeriod(at("2026-11-19T09:30"), [hours()], "UTC").from).toEqual(at("2026-11-18T18:00"))
  })

  it("during the day, still from yesterday's close", () => {
    expect(resolveMissedPeriod(at("2026-11-19T15:00"), [hours()], "UTC").from).toEqual(at("2026-11-18T18:00"))
  })

  it("in the evening, from today's close", () => {
    expect(resolveMissedPeriod(at("2026-11-19T21:00"), [hours()], "UTC").from).toEqual(at("2026-11-19T18:00"))
  })

  it("on Monday morning, from Friday's close", () => {
    expect(resolveMissedPeriod(at("2026-11-23T09:00"), [hours()], "UTC").from).toEqual(at("2026-11-20T18:00"))
  })

  it("a lunch break is not the end of the working day", () => {
    const schedule = { ...WEEKDAYS, thu: { enabled: true, intervals: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }] } }
    expect(resolveMissedPeriod(at("2026-11-19T15:00"), [hours({ schedule })], "UTC").from).toEqual(at("2026-11-18T18:00"))
    expect(resolveMissedPeriod(at("2026-11-19T19:00"), [hours({ schedule })], "UTC").from).toEqual(at("2026-11-19T18:00"))
  })

  it("a night shift ends in the morning, not at midnight", () => {
    const night = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, {
      enabled: true,
      intervals: [{ start: "00:00", end: "06:00" }, { start: "22:00", end: "23:59" }],
    }]))
    const shift = hours({ schedule: night })
    expect(resolveMissedPeriod(at("2026-11-19T07:00"), [shift], "UTC").from).toEqual(at("2026-11-19T06:00"))
    expect(resolveMissedPeriod(at("2026-11-19T23:30"), [shift], "UTC").from).toEqual(at("2026-11-19T06:00"))
    expect(resolveMissedPeriod(at("2026-11-19T03:00"), [shift], "UTC").from).toEqual(at("2026-11-18T06:00"))
  })

  it("a line open around the clock has no close, so the last 16 hours", () => {
    const always = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, {
      enabled: true,
      intervals: [{ start: "00:00", end: "23:59" }],
    }]))
    expect(resolveMissedPeriod(at("2026-11-19T07:00"), [hours({ schedule: always })], "UTC").basis).toBe("last_16_hours")
  })

  it("skips a closed holiday", () => {
    const holidays = [{ date: "2026-11-18", closed: true }]
    expect(resolveMissedPeriod(at("2026-11-19T09:30"), [hours({ holidays })], "UTC").from).toEqual(at("2026-11-17T18:00"))
  })

  it("without hours, the last 16 hours", () => {
    const now = at("2026-11-19T09:30")
    const period = resolveMissedPeriod(now, [], "Asia/Baku")
    expect(period.basis).toBe("last_16_hours")
    expect(period.from).toEqual(new Date(now.getTime() - 16 * 3_600_000))
    expect(period.timezone).toBe("Asia/Baku")
  })

  it("an empty schedule is not a schedule of 09:00-18:00", () => {
    expect(resolveMissedPeriod(at("2026-11-19T09:30"), [hours({ schedule: {} })], "UTC").basis).toBe("last_16_hours")
  })

  it("a schedule with no working day at all falls back", () => {
    const schedule = { mon: { enabled: false, intervals: [] } }
    expect(resolveMissedPeriod(at("2026-11-19T09:30"), [hours({ schedule })], "UTC").basis).toBe("last_16_hours")
  })

  it("prefers the organization's hours to the telephony ones", () => {
    const voice = hours({ channelType: "voice", schedule: { thu: { enabled: true, intervals: [{ start: "07:00", end: "08:00" }] } } })
    expect(resolveMissedPeriod(at("2026-11-19T09:30"), [voice, hours()], "UTC").from).toEqual(at("2026-11-18T18:00"))
  })
})
