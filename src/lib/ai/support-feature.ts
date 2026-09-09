import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import { isAiFeatureEnabled } from "@/lib/ai/budget"

export const SUPPORT_AI_DISABLED_ERROR = {
  error: "Support AI is disabled for this organization.",
  errorKey: "supportAiDisabled",
} as const

/** Single server-side gate for every AI path owned by the Support module. */
export async function isSupportAiEnabled(organizationId: string): Promise<boolean> {
  const disabled = await isAiFeatureEnabled(organizationId, SUPPORT_AI_DISABLED_FEATURE)
  return !disabled
}
