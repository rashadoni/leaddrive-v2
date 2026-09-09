/**
 * The audio half of a browser call: a microphone, a relay socket, an earpiece.
 *
 * Deliberately not a new audio stack. The voice console's two worklets are
 * already parameterised by sample rate, already handle the two hard parts —
 * resampling the capture and buffering playback so a long stretch of speech
 * never overruns — and are already proven on this product's traffic. A second
 * implementation would be a second set of the same bugs.
 *
 * The wire format is 8 kHz mono signed 16-bit, little-endian: the telephone's
 * own rate, carried end to end without being resampled in the middle. Anything
 * higher would invent detail the line never had and then throw it away again at
 * the PBX; anything lower would be worse than the phone. The browser resamples
 * on both edges because it is the only place with cycles to spare.
 */

/** What the telephone network actually carries. Not a quality choice. */
export const TELEPHONE_SAMPLE_RATE = 8_000

export type BrowserCallHandle = {
  /** Stop everything: microphone, sockets, audio contexts. Safe to call twice. */
  hangUp: () => void
  /** True once the far side has joined and audio is moving. */
  isConnected: () => boolean
}

/**
 * The audio stack, built and proven, with nobody dialled yet.
 *
 * Splitting preparation from connection is not tidiness. Everything that can
 * fail for capability reasons — a browser that will not open an 8 kHz context,
 * a worklet module that does not load — fails HERE, before a single phone
 * rings. Building it after the dial meant an audio failure left a customer
 * answering into silence, which is the exact defect this feature exists to
 * remove.
 */
export type PreparedBrowserAudio = {
  captureContext: AudioContext
  playbackContext: AudioContext
  captureNode: AudioWorkletNode
  playbackNode: AudioWorkletNode
  stream: MediaStream
  /** Tear down without ever having connected. Safe to call twice. */
  dispose: () => void
}

export type PrepareOptions = {
  stream: MediaStream
  captureWorkletUrl: string
  playbackWorkletUrl: string
}

export type BrowserCallOptions = {
  relayUrl: string
  ticket: string
  /** The relay accepted the browser socket; the PBX may not have joined yet. */
  onConnected?: () => void
  /** The PBX half joined and delivered its first audio frame. */
  onMediaStarted?: () => void
  onEnded?: (reason: string) => void
}

function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: a sample above 1.0 wraps to a loud click otherwise,
    // and a microphone with gain applied produces those regularly.
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return out.buffer
}

function pcm16ToFloat(buffer: ArrayBuffer): Float32Array {
  const view = new Int16Array(buffer)
  const out = new Float32Array(view.length)
  for (let i = 0; i < view.length; i += 1) out[i] = view[i] / 0x8000
  return out
}

/**
 * Build the audio path. Nothing is dialled and nothing is sent.
 *
 * Every capability failure lands here: a browser that will not give an 8 kHz
 * context, a worklet module that does not load, a context that will not resume.
 * The caller can then refuse the call with nobody disturbed.
 */
export async function prepareBrowserAudio(options: PrepareOptions): Promise<PreparedBrowserAudio> {
  const captureContext = new AudioContext({ sampleRate: TELEPHONE_SAMPLE_RATE })
  const playbackContext = new AudioContext({ sampleRate: TELEPHONE_SAMPLE_RATE })
  const disposeContexts = () => {
    void captureContext.close().catch(() => {})
    void playbackContext.close().catch(() => {})
  }
  try {
    await Promise.all([
      captureContext.audioWorklet.addModule(options.captureWorkletUrl),
      playbackContext.audioWorklet.addModule(options.playbackWorkletUrl),
    ])
    await Promise.all([captureContext.resume(), playbackContext.resume()])

    const source = captureContext.createMediaStreamSource(options.stream)
    const captureNode = new AudioWorkletNode(captureContext, "gemini-live-capture", {
      processorOptions: {
        targetSampleRate: TELEPHONE_SAMPLE_RATE,
        // 20 ms at the telephone rate, so one browser packet is exactly one
        // AudioSocket frame. The default chunk is a fixed sample count tuned
        // for the 16 kHz assistant; left alone it would send 64 ms bursts that
        // the station then has to cut into three.
        chunkSamples: Math.round(TELEPHONE_SAMPLE_RATE * 0.02),
      },
    })
    const playbackNode = new AudioWorkletNode(playbackContext, "gemini-live-playback", {
      processorOptions: {
        sourceSampleRate: TELEPHONE_SAMPLE_RATE,
        generation: 1,
        // A live conversation, not a monologue: audio that arrives late must
        // not become permanent one-way delay. Past this depth the oldest
        // samples are dropped, which costs a syllable once instead of adding
        // that delay to every word for the rest of the call.
        maxLatencySeconds: 0.2,
      },
    })
    // The capture graph must reach a destination or the browser suspends it,
    // and it must be silent or the salesperson hears their own voice back.
    const silence = captureContext.createGain()
    silence.gain.value = 0
    source.connect(captureNode)
    captureNode.connect(silence)
    silence.connect(captureContext.destination)
    playbackNode.connect(playbackContext.destination)

    let disposed = false
    return {
      captureContext,
      playbackContext,
      captureNode,
      playbackNode,
      stream: options.stream,
      dispose: () => {
        if (disposed) return
        disposed = true
        options.stream.getTracks().forEach((track) => track.stop())
        disposeContexts()
      },
    }
  } catch (error) {
    // A half-built stack must not leak two audio contexts and a live
    // microphone into a page that is about to tell the user it failed.
    options.stream.getTracks().forEach((track) => track.stop())
    disposeContexts()
    throw error
  }
}

/**
 * Join the prepared audio to the call: microphone to the relay, relay to ear.
 *
 * The socket is opened while the customer's phone is still ringing, so the
 * browser is already waiting when the PBX joins. Whoever arrives second does
 * the joining, which is why nothing here waits for a "ready" signal that would
 * only be another thing to time out.
 */
export function connectBrowserCall(
  prepared: PreparedBrowserAudio,
  options: BrowserCallOptions,
): BrowserCallHandle {
  const { captureContext, playbackContext, captureNode, playbackNode, stream } = prepared
  const socket = new WebSocket(`${options.relayUrl}?ticket=${encodeURIComponent(options.ticket)}`)
  socket.binaryType = "arraybuffer"

  let connected = false
  let mediaStarted = false
  let ended = false

  const teardown = (reason: string) => {
    if (ended) return
    ended = true
    try {
      socket.close()
    } catch {
      // Already gone.
    }
    // The microphone light going out is how a salesperson knows the call is
    // over. Leaving the track live after a hang-up is alarming and looks
    // exactly like being recorded.
    stream.getTracks().forEach((track) => track.stop())
    void captureContext.close().catch(() => {})
    void playbackContext.close().catch(() => {})
    options.onEnded?.(reason)
  }

  captureNode.port.onmessage = (event) => {
    if (event.data?.type !== "audio" || socket.readyState !== WebSocket.OPEN) return
    socket.send(floatToPcm16(event.data.samples as Float32Array))
  }

  socket.onopen = () => {
    connected = true
    options.onConnected?.()
  }
  socket.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) return
    if (!mediaStarted) {
      mediaStarted = true
      options.onMediaStarted?.()
    }
    playbackNode.port.postMessage(
      { type: "audio", samples: pcm16ToFloat(event.data), generation: 1 },
      [],
    )
  }
  socket.onclose = () => teardown("socket_closed")
  socket.onerror = () => teardown("socket_error")

  return {
    hangUp: () => teardown("hung_up"),
    isConnected: () => connected && !ended,
  }
}
