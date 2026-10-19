import { NextRequest, NextResponse } from "next/server"
import { geminiApiKey, readWav, transcribeGeminiAudio } from "@/lib/ai/gemini-speech"
import { noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { loadActiveDemoGrant } from "@/lib/demo-center/active-grant"
import { claimDemoVoiceSeconds, settleDemoVoiceSeconds } from "@/lib/demo-center/assistant-voice"
import { demoAssistantVoiceEnabled } from "@/lib/demo-center/assistant-voice-switch"
import { DEMO_ASSISTANT_MAX_QUESTION_CHARS } from "@/lib/demo-center/assistant/policy"
import {
  DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS,
  DEMO_ASSISTANT_VOICE_CLIP_MIN_SECONDS,
  DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE,
  DEMO_VOICE_REFUSAL_TEXT,
  clipChargeSeconds,
  type DemoVoiceRefusal,
} from "@/lib/demo-center/assistant/voice-policy"
import { findStep } from "@/lib/demo-center/journey"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * «Səslə soruşun»: one spoken question, at most 15 seconds, to text (owner,
 * 2026-10-20).
 *
 * The body is the clip itself — mono 16-bit PCM at 16 kHz in a WAV file, as
 * the page records it. Its length is read from the file before anything is
 * spent, claimed against the voice budget (assistant-voice.ts), and only then
 * sent to Google. The answer is the text and nothing else: the clip is not
 * written anywhere, not logged, and is gone when this request is. The page
 * shows the prospect what was heard and asks it through the assistant route,
 * which masks it before Claude like any typed question.
 *
 * Granted sessions only, checked exactly as the assistant does
 * (active-grant.ts) — before the clip is even read. With
 * `DEMO_ASSISTANT_VOICE` off the route does not exist.
 */

/** A WAV header and a little slack around the longest clip. */
const MAX_BODY_BYTES = 44 + DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE * 2 * (DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + 1)
/** The page stops at 15 s; its capture works in buffers, which may add a fraction. */
const CLIP_TOLERANCE_SECONDS = 0.5
const WAV_TYPES = new Set(["audio/wav", "audio/wave", "audio/x-wav"])

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!demoAssistantVoiceEnabled()) return refuse("not_enabled", 404)
  const { token } = await params
  if (!validRawDemoToken(token)) return refuse("not_enabled", 404)
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (!WAV_TYPES.has(type)) return refuse("bad_audio", 415)
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > MAX_BODY_BYTES) return refuse("bad_audio", 413)

  const now = new Date()
  const active = await runWithRlsBypass(() => loadActiveDemoGrant(request, token, now))
  if (!active.ok) return refuse("not_enabled", active.status)

  const clip = await readBody(request, MAX_BODY_BYTES)
  if (!clip) return refuse("bad_audio", 413)
  const wav = readWav(clip)
  if (!wav || wav.format !== 1 || wav.channels !== 1 || wav.sampleRate !== DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE || wav.bitsPerSample !== 16) {
    return refuse("bad_audio", 400)
  }
  if (wav.seconds > DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS + CLIP_TOLERANCE_SECONDS) return refuse("bad_audio", 413)
  if (wav.seconds < DEMO_ASSISTANT_VOICE_CLIP_MIN_SECONDS) return refuse("too_short", 400)

  const apiKey = geminiApiKey()
  if (!apiKey) return refuse("unavailable", 503)

  const stepId = request.nextUrl.searchParams.get("stepId")
  const claim = await claimDemoVoiceSeconds({
    grantId: active.grant.id,
    kind: "hear",
    seconds: clipChargeSeconds(wav.seconds),
    stepId: stepId ? findStep(active.manifest, stepId)?.step.id ?? null : null,
    now,
  })
  if (!claim.ok) return refuse(claim.refusal, 429)

  const heard = await transcribeGeminiAudio({ apiKey, wav: clip })
  // The clip has done its one job.
  clip.fill(0)
  if (!heard.ok) {
    await settleDemoVoiceSeconds(claim, "failed")
    return refuse("unavailable", 502)
  }
  const text = heard.text.slice(0, DEMO_ASSISTANT_MAX_QUESTION_CHARS).trim()
  if (!text) {
    await settleDemoVoiceSeconds(claim, "silent")
    return refuse("silent", 422)
  }
  await settleDemoVoiceSeconds(claim, "heard")
  return NextResponse.json({ success: true, text }, { headers: noStoreHeaders() })
}

/** The body, or null once it grows past `limit` — read in chunks, never buffered whole first. */
async function readBody(request: NextRequest, limit: number): Promise<Buffer | null> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function refuse(refusal: DemoVoiceRefusal, status: number) {
  return NextResponse.json(
    { success: false, code: refusal, error: DEMO_VOICE_REFUSAL_TEXT[refusal] },
    { status, headers: noStoreHeaders() },
  )
}
