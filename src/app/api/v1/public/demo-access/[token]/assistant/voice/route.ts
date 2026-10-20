import { NextRequest, NextResponse } from "next/server"
import { geminiApiKey, synthesizeGeminiSpeech } from "@/lib/ai/gemini-speech"
import { noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { loadActiveDemoGrant } from "@/lib/demo-center/active-grant"
import { claimDemoVoiceSeconds, demoAnswerHashMatches, settleDemoVoiceSeconds } from "@/lib/demo-center/assistant-voice"
import { demoAssistantVoiceEnabled } from "@/lib/demo-center/assistant-voice-switch"
import {
  DEMO_ASSISTANT_VOICE_MAX_CHARS,
  DEMO_VOICE_REFUSAL_TEXT,
  demoVoiceExhausted,
  speechSecondsUpperBound,
  type DemoVoiceRefusal,
} from "@/lib/demo-center/assistant/voice-policy"
import { DEMO_GUIDE_VOICE, DEMO_GUIDE_VOICE_DIRECTION, DEMO_GUIDE_VOICE_STYLE } from "@/lib/demo-center/guide-voice"
import { findStep } from "@/lib/demo-center/journey"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Speaks one Da Vinci answer in the guide's voice (owner, 2026-10-20).
 *
 * The browser sends back the answer the assistant route gave it — its id, its
 * text and the keyed hash the route issued for exactly that text. Anything
 * the hash does not vouch for is refused before any spend, so this route
 * cannot be made to say arbitrary words in the guide's voice. An answer is
 * spoken once. The seconds are claimed in the database before Google is
 * asked (assistant-voice.ts) and settled at the audio's real length; the
 * audio comes back as a WAV file and is kept nowhere.
 *
 * A refusal over the budget says whether voice is over for this demo (not
 * how many seconds are left: that figure includes the day's pool across all
 * demos): a long answer's estimate can be refused while a question still
 * fits, and then only this answer stays text.
 *
 * Granted sessions only, checked exactly as the assistant does
 * (active-grant.ts). With `DEMO_ASSISTANT_VOICE` off the route does not exist.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!demoAssistantVoiceEnabled()) return refuse("not_enabled", 404)
  const { token } = await params
  if (!validRawDemoToken(token)) return refuse("not_enabled", 404)

  const body = await request.json().catch(() => ({})) as { answerId?: unknown; answer?: unknown; answerHash?: unknown; stepId?: unknown }
  const answerId = typeof body.answerId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.answerId) ? body.answerId : null
  const answer = typeof body.answer === "string" && body.answer.trim() ? body.answer : null
  if (!answerId || !answer) return refuse("refused", 400)
  if (answer.length > DEMO_ASSISTANT_VOICE_MAX_CHARS) return refuse("too_long", 413)

  const now = new Date()
  const active = await runWithRlsBypass(() => loadActiveDemoGrant(request, token, now))
  if (!active.ok) return refuse("not_enabled", active.status)
  const { grant, manifest } = active
  if (!demoAnswerHashMatches(grant.id, answerId, answer, body.answerHash)) return refuse("refused", 403)

  const apiKey = geminiApiKey()
  if (!apiKey) return refuse("unavailable", 503)

  const claim = await claimDemoVoiceSeconds({
    grantId: grant.id,
    kind: "speak",
    seconds: speechSecondsUpperBound(answer),
    answerId,
    stepId: findStep(manifest, String(body.stepId))?.step.id ?? null,
    now,
  })
  if (!claim.ok) {
    return claim.refusal === "already_voiced"
      ? refuse("already_voiced", 409)
      : refuse(claim.refusal, 429, demoVoiceExhausted(claim.secondsLeft))
  }

  const spoken = await synthesizeGeminiSpeech({
    apiKey,
    model: DEMO_GUIDE_VOICE.model,
    voice: DEMO_GUIDE_VOICE.voice,
    text: answer,
    direction: DEMO_GUIDE_VOICE_DIRECTION,
    style: DEMO_GUIDE_VOICE_STYLE,
  })
  if (!spoken.ok) {
    await settleDemoVoiceSeconds(claim, "failed")
    return refuse("unavailable", 502)
  }
  await settleDemoVoiceSeconds(claim, "voiced", spoken.seconds)
  return new NextResponse(new Uint8Array(spoken.wav), {
    status: 200,
    headers: { ...noStoreHeaders(), "Content-Type": "audio/wav", "Content-Length": String(spoken.wav.length) },
  })
}

function refuse(refusal: DemoVoiceRefusal, status: number, budget?: { exhausted: boolean }) {
  return NextResponse.json(
    { success: false, code: refusal, error: DEMO_VOICE_REFUSAL_TEXT[refusal], ...budget },
    { status, headers: noStoreHeaders() },
  )
}
