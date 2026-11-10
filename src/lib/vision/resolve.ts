import { aiKeyOrRefusal, isAiUnavailable, UNIT_PRICING, type AiFeature } from "@/lib/ai/gateway"
import { createGoogleVisionClient } from "@/lib/vision/providers/google-vision"
import type { VisionOcrClient } from "@/lib/vision/types"

/**
 * The organization's OCR client through the AI gateway: its own Google Vision
 * key or the platform's, the daily limit on the platform's, and a journal line
 * per image read. Null when OCR is not available to the organization.
 */
export async function resolveVisionOcrClient(orgId: string, feature: AiFeature): Promise<VisionOcrClient | null> {
  const provider = process.env.VISION_OCR_PROVIDER ?? "google-vision"
  if (provider !== "google-vision") return null
  const access = await aiKeyOrRefusal(orgId, "google_vision", feature)
  if (isAiUnavailable(access)) return null
  const client = createGoogleVisionClient({
    apiKey: access.apiKey,
    endpoint: process.env.GOOGLE_VISION_ENDPOINT,
    timeoutMs: parseTimeout(process.env.VISION_OCR_TIMEOUT_MS),
  })
  return {
    async detectText(request) {
      const result = await client.detectText(request)
      access.journal({ model: "google-vision-text-detection", costUsd: UNIT_PRICING.visionImage })
      return result
    },
  }
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 1_000 && value <= 120_000 ? value : undefined
}
