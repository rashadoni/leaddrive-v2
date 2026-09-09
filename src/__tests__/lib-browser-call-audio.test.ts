// @vitest-environment jsdom

/**
 * The audio edges of a browser call.
 *
 * The interesting parts are not the plumbing but the two conversions the wire
 * format depends on, and what happens when a call ends: a microphone that stays
 * live after a hang-up looks exactly like being recorded, and a socket that
 * outlives the call looks exactly like a working one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { connectBrowserCall, prepareBrowserAudio, TELEPHONE_SAMPLE_RATE } from "@/lib/voip/browser-call-audio"

class FakeWorkletNode {
  port = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: vi.fn() }
  constructor(public context: unknown, public name: string, public options: unknown) {
    FakeWorkletNode.nodes.set(name, this)
  }
  connect() {}
  static nodes = new Map<string, FakeWorkletNode>()
}

class FakeAudioContext {
  static created: FakeAudioContext[] = []
  /** Set by the test that proves a browser which cannot load a worklet. */
  static failModules = false
  closed = false
  audioWorklet = {
    addModule: vi.fn(async () => {
      if (FakeAudioContext.failModules) throw new Error("no worklet")
    }),
  }
  constructor(public options: { sampleRate: number }) {
    FakeAudioContext.created.push(this)
  }
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn(async () => { this.closed = true })
  createMediaStreamSource() { return { connect: () => {} } }
  createGain() { return { gain: { value: 1 }, connect: () => {} } }
  destination = {}
}

class FakeSocket {
  static last: FakeSocket | null = null
  static OPEN = 1
  readyState = 1
  binaryType = ""
  sent: ArrayBuffer[] = []
  closed = false
  onopen: null | (() => void) = null
  onmessage: null | ((e: { data: unknown }) => void) = null
  onclose: null | (() => void) = null
  onerror: null | (() => void) = null
  constructor(public url: string) { FakeSocket.last = this }
  send(data: ArrayBuffer) { this.sent.push(data) }
  close() { this.closed = true }
}

const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] } as unknown as MediaStream

beforeEach(() => {
  vi.clearAllMocks()
  FakeWorkletNode.nodes.clear()
  FakeAudioContext.created.length = 0
  FakeAudioContext.failModules = false
  vi.stubGlobal("AudioContext", FakeAudioContext)
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode)
  vi.stubGlobal("WebSocket", FakeSocket)
})

async function open(ticket = "tick et/+1") {
  const prepared = await prepareBrowserAudio({
    stream,
    captureWorkletUrl: "/capture.js",
    playbackWorkletUrl: "/playback.js",
  })
  return connectBrowserCall(prepared, { relayUrl: "wss://relay.example/browser", ticket })
}

describe("browser call audio", () => {
  it("runs both ends at the telephone's own rate", async () => {
    await open()
    expect(FakeAudioContext.created.map((c) => c.options.sampleRate))
      .toEqual([TELEPHONE_SAMPLE_RATE, TELEPHONE_SAMPLE_RATE])
    expect(FakeWorkletNode.nodes.get("gemini-live-capture")?.options)
      .toEqual({ processorOptions: { targetSampleRate: 8000, chunkSamples: 160 } })
  })

  it("escapes the ticket instead of pasting it into the URL", async () => {
    await open()
    // A ticket is base64url plus a dot, but a value that ever grows a "+" or a
    // "/" must not silently become a different ticket on the wire.
    expect(FakeSocket.last?.url).toBe("wss://relay.example/browser?ticket=tick%20et%2F%2B1")
  })

  it("sends the microphone as 16-bit samples, clamped", async () => {
    await open()
    const capture = FakeWorkletNode.nodes.get("gemini-live-capture")!
    capture.port.onmessage?.({ data: { type: "audio", samples: new Float32Array([0, 1, -1, 2, -2]) } })

    const sent = new Int16Array(FakeSocket.last!.sent[0])
    // 2.0 would wrap to a loud click without the clamp; microphones with gain
    // produce values above 1.0 regularly.
    expect(Array.from(sent)).toEqual([0, 32767, -32768, 32767, -32768])
  })

  it("hands incoming audio to the earpiece as floats", async () => {
    await open()
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    const incoming = new Int16Array([0, 16384, -16384]).buffer
    FakeSocket.last?.onmessage?.({ data: incoming })

    const posted = playback.port.postMessage.mock.calls[0][0]
    expect(posted.type).toBe("audio")
    expect(Array.from(posted.samples as Float32Array)).toEqual([0, 0.5, -0.5])
  })

  it("does not report live media until the PBX half sends its first frame", async () => {
    const socketConnected = vi.fn()
    const mediaStarted = vi.fn()
    const prepared = await prepareBrowserAudio({
      stream,
      captureWorkletUrl: "/c.js",
      playbackWorkletUrl: "/p.js",
    })
    connectBrowserCall(prepared, {
      relayUrl: "wss://relay.example/browser",
      ticket: "t",
      onConnected: socketConnected,
      onMediaStarted: mediaStarted,
    })

    FakeSocket.last?.onopen?.()
    expect(socketConnected).toHaveBeenCalledTimes(1)
    expect(mediaStarted).not.toHaveBeenCalled()

    FakeSocket.last?.onmessage?.({ data: new Int16Array([1]).buffer })
    FakeSocket.last?.onmessage?.({ data: new Int16Array([2]).buffer })
    expect(mediaStarted).toHaveBeenCalledTimes(1)
  })

  it("stops the microphone and the contexts when the call ends", async () => {
    const call = await open()
    call.hangUp()

    expect(track.stop).toHaveBeenCalled()
    expect(FakeSocket.last?.closed).toBe(true)
    expect(FakeAudioContext.created.every((c) => c.close.mock.calls.length === 1)).toBe(true)
    expect(call.isConnected()).toBe(false)
  })

  it("ends the call once, however many things go wrong", async () => {
    const ended = vi.fn()
    const prepared = await prepareBrowserAudio({
      stream,
      captureWorkletUrl: "/c.js",
      playbackWorkletUrl: "/p.js",
    })
    const call = connectBrowserCall(prepared, {
      relayUrl: "wss://relay.example/browser",
      ticket: "t",
      onEnded: ended,
    })
    FakeSocket.last?.onerror?.()
    FakeSocket.last?.onclose?.()
    call.hangUp()

    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith("socket_error")
  })

  it("asks for a 20 ms chunk and a bounded delay, not the assistant's settings", async () => {
    await open()
    // One browser packet = one AudioSocket frame, so the station never has to
    // cut a burst into three.
    expect((FakeWorkletNode.nodes.get("gemini-live-capture")?.options as { processorOptions: Record<string, number> })
      .processorOptions.chunkSamples).toBe(160)
    // A live conversation: late audio must not become permanent delay.
    expect((FakeWorkletNode.nodes.get("gemini-live-playback")?.options as { processorOptions: Record<string, number> })
      .processorOptions.maxLatencySeconds).toBe(0.2)
  })

  it("leaves nothing running when the audio stack cannot be built", async () => {
    // This is the whole point of preparing before dialling: a browser that
    // cannot load a worklet must not leave a live microphone and two contexts
    // behind while the caller decides what to tell the user.
    FakeAudioContext.failModules = true
    await expect(prepareBrowserAudio({
      stream,
      captureWorkletUrl: "/c.js",
      playbackWorkletUrl: "/p.js",
    })).rejects.toThrow()

    expect(track.stop).toHaveBeenCalled()
    expect(FakeAudioContext.created.every((c) => c.close.mock.calls.length === 1)).toBe(true)
  })
})
