import { canonicalizeMediaUrl } from "@/lib/social/media-cascade"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

export type SocialMediaPlatform = "youtube" | "tiktok" | "instagram" | "facebook" | "direct" | "unknown"
export type ResolvedMediaType = "IMAGE" | "VIDEO" | "AUDIO"

export type SocialMediaAssetResolution = {
  status: "RESOLVED" | "PARTIAL" | "BLOCKED"
  platform: SocialMediaPlatform
  mediaType: ResolvedMediaType
  canonicalUrl: string
  title: string | null
  authorName: string | null
  mediaUrl: string | null
  thumbnailUrl: string | null
  audioUrl: string | null
  frameUrls: string[]
  platformTranscript: string | null
  language: string | null
  durationMs: number | null
  provider: string
  resolvedCapabilities: string[]
  blockers: string[]
}

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|m3u8)(?:$|\?)/i
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|oga|aac|flac)(?:$|\?)/i
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i

export function detectSocialMediaPlatform(value: string): SocialMediaPlatform {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "")
    if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) return "youtube"
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok"
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram"
    if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") return "facebook"
    if (VIDEO_EXT.test(value) || AUDIO_EXT.test(value) || IMAGE_EXT.test(value)) return "direct"
  } catch {
    return "unknown"
  }
  return "unknown"
}

export function getMediaProviderReadiness() {
  const endpoint = configuredResolverEndpoint()
  return {
    ocrConfigured: Boolean(process.env.GOOGLE_VISION_API_KEY?.trim()),
    asrConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    externalAssetResolverConfigured: Boolean(endpoint),
    metaOembedConfigured: Boolean(process.env.META_OEMBED_ACCESS_TOKEN?.trim()),
    freeOembedPlatforms: ["youtube", "tiktok"],
    directMediaSupported: true,
  }
}

export async function resolveSocialMediaAssets(input: {
  submittedUrl: string
  platformHint?: string | null
  mediaType?: "AUTO" | "IMAGE" | "VIDEO" | "AUDIO"
}): Promise<SocialMediaAssetResolution> {
  const submittedUrl = input.submittedUrl.trim()
  if (!isValidPublicMediaUrl(submittedUrl)) throw new Error("Media URL must be a public HTTP(S) URL")
  const detected = detectSocialMediaPlatform(submittedUrl)
  const hinted = normalizePlatform(input.platformHint)
  const platform = hinted ?? detected
  const declaredType = input.mediaType && input.mediaType !== "AUTO" ? input.mediaType : null
  const directType = directMediaType(submittedUrl)
  let base = emptyResolution(submittedUrl, platform, declaredType ?? directType ?? platformDefaultType(platform))

  if (directType) {
    base = {
      ...base,
      status: "RESOLVED",
      mediaType: declaredType ?? directType,
      mediaUrl: submittedUrl,
      audioUrl: (declaredType ?? directType) === "VIDEO" || (declaredType ?? directType) === "AUDIO" ? submittedUrl : null,
      provider: "direct-url",
      resolvedCapabilities: ["DIRECT_MEDIA", ...((declaredType ?? directType) !== "IMAGE" ? ["AUDIO_SOURCE"] : [])],
      blockers: (declaredType ?? directType) === "VIDEO" ? ["FRAME_EXTRACTION_PROVIDER_NOT_CONFIGURED"] : [],
    }
  } else if (platform === "youtube" || platform === "tiktok") {
    base = mergeResolution(base, await resolveFreeOembed(submittedUrl, platform).catch(error => ({
      provider: `${platform}-oembed`,
      blockers: [`OEMBED_FAILED:${errorMessage(error)}`],
    })))
  } else if (platform === "instagram" || platform === "facebook") {
    base = mergeResolution(base, await resolveMetaOembed(submittedUrl, platform).catch(error => ({
      provider: "meta-oembed",
      blockers: [`META_OEMBED_FAILED:${errorMessage(error)}`],
    })))
  }

  const endpoint = configuredResolverEndpoint()
  if (endpoint) {
    const external = await resolveWithExternalProvider(endpoint, submittedUrl, platform).catch(error => ({
      provider: "external-asset-resolver",
      blockers: [`ASSET_RESOLVER_FAILED:${errorMessage(error)}`],
    }))
    base = mergeResolution(base, external)
  }

  const hasAsset = Boolean(base.thumbnailUrl || base.mediaUrl || base.audioUrl || base.frameUrls.length > 0 || base.platformTranscript)
  const blockers = Array.from(new Set([
    ...base.blockers,
    ...(!hasAsset ? ["NO_PROCESSABLE_MEDIA_ASSET"] : []),
    ...(base.mediaType === "VIDEO" && !base.audioUrl && !base.platformTranscript ? ["AUDIO_SOURCE_UNAVAILABLE"] : []),
  ]))
  return {
    ...base,
    status: hasAsset ? (blockers.length > 0 ? "PARTIAL" : "RESOLVED") : "BLOCKED",
    blockers,
  }
}

