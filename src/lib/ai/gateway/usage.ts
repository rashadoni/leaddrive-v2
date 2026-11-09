/**
 * The journal of paid AI calls (`ai_usage`): one row per call, numbers only.
 * The organization's daily budget (`checkAiBudget`) and its spend report read
 * it. A failed write never fails the call that was already paid for.
 */
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { logOperationalFailure } from "@/lib/telemetry/operational-failure"
import type { AiFeature, AiProvider } from "./features"
import { aiCallCostUsd } from "./pricing"

export type AiKeySource = "platform" | "tenant"

export type AiUsageEntry = {
  orgId: string
  feature: AiFeature
  provider: AiProvider
  keySource: AiKeySource
  agentId?: string | null
  model?: string | null
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** For a provider not billed by tokens; otherwise priced from the tokens. */
  costUsd?: number
}

export async function recordAiUsage(entry: AiUsageEntry): Promise<void> {
  const inputTokens = entry.inputTokens || 0
  const outputTokens = entry.outputTokens || 0
  const cacheReadTokens = entry.cacheReadTokens || 0
  const cacheWriteTokens = entry.cacheWriteTokens || 0
  const costUsd = entry.costUsd ?? aiCallCostUsd(entry.model ?? "", inputTokens, outputTokens, {
    readTokens: cacheReadTokens,
    writeTokens: cacheWriteTokens,
  })
  try {
    await runWithTenant(entry.orgId, () => prisma.aiUsage.create({
      data: {
        organizationId: entry.orgId,
        feature: entry.feature,
        agentId: entry.agentId ?? null,
        provider: entry.provider,
        model: entry.model ?? null,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd,
        keySource: entry.keySource,
      },
    }))
  } catch {
    logOperationalFailure("ai-gateway-usage", "warn")
  }
}
