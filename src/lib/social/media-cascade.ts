import crypto from "node:crypto"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

export type MediaDescriptor = {
  mediaType: "IMAGE" | "VIDEO" | "AUDIO"
  sourceUrl: string
  canonicalMediaUrl: string
  thumbnailUrl?: string
  audioUrl?: string
  platformTranscript?: string
  language?: string
  durationMs?: number
  frameUrls: string[]
}

export type MediaCascadePolicy = {
  enabled: boolean
  coverOcrEnabled: boolean
  frameOcrEnabled: boolean
  asrEnabled: boolean
  multimodalEnabled: boolean
  preferPlatformTranscript: boolean
  maxFramesPerVideo: number
  frameCandidatePercent: number
  asrCandidatePercent: number
  multimodalCandidatePercent: number
}

export type MediaStagePlan = {
  stage: "COVER_OCR" | "FRAME_SAMPLE" | "FRAME_OCR" | "PLATFORM_TRANSCRIPT" | "ASR" | "MULTIMODAL"
  provider: string
  modelVersion: string
  enabled: boolean
  reason: string
  frameCount: number
  estimatedCostUsd: number
}

export function extractMediaDescriptor(
  metadata: Record<string, unknown> | undefined,
  fallbackUrl?: string | null,
): MediaDescriptor | null {
  const mediaUrl = stringValue(metadata, "mediaUrl", "videoUrl", "imageUrl", "audioUrl")
  const thumbnailUrl = stringValue(metadata, "thumbnailUrl", "coverUrl", "posterUrl")
  const audioUrl = stringValue(metadata, "audioUrl")
  const sourceUrl = mediaUrl ?? fallbackUrl?.trim() ?? thumbnailUrl
  if (!sourceUrl || !isValidPublicMediaUrl(sourceUrl)) return null
  const safeThumbnail = thumbnailUrl && isValidPublicMediaUrl(thumbnailUrl) ? thumbnailUrl : undefined
  const safeAudio = audioUrl && isValidPublicMediaUrl(audioUrl) ? audioUrl : undefined
  const declaredType = stringValue(metadata, "mediaType", "contentMediaType")?.toUpperCase()
  const mediaType = inferMediaType(declaredType, mediaUrl ?? sourceUrl, safeAudio)
  const frameUrls = arrayStrings(metadata?.frameUrls).filter(isValidPublicMediaUrl).slice(0, 24)
  const transcript = stringValue(metadata, "platformTranscript", "transcript", "captions")
  const duration = numberValue(metadata?.durationMs)
    ?? (numberValue(metadata?.durationSeconds) !== null ? numberValue(metadata?.durationSeconds)! * 1000 : null)
  return {
    mediaType,
    sourceUrl,
    canonicalMediaUrl: canonicalizeMediaUrl(mediaUrl ?? sourceUrl),
    thumbnailUrl: safeThumbnail,
    audioUrl: safeAudio,
    platformTranscript: transcript?.slice(0, 200_000),
    language: stringValue(metadata, "language", "lang")?.slice(0, 16),
    durationMs: duration === null ? undefined : Math.max(0, Math.trunc(duration)),
    frameUrls,
  }
}

