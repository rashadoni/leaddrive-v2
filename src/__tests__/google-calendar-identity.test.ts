import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ refs: vi.fn(), tokens: vi.fn(), calendar: vi.fn(), refresh: vi.fn(), writes: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { account: { findMany: state.refs, findFirst: state.tokens, updateMany: state.writes } } }))
vi.mock("googleapis/build/src/apis/calendar", () => ({ calendar: state.calendar, auth: { OAuth2: class { setCredentials() {} on(_event: string, callback: (tokens: unknown) => unknown) { state.refresh.mockImplementation(callback) } } } }))
import { getGoogleCalendarClient, listBusyIntervals } from "@/lib/google-calendar"
beforeEach(() => { vi.resetAllMocks() })
describe("calendar credential identity", () => {
  it("never falls back to a newly connected account when an old binding credential is missing", async () => {
    state.tokens.mockResolvedValue(null)
    await expect(getGoogleCalendarClient("host", "old-generation")).rejects.toThrow("not connected")
    expect(state.tokens.mock.calls[0][0].where).toMatchObject({ userId: "host", id: "old-generation" })
    expect(state.refs).not.toHaveBeenCalled()
    expect(state.calendar).not.toHaveBeenCalled()
  })
  it("does not contact Google for a sign-in-only consent, even with an expired token", async () => {
    state.refs.mockResolvedValue([{ id: "login", userId: "host", provider: "google", scope: "openid email profile" }])
    await expect(listBusyIntervals("host", "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z")).resolves.toBeNull()
    expect(state.tokens).not.toHaveBeenCalled()
    expect(state.calendar).not.toHaveBeenCalled()
  })
  it("uses the same selected credential identity for a valid connected calendar", async () => {
    state.refs.mockResolvedValue([{ id: "explicit", userId: "host", provider: "google-calendar", scope: "https://www.googleapis.com/auth/calendar.readonly" }])
    state.tokens.mockResolvedValue({ id: "explicit", access_token: "synthetic-valid", expires_at: 2147483647, refresh_token: "synthetic-refresh" })
    const client = { synthetic: true }
    state.calendar.mockReturnValue(client)
    await expect(getGoogleCalendarClient("host")).resolves.toBe(client)
    expect(state.tokens.mock.calls[0][0].where).toMatchObject({ id: "explicit", userId: "host" })
    state.writes.mockResolvedValue({ count: 0 })
    await state.refresh({ access_token: "synthetic-refreshed" })
    expect(state.writes.mock.calls[0][0].where).toEqual({ id: "explicit", access_token: "synthetic-valid", refresh_token: "synthetic-refresh" })
  })
  it("keeps an expired explicit connection unavailable instead of silently skipping it", async () => {
    state.refs.mockResolvedValue([{ id: "explicit", userId: "host", provider: "google-calendar", scope: null }])
    state.tokens.mockResolvedValue({ access_token: "synthetic-expired", expires_at: 1, refresh_token: null })
    await expect(listBusyIntervals("host", "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z")).rejects.toThrow("Token expired")
    expect(state.calendar).not.toHaveBeenCalled()
  })
})
