import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ account: vi.fn(), bindings: vi.fn(), legacy: vi.fn(), client: vi.fn(), list: vi.fn(), outlook: vi.fn(), outlookToken: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { account: { findMany: state.account }, bookingIntegrationBinding: { findMany: state.bindings }, booking: { findFirst: state.legacy } } }))
vi.mock("@/lib/google-calendar", () => ({ getGoogleCalendarClient: state.client, listBusyIntervals: vi.fn() }))
vi.mock("@/lib/calendar/microsoft", () => ({ microsoftAccessToken: state.outlookToken, microsoftEvents: state.outlook }))
import { bookingCalendarBusy } from "@/lib/booking/calendar-busy"

const start = new Date("2026-11-02T05:00:00Z"), end = new Date("2026-11-02T07:00:00Z")
const event = (id: string, startTime = "2026-11-02T05:00:00Z") => ({ id, start: { dateTime: startTime }, end: { dateTime: "2026-11-02T05:30:00Z" } })
beforeEach(() => {
  vi.resetAllMocks()
  state.account.mockResolvedValue([{ id: "account-a", userId: "host", provider: "google-calendar", scope: null }]); state.bindings.mockResolvedValue([{ providerEventId: "own-event" }]); state.legacy.mockResolvedValue(null)
  state.client.mockResolvedValue({ events: { list: state.list } })
  state.outlookToken.mockResolvedValue("outlook-token"); state.outlook.mockResolvedValue([])
})
describe("identity-aware calendar availability", () => {
  it("preserves someone else's overlapping event while excluding its own, including following pages", async () => {
    state.list.mockResolvedValueOnce({ data: { accessRole: "owner", items: [event("own-event"), event("other-event")], nextPageToken: "next" } })
      .mockResolvedValueOnce({ data: { accessRole: "owner", items: [{ ...event("transparent"), transparency: "transparent" }, { id: "all-day", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }], timeZone: "Asia/Baku" } })
    const result = await bookingCalendarBusy("org-a", "host", start, end, "booking-a")
    expect(result.intervals).toEqual([{ start, end: new Date("2026-11-02T05:30:00Z") }, { start: new Date("2026-11-01T20:00:00Z"), end: new Date("2026-11-02T20:00:00Z") }])
    expect(state.list).toHaveBeenCalledTimes(2)
  })
  it("does not exclude an event using a legacy event ID whose account identity is unproven", async () => {
    state.bindings.mockResolvedValue([])
    state.legacy.mockResolvedValue({ googleEventId: "unverified-legacy" })
    state.list.mockResolvedValue({ data: { accessRole: "owner", items: [event("unverified-legacy")] } })
    const result = await bookingCalendarBusy("org-a", "host", start, end, "legacy-booking")
    expect(result.intervals).toHaveLength(1)
    expect(state.legacy).not.toHaveBeenCalled()
  })
  it("takes the busy time of every calendar the host connected, and names them all", async () => {
    // One master, their own Google account and the company's Outlook mailbox:
    // an hour taken in either is an hour the salon cannot sell.
    state.account.mockResolvedValue([
      { id: "account-a", userId: "host", provider: "google-calendar", scope: null },
      { id: "account-o", userId: "host", provider: "microsoft-calendar", scope: null },
    ])
    state.list.mockResolvedValue({ data: { accessRole: "owner", items: [event("other-event")] } })
    state.outlook.mockResolvedValue([{ id: "outlook-event", start: new Date("2026-11-02T06:00:00Z"), end: new Date("2026-11-02T06:45:00Z"), subject: "Planerka" }])
    const result = await bookingCalendarBusy("org-a", "host", start, end, "booking-a")
    expect(result.intervals).toEqual([
      { start, end: new Date("2026-11-02T05:30:00Z") },
      { start: new Date("2026-11-02T06:00:00Z"), end: new Date("2026-11-02T06:45:00Z") },
    ])
    expect(result.events.map((item) => [item.provider, item.title])).toEqual([["google", null], ["microsoft", "Planerka"]])
    // Both calendars are in the key, so connecting or dropping either one
    // between this read and the write is caught.
    expect(result.accountKey).toBe("account-a|account-o")
  })

  it("fails closed when one of two connected calendars cannot be read", async () => {
    state.account.mockResolvedValue([
      { id: "account-a", userId: "host", provider: "google-calendar", scope: null },
      { id: "account-o", userId: "host", provider: "microsoft-calendar", scope: null },
    ])
    state.list.mockResolvedValue({ data: { accessRole: "owner", items: [] } })
    state.outlook.mockRejectedValue(new Error("OUTLOOK_CALENDAR_INCOMPLETE"))
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
  })

  it("fails closed when an all-day interval has no reliable calendar timezone", async () => {
    state.list.mockResolvedValue({ data: { accessRole: "owner", items: [{ id: "all-day-unknown", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }] } })
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
  })
  it("distinguishes no connection from a broken or unreadable connected calendar", async () => {
    state.account.mockResolvedValueOnce([])
    expect((await bookingCalendarBusy("org-a", "host", start, end)).accountKey).toBe("")
    state.client.mockRejectedValueOnce(new Error("expired credential"))
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
    state.client.mockResolvedValue({ events: { list: state.list } })
    state.list.mockResolvedValueOnce({ data: { accessRole: "freeBusyReader", items: [] } })
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
  })
})
