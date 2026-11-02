/**
 * Gemini speech on the server: text to speech, and speech to text.
 *
 * The request shapes for speech follow `scripts/lib/gemini-tts.mjs`, which the
 * recording scripts use: a preview model (gemini-2.5-*-preview-tts) takes its
 * direction inside the text and answers with headerless PCM; from 3.8 on the
 * text is read verbatim through the Interactions API and the direction goes
 * in as style metadata. `gemini-speech.test.ts` holds the two to the same
 * bodies, so the demo's live voice and its recordings cannot drift apart.
 *
 * Two differences, on purpose:
 *   - the key travels in the `x-goog-api-key` header, never in the address.
 *     An address ends up in proxy logs, error messages and traces; a header
 *     does not.
 *   - every Interactions API call says `store: false`. By default Google keeps
 *     each interaction — its input included — for 55 days on the paid tier
 *     (ai.google.dev/gemini-api/docs/interactions, «Data storage and
 *     retention», read 2026-10-20). What the prospect said and what the guide
 *     answered are not to be kept anywhere, there either.
 * Nothing here logs a key, a text, an answer or audio.
 */

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"

/** Gemini TTS answers 24 kHz mono 16-bit PCM in both generations. */
export const GEMINI_SPEECH_SAMPLE_RATE = 24_000

const PREVIEW_MARKERS = ["preview-tts", "tts-preview"]

export function geminiSpeechReadsTextVerbatim(model: string): boolean {
  return !PREVIEW_MARKERS.some((marker) => model.includes(marker))
}

/**
 * The server's Gemini key. The dev box keeps two keys separated by a comma
 * for the recording scripts' rotation; the first one is the key.
 */
export function geminiApiKey(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const first = (env.GEMINI_API_KEY ?? "").split(",")[0]?.trim()
  return first ? first : null
}

function headers(apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey }
}

export interface GeminiSpeechInput {
  readonly model: string
  readonly voice: string
  readonly text: string
  /** Said to a preview model in front of the text («calmly, in Azerbaijani:»). */
  readonly direction?: string
  /** The same direction to a 3.8 model, as metadata it does not read aloud. */
  readonly style?: string
}

/** The request for one utterance: where it goes and what it says. The key is a header, see `synthesizeGeminiSpeech`. */
export function geminiSpeechRequest({ model, voice, text, direction = "", style = "" }: GeminiSpeechInput): { url: string; body: unknown } {
  if (!geminiSpeechReadsTextVerbatim(model)) {
    return {
      url: `${GEMINI_API}/models/${model}:generateContent`,
      body: {
        contents: [{ parts: [{ text: direction ? `${direction}\n${text}` : text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      },
    }
  }
  return {
    url: `${GEMINI_API}/interactions`,
    body: {
      model,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          text,
          ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}),
        }],
      }],
      response_format: { type: "audio", mime_type: "audio/l16" },
      generation_config: { speech_config: [{ voice }] },
      store: false,
    },
  }
}

/** The PCM payload of a WAV file; headerless audio passes through. */
export function stripWavHeader(audio: Buffer): Buffer {
  if (audio.length < 12 || audio.toString("latin1", 0, 4) !== "RIFF" || audio.toString("latin1", 8, 12) !== "WAVE") {
    return audio
  }
  return readWav(audio)?.data ?? Buffer.alloc(0)
}

/** 24 kHz mono PCM16 from either generation's answer, or null when there is no audio in it. */
export function geminiSpeechPcm(json: unknown, model: string): Buffer | null {
  let encoded: string | null = null
  const answer = json as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
    steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }>
  } | null
  if (!geminiSpeechReadsTextVerbatim(model)) {
    encoded = answer?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data ?? null
  } else {
    for (const step of answer?.steps ?? []) {
      if (step?.type !== "model_output") continue
      for (const block of step.content ?? []) {
        if (block?.type === "audio" && block.data) encoded = block.data
      }
    }
  }
  if (!encoded) return null
  const pcm = stripWavHeader(Buffer.from(encoded, "base64"))
  return pcm.length > 0 ? pcm : null
}

export interface WavAudio {
  readonly format: number
  readonly channels: number
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly data: Buffer
  readonly seconds: number
}

/** A RIFF/WAVE file's format and samples, or null when it is not one. */
export function readWav(buffer: Buffer): WavAudio | null {
  if (buffer.length < 12 || buffer.toString("latin1", 0, 4) !== "RIFF" || buffer.toString("latin1", 8, 12) !== "WAVE") return null
  let offset = 12
  let fmt: { format: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("latin1", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === "fmt " && size >= 16 && body + 16 <= buffer.length) {
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    } else if (id === "data") {
      if (!fmt || fmt.channels < 1 || fmt.sampleRate < 1 || fmt.bitsPerSample < 8) return null
      const data = buffer.subarray(body, Math.min(buffer.length, body + size))
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8)
      return { ...fmt, data, seconds: data.length / bytesPerSecond }
    }
    offset = body + size + (size & 1)
  }
  return null
}

