/**
 * Two strangers meet on a phone call. Everything about who they are is decided
 * before a single audio frame moves.
 *
 * These drive the relay's pairing directly with fake sockets: the audio pump is
 * two lines, the interesting behaviour is who gets joined to whom, who is
 * refused, and what happens to a half whose partner never arrives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"

process.env.NODE_ENV = "test"

const { park, waiting } = await import("../../scripts/softphone-relay/relay.mjs")

class FakeSocket extends EventEmitter {
  readyState = 1
  OPEN = 1
  resumed = 0
  resume() { this.resumed += 1 }
  sent: Array<{ data: unknown; binary: boolean }> = []
  closed: { code?: number; reason?: string } | null = null
  send(data: unknown, opts: { binary: boolean }) {
    this.sent.push({ data, binary: opts?.binary === true })
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
    this.readyState = 3
    this.emit("close")
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  waiting.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("relay pairing", () => {
  it("joins a browser and the PBX half that names the same call", () => {
    const browser = new FakeSocket()
    const pbx = new FakeSocket()

    park("call-1", "browser", browser as never)
    expect(waiting.size).toBe(1)
    park("call-1", "pbx", pbx as never)
    expect(waiting.size).toBe(0)

    // Audio moves both ways, binary preserved — telephone audio is not text.
    browser.emit("message", Buffer.from([1, 2, 3]), true)
    pbx.emit("message", Buffer.from([4, 5]), true)
    expect(pbx.sent).toEqual([{ data: Buffer.from([1, 2, 3]), binary: true }])
    expect(browser.sent).toEqual([{ data: Buffer.from([4, 5]), binary: true }])
  })

  it("never joins two halves of different calls", () => {
    const browser = new FakeSocket()
    const otherPbx = new FakeSocket()

    park("call-1", "browser", browser as never)
    park("call-2", "pbx", otherPbx as never)

    expect(waiting.size).toBe(2)
    browser.emit("message", Buffer.from([9]), true)
    expect(otherPbx.sent).toEqual([])
  })

  it("refuses a second socket claiming the same side of a live call", () => {
    const first = new FakeSocket()
    const impostor = new FakeSocket()

    park("call-1", "browser", first as never)
    park("call-1", "browser", impostor as never)

    // The newcomer loses: the parked socket may already be a call in progress.
    expect(impostor.closed?.code).toBe(4409)
    expect(first.closed).toBeNull()
  })

  it("ends both halves together when either one goes", () => {
    const browser = new FakeSocket()
    const pbx = new FakeSocket()
    park("call-1", "browser", browser as never)
    park("call-1", "pbx", pbx as never)

    pbx.close()

    // A browser left holding a live socket after the customer hung up looks
    // exactly like a working call to the salesperson.
    expect(browser.closed?.code).toBe(1000)
  })

  it("releases a half whose partner never arrives", () => {
    const browser = new FakeSocket()
    park("call-1", "browser", browser as never)

    vi.advanceTimersByTime(120_000)

    expect(browser.closed?.code).toBe(4408)
    expect(waiting.size).toBe(0)
  })

  it("forgets a parked half as soon as its socket closes", () => {
    const browser = new FakeSocket()
    park("call-1", "browser", browser as never)
    browser.close()
    expect(waiting.size).toBe(0)
  })

  it("holds the station's audio until the halves meet, and never holds the browser's", () => {
    // The two windows differ by three orders of magnitude, so they get
    // different policies. The station pairs within milliseconds of connecting
    // and those first bytes are the customer's first word — hold them. The
    // browser parks for the whole ringing time, up to two minutes; holding that
    // would deliver a minute of the salesperson talking to themselves as one
    // burst the moment the customer answers. So it is never paused: whatever is
    // said before the halves meet is simply not carried.
    const browser = new FakeSocket()
    const pbx = new FakeSocket()

    park("call-1", "pbx", pbx as never)
    expect(pbx.resumed).toBe(0)

    park("call-1", "browser", browser as never)
    expect(pbx.resumed).toBe(1)
    expect(browser.resumed).toBe(0)
  })
})
