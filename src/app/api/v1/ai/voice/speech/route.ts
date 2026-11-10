import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { journalPlatformAiCall, perMinuteCostUsd, UNIT_PRICING } from "@/lib/ai/gateway"
import {
  CONSOLE_SPEECH_MAX_CHARS,
  CONSOLE_SPEECH_SAMPLE_RATE,
  ConsoleSpeechError,
  consoleSpeechConfig,
  streamConsoleSpeech,
} from "@/lib/ai/voice/console-speech"

/**
 * POST /api/v1/ai/voice/speech — одна фраза ответа помощника голосом линии
 * (console-speech.ts). Звук — PCM16 24 кГц моно потоком, по мере синтеза.
 *
 * Только человек за вкладкой, только в своём живом разговоре: озвучка платная,
 * и без живого разговора ей нечего озвучивать. Текст — ответ модели, который
 * вкладка уже получила; ни текст, ни звук здесь не сохраняются и не пишутся в
 * журнал.
 */

const bodySchema = z.strictObject({
  voiceSessionId: z.string().trim().min(1).max(191),
  text: z.string().trim().min(1).max(CONSOLE_SPEECH_MAX_CHARS),
})

/** Первый звук приходит за ~0,7 с; дольше — вкладка говорит голосом Live. */
const FIRST_AUDIO_TIMEOUT_MS = 4_000
const WHOLE_PHRASE_TIMEOUT_MS = 30_000

export const POST = withRlsSessionAuth(async (req, auth) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const config = consoleSpeechConfig()
  if (!config) return NextResponse.json({ error: "Speech unavailable", code: "SPEECH_UNAVAILABLE" }, { status: 503 })

  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  // Фраза за фразой: длинный ответ — это десяток запросов за полминуты.
  if (!checkRateLimit(`voice:speech:${auth.orgId}:${auth.userId}`, { maxRequests: 120, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const session = await prisma.voiceSession.findFirst({
    where: {
      id: parsed.data.voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      expiresAt: { gt: new Date() },
    },
    select: { locale: true },
  })
  if (!session) return NextResponse.json({ error: "Session expired" }, { status: 409 })

  const upstream = new AbortController()
  const whole = setTimeout(() => upstream.abort(), WHOLE_PHRASE_TIMEOUT_MS)
  req.signal?.addEventListener("abort", () => upstream.abort())
  const chunks = streamConsoleSpeech({
    config,
    text: parsed.data.text,
    locale: session.locale,
    signal: upstream.signal,
  })

  // Ответ начинается только с первым звуком: отказ Google до него — 502, и
  // вкладка говорит эту фразу голосом Live, а не молчит.
  const firstTimer = setTimeout(() => upstream.abort(), FIRST_AUDIO_TIMEOUT_MS)
  let first: IteratorResult<Buffer>
  try {
    first = await chunks.next()
  } catch (error) {
    clearTimeout(firstTimer)
    clearTimeout(whole)
    const status = error instanceof ConsoleSpeechError ? error.status : null
    console.warn("[voice] console speech failed", { status })
    return NextResponse.json({ error: "Speech failed", code: "SPEECH_FAILED" }, { status: 502 })
  }
  clearTimeout(firstTimer)
  if (first.done) {
    clearTimeout(whole)
    return NextResponse.json({ error: "Speech failed", code: "SPEECH_EMPTY" }, { status: 502 })
  }

  // The organization's AI journal (src/lib/ai/gateway): the speech this phrase
  // produced, by its length. Vertex runs on the platform's credentials.
  let bytes = first.value.length
  let journaled = false
  const journal = () => {
    if (journaled) return
    journaled = true
    const seconds = bytes / (CONSOLE_SPEECH_SAMPLE_RATE * 2)
    journalPlatformAiCall(auth.orgId, "gemini", "voice-assistant", {
      model: "gemini-3.8-flash-tts",
      costUsd: perMinuteCostUsd(UNIT_PRICING.geminiSpeechMinute, seconds),
    })
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(first.value))
    },
    async pull(controller) {
      try {
        const next = await chunks.next()
        if (next.done) {
          clearTimeout(whole)
          journal()
          controller.close()
          return
        }
        bytes += next.value.length
        controller.enqueue(new Uint8Array(next.value))
      } catch {
        // Обрыв посреди фразы: вкладка доиграет то, что пришло.
        clearTimeout(whole)
        journal()
        controller.close()
      }
    },
    cancel() {
      clearTimeout(whole)
      journal()
      upstream.abort()
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": `audio/L16;rate=${CONSOLE_SPEECH_SAMPLE_RATE};channels=1`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
