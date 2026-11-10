/**
 * A customer's voice message, as text — on every messenger, whether or not an AI answers there.
 *
 * Until 2026-11-10 only Instagram and TikTok transcribed a voice note, and only when the channel's
 * replies were set to AI: on WhatsApp, Telegram and Facebook Messenger the manager had to play it,
 * and the AI never heard it at all (owner: «Да» to «расшифровку для всех мессенджеров, и текст
 * под голосовым всегда»). The text goes into the message's own `body` — «[Səsli mesaj]» and the
 * words — so the inbox, the AI, the rules and the ticket all read it like any typed message, and
 * `metadata.transcription` keeps who transcribed it and how long the audio was.
 *
 * Never throws and never blocks the message: no key, a spent limit, a slow or failed provider —
 * the voice note stays as it arrived, playable, with its placeholder.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { resolveTranscriptionClient } from "@/lib/transcription/transcribe"

export const VOICE_MESSAGE_PREFIX = "[Səsli mesaj]"

/** Long enough for a minute of speech; short enough that the platform's webhook is answered in time. */
const TRANSCRIBE_WAIT_MS = 15_000

export type VoiceTranscription = {
  text: string
  provider: string
  language: string | null
  durationSeconds: number | null
}

export type VoiceAudio =
  | { audioUrl: string; audio?: undefined }
  | { audioUrl?: undefined; audio: { bytes: Uint8Array; contentType?: string; filename?: string } }

/** «[Səsli mesaj]» and the words — what the message's body becomes. */
export function voiceMessageBody(text: string): string {
  return `${VOICE_MESSAGE_PREFIX}\n${text}`
}

export async function transcribeInboundVoice(
  input: { organizationId: string; source: string; waitMs?: number } & VoiceAudio,
): Promise<VoiceTranscription | null> {
  try {
    const client = await resolveTranscriptionClient(input.organizationId, "inbox-audio")
    if (!client) return null
    const work = client.transcribe({
      audioUrl: input.audioUrl ?? "",
      audio: input.audio,
      prompt: `Müştəri ${input.source} vasitəsilə şirkətə Azərbaycan, rus və ya türk dilində müraciət edir.`,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), input.waitMs ?? TRANSCRIBE_WAIT_MS) })
    const result = await Promise.race([work, timeout]).finally(() => clearTimeout(timer))
    if (!result) {
      console.warn(`[voice transcript] ${input.source}: no answer in time`)
      work.catch(() => {})
      return null
    }
    const text = result.transcript.trim()
    if (!text) return null
    return {
      text,
      provider: result.provider,
      language: result.language || null,
      durationSeconds: result.durationSeconds ?? null,
    }
  } catch (error) {
    console.error(`[voice transcript] ${input.source} failed:`, error instanceof Error ? error.message : "unknown error")
    return null
  }
}

/** Writes the words into a message already saved. */
export async function storeVoiceTranscript(input: {
  organizationId: string
  messageId: string
  metadata: Prisma.InputJsonObject
  transcription: VoiceTranscription
}): Promise<void> {
  await prisma.channelMessage.updateMany({
    where: { id: input.messageId, organizationId: input.organizationId },
    data: {
      body: voiceMessageBody(input.transcription.text),
      metadata: { ...input.metadata, transcription: input.transcription },
    },
  })
}

/** Transcribe a saved voice message from its URL and write the words into it. The text, or null. */
export async function transcribeAndStoreInboundVoice(input: {
  organizationId: string
  messageId: string
  audioUrl: string
  metadata: Prisma.InputJsonObject
  source: string
}): Promise<string | null> {
  const transcription = await transcribeInboundVoice({
    organizationId: input.organizationId,
    source: input.source,
    audioUrl: input.audioUrl,
  })
  if (!transcription) return null
  try {
    await storeVoiceTranscript({ ...input, transcription })
  } catch (error) {
    console.error(`[voice transcript] ${input.source}: saving failed:`, error instanceof Error ? error.message : "unknown error")
    return null
  }
  return transcription.text
}
