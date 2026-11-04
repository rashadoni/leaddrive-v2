/**
 * Which calendars count as connected, and the fingerprint a booking is
 * written against.
 *
 * Both answers decide whether an hour is sold twice: a calendar missed here
 * is time nobody checked, and a fingerprint that does not change when the
 * host connects Outlook mid-booking is a booking taken against a calendar
 * that was never read.
 */
import { describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import { connectedCalendars, connectedCalendarsOf } from "@/lib/calendar/accounts"
import { calendarProviderOf, connectedCalendarKey } from "@/lib/calendar/providers"

const reader = (rows: { id: string; userId: string; provider: string; scope: string | null }[]) =>
  ({ account: { findMany: vi.fn().mockResolvedValue(rows) } } as unknown as Prisma.TransactionClient)

describe("the calendars one person has connected", () => {
  it("is one of each provider, and Outlook does not displace Google", async () => {
    const calendars = await connectedCalendarsOf(reader([
      { id: "outlook", userId: "host", provider: "microsoft-calendar", scope: null },
      { id: "gcal", userId: "host", provider: "google-calendar", scope: null },
    ]), "host")
    expect(calendars.map((item) => [item.provider, item.id]).sort()).toEqual([["google", "gcal"], ["microsoft", "outlook"]])
  })

  it("prefers the explicit Google connection over a leftover sign-in row", async () => {
    const result = await connectedCalendars(reader([
      { id: "standalone", userId: "host", provider: "google-calendar", scope: "openid" },
      { id: "sso-calendar", userId: "host", provider: "google", scope: "https://www.googleapis.com/auth/calendar.readonly" },
    ]), ["host"])
    expect(result.get("host")?.map((item) => item.id)).toEqual(["standalone"])
  })

  it("leaves out a Google row that only ever signed somebody in", async () => {
    const result = await connectedCalendars(reader([
      { id: "sign-in", userId: "identity", provider: "google", scope: "openid email profile" },
      { id: "unknown-grant", userId: "unknown", provider: "google", scope: null },
      { id: "not-a-calendar", userId: "other", provider: "credentials", scope: null },
    ]), ["identity", "unknown", "other"])
    expect(result.has("identity")).toBe(false)
    // An unrecognised scope is not evidence of sign-in-only consent, so the
    // calendar still counts: the other way round silently stops blocking it.
    expect(result.get("unknown")?.map((item) => item.id)).toEqual(["unknown-grant"])
    expect(result.has("other")).toBe(false)
  })

  it("knows which stored provider string is which calendar", () => {
    expect(calendarProviderOf("google-calendar")).toBe("google")
    expect(calendarProviderOf("google")).toBe("google")
    expect(calendarProviderOf("microsoft-calendar")).toBe("microsoft")
    expect(calendarProviderOf("microsoft-entra-id")).toBeNull()
    expect(calendarProviderOf("credentials")).toBeNull()
  })
})

describe("the fingerprint a booking is decided against", () => {
  it("does not depend on the order the calendars came back in", () => {
    expect(connectedCalendarKey([{ id: "b" }, { id: "a" }])).toBe(connectedCalendarKey([{ id: "a" }, { id: "b" }]))
  })

  it("changes when a calendar is connected or dropped, and is empty with none", () => {
    expect(connectedCalendarKey([])).toBe("")
    expect(connectedCalendarKey([{ id: "a" }])).not.toBe(connectedCalendarKey([{ id: "a" }, { id: "b" }]))
    expect(connectedCalendarKey([{ id: "a" }])).not.toBe(connectedCalendarKey([]))
  })
})
