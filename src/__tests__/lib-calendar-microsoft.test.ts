/**
 * The Outlook half of calendar sync, against the shapes Graph really answers
 * with — because every mistake here is silent. A free-marked event read as
 * busy loses the salon an hour; a busy one read as free double-books it; and
 * a create whose answer was lost, repeated, puts the same visit twice in the
 * master's calendar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { account: { findFirst: db.findFirst, updateMany: db.updateMany } } }))

import {
  createMicrosoftEvent, deleteMicrosoftEvent, exchangeMicrosoftCode, microsoftAccessToken,
  microsoftAuthorizeUrl, microsoftCalendarConfigured, microsoftEventByTransaction, microsoftEvents,
  microsoftIdentity, updateMicrosoftEvent,
} from "@/lib/calendar/microsoft"

const calls: { url: string; init: RequestInit }[] = []
function answer(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
function serve(...responses: Response[]) {
  const queue = [...responses]
  calls.length = 0
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return queue.shift() ?? answer({}, 500)
  }))
}
const slot = (local: string) => ({ dateTime: local, timeZone: "UTC" })
const from = new Date("2026-11-05T00:00:00Z"), to = new Date("2026-11-06T00:00:00Z")

beforeEach(() => {
  vi.resetAllMocks()
  calls.length = 0
  process.env.MICROSOFT_CLIENT_ID = "client-id"
  process.env.MICROSOFT_CLIENT_SECRET = "client-secret"
  process.env.MICROSOFT_TENANT_ID = "common"
})

describe("what the consent link asks for", () => {
  it("asks for the calendar and a refresh token, and carries the signed state", () => {
    const url = new URL(microsoftAuthorizeUrl("https://app.example.test/callback", "state.signature"))
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    expect(url.searchParams.get("scope")).toBe("offline_access https://graph.microsoft.com/Calendars.ReadWrite")
    expect(url.searchParams.get("state")).toBe("state.signature")
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.test/callback")
    // Without consent a reconnection may come back with no refresh token.
    expect(url.searchParams.get("prompt")).toBe("consent")
  })

  it("is only offered once the application is registered", () => {
    expect(microsoftCalendarConfigured()).toBe(true)
    process.env.MICROSOFT_CLIENT_SECRET = ""
    expect(microsoftCalendarConfigured()).toBe(false)
  })

  it("goes to one organisation's own tenant when it is set", () => {
    process.env.MICROSOFT_TENANT_ID = "contoso.onmicrosoft.com"
    expect(microsoftAuthorizeUrl("https://app.example.test/callback", "s")).toContain("/contoso.onmicrosoft.com/oauth2/v2.0/authorize")
  })
})

describe("the day as Outlook has it", () => {
  it("leaves out what the person marked free and what was cancelled", async () => {
    serve(answer({ value: [
      { id: "busy", subject: "Planerka", start: slot("2026-11-05T09:00:00.0000000"), end: slot("2026-11-05T10:00:00.0000000") },
      { id: "free", subject: "Reminder", showAs: "free", start: slot("2026-11-05T11:00:00.0000000"), end: slot("2026-11-05T11:30:00.0000000") },
      { id: "gone", subject: "Cancelled", isCancelled: true, start: slot("2026-11-05T12:00:00.0000000"), end: slot("2026-11-05T13:00:00.0000000") },
    ] }))
    const events = await microsoftEvents("token", from, to)
    expect(events).toEqual([{ id: "busy", subject: "Planerka", start: new Date("2026-11-05T09:00:00Z"), end: new Date("2026-11-05T10:00:00Z") }])
    expect(calls[0].url).toContain("/me/calendarView?")
    expect(calls[0].url).toContain("startDateTime=2026-11-05T00%3A00%3A00.000Z")
    // Asking for UTC is what makes the instants above unambiguous.
    expect((calls[0].init.headers as Record<string, string>).Prefer).toBe('outlook.timezone="UTC"')
  })

  it("reads every page, not the first one", async () => {
    serve(
      answer({ value: [{ id: "one", start: slot("2026-11-05T09:00:00"), end: slot("2026-11-05T09:30:00") }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=1" }),
      answer({ value: [{ id: "two", start: slot("2026-11-05T15:00:00"), end: slot("2026-11-05T16:00:00") }] }),
    )
    expect((await microsoftEvents("token", from, to)).map((event) => event.id)).toEqual(["one", "two"])
    expect(calls).toHaveLength(2)
  })

  it("refuses an answer it cannot place on the clock instead of guessing", async () => {
    serve(answer({ value: [{ id: "elsewhere", start: { dateTime: "2026-11-05T09:00:00.0000000", timeZone: "Pacific Standard Time" }, end: slot("2026-11-05T10:00:00") }] }))
    await expect(microsoftEvents("token", from, to)).rejects.toThrow("OUTLOOK_EVENT_UNREADABLE")
    serve(answer({ value: [{ id: "timeless", start: {}, end: slot("2026-11-05T10:00:00") }] }))
    await expect(microsoftEvents("token", from, to)).rejects.toThrow("OUTLOOK_EVENT_UNREADABLE")
  })

  it("fails loudly when Graph refuses, because a short read looks like free time", async () => {
    serve(answer({ error: { code: "ErrorAccessDenied" } }, 403))
    await expect(microsoftEvents("token", from, to)).rejects.toThrow("OUTLOOK_REQUEST_FAILED_403")
  })
})

describe("whose calendar it is", () => {
  it("is the mailbox Microsoft itself names, never the callback's word", async () => {
    serve(answer({ id: "AAMk-calendar", owner: { address: "salon@contoso.com" } }))
    expect(await microsoftIdentity("token")).toBe("salon@contoso.com")
    serve(answer({ id: "AAMk-calendar" }))
    expect(await microsoftIdentity("token")).toBe("AAMk-calendar")
    serve(answer({}))
    await expect(microsoftIdentity("token")).rejects.toThrow("OUTLOOK_IDENTITY_MISSING")
  })
})

describe("keeping the connection alive", () => {
  it("uses the stored token while it is good", async () => {
    db.findFirst.mockResolvedValue({ id: "account-o", access_token: "live", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600 })
    serve()
    expect(await microsoftAccessToken("account-o", "host")).toBe("live")
    expect(calls).toHaveLength(0)
  })

  it("refreshes before it expires and keeps the new one", async () => {
    // Inside the last two minutes: a token that expires mid-request is the
    // same failure as an expired one.
    db.findFirst.mockResolvedValue({ id: "account-o", access_token: "stale", refresh_token: "refresh-me", expires_at: Math.floor(Date.now() / 1000) + 30 })
    db.updateMany.mockResolvedValue({ count: 1 })
    serve(answer({ access_token: "fresh", refresh_token: "next-refresh", expires_in: 3600 }))
    expect(await microsoftAccessToken("account-o", "host")).toBe("fresh")
    expect(calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token")
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token")
    const saved = db.updateMany.mock.calls[0][0]
    // Compare-and-set on the old token: two workers refreshing at once must
    // not put an older token back.
    expect(saved.where).toEqual({ id: "account-o", access_token: "stale" })
    expect(saved.data.access_token).toBe("fresh")
    expect(saved.data.refresh_token).toBe("next-refresh")
  })

  it("says to reconnect rather than pretend, when there is nothing to refresh with", async () => {
    db.findFirst.mockResolvedValue({ id: "account-o", access_token: "stale", refresh_token: null, expires_at: Math.floor(Date.now() / 1000) - 10 })
    serve()
    await expect(microsoftAccessToken("account-o", "host")).rejects.toThrow("OUTLOOK_RECONNECT_REQUIRED")
    db.findFirst.mockResolvedValue(null)
    await expect(microsoftAccessToken("account-o", "host")).rejects.toThrow("OUTLOOK_NOT_CONNECTED")
  })

  it("reports a refused code exchange instead of storing half a connection", async () => {
    serve(answer({ error: "invalid_grant" }, 400))
    await expect(exchangeMicrosoftCode("code", "https://app.example.test/callback")).rejects.toThrow("OUTLOOK_TOKEN_EXCHANGE_FAILED")
  })
})

describe("the CRM's own meeting on an Outlook calendar", () => {
  const body = { subject: "Saç · Leyla", description: "note", location: "Salon", start: new Date("2026-11-05T09:00:00Z"), end: new Date("2026-11-05T09:45:00Z") }

  it("is created with the identifier a retry can find it by", async () => {
    serve(answer({ id: "graph-event-1" }))
    expect(await createMicrosoftEvent("token", body, "generation-1")).toBe("graph-event-1")
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.transactionId).toBe("generation-1")
    expect(sent.start).toEqual({ dateTime: "2026-11-05T09:00:00.000", timeZone: "UTC" })
    expect(sent.subject).toBe("Saç · Leyla")
  })

  it("is found by that identifier when the answer to the create was lost", async () => {
    serve(answer({ value: [{ id: "graph-event-1" }] }))
    expect(await microsoftEventByTransaction("token", "generation-1")).toBe("graph-event-1")
    expect(decodeURIComponent(calls[0].url)).toContain("$filter=transactionId eq 'generation-1'")
    serve(answer({ value: [] }))
    expect(await microsoftEventByTransaction("token", "generation-2")).toBeNull()
    // A quote in the identifier must not break out of the filter.
    serve(answer({ value: [] }))
    await microsoftEventByTransaction("token", "it's")
    expect(decodeURIComponent(calls[0].url)).toContain("transactionId eq 'it''s'")
  })

  it("reports an event somebody deleted by hand as missing, so it can be made again", async () => {
    serve(answer({}, 404))
    expect(await updateMicrosoftEvent("token", "graph-event-1", body)).toEqual({ missing: true })
    serve(answer({}, 200))
    expect(await updateMicrosoftEvent("token", "graph-event-1", body)).toEqual({ missing: false })
    expect(calls[0].init.method).toBe("PATCH")
    serve(answer({}, 500))
    await expect(updateMicrosoftEvent("token", "graph-event-1", body)).rejects.toThrow("OUTLOOK_REQUEST_FAILED_500")
  })

  it("treats an already-deleted event as deleted, and a refusal as a failure", async () => {
    serve(answer({}, 404))
    await expect(deleteMicrosoftEvent("token", "graph-event-1")).resolves.toBeUndefined()
    serve(answer({}, 403))
    await expect(deleteMicrosoftEvent("token", "graph-event-1")).rejects.toThrow("OUTLOOK_REQUEST_FAILED_403")
  })
})
