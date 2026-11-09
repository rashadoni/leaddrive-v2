/**
 * A service that takes the request and then says nothing no longer holds the
 * sender (owner, 2026-11-09: «Да, тайм-ауты»). The stand-in service below
 * never answers — exactly what a hung provider looks like — and gives up
 * only when the request's own signal does. Before, Node's fetch would have
 * waited five minutes for the headers; each sender now stops at its limit and
 * reports a failure the way it reports a dropped connection.
 *
 * The limits are real (15 s for a message); to keep the test fast the timer
 * behind `AbortSignal.timeout` is shortened, and the limit each sender asked
 * for is checked separately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { atlProvider } from "@/lib/sms/providers/atl"
import { sendVkMessage } from "@/lib/vkontakte"
import { sendExpoPush } from "@/lib/push/expo-push"

const realTimeout = AbortSignal.timeout.bind(AbortSignal)
let asked: number[]

beforeEach(() => {
  asked = []
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    asked.push(ms)
    return realTimeout(30)
  })
  vi.spyOn(console, "error").mockImplementation(() => {})
  // The hung service: never answers, gives up only when the signal fires.
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) return // no limit: this request would wait for ever
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Settles `work` or reports that it is still waiting after `ms`. */
const within = <T,>(work: Promise<T>, ms = 2_000) =>
  Promise.race([work, new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), ms))])

describe("a sender gives up on a service that does not answer", () => {
  it("SMS through ATL reports a failure instead of waiting", async () => {
    const result = await within(atlProvider.send({ atlLogin: "l", atlPassword: "p", atlTitle: "T" }, { to: "+994501234567", message: "Salam" }, false))
    expect(result).toMatchObject({ success: false })
    expect(asked).toEqual([15_000])
  })

  it("a VK message reports a failure instead of waiting", async () => {
    expect(await within(sendVkMessage("1", "Salam", "token"))).toBe(false)
    expect(asked).toEqual([15_000])
  })

  it("a push to the field app returns instead of waiting", async () => {
    expect(await within(sendExpoPush([{ to: "ExponentPushToken[abc]", title: "t", body: "b" }]))).toBe(1)
    expect(asked).toEqual([15_000])
  })
})
