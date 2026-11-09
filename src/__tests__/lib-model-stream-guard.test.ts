/**
 * A streamed model round that goes silent is cut off and asked once more
 * (src/lib/ai/model-stream-guard.ts). Production 2026-11-09: Anthropic's
 * stream stopped for 65 s after the first word, and nothing bounded it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MODEL_STREAM_STALL_MS, ModelStreamStalledError, streamRoundGuarded } from "@/lib/ai/model-stream-guard"

type Event = { n: number }

/** A stream that sends `events`, then either finishes or goes silent until aborted. */
function stream(events: Event[], ends: "finish" | "silent", message = "done") {
  const handlers: Array<(event: Event) => void> = []
  let abortWith: ((error: Error) => void) | undefined
  const self = {
    aborted: false,
    on(_name: "streamEvent", handler: (event: Event) => void) { handlers.push(handler); return self },
    finalMessage() {
      for (const event of events) for (const handler of handlers) handler(event)
      if (ends === "finish") return Promise.resolve(message)
      return new Promise<string>((_resolve, reject) => { abortWith = reject })
    },
    abort() { self.aborted = true; abortWith?.(new Error("Request was aborted.")) },
  }
  return self
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("streamRoundGuarded", () => {
  it("passes a healthy round through, every event to the caller", async () => {
    const seen: number[] = []
    const onRetry = vi.fn()
    const result = await streamRoundGuarded({ open: () => stream([{ n: 1 }, { n: 2 }], "finish"), onEvent: (e) => seen.push(e.n), onRetry })
    expect(result).toBe("done")
    expect(seen).toEqual([1, 2])
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("cuts off a stream silent for 20 s after its first word and asks the round again", async () => {
    const first = stream([{ n: 1 }], "silent")
    const second = stream([{ n: 1 }, { n: 2 }], "finish", "second answer")
    const opened = [first, second]
    const order: string[] = []
    const work = streamRoundGuarded({
      open: () => { order.push("open"); return opened.shift()! },
      onEvent: (e) => order.push(`event ${e.n}`),
      onRetry: () => order.push("retry"),
      onStall: (attempt) => order.push(`stall ${attempt}`),
    })
    await vi.advanceTimersByTimeAsync(MODEL_STREAM_STALL_MS - 1)
    expect(first.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(work).resolves.toBe("second answer")
    expect(first.aborted).toBe(true)
    expect(order).toEqual(["open", "event 1", "stall 1", "retry", "open", "event 1", "event 2"])
  })

  it("gives up after the second silence, saying so", async () => {
    const work = streamRoundGuarded({ open: () => stream([], "silent"), onEvent: () => {}, onRetry: () => {} })
    const failed = expect(work).rejects.toBeInstanceOf(ModelStreamStalledError)
    await vi.advanceTimersByTimeAsync(2 * MODEL_STREAM_STALL_MS)
    await failed
  })

  it("does not cut off a slow stream that keeps talking", async () => {
    const handlers: Array<(event: Event) => void> = []
    let finish!: (message: string) => void
    const slow = {
      aborted: false,
      on(_name: "streamEvent", handler: (event: Event) => void) { handlers.push(handler); return slow },
      finalMessage: () => new Promise<string>((resolve) => { finish = resolve }),
      abort() { slow.aborted = true },
    }
    const work = streamRoundGuarded({ open: () => slow, onEvent: () => {}, onRetry: () => {} })
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(MODEL_STREAM_STALL_MS - 1_000)
      for (const handler of handlers) handler({ n: i })
    }
    finish("slow but whole")
    await expect(work).resolves.toBe("slow but whole")
    expect(slow.aborted).toBe(false)
  })

  it("passes any other failure through without asking again", async () => {
    const onRetry = vi.fn()
    const broken = { on: () => broken, finalMessage: () => Promise.reject(new Error("overloaded_error")), abort: () => {} }
    await expect(streamRoundGuarded({ open: () => broken, onEvent: () => {}, onRetry })).rejects.toThrow("overloaded_error")
    expect(onRetry).not.toHaveBeenCalled()
  })
})