export function planMediaCascade(
  policy: MediaCascadePolicy,
  media: MediaDescriptor,
  relevanceScore: number,
  cohortKey: string,
): MediaStagePlan[] {
  const score = Math.max(0, Math.min(1, relevanceScore))
  const frameCount = media.frameUrls.length > 0
    ? Math.min(media.frameUrls.length, policy.maxFramesPerVideo)
    : Math.min(policy.maxFramesPerVideo, representativeFrameTimes(media.durationMs).length)
  const coverUrl = media.thumbnailUrl ?? (media.mediaType === "IMAGE" ? media.sourceUrl : undefined)
  const frameCandidate = media.mediaType === "VIDEO" && selectedForStage(cohortKey, "frames", score, policy.frameCandidatePercent, 0.7)
  const asrCandidate = media.mediaType !== "IMAGE" && selectedForStage(cohortKey, "asr", score, policy.asrCandidatePercent, 0.86)
  const multimodalCandidate = selectedForStage(cohortKey, "multimodal", score, policy.multimodalCandidatePercent, 0.96)
  const coverCost = price("VISION_COVER_OCR_UNIT_USD", 0.0015)
  const asrMinutes = Math.max(1 / 60, (media.durationMs ?? 60_000) / 60_000)

  return [
    {
      stage: "PLATFORM_TRANSCRIPT",
      provider: "platform",
      modelVersion: "source-payload-v1",
      enabled: Boolean(policy.preferPlatformTranscript && media.platformTranscript),
      reason: media.platformTranscript ? "platform_transcript_available" : "platform_transcript_missing",
      frameCount: 0,
      estimatedCostUsd: 0,
    },
    {
      stage: "COVER_OCR",
      provider: "google-vision",
      modelVersion: "text-detection-v1",
      enabled: Boolean(policy.enabled && policy.coverOcrEnabled && coverUrl),
      reason: !policy.enabled ? "media_processing_disabled" : coverUrl ? "cover_available" : "cover_missing",
      frameCount: coverUrl ? 1 : 0,
      estimatedCostUsd: coverUrl ? coverCost : 0,
    },
    {
      stage: "FRAME_SAMPLE",
      provider: media.frameUrls.length > 0 ? "platform" : "frame-extractor",
      modelVersion: "representative-v1",
      enabled: Boolean(policy.enabled && policy.frameOcrEnabled && frameCandidate && frameCount > 0),
      reason: frameCandidate ? (frameCount > 0 ? "budgeted_candidate" : "no_extractable_frames") : "outside_frame_cohort",
      frameCount,
      estimatedCostUsd: media.frameUrls.length > 0 ? 0 : price("MEDIA_FRAME_EXTRACTION_UNIT_USD", 0),
    },
    {
      stage: "FRAME_OCR",
      provider: "google-vision",
      modelVersion: "text-detection-v1",
      enabled: Boolean(policy.enabled && policy.frameOcrEnabled && frameCandidate && media.frameUrls.length > 0),
      reason: !frameCandidate ? "outside_frame_cohort" : media.frameUrls.length > 0 ? "frames_available" : "frame_extractor_not_configured",
      frameCount: Math.min(media.frameUrls.length, policy.maxFramesPerVideo),
      estimatedCostUsd: Math.min(media.frameUrls.length, policy.maxFramesPerVideo) * coverCost,
    },
    {
      stage: "ASR",
      provider: "openai-whisper",
      modelVersion: "whisper-1",
      enabled: Boolean(policy.enabled && policy.asrEnabled && asrCandidate && media.audioUrl && !media.platformTranscript),
      reason: media.platformTranscript ? "platform_transcript_preferred" : !asrCandidate ? "outside_asr_cohort" : media.audioUrl ? "audio_available" : "audio_extractor_not_configured",
      frameCount: 0,
      estimatedCostUsd: asrMinutes * price("MEDIA_ASR_MINUTE_USD", 0.006),
    },
    {
      stage: "MULTIMODAL",
      provider: "unconfigured",
      modelVersion: "none",
      enabled: Boolean(policy.enabled && policy.multimodalEnabled && multimodalCandidate),
      reason: multimodalCandidate ? "high_value_candidate" : "outside_multimodal_cohort",
      frameCount,
      estimatedCostUsd: price("MEDIA_MULTIMODAL_RUN_USD", 0.01),
    },
  ]
}

export function representativeFrameTimes(durationMs: number | undefined, count = 8): number[] {
  if (!durationMs || durationMs <= 0 || count <= 0) return []
  const safeCount = Math.max(1, Math.min(24, Math.trunc(count)))
  if (durationMs < 2_000) return [Math.trunc(durationMs / 2)]
  const start = Math.min(1_000, Math.trunc(durationMs * 0.05))
  const end = Math.max(start, durationMs - Math.min(1_000, Math.trunc(durationMs * 0.05)))
  if (safeCount === 1) return [Math.trunc((start + end) / 2)]
  return Array.from({ length: safeCount }, (_, index) => Math.trunc(start + (end - start) * index / (safeCount - 1)))
}

export function canonicalizeMediaUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ""
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.startsWith("utm_") || ["fbclid", "gclid", "igshid"].includes(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "")
    return url.toString()
  } catch {
    return value.trim()
  }
}

function selectedForStage(key: string, stage: string, score: number, percent: number, highValueFloor: number) {
  if (score >= highValueFloor) return true
  if (percent <= 0) return false
  const bucket = crypto.createHash("sha256").update(`${key}:${stage}`).digest().readUInt32BE(0) % 10_000
  return bucket < Math.min(100, percent) * 100
}

function inferMediaType(declared: string | undefined, url: string, audioUrl: string | undefined): MediaDescriptor["mediaType"] {
  if (declared && ["IMAGE", "VIDEO", "AUDIO"].includes(declared)) return declared as MediaDescriptor["mediaType"]
  if (audioUrl && audioUrl === url) return "AUDIO"
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase() } catch { return url.toLowerCase() } })()
  if (/\.(mp3|wav|m4a|ogg|aac)(?:$|\?)/.test(pathname)) return "AUDIO"
  if (/\.(mp4|mov|webm|mkv|m3u8)(?:$|\?)/.test(pathname)) return "VIDEO"
  return "IMAGE"
}

function stringValue(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(item => item.trim()) : []
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function price(envKey: string, fallback: number): number {
  const raw = Number(process.env[envKey])
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}
