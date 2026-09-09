import type { FunctionCall, FunctionResponse, LiveServerMessage } from "@google/genai"

export const GEMINI_INPUT_SAMPLE_RATE = 16_000
export const GEMINI_OUTPUT_SAMPLE_RATE = 24_000
export const GEMINI_CAPTURE_WORKLET_URL = "/gemini-live-capture.worklet.js"
export const GEMINI_PLAYBACK_WORKLET_URL = "/gemini-live-playback.worklet.js"

export function pcm16ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return window.btoa(binary)
}

export function base64Pcm16ToFloat32(base64: string): Float32Array {
  if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Gemini Live returned invalid base64 audio")
  }
  const binary = window.atob(base64)
  if (binary.length % 2 !== 0) {
    throw new Error("Gemini Live returned an odd PCM16 byte count")
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let i = 0; i < samples.length; i += 1) {
    const value = view.getInt16(i * 2, true)
    samples[i] = value < 0 ? value / 0x8000 : value / 0x7fff
  }
  return samples
}

export function geminiAudioParts(message: LiveServerMessage): Array<{ data: string; mimeType: string }> {
  const parts = message.serverContent?.modelTurn?.parts ?? []
  return parts.flatMap((part) => {
    if (!part.inlineData) return []
    const expected = `audio/pcm;rate=${GEMINI_OUTPUT_SAMPLE_RATE}`
    if (part.inlineData.mimeType !== expected || !part.inlineData.data) {
      throw new Error("Gemini Live returned an invalid audio payload")
    }
    return [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType }]
  })
}

export function geminiFunctionCalls(message: LiveServerMessage): FunctionCall[] {
  return message.toolCall?.functionCalls ?? []
}

export function geminiFunctionResponse(
  call: FunctionCall,
  output: string,
): FunctionResponse {
  let result: unknown = output
  try { result = JSON.parse(output) } catch { /* keep safe text sentinel */ }
  return {
    id: call.id,
    name: call.name,
    response: { output: result },
  }
}

export function geminiInputTranscript(message: LiveServerMessage): {
  text: string
  finished: boolean
} | null {
  const transcription = message.serverContent?.inputTranscription
  if (!transcription) return null
  return {
    text: transcription.text ?? "",
    finished: transcription.finished === true,
  }
}
