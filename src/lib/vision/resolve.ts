import { createGoogleVisionClient } from "@/lib/vision/providers/google-vision"
import type { VisionOcrClient } from "@/lib/vision/types"

export function resolveVisionOcrClient(): VisionOcrClient | null {
  const provider = process.env.VISION_OCR_PROVIDER ?? "google-vision"
  if (provider !== "google-vision") return null
  const apiKey = process.env.GOOGLE_VISION_API_KEY
  if (!apiKey) return null
  return createGoogleVisionClient({
    apiKey,
    endpoint: process.env.GOOGLE_VISION_ENDPOINT,
    timeoutMs: parseTimeout(process.env.VISION_OCR_TIMEOUT_MS),
  })
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 1_000 && value <= 120_000 ? value : undefined
}
