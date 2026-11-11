import type { Prisma } from "@prisma/client"
import { storeVoiceTranscript, transcribeInboundVoice } from "@/lib/inbox/inbound-voice-transcript"

type MetaAttachment = {
  type?: unknown
  payload?: { url?: unknown } | null
}

export type InstagramAttachmentType = "audio" | "image" | "video" | "document"

const AUDIO_EXTENSION_RE = /\.(?:aac|amr|m4a|mp3|oga|ogg|opus|wav)(?:$|[?#])/i
const VIDEO_EXTENSION_RE = /\.(?:mov|mp4|m4v|webm)(?:$|[?#])/i
const IMAGE_EXTENSION_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i

export function parseInstagramAttachment(attachments: unknown): {
  mediaUrl: string | null
  messageType: InstagramAttachmentType | null
} {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { mediaUrl: null, messageType: null }
  }

  const attachment = (attachments[0] || {}) as MetaAttachment
  const mediaUrl =
    typeof attachment.payload?.url === "string" && attachment.payload.url.trim()
      ? attachment.payload.url.trim()
      : null
  if (!mediaUrl) return { mediaUrl: null, messageType: null }

  const declaredType = typeof attachment.type === "string" ? attachment.type.toLowerCase() : ""
  if (declaredType.includes("audio") || declaredType.includes("voice")) {
    return { mediaUrl, messageType: "audio" }
  }
  if (declaredType.includes("video")) return { mediaUrl, messageType: "video" }
  if (declaredType.includes("image")) return { mediaUrl, messageType: "image" }

  // Meta normally supplies attachment.type. Extension checks cover older
  // payloads and signed CDN URLs whose type is missing or reported as "file".
  if (AUDIO_EXTENSION_RE.test(mediaUrl)) return { mediaUrl, messageType: "audio" }
  if (VIDEO_EXTENSION_RE.test(mediaUrl)) return { mediaUrl, messageType: "video" }
  if (IMAGE_EXTENSION_RE.test(mediaUrl)) return { mediaUrl, messageType: "image" }
  return { mediaUrl, messageType: "document" }
}

export const INSTAGRAM_AUDIO_TEXT_FALLBACK =
  "Təəssüf ki, səsli mesajı dinləyə bilmədim. Zəhmət olmasa, mesajınızı mətn şəklində göndərin."

type InboundAudioInput = {
  organizationId: string
  messageId: string
  audioUrl: string
  /** The file itself when we already keep it (lib/inbox/meta-media); then the URL is not fetched. */
  audio?: { bytes: Uint8Array; contentType?: string; filename?: string }
  metadata: Prisma.InputJsonObject
  onTranscript: (transcript: string) => Promise<void>
  sendFallback: (text: string) => Promise<unknown>
}

async function handleInboundAudio(
  input: InboundAudioInput,
  source: "Instagram" | "TikTok" | "Facebook",
): Promise<"transcribed" | "fallback"> {
  // One transcription for every messenger (lib/inbox/inbound-voice-transcript); this path adds
  // only what an AI-answered channel needs on top — the reply, or a request to type it instead.
  const transcription = await transcribeInboundVoice(input.audio
    ? { organizationId: input.organizationId, source, audio: input.audio }
    : { organizationId: input.organizationId, source, audioUrl: input.audioUrl })
  if (!transcription) {
    await input.sendFallback(INSTAGRAM_AUDIO_TEXT_FALLBACK)
    return "fallback"
  }
  try {
    await storeVoiceTranscript({
      organizationId: input.organizationId,
      messageId: input.messageId,
      metadata: input.metadata,
      transcription,
    })
  } catch (error) {
    console.error(`[${source} audio] saving the transcript failed:`, error instanceof Error ? error.message : "unknown error")
    await input.sendFallback(INSTAGRAM_AUDIO_TEXT_FALLBACK)
    return "fallback"
  }

  // A downstream AI/rules failure is not a transcription failure. Do not tell
  // the customer to resend text after their audio was already understood.
  await input.onTranscript(transcription.text)
  return "transcribed"
}

export function handleInstagramInboundAudio(input: InboundAudioInput) {
  return handleInboundAudio(input, "Instagram")
}

export function handleTikTokInboundAudio(input: InboundAudioInput) {
  return handleInboundAudio(input, "TikTok")
}

export function handleFacebookInboundAudio(input: InboundAudioInput) {
  return handleInboundAudio(input, "Facebook")
}
