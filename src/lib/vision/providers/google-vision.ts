import { lookup } from "node:dns/promises"
import {
  VISION_LIMITS,
  isValidPublicMediaUrl,
  type VisionOcrClient,
  type VisionTextRequest,
  type VisionTextResult,
} from "@/lib/vision/types"

type FetchLike = typeof fetch
type LookupAddress = { address: string; family: number }

export type GoogleVisionConfig = {
  apiKey: string
  endpoint?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
  resolveHost?: (hostname: string) => Promise<LookupAddress[]>
}

type GoogleVisionResponse = {
  responses?: Array<{
    error?: { message?: string }
    fullTextAnnotation?: { text?: string }
    textAnnotations?: Array<{
      description?: string
      confidence?: number
      locale?: string
      boundingPoly?: { vertices?: Array<{ x?: number; y?: number }> }
    }>
  }>
}

export function createGoogleVisionClient(config: GoogleVisionConfig): VisionOcrClient {
  if (!config.apiKey) throw new Error("Google Vision: apiKey is required")
  const endpoint = config.endpoint ?? "https://vision.googleapis.com/v1/images:annotate"
  const timeoutMs = config.timeoutMs ?? 30_000
  const fetchImpl = config.fetchImpl ?? fetch
  const resolveHost = config.resolveHost ?? (async hostname => lookup(hostname, { all: true }))

  return {
    async detectText(request: VisionTextRequest): Promise<VisionTextResult> {
      if (!isValidPublicMediaUrl(request.imageUrl)) throw new Error("Google Vision: invalid imageUrl")
      const url = new URL(request.imageUrl)
      const addresses = await resolveHost(url.hostname)
      if (addresses.length === 0 || addresses.some(item => !isPublicResolvedAddress(item.address))) {
        throw new Error("Google Vision: image host resolves to a private or reserved address")
      }
      const maxBytes = Math.min(
        Math.max(1024, request.maxBytes ?? VISION_LIMITS.defaultMaxBytes),
        VISION_LIMITS.absoluteMaxBytes,
      )
      const imageResponse = await fetchWithTimeout(fetchImpl, request.imageUrl, timeoutMs)
      if (!imageResponse.ok) throw new Error(`Google Vision: image fetch failed (HTTP ${imageResponse.status})`)
      const declaredSize = Number(imageResponse.headers.get("content-length") || "0")
      if (declaredSize > maxBytes) throw new Error(`Google Vision: image exceeds ${maxBytes} byte limit`)
      const bytes = await imageResponse.arrayBuffer()
      if (bytes.byteLength > maxBytes) throw new Error(`Google Vision: image exceeds ${maxBytes} byte limit`)

      const languageHints = Array.from(new Set(request.languageHints ?? []))
        .filter(value => /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value))
        .slice(0, VISION_LIMITS.maxLanguageHints)
      const response = await fetchWithTimeout(fetchImpl, `${endpoint}?key=${encodeURIComponent(config.apiKey)}`, timeoutMs, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: Buffer.from(bytes).toString("base64") },
            features: [{ type: "TEXT_DETECTION", maxResults: 100 }],
            imageContext: languageHints.length > 0 ? { languageHints } : undefined,
          }],
        }),
      })
      if (!response.ok) throw new Error(`Google Vision: annotate failed (HTTP ${response.status})`)
      const body = await response.json() as GoogleVisionResponse
      const result = body.responses?.[0]
      if (result?.error?.message) throw new Error(`Google Vision: ${result.error.message.slice(0, 200)}`)
      const annotations = result?.textAnnotations ?? []
      return {
        fullText: result?.fullTextAnnotation?.text?.trim() || annotations[0]?.description?.trim() || "",
        blocks: annotations.slice(1).flatMap(annotation => {
          const text = annotation.description?.trim()
          if (!text) return []
          return [{
            text,
            confidence: clampConfidence(annotation.confidence ?? 0.8),
            language: annotation.locale,
            boundingBox: annotation.boundingPoly?.vertices?.map(vertex => ({ x: vertex.x ?? 0, y: vertex.y ?? 0 })),
          }]
        }),
        provider: "google-vision",
        modelVersion: "text-detection-v1",
      }
    },
  }
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function isPublicResolvedAddress(address: string): boolean {
  if (address.includes(":")) {
    const normalized = address.toLowerCase()
    return !(normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:"))
  }
  return isValidPublicMediaUrl(`https://${address}/`)
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController()
  const handle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal })
  } finally {
    clearTimeout(handle)
  }
}
