/**
 * C4 Call Transcription — provider-abstract types.
 *
 * Slice-2 of A7/A8 Conversation Intelligence: the audio URL →
 * transcript pipeline that the analyze route was waiting for.
 *
 * Provider abstraction lets us swap OpenAI Whisper for AssemblyAI /
 * Deepgram / self-hosted Whisper without rewriting the analyze
 * route. The pure compute helpers in `transcribe.ts` route by env
 * config; provider implementations live in `./providers/`.
 */

/** Supported transcription providers. Add a new entry here AND
 *  register the implementation in `./transcribe.ts`. Test code uses
 *  the `TranscriptionClient` interface directly with vi-stubbed
 *  fakes (see `__tests__/api-calls-transcribe.test.ts`) — no
 *  "mock" enum entry needed at the type layer. */
export const TRANSCRIPTION_PROVIDERS = ["openai-whisper"] as const
export type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDERS)[number]

export interface TranscriptionRequest {
  /** Publicly-accessible audio URL (mp3 / wav / m4a / webm / ogg).
   *  Provider implementations must download it through the shared
   *  DNS-pinned, redirect-validating outbound transport. */
  audioUrl: string
  /** Optional ISO 639-1 language hint. Whisper auto-detects when
   *  absent but accuracy improves with a hint for short clips. */
  language?: string
  /** Optional prompt — Whisper-style context biasing (e.g. caller
   *  company name, product names). */
  prompt?: string
}

export interface TranscriptionResult {
  /** Plain-text transcript. */
  transcript: string
  /** Detected or supplied language code (ISO 639-1). */
  language?: string
  /** Duration of the audio in seconds, if the provider reports it. */
  durationSeconds?: number
  /** Provider that produced this transcript — pinned for replay /
   *  cross-provider comparison. */
  provider: TranscriptionProvider
}

export interface TranscriptionClient {
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>
}

/** Per-route guardrails applied BEFORE the provider call. */
export const TRANSCRIPTION_LIMITS = {
  /** Max audio URL length — defends against payload-stuffing attacks. */
  maxUrlLength: 2048,
  /** Max prompt length — Whisper has its own cap (224 tokens),
   *  this is a defensive char limit on top. */
  maxPromptLength: 1000,
  /** Max language code length. */
  maxLanguageLength: 8,
} as const

/** URL safety check — required scheme + length cap + SSRF guard.
 *  Provider calls MUST run this before forwarding.
 *
 *  Rejects:
 *    - Empty / over-length input
 *    - Non-http(s) schemes (no file://, javascript:, etc.)
 *    - Localhost / loopback / link-local / private IP literals
 *      (defends against an authenticated user probing the internal
 *      network or cloud metadata endpoint via the audioUrl body
 *      override).
 *
 *  This lexical helper does not resolve hostnames. Provider implementations
 *  must additionally use the shared outbound transport, which resolves every
 *  A/AAAA answer, rejects non-public targets, pins the selected IP into the
 *  socket lookup, and repeats validation on redirects. */
export function isValidAudioUrl(url: string): boolean {
  if (url.length === 0 || url.length > TRANSCRIPTION_LIMITS.maxUrlLength) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
  const host = parsed.hostname.toLowerCase()
  if (isPrivateHost(host)) return false
  return true
}

/** Internal — exported for tests. Rejects IP literals in the
 *  private / loopback / link-local / cloud-metadata ranges plus
 *  the obvious localhost aliases. */
export function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") return true

  // IPv6 — strip brackets the URL parser may have left in.
  const v6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (v6 === "::1" || v6 === "::") return true
  // IPv6 unique-local fc00::/7 + link-local fe80::/10
  if (/^fc[0-9a-f]{2}:/i.test(v6) || /^fd[0-9a-f]{2}:/i.test(v6)) return true
  if (/^fe[89ab][0-9a-f]:/i.test(v6)) return true
  // ::ffff:0:0/96 IPv4-mapped — WHATWG URL parser normalizes the
  // dotted-quad form (`::ffff:127.0.0.1`) into hex (`::ffff:7f00:1`),
  // so we reject the entire prefix; legitimate public traffic never
  // uses IPv4-mapped IPv6 in URLs.
  if (/^::ffff:/i.test(v6)) return true

  // IPv4 literal
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return isPrivateIPv4(host)
  }

  // Hostnames pass this lexical layer; the provider's outbound transport
  // performs resolution-time validation and socket pinning.
  return false
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    // Invalid IPv4 — fail closed.
    return true
  }
  const [a, b] = parts
  if (a === 10) return true                        // 10.0.0.0/8
  if (a === 127) return true                       // 127.0.0.0/8 loopback
  if (a === 0) return true                         // 0.0.0.0/8 "this network"
  if (a === 169 && b === 254) return true          // 169.254.0.0/16 link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true          // 192.168.0.0/16
  if (a === 192 && b === 0) return true            // 192.0.0.0/24 IETF + 192.0.2.0/24 TEST-NET-1
  if (a >= 224) return true                        // 224+ multicast + reserved
  return false
}
