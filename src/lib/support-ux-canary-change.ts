import type { Prisma } from "@prisma/client"
import { SUPPORT_UX_V2_CANARY_FLAG } from "@/lib/support-ux-rollout"

export class SupportCanaryChangeError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code)
  }
}

/** Keep the native/encoded array and every unrelated entry, including duplicates. */
export function planSupportCanaryChange(features: Prisma.JsonValue, enabled: boolean) {
  let decoded: unknown = features
  try {
    const stored = JSON.stringify(features)
    if (Buffer.byteLength(stored, "utf8") > 4096) throw new Error()
    if (typeof features === "string") decoded = JSON.parse(features)
    if (!Array.isArray(decoded)) throw new Error()
    JSON.stringify(decoded, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error()
      return value
    })
  } catch {
    throw new SupportCanaryChangeError("SUPPORT_UX_FEATURES_UNSUPPORTED", 409)
  }
  const values = decoded as Prisma.JsonArray
  const before = values.includes(SUPPORT_UX_V2_CANARY_FLAG)
  const changed = before !== enabled
  const entries = enabled
    ? changed ? [...values, SUPPORT_UX_V2_CANARY_FLAG] : values
    : values.filter((entry) => entry !== SUPPORT_UX_V2_CANARY_FLAG)
  const nextFeatures: Prisma.InputJsonValue = typeof features === "string"
    ? changed ? JSON.stringify(entries) : features
    : entries as Prisma.InputJsonArray
  if (Buffer.byteLength(JSON.stringify(nextFeatures), "utf8") > 4096) {
    throw new SupportCanaryChangeError("SUPPORT_UX_FEATURES_UNSUPPORTED", 409)
  }
  return { before, changed, nextFeatures }
}
