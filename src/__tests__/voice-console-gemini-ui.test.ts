// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const gemini = vi.hoisted(() => ({
  callbacks: null as null | {
    onmessage: (message: unknown) => void
    onerror: () => void
    onclose: () => void
  },
  constructorArgs: [] as unknown[],
  connectArgs: [] as unknown[],
  connectBarrier: null as Promise<void> | null,
  session: {
    sendRealtimeInput: vi.fn(),
    sendToolResponse: vi.fn(),
    close: vi.fn(),
  },
}))

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    live = {
      connect: vi.fn(async (input: { callbacks: typeof gemini.callbacks }) => {
        gemini.connectArgs.push(input)
        gemini.callbacks = input.callbacks
        if (gemini.connectBarrier) await gemini.connectBarrier
        return gemini.session
      }),
    }
    constructor(input: unknown) { gemini.constructorArgs.push(input) }
  },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads",
  useRouter: () => ({ push: vi.fn() }),
}))

const labels: Record<string, string> = {
  idle: "Ready",
  listening: "Listening",
  hearing: "I can hear you…",
  processing: "Preparing an answer…",
  speaking: "Speaking",
  connecting: "Connecting…",
  start: "Start talking",
  stop: "Stop",
  startFailed: "Start failed",
  connectionLost: "Connection stopped. Click to start again.",
  noResponse: "Response timeout. Click to start again.",
  micDenied: "Mic blocked",
  micSilent: "No sound is reaching us",
  crmUnreachable: "Lost the link to CRM data",
  budgetExhausted: "No budget",
  transcriptionUnavailable: "Caption unavailable",
  idleStopped: "Stopped after a minute of silence",
  sessionLimit: "The conversation reached its time limit",
}

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => Object.assign(
    (key: string, values?: { text?: string }) => key === "heard"
      ? `Heard: ${values?.text ?? ""}`
      : labels[key] ?? key,
    { has: () => false },
  ),
}))

import { VoiceConsole } from "@/components/ai/voice-console"

class FakeTrack {
  stop = vi.fn()
}

class FakeStream {
  track = new FakeTrack()
  getTracks() { return [this.track] }
}

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null
  sent: Array<{ message: unknown; transfer?: Transferable[] }> = []
  postMessage(message: unknown, transfer?: Transferable[]) { this.sent.push({ message, transfer }) }
  emit(data: unknown) { this.onmessage?.(new MessageEvent("message", { data })) }
}

class FakeWorkletNode {
  static nodes = new Map<string, FakeWorkletNode>()
  port = new FakePort()
  options: AudioWorkletNodeOptions | undefined
  constructor(_context: AudioContext, name: string, options?: AudioWorkletNodeOptions) {
    this.options = options
    FakeWorkletNode.nodes.set(name, this)
  }
  connect() { return this }
  disconnect() {}
}

class FakeAnalyser {
  fftSize = 512
  frequencyBinCount = 256
  getByteTimeDomainData(buffer: Uint8Array) { buffer.fill(140) }
}

