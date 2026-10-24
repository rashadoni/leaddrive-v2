import { afterEach, describe, expect, it, vi } from "vitest"
import { bookingRequestIdentity, completeBookingRequest } from "@/lib/booking/client-identity"
afterEach(() => vi.unstubAllGlobals())
describe("booking request identity", () => {
  it("starts a fresh intent only after a confirmed success, including when storage is disabled", async () => {
    const stored: Record<string, string> = {}
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => stored[key] ?? null, setItem: (key: string, value: string) => { stored[key] = value }, removeItem: (key: string) => { delete stored[key] } })
    const first = await bookingRequestIdentity("completed-intent", { slot: "same" })
    expect(await bookingRequestIdentity("completed-intent", { slot: "same" })).toEqual(first)
    completeBookingRequest("completed-intent")
    expect(stored).toEqual({})
    expect(await bookingRequestIdentity("completed-intent", { slot: "same" })).not.toEqual(first)
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("disabled") }, setItem() { throw new Error("disabled") }, removeItem() { throw new Error("disabled") } })
    const privateFirst = await bookingRequestIdentity("private-completed", {})
    completeBookingRequest("private-completed")
    expect(await bookingRequestIdentity("private-completed", {})).not.toEqual(privateFirst)
  })
  it("replays the same request even when browser storage is disabled", async () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("private mode") }, setItem() { throw new Error("private mode") } })
    const input = { name: "Synthetic client", startsAt: "2026-11-02T05:30:00Z" }
    const first = await bookingRequestIdentity("private-page", input)
    expect(await bookingRequestIdentity("private-page", input)).toEqual(first)
    expect(await bookingRequestIdentity("private-page", { ...input, startsAt: "2026-11-02T06:00:00Z" })).not.toEqual(first)
  })
  it("stores no client form data and scopes independent pages separately", async () => {
    const stored: Record<string, string> = {}
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => stored[key] ?? null, setItem: (key: string, value: string) => { stored[key] = value } })
    const input = { name: "Synthetic secret name", phone: "+994501111111", note: "Private synthetic comment" }
    const first = await bookingRequestIdentity("page-a", input)
    const second = await bookingRequestIdentity("page-b", input)
    expect(first).not.toEqual(second)
    expect(JSON.stringify(stored)).not.toContain(input.name)
    expect(JSON.stringify(stored)).not.toContain(input.phone)
    expect(JSON.stringify(stored)).not.toContain(input.note)
    expect(first.idempotencyKey).not.toBe(first.recoverySecret)
  })
})
