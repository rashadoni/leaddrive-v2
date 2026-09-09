import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

type WorkletPort = {
  onmessage: ((event: { data: unknown }) => void) | null
  messages: unknown[]
  postMessage: (message: unknown) => void
}

type WorkletInstance = {
  port: WorkletPort
  process: (inputs: Float32Array[][], outputs?: Float32Array[][]) => boolean
  count?: number
  capacity?: number
}

function loadProcessor(path: string, contextSampleRate: number): new (options?: unknown) => WorkletInstance {
  let Processor: (new (options?: unknown) => WorkletInstance) | null = null
  class AudioWorkletProcessor {
    port: WorkletPort = {
      onmessage: null,
      messages: [],
      postMessage: (message) => { this.port.messages.push(message) },
    }
  }
  runInNewContext(readFileSync(path, "utf8"), {
    AudioWorkletProcessor,
    Float32Array,
    Math,
    Number,
    sampleRate: contextSampleRate,
    registerProcessor: (_name: string, implementation: new (options?: unknown) => WorkletInstance) => {
      Processor = implementation
    },
  })
  if (!Processor) throw new Error(`Worklet did not register: ${path}`)
  return Processor
}

describe("Gemini Live audio worklets", () => {
  it("statefully resamples a 48 kHz capture context to 16 kHz chunks", () => {
    const Capture = loadProcessor("public/gemini-live-capture.worklet.js", 48_000)
    const capture = new Capture({ processorOptions: { targetSampleRate: 16_000 } })
    for (let i = 0; i < 12; i += 1) {
      capture.process([[new Float32Array(128).fill(0.25)]])
    }
    const audio = capture.port.messages.find((message) => (message as { type?: string }).type === "audio") as {
      samples: Float32Array
    }
    expect(audio.samples).toHaveLength(512)
    expect(audio.samples.every((sample) => Math.abs(sample - 0.25) < 0.0001)).toBe(true)
  })

  it("bounds playback, resamples 24 kHz output, and fences stale generations", () => {
    const Playback = loadProcessor("public/gemini-live-playback.worklet.js", 48_000)
    const playback = new Playback({
      processorOptions: { sourceSampleRate: 24_000, maxBufferedSeconds: 0.01, generation: 7 },
    })
    playback.port.onmessage?.({ data: { type: "audio", generation: 6, samples: new Float32Array(100) } })
    expect(playback.count).toBe(0)

    // A chunk larger than the ring GROWS it. Gemini streams an answer faster
    // than it plays, so the un-played tail is the rest of the answer: a fixed
    // ring would be a limit on how long the assistant may talk, and it used to
    // end the call mid-sentence.
    playback.port.onmessage?.({ data: { type: "audio", generation: 7, samples: new Float32Array(300).fill(0.5) } })
    expect(playback.capacity).toBe(480)
    expect(playback.count).toBe(300)
    expect(playback.port.messages).toContainEqual({ type: "grew", generation: 7, capacity: 480 })
    expect(playback.port.messages.some((message) => (message as { type?: string }).type === "overflow")).toBe(false)

    const output = new Float32Array(128)
    playback.process([], [[output]])
    expect(output.some((sample) => sample !== 0)).toBe(true)

    playback.port.onmessage?.({ data: { type: "audio", generation: 7, samples: new Float32Array(100).fill(0.5) } })
    expect(playback.count).toBeGreaterThan(0)
    playback.port.onmessage?.({ data: { type: "reset", generation: 8 } })
    playback.port.onmessage?.({ data: { type: "audio", generation: 8, samples: new Float32Array(100).fill(0.5) } })
    expect(playback.count).toBe(100)
    // A reset released the grown ring instead of holding the high-water mark.
    expect(playback.capacity).toBe(240)

    playback.port.onmessage?.({ data: { type: "interrupt", generation: 7 } })
    expect(playback.count).toBeGreaterThan(0)
    playback.port.onmessage?.({ data: { type: "interrupt", generation: 8 } })
    expect(playback.count).toBe(0)
  })

  it("holds a long answer instead of ending the call", () => {
    // The production failure, in numbers: a 30-second ring, an answer longer
    // than 30 seconds, and a session that stopped mid-sentence.
    const Playback = loadProcessor("public/gemini-live-playback.worklet.js", 48_000)
    const playback = new Playback({
      processorOptions: { sourceSampleRate: 24_000, maxBufferedSeconds: 30, generation: 1 },
    })
    // 90 seconds of speech, streamed as the model streams it: far faster than
    // it plays, in chunks of a fifth of a second.
    for (let i = 0; i < 450; i += 1) {
      playback.port.onmessage?.({ data: { type: "audio", generation: 1, samples: new Float32Array(4_800).fill(0.25) } })
    }
    expect(playback.count).toBe(450 * 4_800)
    expect(playback.port.messages.some((message) => (message as { type?: string }).type === "overflow")).toBe(false)

    const output = new Float32Array(128)
    playback.process([], [[output]])
    expect(output.every((sample) => Math.abs(sample - 0.25) < 0.0001)).toBe(true)

    // Barge-in returns the memory rather than keeping ninety seconds of ring.
    playback.port.onmessage?.({ data: { type: "interrupt", generation: 1 } })
    expect(playback.count).toBe(0)
    expect(playback.capacity).toBe(24_000 * 30)
  })

  it("keeps a live call's delay bounded instead of growing with it", () => {
    // The opposite case to a spoken answer. There the whole reply arrives
    // faster than it plays and the ring grows so nothing is lost. In a live
    // conversation a stall would otherwise become permanent one-way delay:
    // the late audio still plays, just always late, for the rest of the call.
    const Playback = loadProcessor("public/gemini-live-playback.worklet.js", 48_000)
    const playback = new Playback({
      processorOptions: { sourceSampleRate: 8_000, generation: 1, maxLatencySeconds: 0.2 },
    })

    // A second of audio arrives while nothing is draining.
    for (let i = 0; i < 5; i += 1) {
      playback.port.onmessage?.({ data: { type: "audio", generation: 1, samples: new Float32Array(1_600).fill(0.5) } })
    }

    // Held at 200 ms, not 1 000 ms: the oldest went, the newest is what plays.
    expect(playback.count).toBe(1_600)
    expect(playback.port.messages.some((m) => (m as { type?: string }).type === "latency_trimmed")).toBe(true)
    expect(playback.port.messages.some((m) => (m as { type?: string }).type === "overflow")).toBe(false)
  })

  it("leaves the assistant's answer path growing exactly as before", () => {
    // No maxLatencySeconds means the answer behaviour, untouched: a two-minute
    // reply must not lose its middle.
    const Playback = loadProcessor("public/gemini-live-playback.worklet.js", 48_000)
    const playback = new Playback({
      processorOptions: { sourceSampleRate: 24_000, maxBufferedSeconds: 30, generation: 1 },
    })
    for (let i = 0; i < 100; i += 1) {
      playback.port.onmessage?.({ data: { type: "audio", generation: 1, samples: new Float32Array(24_000).fill(0.25) } })
    }
    expect(playback.count).toBe(100 * 24_000)
    expect(playback.port.messages.some((m) => (m as { type?: string }).type === "latency_trimmed")).toBe(false)
  })

  it("sizes the capture chunk when the caller says so, and not otherwise", () => {
    const Capture = loadProcessor("public/gemini-live-capture.worklet.js", 48_000)
    // The telephone path asks for 20 ms at 8 kHz so one packet is one frame.
    const phone = new Capture({ processorOptions: { targetSampleRate: 8_000, chunkSamples: 160 } })
    for (let i = 0; i < 80; i += 1) phone.process([[new Float32Array(128).fill(0.2)]])
    const phoneAudio = phone.port.messages.find((m) => (m as { type?: string }).type === "audio") as { samples: Float32Array }
    expect(phoneAudio.samples).toHaveLength(160)

    // The assistant passes nothing and keeps the chunk it was tuned with.
    const assistant = new Capture({ processorOptions: { targetSampleRate: 16_000 } })
    for (let i = 0; i < 400; i += 1) assistant.process([[new Float32Array(128).fill(0.2)]])
    const assistantAudio = assistant.port.messages.find((m) => (m as { type?: string }).type === "audio") as { samples: Float32Array }
    expect(assistantAudio.samples).toHaveLength(512)
  })
})