function emptyResolution(url: string, platform: SocialMediaPlatform, mediaType: ResolvedMediaType): SocialMediaAssetResolution {
  return {
    status: "BLOCKED",
    platform,
    mediaType,
    canonicalUrl: canonicalizeMediaUrl(url),
    title: null,
    authorName: null,
    mediaUrl: null,
    thumbnailUrl: null,
    audioUrl: null,
    frameUrls: [],
    platformTranscript: null,
    language: null,
    durationMs: null,
    provider: "none",
    resolvedCapabilities: [],
    blockers: [],
  }
}

async function resolveFreeOembed(url: string, platform: "youtube" | "tiktok") {
  const endpoint = platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    : `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
  const response = await fetchJson(endpoint, { headers: { accept: "application/json" } })
  if (!response.ok) return { provider: `${platform}-oembed`, blockers: [`OEMBED_HTTP_${response.status}`] }
  const payload = response.data
  return sanitizePayload(payload, `${platform}-oembed`, ["METADATA", ...(stringValue(payload.thumbnail_url) ? ["THUMBNAIL"] : [])], ["AUDIO_SOURCE_UNAVAILABLE"])
}

async function resolveMetaOembed(url: string, platform: "instagram" | "facebook") {
  const token = process.env.META_OEMBED_ACCESS_TOKEN?.trim()
  if (!token) return { provider: "meta-oembed", blockers: ["META_OEMBED_TOKEN_MISSING"] }
  const kind = platform === "instagram" ? "instagram_oembed" : "oembed_post"
  const endpoint = `https://graph.facebook.com/v21.0/${kind}?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(token)}`
  const response = await fetchJson(endpoint, { headers: { accept: "application/json" } })
  if (!response.ok) return { provider: "meta-oembed", blockers: [`META_OEMBED_HTTP_${response.status}`] }
  return sanitizePayload(response.data, "meta-oembed", ["METADATA", ...(stringValue(response.data.thumbnail_url) ? ["THUMBNAIL"] : [])], ["AUDIO_SOURCE_UNAVAILABLE"])
}

async function resolveWithExternalProvider(endpoint: URL, url: string, platform: SocialMediaPlatform) {
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" }
  const token = process.env.SOCIAL_MEDIA_ASSET_RESOLVER_TOKEN?.trim()
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetchJson(endpoint.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({ url, platform, requestedAssets: ["thumbnail", "frames", "audio", "transcript"] }),
  })
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  return sanitizePayload(response.data, "external-asset-resolver", ["EXTERNAL_RESOLVER"], [])
}

