/**
 * Where a lead came from, as a public form sends it: ad click ids, cookies of
 * the ad platforms, UTM tags and the page. Everything here is attacker-
 * controlled, so every field is bounded and anything malformed is dropped
 * rather than refused — a form must never fail because of its tracking.
 *
 * Stored on `Lead.adAttribution`; copied to `Deal.metadata.adAttribution` on
 * conversion; read by src/lib/ad-conversions/meta.ts.
 */
import { z } from "zod"

export interface AdAttribution {
  fbclid?: string
  /** Meta's click cookie `_fbc` ("fb.1.<ms>.<fbclid>"), or built from fbclid. */
  fbc?: string
  /** Meta's browser cookie `_fbp`. */
  fbp?: string
  gclid?: string
  /** GA client id from the `_ga` cookie ("123.456"). */
  gaClientId?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  /** The page the form was on. */
  pageUrl?: string
  userAgent?: string
  /** ISO time the attribution was captured. */
  capturedAt?: string
}

const id = z.string().trim().max(500).regex(/^[\w.\-~%]+$/)
const text = z.string().trim().max(300)

export const attributionInputSchema = z.object({
  fbclid: id.optional(),
  fbc: z.string().trim().max(600).regex(/^fb\.\d\.\d{10,16}\.[\w.\-~%]+$/).optional(),
  fbp: z.string().trim().max(100).regex(/^fb\.\d\.\d{10,16}\.\d+$/).optional(),
  gclid: id.optional(),
  gaClientId: z.string().trim().max(60).regex(/^\d+\.\d+$/).optional(),
  utmSource: text.optional(),
  utmMedium: text.optional(),
  utmCampaign: text.optional(),
  utmContent: text.optional(),
  utmTerm: text.optional(),
  pageUrl: z.string().trim().max(1000).url().refine((value) => /^https?:\/\//.test(value)).optional(),
})

/** Parse what a form sent, field by field; a bad field is dropped, not fatal. */
export function readAttribution(input: unknown, context: { userAgent?: string | null; now?: Date } = {}): AdAttribution | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const result: AdAttribution = {}
  const shape = attributionInputSchema.shape
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const parsed = shape[key].safeParse((input as Record<string, unknown>)[key])
    if (parsed.success && parsed.data) (result as Record<string, string>)[key] = parsed.data
  }
  if (!result.fbc && result.fbclid) {
    // Meta's own format for a click id that has no cookie yet.
    result.fbc = `fb.1.${(context.now ?? new Date()).getTime()}.${result.fbclid}`
  }
  const hasSignal = Object.keys(result).length > 0
  if (!hasSignal) return null
  if (context.userAgent) result.userAgent = context.userAgent.slice(0, 400)
  result.capturedAt = (context.now ?? new Date()).toISOString()
  return result
}

/** Read an attribution object back from a JSON column. */
export function storedAttribution(value: unknown): AdAttribution | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as AdAttribution
}