/** A WAV file around mono 16-bit PCM. */
export function pcm16Wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "latin1")
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8, "latin1")
  header.write("fmt ", 12, "latin1")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36, "latin1")
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export type GeminiSpeechFailure = "network" | "http" | "no_audio"

/**
 * One utterance as a WAV file. One request, no retry: the caller has claimed
 * the seconds for exactly one, and a second would be spend nobody claimed.
 */
export async function synthesizeGeminiSpeech(
  input: GeminiSpeechInput & { readonly apiKey: string; readonly timeoutMs?: number },
): Promise<{ ok: true; wav: Buffer; seconds: number } | { ok: false; reason: GeminiSpeechFailure; status?: number }> {
  const { url, body } = geminiSpeechRequest(input)
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
    })
  } catch {
    return { ok: false, reason: "network" }
  }
  if (!response.ok) return { ok: false, reason: "http", status: response.status }
  const pcm = geminiSpeechPcm(await response.json().catch(() => null), input.model)
  if (!pcm) return { ok: false, reason: "no_audio" }
  return { ok: true, wav: pcm16Wav(pcm, GEMINI_SPEECH_SAMPLE_RATE), seconds: pcm.length / 2 / GEMINI_SPEECH_SAMPLE_RATE }
}

/**
 * The model that turns a spoken question into text: Google's own
 * speech-to-text model (gemini-3.5-transcribe, Interactions API). It is not
 * prompted — the clip is transcribed, never read as instructions — and it
 * takes the three languages a prospect speaks here as hints. Checked live on
 * 2026-10-20 with an inline 16 kHz WAV: Azerbaijani and Russian came back
 * word for word in about a second. (gemini-2.5-flash, the earlier choice,
 * now answers 404 «no longer available to new users».)
 */
export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe"

/** Azerbaijani, Russian, English — BCP-47, as the transcription config takes them. */
export const GEMINI_TRANSCRIBE_LANGUAGES = ["az-AZ", "ru-RU", "en-US"] as const

/** Names a prospect says that no dictionary has; a nudge, not a filter. */
export const GEMINI_TRANSCRIBE_VOCABULARY = ["LeadDrive", "Da Vinci", "CRM", "WhatsApp", "Instagram", "Telegram"] as const

export function geminiTranscribeRequest({ model, wav }: { model: string; wav: Buffer }): { url: string; body: unknown } {
  return {
    url: `${GEMINI_API}/interactions`,
    body: {
      model,
      // Inline: a 15-second clip is under half a megabyte, and the Files API
      // would keep the upload at Google for two days.
      input: [{ type: "audio", data: wav.toString("base64"), mime_type: "audio/wav" }],
      generation_config: {
        transcription_config: {
          language_codes: [...GEMINI_TRANSCRIBE_LANGUAGES],
          custom_vocabulary: [...GEMINI_TRANSCRIBE_VOCABULARY],
          // Fillers and false starts removed: the text is shown as the question.
          mode: "smart",
        },
      },
      store: false,
    },
  }
}

/** The transcript in an Interactions answer: its model output's text, trimmed. */
export function geminiTranscript(json: unknown): string {
  const answer = json as {
    output_text?: unknown
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>
  } | null
  const parts: string[] = []
  for (const step of answer?.steps ?? []) {
    if (step?.type !== "model_output") continue
    for (const block of step.content ?? []) {
      if (block?.type === "text" && typeof block.text === "string") parts.push(block.text)
    }
  }
  const text = parts.length ? parts.join(" ") : typeof answer?.output_text === "string" ? answer.output_text : ""
  return text.replace(/\s+/g, " ").trim()
}

export type GeminiTranscribeFailure = "network" | "http"

/** One clip to text. The clip is sent and forgotten: nothing here keeps it. */
export async function transcribeGeminiAudio(input: {
  readonly apiKey: string
  readonly wav: Buffer
  readonly model?: string
  readonly timeoutMs?: number
}): Promise<{ ok: true; text: string } | { ok: false; reason: GeminiTranscribeFailure; status?: number }> {
  const { url, body } = geminiTranscribeRequest({ model: input.model ?? GEMINI_TRANSCRIBE_MODEL, wav: input.wav })
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
    })
  } catch {
    return { ok: false, reason: "network" }
  }
  if (!response.ok) return { ok: false, reason: "http", status: response.status }
  return { ok: true, text: geminiTranscript(await response.json().catch(() => null)) }
}
