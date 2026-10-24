import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ account: vi.fn(), bindings: vi.fn(), legacy: vi.fn(), client: vi.fn(), list: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { account: { findMany: state.account }, bookingIntegrationBinding: { findMany: state.bindings }, booking: { findFirst: state.legacy } } }))
vi.mock("@/lib/google-calendar", () => ({ getGoogleCalendarClient: state.client }))
import { bookingCalendarBusy } from "@/lib/booking/calendar-busy"

const start = new Date("2026-11-02T05:00:00Z"), end = new Date("2026-11-02T07:00:00Z")
const event = (id: string, startTime = "2026-11-02T05:00:00Z") => ({ id, start: { dateTime: startTime }, end: { dateTime: "2026-11-02T05:30:00Z" } })
beforeEach(() => {
  vi.resetAllMocks()
  state.account.mockResolvedValue([{ id: "account-a", userId: "host", provider: "google-calendar", scope: null }]); state.bindings.mockResolvedValue([{ providerEventId: "own-event" }]); state.legacy.mockResolvedValue(null)
  state.client.mockResolvedValue({ events: { list: state.list } })
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
  it("fails closed when an all-day interval has no reliable calendar timezone", async () => {
    state.list.mockResolvedValue({ data: { accessRole: "owner", items: [{ id: "all-day-unknown", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }] } })
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
  })
  it("distinguishes no connection from a broken or unreadable connected calendar", async () => {
    state.account.mockResolvedValueOnce([])
    expect((await bookingCalendarBusy("org-a", "host", start, end)).accountId).toBeNull()
    state.client.mockRejectedValueOnce(new Error("expired credential"))
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
    state.client.mockResolvedValue({ events: { list: state.list } })
    state.list.mockResolvedValueOnce({ data: { accessRole: "freeBusyReader", items: [] } })
    await expect(bookingCalendarBusy("org-a", "host", start, end)).rejects.toMatchObject({ code: "CALENDAR_UNAVAILABLE" })
  })
})