class FakeAudioContext {
  state: AudioContextState = "running"
  destination = {}
  audioWorklet = { addModule: vi.fn(async () => {}) }
  createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} } }
  createGain() { return { gain: { value: 1 }, connect: () => {} } }
  createAnalyser() { return new FakeAnalyser() }
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("VoiceConsole Gemini Live lifecycle", () => {
  let container: HTMLDivElement
  let root: Root
  let stream: FakeStream
  let toolReadBarrier: Promise<Response> | null
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    stream = new FakeStream()
    toolReadBarrier = null
    gemini.callbacks = null
    gemini.constructorArgs.length = 0
    gemini.connectArgs.length = 0
    gemini.connectBarrier = null
    gemini.session.sendRealtimeInput.mockReset()
    gemini.session.sendToolResponse.mockReset()
    gemini.session.close.mockReset()
    FakeWorkletNode.nodes.clear()
    vi.stubGlobal("AudioContext", FakeAudioContext)
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    })
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => true) })
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/api/v1/ai/voice/session")) {
        return json({ data: {
          voiceSessionId: "voice-session-1",
          maxSessionSeconds: 3_600,
          heartbeatIntervalSeconds: 15,
          remainingSeconds: 7_200,
          firstName: "Rashad",
          allowedSections: ["leads"],
        } })
      }
      if (url.endsWith("/session/token")) {
        return json({ data: {
          token: "ephemeral-only",
          expiresAt: "2026-08-14T11:02:00.000Z",
          model: "gemini-3.1-flash-live-preview",
          apiVersion: "v1beta",
          connectionId: "17de9868-8f83-4baf-85dc-5e6ac5eb3622",
        } })
      }
      if (url.endsWith("/session/end")) return json({ data: { billedSeconds: 1 } })
      if (url.endsWith("/session/heartbeat")) return json({ ok: true })
      if (url.endsWith("/voice/read")) return toolReadBarrier ?? json({ data: { total: 7 } })
      if (url.endsWith("/voice/trace")) return new Response(null, { status: 204 })
      return json({ data: {} })
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function start() {
    await act(async () => {
      root.render(createElement(VoiceConsole, { variant: "orb", autoStart: true }))
      await flush()
    })
    expect(gemini.callbacks).not.toBeNull()
  }

  it("does not load the Gemini runtime until voice is started", async () => {
    await act(async () => {
      root.render(createElement(VoiceConsole, { variant: "orb", autoStart: false }))
      await flush()
    })
    expect(gemini.constructorArgs).toHaveLength(0)
    expect(gemini.connectArgs).toHaveLength(0)
  })

  it("does not wire microphone capture until Gemini setup connects", async () => {
    let release!: () => void
    gemini.connectBarrier = new Promise<void>((resolve) => { release = resolve })
    await act(async () => {
      root.render(createElement(VoiceConsole, { variant: "orb", autoStart: true }))
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(1)
    expect(FakeWorkletNode.nodes.size).toBe(0)
    await act(async () => {
      release()
      gemini.connectBarrier = null
      await flush()
    })
    expect(FakeWorkletNode.nodes.has("gemini-live-capture")).toBe(true)
  })

  it("fails the start promptly when Gemini closes before setupComplete", async () => {
    gemini.connectBarrier = new Promise<void>(() => {})
    await act(async () => {
      root.render(createElement(VoiceConsole, { variant: "orb", autoStart: true }))
      await flush()
    })
    expect(gemini.callbacks).not.toBeNull()
    await act(async () => {
      gemini.callbacks!.onclose()
      await flush()
    })
    expect(container.textContent).toContain("Start failed")
    expect(FakeWorkletNode.nodes.size).toBe(0)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/session/end"))).toBe(true)
  })

  it("fails the start promptly when Gemini errors before setupComplete", async () => {
    gemini.connectBarrier = new Promise<void>(() => {})
    await act(async () => {
      root.render(createElement(VoiceConsole, { variant: "orb", autoStart: true }))
      await flush()
    })
    await act(async () => {
      gemini.callbacks!.onerror()
      await flush()
    })
    expect(container.textContent).toContain("Start failed")
    expect(FakeWorkletNode.nodes.size).toBe(0)
  })

  it("times out a hung setup and closes a session that resolves late", async () => {
    let release!: () => void
    gemini.connectBarrier = new Promise<void>((resolve) => { release = resolve })
    await act(async () => {
      root.render(createElement(VoiceConsole, { variant: "orb", autoStart: true }))
      await flush()
    })
    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await flush()
    })
    expect(container.textContent).toContain("Start failed")
    await act(async () => {
      release()
      gemini.connectBarrier = null
      await flush()
    })
    expect(gemini.session.close).toHaveBeenCalled()
  })

  it("uses only the server-issued ephemeral token and never calls the legacy connect endpoint", async () => {
    await start()
    expect(gemini.constructorArgs).toEqual([{ apiKey: "ephemeral-only", httpOptions: { apiVersion: "v1beta" } }])
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/session/token"))).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/session/connect"))).toBe(false)
    expect(gemini.session.sendRealtimeInput).toHaveBeenCalledWith({
      text: "Greet the user briefly in en and address them as Rashad.",
    })
    expect(gemini.connectArgs[0]).toEqual(expect.objectContaining({
      config: { sessionResumption: {} },
    }))
    expect(container.textContent).toContain("Preparing an answer")
  })

  it("streams 16 kHz microphone PCM directly into Gemini Live", async () => {
    await start()
    const capture = FakeWorkletNode.nodes.get("gemini-live-capture")!
    expect(capture.options?.processorOptions).toEqual({ targetSampleRate: 16_000 })
    act(() => capture.port.emit({ type: "audio", samples: new Float32Array([0, 0.5, -0.5]) }))
    expect(gemini.session.sendRealtimeInput).toHaveBeenCalledWith({
      audio: expect.objectContaining({ mimeType: "audio/pcm;rate=16000" }),
    })
  })

  it("plays every bundled audio part and immediately flushes playback on barge-in", async () => {
    await start()
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    expect(playback.options?.processorOptions).toEqual({
      sourceSampleRate: 24_000,
      maxBufferedSeconds: 30,
      generation: 1,
    })
    act(() => gemini.callbacks!.onmessage({
      serverContent: {
        modelTurn: { parts: [
          { inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } },
          { inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } },
        ] },
      },
    }))
    expect(playback.port.sent.filter(({ message }) => (message as { type?: string }).type === "audio")).toHaveLength(2)
    expect(container.textContent).toContain("Speaking")

    act(() => gemini.callbacks!.onmessage({ serverContent: { interrupted: true } }))
    expect(playback.port.sent.at(-1)?.message).toEqual({ type: "interrupt", generation: 1 })
  })

  it("flushes queued playback synchronously on local speech before Gemini confirms interruption", async () => {
    await start()
    const capture = FakeWorkletNode.nodes.get("gemini-live-capture")!
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    act(() => gemini.callbacks!.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } },
    }))
    act(() => capture.port.emit({ type: "activity", active: true }))
    expect(playback.port.sent.at(-1)?.message).toEqual({ type: "interrupt", generation: 1 })
    expect(container.textContent).toContain("I can hear you")
  })

  it("fails closed once without enqueueing malformed provider audio", async () => {
    await start()
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    await act(async () => {
      gemini.callbacks!.onmessage({
        serverContent: { modelTurn: { parts: [{
          inlineData: { data: "AA==", mimeType: "audio/pcm;rate=24000" },
        }] } },
      })
      await flush()
    })
    expect(playback.port.sent.filter(
      ({ message }) => (message as { type?: string }).type === "audio",
    )).toHaveLength(0)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/session/end"))).toHaveLength(1)
    expect(container.textContent).toContain("Connection stopped")
  })

  it("keeps the conversation alive when playback drops a tail", async () => {
    // The buffer now grows with the answer, so an overflow no longer means "a
    // long reply" — it means ten minutes of speech never drained. Losing the
    // tail of one answer is not a reason to hang up on the user, and hanging up
    // is exactly what cut a detailed analytics answer off mid-sentence.
    await start()
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    await act(async () => {
      playback.port.emit({ type: "overflow", generation: 1 })
      await flush()
    })
    expect(container.textContent).not.toContain("Connection stopped")
    expect(stream.track.stop).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/session/end"))).toBe(false)
  })

  it("returns browser navigation tool results through Gemini's function-response channel", async () => {
    await start()
    await act(async () => {
      gemini.callbacks!.onmessage({
        toolCall: { functionCalls: [{ id: "call-1", name: "get_current_screen", args: {} }] },
      })
      await flush()
    })
    expect(gemini.session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [expect.objectContaining({
        id: "call-1",
        name: "get_current_screen",
        response: { output: expect.objectContaining({ section: "leads" }) },
      })],
    })
  })

  it("does not send a tool response cancelled while the tool is running", async () => {
    await start()
    await act(async () => {
      gemini.callbacks!.onmessage({
        toolCall: { functionCalls: [{ id: "cancel-me", name: "get_current_screen", args: {} }] },
      })
      gemini.callbacks!.onmessage({ toolCallCancellation: { ids: ["cancel-me"] } })
      await flush()
    })
    expect(gemini.session.sendToolResponse).not.toHaveBeenCalled()
  })

  it("settles and exposes retry state when the Gemini socket closes unexpectedly", async () => {
    await start()
    await act(async () => {
      gemini.callbacks!.onclose()
      await flush()
    })
    expect(container.textContent).toContain("Connection stopped")
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/session/end"))).toBe(true)
    expect(stream.track.stop).toHaveBeenCalled()
  })

  it("resumes with the latest handle when Gemini sends GoAway", async () => {
    await start()
    act(() => gemini.callbacks!.onmessage({
      sessionResumptionUpdate: { resumable: true, newHandle: "resume-once" },
    }))
    await act(async () => {
      gemini.callbacks!.onmessage({ goAway: { timeLeft: "5s" } })
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(2)
    expect(gemini.connectArgs[1]).toEqual(expect.objectContaining({
      config: { sessionResumption: { handle: "resume-once" } },
    }))
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/session/end"))).toBe(false)
  })

  it("preserves already queued provider audio across a planned GoAway", async () => {
    await start()
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    act(() => {
      gemini.callbacks!.onmessage({
        serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } },
      })
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "resume-audio" },
      })
    })
    const interruptsBefore = playback.port.sent.filter(
      ({ message }) => (message as { type?: string }).type === "interrupt",
    ).length

    await act(async () => {
      gemini.callbacks!.onmessage({ goAway: { timeLeft: "5s" } })
      await flush()
    })

    expect(playback.port.sent.filter(
      ({ message }) => (message as { type?: string }).type === "interrupt",
    )).toHaveLength(interruptsBefore)
    expect(container.textContent).toContain("Speaking")
  })

  it("preserves already queued provider audio across an emergency socket error", async () => {
    await start()
    const playback = FakeWorkletNode.nodes.get("gemini-live-playback")!
    act(() => {
      gemini.callbacks!.onmessage({
        serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } },
      })
      gemini.callbacks!.onmessage({ serverContent: { generationComplete: true } })
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "resume-error" },
      })
    })
    const interruptsBefore = playback.port.sent.filter(
      ({ message }) => (message as { type?: string }).type === "interrupt",
    ).length

    await act(async () => {
      gemini.callbacks!.onerror()
      await flush()
    })

    expect(gemini.connectArgs).toHaveLength(2)
    expect(playback.port.sent.filter(
      ({ message }) => (message as { type?: string }).type === "interrupt",
    )).toHaveLength(interruptsBefore)
    expect(container.textContent).toContain("Speaking")
  })

  it("never resumes an emergency close with a checkpoint older than model generation", async () => {
    await start()
    act(() => {
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "stale-before-audio" },
      })
      gemini.callbacks!.onmessage({
        serverContent: { modelTurn: { parts: [{
          inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" },
        }] } },
      })
    })
    await act(async () => {
      gemini.callbacks!.onclose()
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(1)
    expect(container.textContent).toContain("Connection stopped")
  })

  it("allows emergency reconnect only after a fresh post-generation checkpoint", async () => {
    await start()
    act(() => {
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "stale-before-audio" },
      })
      gemini.callbacks!.onmessage({
        serverContent: { modelTurn: { parts: [{
          inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" },
        }] } },
      })
      gemini.callbacks!.onmessage({ serverContent: { generationComplete: true } })
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "fresh-after-audio" },
      })
    })
    await act(async () => {
      gemini.callbacks!.onclose()
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(2)
    expect(gemini.connectArgs[1]).toEqual(expect.objectContaining({
      config: { sessionResumption: { handle: "fresh-after-audio" } },
    }))
  })

  it("defers planned GoAway until an in-flight CRM tool response is sent once", async () => {
    await start()
    let releaseRead!: (response: Response) => void
    toolReadBarrier = new Promise<Response>((resolve) => { releaseRead = resolve })
    act(() => {
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "resume-tool" },
      })
      gemini.callbacks!.onmessage({ sessionResumptionUpdate: { resumable: false } })
      gemini.callbacks!.onmessage({
        toolCall: { functionCalls: [{ id: "tool-during-goaway", name: "get_leads_summary", args: {} }] },
      })
      gemini.callbacks!.onmessage({ goAway: { timeLeft: "5s" } })
    })
    expect(gemini.connectArgs).toHaveLength(1)

    await act(async () => {
      releaseRead(json({ data: { total: 7 } }))
      toolReadBarrier = null
      await flush()
    })

    expect(gemini.session.sendToolResponse).toHaveBeenCalledTimes(1)
    expect(gemini.session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [expect.objectContaining({ id: "tool-during-goaway" })],
    })
    expect(gemini.connectArgs).toHaveLength(1)
    await act(async () => {
      gemini.callbacks!.onmessage({ serverContent: { generationComplete: true } })
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "resume-tool-fresh" },
      })
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(2)
  })

  it("sends no raw navigation values in the browser trace payload", async () => {
    await start()
    await act(async () => {
      gemini.callbacks!.onmessage({
        toolCall: { functionCalls: [{
          id: "nav-private",
          name: "navigate_to_section",
          args: { section: "leads", filter: "open", query: "customer private query" },
        }] },
      })
      await flush()
    })
    const traceCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/voice/trace"))
    const traceBody = JSON.parse(String(traceCall?.[1]?.body))
    expect(traceBody.args).toEqual({ keys: ["section", "filter"] })
    expect(JSON.stringify(traceBody)).not.toContain("customer private query")
  })

  it("clears a stale handle when Gemini says the session is not resumable", async () => {
    await start()
    act(() => {
      gemini.callbacks!.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: "stale" } })
      gemini.callbacks!.onmessage({ sessionResumptionUpdate: { resumable: false } })
    })
    await act(async () => {
      gemini.callbacks!.onmessage({ goAway: { timeLeft: "5s" } })
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(1)
    expect(container.textContent).not.toContain("Connection stopped")
    await act(async () => {
      vi.advanceTimersByTime(4_500)
      await flush()
    })
    expect(container.textContent).toContain("Connection stopped")
  })

  it("waits for a fresh resumable checkpoint after GoAway mid-generation", async () => {
    await start()
    act(() => {
      gemini.callbacks!.onmessage({
        serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } },
      })
      gemini.callbacks!.onmessage({ sessionResumptionUpdate: { resumable: false } })
      gemini.callbacks!.onmessage({ goAway: { timeLeft: "5s" } })
    })
    expect(gemini.connectArgs).toHaveLength(1)

    await act(async () => {
      gemini.callbacks!.onmessage({ serverContent: { generationComplete: true } })
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(1)

    await act(async () => {
      gemini.callbacks!.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "fresh-after-generation" },
      })
      await flush()
    })
    expect(gemini.connectArgs).toHaveLength(2)
    expect(gemini.connectArgs[1]).toEqual(expect.objectContaining({
      config: { sessionResumption: { handle: "fresh-after-generation" } },
    }))
  })

  it("drops speech from a failed socket and asks for only the interrupted sentence again", async () => {
    await start()
    const capture = FakeWorkletNode.nodes.get("gemini-live-capture")!
    act(() => {
      gemini.callbacks!.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: "resume-speech" } })
      capture.port.emit({ type: "activity", active: true })
    })
    let release!: () => void
    gemini.connectBarrier = new Promise<void>((resolve) => { release = resolve })
    act(() => gemini.callbacks!.onmessage({ goAway: { timeLeft: "5s" } }))
    const before = gemini.session.sendRealtimeInput.mock.calls.length
    act(() => capture.port.emit({ type: "audio", samples: new Float32Array([0.5, 0.5]) }))
    expect(gemini.session.sendRealtimeInput.mock.calls).toHaveLength(before)

    await act(async () => {
      release()
      gemini.connectBarrier = null
      await flush()
    })
    act(() => capture.port.emit({ type: "activity", active: false }))
    expect(gemini.session.sendRealtimeInput).toHaveBeenLastCalledWith({
      text: expect.stringContaining("ask them to repeat only their last sentence"),
    })
  })
})
