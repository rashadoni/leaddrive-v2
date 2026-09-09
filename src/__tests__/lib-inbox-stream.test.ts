import { describe, it, expect } from "vitest"
import { inboxSignature, nextInboxSignal, sseFrame, SSE_HEARTBEAT } from "@/lib/inbox-stream"

// Phase 6 — the SSE bridge is a cheap change-detector: signature changes → push refresh.
describe("inboxSignature", () => {
  it("combines count + latestMs into a stable string", () => {
    expect(inboxSignature({ count: 3, latestMs: 1000 })).toBe("3:1000:0:0")
  })

  it("renders a null latestMs (empty org) as 0", () => {
    expect(inboxSignature({ count: 0, latestMs: null })).toBe("0:0:0:0")
  })

  it("changes when a new message arrives (count + timestamp move)", () => {
    const before = inboxSignature({ count: 5, latestMs: 1000 })
    const after = inboxSignature({ count: 6, latestMs: 2000 })
    expect(before).not.toBe(after)
  })

  it("changes when a call-only event arrives even if messages do not change", () => {
    const before = inboxSignature({ count: 5, latestMs: 1000, callCount: 1, callLatestMs: 1500 })
    const after = inboxSignature({ count: 5, latestMs: 1000, callCount: 2, callLatestMs: 2000 })
    expect(before).not.toBe(after)
  })
})

describe("nextInboxSignal", () => {
  it("the FIRST observation (prev null) is never a change — only baselines", () => {
    const r = nextInboxSignal(null, { count: 4, latestMs: 9 })
    expect(r).toEqual({ signature: "4:9:0:0", changed: false })
  })

  it("an identical snapshot does not push", () => {
    const r = nextInboxSignal("4:9:0:0", { count: 4, latestMs: 9 })
    expect(r.changed).toBe(false)
    expect(r.signature).toBe("4:9:0:0")
  })

  it("a delta (new message) pushes a refresh", () => {
    const r = nextInboxSignal("4:9:0:0", { count: 5, latestMs: 20 })
    expect(r.changed).toBe(true)
    expect(r.signature).toBe("5:20:0:0")
  })

  it("catches a delete+insert that nets the same count via the timestamp", () => {
    // count unchanged (5→5) but a newer message exists → still a change.
    const r = nextInboxSignal("5:100:0:0", { count: 5, latestMs: 200 })
    expect(r.changed).toBe(true)
  })

  it("pushes a refresh when only CallLog changes", () => {
    const r = nextInboxSignal(
      "5:100:1:150",
      { count: 5, latestMs: 100, callCount: 2, callLatestMs: 220 },
    )
    expect(r.changed).toBe(true)
  })
})

describe("sseFrame", () => {
  it("serializes a named event with JSON data + the blank-line terminator", () => {
    expect(sseFrame({ type: "refresh" }, "refresh")).toBe('event: refresh\ndata: {"type":"refresh"}\n\n')
  })

  it("omits the event line when no event name is given", () => {
    expect(sseFrame({ ok: true })).toBe('data: {"ok":true}\n\n')
  })

  it("heartbeat is an SSE comment (ignored by EventSource)", () => {
    expect(SSE_HEARTBEAT.startsWith(":")).toBe(true)
    expect(SSE_HEARTBEAT.endsWith("\n\n")).toBe(true)
  })
})
