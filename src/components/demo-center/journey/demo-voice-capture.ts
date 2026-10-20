"use client"

import { DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE } from "@/lib/demo-center/assistant/voice-policy"

/**
 * One spoken question from the prospect's microphone, as the server wants it:
 * mono 16-bit PCM at 16 kHz in a WAV file, at most `maxSeconds` long.
 *
 * Plain Web Audio, no worklet file: the capture worklet the CRM's voice
 * console uses is served behind the login, and a prospect has no CRM session.
 * The context runs at the device's own rate — Firefox refuses a microphone in
 * a context at another rate — and the samples are brought down to 16 kHz
 * here, on the way into the file.
 *
 * The microphone is opened for one clip and released when it ends: stop,
 * cancel and every failure stop each track and close the context, so the
 * browser's recording indicator goes out with the clip.
 */

export class VoiceCaptureError extends Error {
  constructor(readonly kind: "denied" | "no_microphone" | "unsupported" | "failed") {
    super(kind)
  }
}

export interface VoiceClip {
  readonly wav: Blob
  readonly seconds: number
}

export interface VoiceCapture {
  /** Ends the clip, releases the microphone and returns the file. */
  stop(): VoiceClip
  /** Releases the microphone and throws the clip away. */
  cancel(): void
}

/** Averages the input down to `toRate` (a box filter is enough for speech, and keeps aliasing out). */
export function resampleMono(samples: Float32Array, fromRate: number, toRate = DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples
  const ratio = fromRate / toRate
  const length = Math.floor(samples.length / ratio)
  const out = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const start = index * ratio
    const end = Math.min(samples.length, start + ratio)
    let sum = 0
    let count = 0
    for (let at = Math.floor(start); at < end; at += 1) {
      sum += samples[at]
      count += 1
    }
    out[index] = count ? sum / count : 0
  }
  return out
}

/** A WAV file around mono 16-bit PCM. */
export function encodeWav16(samples: Float32Array, sampleRate = DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2))
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return bytes
}

function captureError(error: unknown): VoiceCaptureError {
  const name = (error as { name?: string } | null)?.name
  if (name === "NotAllowedError" || name === "SecurityError") return new VoiceCaptureError("denied")
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") return new VoiceCaptureError("no_microphone")
  return new VoiceCaptureError("failed")
}

/**
 * Opens the microphone and starts one clip. `onFull` fires once when the clip
 * reaches `maxSeconds`; nothing past that is kept.
 */
export async function startVoiceCapture({ maxSeconds, onFull }: { maxSeconds: number; onFull: () => void }): Promise<VoiceCapture> {
  const AudioContextClass = typeof window === "undefined"
    ? undefined
    : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !AudioContextClass) {
    throw new VoiceCaptureError("unsupported")
  }
  // Made before the first await, while the press that started the clip is
  // still the current gesture: Safari on a phone leaves a context made later
  // suspended, and a suspended context records silence.
  const context = new AudioContextClass()
  // A refused resume is not the end: the context may be running already.
  const resuming = Promise.resolve(context.resume?.()).catch(() => undefined)
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (error) {
    void context.close().catch(() => undefined)
    throw captureError(error)
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    for (const track of stream.getTracks()) track.stop()
    void context.close().catch(() => undefined)
  }

  try {
    const rate = context.sampleRate
    const maxSamples = Math.floor(maxSeconds * rate)
    const chunks: Float32Array[] = []
    let length = 0
    let full = false
    const source = context.createMediaStreamSource(stream)
    // Deprecated but everywhere, and it needs no file of its own (see above).
    const processor = context.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (released || full) return
      const input = event.inputBuffer.getChannelData(0)
      const take = Math.min(input.length, maxSamples - length)
      if (take > 0) {
        chunks.push(new Float32Array(input.subarray(0, take)))
        length += take
      }
      if (length >= maxSamples) {
        full = true
        onFull()
      }
    }
    source.connect(processor)
    // A script processor only runs while connected onward; it writes nothing, so this is silence.
    processor.connect(context.destination)
    await resuming

    return {
      stop() {
        processor.onaudioprocess = null
        try {
          source.disconnect()
          processor.disconnect()
        } catch {
          // Already disconnected: the clip is what was gathered.
        }
        release()
        const merged = new Float32Array(length)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.length
        }
        const samples = resampleMono(merged, rate)
        return { wav: new Blob([encodeWav16(samples)], { type: "audio/wav" }), seconds: samples.length / DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE }
      },
      cancel() {
        processor.onaudioprocess = null
        release()
      },
    }
  } catch (error) {
    release()
    throw error instanceof VoiceCaptureError ? error : new VoiceCaptureError("failed")
  }
}
