/**
 * OpenAI Whisper transcription provider.
 *
 * Uses the `whisper-1` model via the OpenAI Audio API
 * (`/v1/audio/transcriptions`). The endpoint expects multipart
 * form-data with an audio file — we fetch the recordingUrl
 * ourselves, then forward the bytes.
 *
 * Cost reference (Dec 2025): $0.006/min — a typical 3-minute call
 * costs ~$0.018 per transcription.
 *
 * Why not stream the URL straight to OpenAI: their API takes a
 * binary upload, not a URL. We must fetch + forward.
 */

import {
  isValidAudioUrl,
  TRANSCRIPTION_LIMITS,
  type TranscriptionClient,
  type TranscriptionRequest,
  type TranscriptionResult,
} from "../types"
import {
  downloadOutboundResource,
  type OutboundWebhookResolver,
  type OutboundWebhookTransport,
} from "@/lib/integrations/webhook-url-guard"

const OPENAI_API_BASE = "https://api.openai.com/v1"

/** Max audio size accepted by the Whisper API (Dec 2025: 25 MB). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export interface OpenAIWhisperConfig {
  apiKey: string
  /** Override base URL (e.g. Azure OpenAI proxy). */
  baseUrl?: string
  /** Request timeout in ms — bounded so a slow Whisper call doesn't
   *  hang the cron route. Default 60s. */
  timeoutMs?: number
  resolveHost?: OutboundWebhookResolver
  /** Test seam for the SSRF-safe, IP-pinned audio download transport. */
  audioTransport?: OutboundWebhookTransport
}

export function createOpenAIWhisperClient(cfg: OpenAIWhisperConfig): TranscriptionClient {
  if (!cfg.apiKey) {
    throw new Error("OpenAI Whisper: apiKey is required")
  }
  const baseUrl = cfg.baseUrl || OPENAI_API_BASE
  const timeoutMs = cfg.timeoutMs ?? 60_000

  return {
    async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
      // Validate up front so a malformed input doesn't waste a paid
      // call or expose an SSRF surface via the audio fetch.
      if (!isValidAudioUrl(req.audioUrl)) {
        throw new Error("OpenAI Whisper: invalid audioUrl")
      }
      if (req.prompt && req.prompt.length > TRANSCRIPTION_LIMITS.maxPromptLength) {
        throw new Error("OpenAI Whisper: prompt exceeds max length")
      }
      if (req.language && req.language.length > TRANSCRIPTION_LIMITS.maxLanguageLength) {
        throw new Error("OpenAI Whisper: language code too long")
      }
      // Step 1: fetch the audio bytes through a transport that validates every
      // A/AAAA answer, pins the validated IP into the socket lookup, and
      // repeats validation on every redirect. A validate-then-global-fetch
      // sequence would still permit DNS rebinding and redirect-based SSRF.
      const audioRes = await downloadOutboundResource(req.audioUrl, {
        timeoutMs,
        maxResponseBytes: MAX_AUDIO_BYTES,
        resolver: cfg.resolveHost,
        transport: cfg.audioTransport,
      })
      if (!audioRes.ok) {
        throw new Error(`OpenAI Whisper: audio fetch failed (HTTP ${audioRes.status})`)
      }
      const contentLength = Number(audioRes.headers?.["content-length"] || "0")
      if (contentLength > MAX_AUDIO_BYTES) {
        throw new Error(`OpenAI Whisper: audio exceeds ${MAX_AUDIO_BYTES} byte limit`)
      }
      const audioBytes = audioRes.bodyBytes
      if (audioBytes.byteLength > MAX_AUDIO_BYTES) {
        throw new Error(`OpenAI Whisper: audio exceeds ${MAX_AUDIO_BYTES} byte limit`)
      }

      // Filename extension helps Whisper detect the codec.
      const contentType = audioRes.headers?.["content-type"]?.split(";")[0].trim() || ""
      const filename = filenameFromUrl(req.audioUrl, contentType)
      const audioBlob = new Blob(
        [Uint8Array.from(audioBytes)],
        contentType ? { type: contentType } : undefined,
      )

      // Step 2: multipart upload to Whisper.
      const form = new FormData()
      form.append("file", audioBlob, filename)
      form.append("model", "whisper-1")
      form.append("response_format", "verbose_json") // includes language + duration
      if (req.language) form.append("language", req.language)
      if (req.prompt) form.append("prompt", req.prompt)

      const whisperRes = await fetchWithTimeout(`${baseUrl}/audio/transcriptions`, timeoutMs, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
      })
      if (!whisperRes.ok) {
        const errBody = await whisperRes.text().catch(() => "")
        throw new Error(`OpenAI Whisper: transcribe failed (HTTP ${whisperRes.status}): ${errBody.slice(0, 200)}`)
      }
      const body: { text?: string; language?: string; duration?: number } = await whisperRes.json()
      if (typeof body.text !== "string") {
        throw new Error("OpenAI Whisper: response missing text field")
      }

      return {
        transcript: body.text,
        language: body.language,
        durationSeconds: typeof body.duration === "number" ? body.duration : undefined,
        provider: "openai-whisper",
      }
    },
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const handle = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(handle)
  }
}

function filenameFromUrl(url: string, contentType = ""): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split("/").filter(Boolean).pop()
    if (last && /\.[a-z0-9]{2,4}$/i.test(last)) return last
  } catch {
    /* fall through */
  }
  const extensionByContentType: Record<string, string> = {
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "audio/webm": "webm",
  }
  const extension = extensionByContentType[contentType.toLowerCase()]
  if (extension) return `audio.${extension}`
  return "audio.mp3"
}
