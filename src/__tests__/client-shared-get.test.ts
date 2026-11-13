import { afterEach, describe, expect, it, vi } from "vitest"
import { sharedGetJson, sharedGetsInFlight } from "@/lib/client/shared-get"

/** A response that arrives only when the test says so. */
function heldFetch() {
  const calls: string[] = []
  const pending: Array<{ answer: (body: unknown, status?: number) => void; fail: (e: Error) => void }> = []
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    calls.push(url)
    return new Promise<Response>((resolve, reject) => {
      pending.push({
        answer: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })),
        fail: reject,
      })
    })
  }))
  return { calls, pending }
}

afterEach(() => vi.unstubAllGlobals())

/**
 * The task table, the task form and the saved-view bar read the same lists when a page opens;
 * on prod each list was requested twice, in the same millisecond (2026-11-13).
 */
describe("parts of a page that need the same list read it once", () => {
  it("two reads of one address in flight are one request, and both get the answer", async () => {
    const net = heldFetch()
    const a = sharedGetJson<{ data: string[] }>("/api/v1/task-types?activeOnly=true")
    const b = sharedGetJson<{ data: string[] }>("/api/v1/task-types?activeOnly=true")
    expect(net.calls).toEqual(["/api/v1/task-types?activeOnly=true"])
    net.pending[0].answer({ data: ["bug"] })
    expect(await a).toEqual({ ok: true, status: 200, json: { data: ["bug"] } })
    expect(await b).toEqual({ ok: true, status: 200, json: { data: ["bug"] } })
  })

  it("keeps nothing: a read after the answer goes to the server again", async () => {
    const net = heldFetch()
    const first = sharedGetJson("/api/v1/saved-views?entityType=tasks")
    net.pending[0].answer({ data: [] })
    await first
    expect(sharedGetsInFlight()).toBe(0)

    const second = sharedGetJson<{ data: string[] }>("/api/v1/saved-views?entityType=tasks")
    expect(net.calls).toHaveLength(2)
    net.pending[1].answer({ data: ["new view"] })
    expect((await second).json).toEqual({ data: ["new view"] })
  })

  it("different addresses are different requests", async () => {
    const net = heldFetch()
    const types = sharedGetJson("/api/v1/task-types?activeOnly=true")
    const all = sharedGetJson("/api/v1/task-types")
    expect(net.calls).toEqual(["/api/v1/task-types?activeOnly=true", "/api/v1/task-types"])
    net.pending[0].answer({ data: [1] })
    net.pending[1].answer({ data: [1, 2] })
    expect((await types).json).toEqual({ data: [1] })
    expect((await all).json).toEqual({ data: [1, 2] })
  })

  it("a refusal reaches everyone who shared the read, with its status", async () => {
    const net = heldFetch()
    const a = sharedGetJson("/api/v1/event-types?activeOnly=true")
    const b = sharedGetJson("/api/v1/event-types?activeOnly=true")
    net.pending[0].answer({ error: "Forbidden" }, 403)
    expect(await a).toEqual({ ok: false, status: 403, json: { error: "Forbidden" } })
    expect((await b).ok).toBe(false)
  })

  it("a network failure fails for everyone and is not remembered", async () => {
    const net = heldFetch()
    const a = sharedGetJson("/api/v1/event-types")
    const b = sharedGetJson("/api/v1/event-types")
    net.pending[0].fail(new Error("offline"))
    await expect(a).rejects.toThrow("offline")
    await expect(b).rejects.toThrow("offline")
    expect(sharedGetsInFlight()).toBe(0)

    const again = sharedGetJson("/api/v1/event-types")
    net.pending[1].answer({ data: [] })
    expect((await again).ok).toBe(true)
  })

  it("a body that is not JSON is an answer without data, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })))
    expect(await sharedGetJson("/api/v1/task-types")).toEqual({ ok: false, status: 502, json: null })
  })
})