function sanitizePayload(payload: Record<string, unknown>, provider: string, capabilities: string[], blockers: string[]) {
  const mediaUrl = publicUrl(payload.mediaUrl) ?? publicUrl(payload.videoUrl) ?? publicUrl(payload.url)
  const thumbnailUrl = publicUrl(payload.thumbnailUrl) ?? publicUrl(payload.thumbnail_url) ?? publicUrl(payload.coverUrl)
  const audioUrl = publicUrl(payload.audioUrl)
  const frameUrls = arrayValue(payload.frameUrls).map(publicUrl).filter((value): value is string => Boolean(value)).slice(0, 24)
  const transcript = stringValue(payload.platformTranscript) ?? stringValue(payload.transcript)
  const durationMs = numberValue(payload.durationMs) ?? (numberValue(payload.durationSeconds) !== null ? Math.round(numberValue(payload.durationSeconds)! * 1000) : null)
  const declaredType = stringValue(payload.mediaType)?.toUpperCase()
  const mediaType = declaredType && ["IMAGE", "VIDEO", "AUDIO"].includes(declaredType)
    ? declaredType as ResolvedMediaType
    : mediaUrl ? directMediaType(mediaUrl) : null
  const resolved = [
    ...capabilities,
    ...(mediaUrl ? ["MEDIA_URL"] : []),
    ...(thumbnailUrl ? ["THUMBNAIL"] : []),
    ...(audioUrl ? ["AUDIO_SOURCE"] : []),
    ...(frameUrls.length > 0 ? ["FRAMES"] : []),
    ...(transcript ? ["PLATFORM_TRANSCRIPT"] : []),
  ]
  return {
    provider,
    ...(mediaType ? { mediaType } : {}),
    title: stringValue(payload.title),
    authorName: stringValue(payload.authorName) ?? stringValue(payload.author_name),
    mediaUrl,
    thumbnailUrl,
    audioUrl,
    frameUrls,
    platformTranscript: transcript?.slice(0, 200_000) ?? null,
    language: stringValue(payload.language)?.slice(0, 16) ?? null,
    durationMs: durationMs === null ? null : Math.max(0, Math.trunc(durationMs)),
    resolvedCapabilities: Array.from(new Set(resolved)),
    blockers,
  }
}

function mergeResolution(base: SocialMediaAssetResolution, extra: Partial<SocialMediaAssetResolution> & { provider?: string; blockers?: string[] }) {
  const provider = extra.provider && extra.provider !== "none"
    ? base.provider === "none" ? extra.provider : `${base.provider}+${extra.provider}`
    : base.provider
  return {
    ...base,
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== null && value !== undefined)),
    title: extra.title ?? base.title,
    authorName: extra.authorName ?? base.authorName,
    mediaUrl: extra.mediaUrl ?? base.mediaUrl,
    thumbnailUrl: extra.thumbnailUrl ?? base.thumbnailUrl,
    audioUrl: extra.audioUrl ?? base.audioUrl,
    frameUrls: extra.frameUrls?.length ? extra.frameUrls : base.frameUrls,
    platformTranscript: extra.platformTranscript ?? base.platformTranscript,
    language: extra.language ?? base.language,
    durationMs: extra.durationMs ?? base.durationMs,
    provider,
    resolvedCapabilities: Array.from(new Set([...base.resolvedCapabilities, ...(extra.resolvedCapabilities ?? [])])),
    blockers: Array.from(new Set([...base.blockers, ...(extra.blockers ?? [])])),
  } as SocialMediaAssetResolution
}

function configuredResolverEndpoint(): URL | null {
  const raw = process.env.SOCIAL_MEDIA_ASSET_RESOLVER_ENDPOINT?.trim()
  if (!raw) return null
  try {
    const endpoint = new URL(raw)
    const allowed = new Set((process.env.SOCIAL_MEDIA_ASSET_RESOLVER_ALLOWED_HOSTS ?? "")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean))
    if (endpoint.protocol !== "https:" || !isValidPublicMediaUrl(endpoint.toString()) || !allowed.has(endpoint.hostname.toLowerCase())) return null
    return endpoint
  } catch {
    return null
  }
}

async function fetchJson(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal })
    const text = await response.text()
    if (text.length > 1_000_000) throw new Error("resolver_response_too_large")
    const data = text ? JSON.parse(text) : {}
    return { ok: response.ok, status: response.status, data: recordValue(data) }
  } finally {
    clearTimeout(timeout)
  }
}

function normalizePlatform(value: string | null | undefined): SocialMediaPlatform | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && ["youtube", "tiktok", "instagram", "facebook", "direct"].includes(normalized)
    ? normalized as SocialMediaPlatform
    : null
}

function platformDefaultType(platform: SocialMediaPlatform): ResolvedMediaType {
  return ["youtube", "tiktok", "instagram", "facebook"].includes(platform) ? "VIDEO" : "IMAGE"
}

function directMediaType(url: string): ResolvedMediaType | null {
  if (VIDEO_EXT.test(url)) return "VIDEO"
  if (AUDIO_EXT.test(url)) return "AUDIO"
  if (IMAGE_EXT.test(url)) return "IMAGE"
  return null
}

function publicUrl(value: unknown): string | null {
  const raw = stringValue(value)
  return raw && isValidPublicMediaUrl(raw) ? raw : null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 120)
}
