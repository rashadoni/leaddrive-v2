/**
 * One way in and out for every paid AI call (owner, 2026-11-09): the key the
 * organization chose, its budget, and a journal line per call. Plan and
 * stages: docs/ai-provider-gateway-plan.md.
 */
export { anthropicFor, anthropicAccess, anthropicAvailable, anthropicOrRefusal, platformAnthropic, AiUnavailableError, isAiUnavailable, aiUnavailableText, type AnthropicForOptions } from "./anthropic"
export { AI_FEATURES, AI_PROVIDERS, SELF_KEY_PROVIDERS, isSelfKeyProvider, aiFeatureLabel, type AiFeature, type AiProvider } from "./features"
export { recordAiUsage, type AiUsageEntry, type AiKeySource } from "./usage"
export {
  tenantAiAccess, saveTenantAiCredential, deleteTenantAiCredential, listTenantAiCredentials, forgetTenantAiAccess, keyHint,
} from "./credentials"
export { aiCallCostUsd, MODEL_PRICING, UNIT_PRICING, perMinuteCostUsd } from "./pricing"
export {
  aiKeyFor, aiKeyOrRefusal, aiProviderAvailable, journalPlatformAiCall, journalAiCallOnCurrentKey, platformAiKey,
  type AiKeyAccess, type AiJournalEntry, type AiAccessOptions,
} from "./access"
export { verifyProviderKey, type KeyCheck } from "./verify-key"
export {
  aiSpendReport, RANGES_FOR, SPEND_GRANULARITIES, SPEND_RANGES, isSpendGranularity, isSpendRange, spendTimeZone,
  type SpendGranularity, type SpendRange, type SpendReport, type SpendRow, type SpendPeriod,
} from "./spend-report"
