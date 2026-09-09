export type VisionSignalType = "COVER_OCR" | "FRAME_OCR"

export type VisionTextBlock = {
  text: string
  confidence: number
  language?: string
  boundingBox?: Array<{ x: number; y: number }>
}

export type VisionTextResult = {
  fullText: string
  blocks: VisionTextBlock[]
  provider: string
  modelVersion: string
}

export type VisionTextRequest = {
  imageUrl: string
  languageHints?: string[]
  maxBytes?: number
}

export interface VisionOcrClient {
  detectText(request: VisionTextRequest): Promise<VisionTextResult>
}

export const VISION_LIMITS = {
  maxUrlLength: 2048,
  defaultMaxBytes: 10 * 1024 * 1024,
  absoluteMaxBytes: 25 * 1024 * 1024,
  maxLanguageHints: 8,
} as const

export function isValidPublicMediaUrl(value: string): boolean {
  if (!value || value.length > VISION_LIMITS.maxUrlLength) return false
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (["localhost", "ip6-localhost", "ip6-loopback", "::", "::1"].includes(host)) return false
    if (/^(fc|fd|fe[89ab])/i.test(host) || /^::ffff:/i.test(host)) return false
    const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!match) return true
    const octets = match.slice(1).map(Number)
    if (octets.some(octet => octet < 0 || octet > 255)) return false
    const [a, b, c] = octets
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
  } catch {
    return false
  }
}
