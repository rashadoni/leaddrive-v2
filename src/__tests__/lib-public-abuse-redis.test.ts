import { afterEach, describe, expect, it, vi } from "vitest"
import { waitForPublicGuardRedis } from "@/lib/public-abuse-redis"

type Listener = () => void

function connectingRedis() {
  const listeners = new Map<string, Set<Listener>>()
  const client = {
    status: "connecting",
    once(event: string, listener: Listener) {
      const wrapped = () => {
        client.off(event, wrapped)
        listener()
      }
      const current = listeners.get(event) ?? new Set<Listener>()
      current.add(wrapped)
      listeners.set(event, current)
      return client
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener)
      return client
    },
    emit(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener()
    },
  }
  return client
}

describe("public abuse Redis readiness", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("lets the first request await a bounded initial connection", async () => {
    const redis = connectingRedis()
    const readiness = waitForPublicGuardRedis(redis as any)

    redis.status = "ready"
    redis.emit("ready")

    await expect(readiness).resolves.toBe(true)
  })

  it("fails closed when a connecting client does not become ready in time", async () => {
    vi.useFakeTimers()
    const redis = connectingRedis()
    const readiness = waitForPublicGuardRedis(redis as any)

    await vi.advanceTimersByTimeAsync(751)

    await expect(readiness).resolves.toBe(false)
  })

  it("shares one readiness wait between concurrent first requests", async () => {
    const redis = connectingRedis()
    const first = waitForPublicGuardRedis(redis as any)
    const second = waitForPublicGuardRedis(redis as any)

    expect(second).toBe(first)
    redis.status = "ready"
    redis.emit("ready")
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })
})
