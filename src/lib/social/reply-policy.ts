import { classifySocialAiTopic } from "@/lib/social/ai-reply-policy"
import { hasApprovedProviderReplyCapability } from "@/lib/social/provider-reply"

export type SocialReplySourceTier =
  | "official_owned"
  | "provider_api"
  | "search_index"
  | "notification_inbox"
  | "browser_capture"
  | "manual"
  | "unknown"

export type SocialReplyPolicyReason =
  | "allowed"
  | "unsupported_provider"
  | "no_connected_account"
  | "live_reply_disabled"
  | "source_requires_human_action"
  | "approval_required"
  | "manual_only_capture"

export interface SocialReplyPolicyInput {
  platform: string
  sourceType?: string | null
  sourceProvider?: string | null
  sourceMetadata?: unknown
  text: string
  sentiment?: string | null
  hasConnectedAccount?: boolean
}

export interface SocialReplyPolicyOptions {
  liveRepliesEnabled: boolean
  approvedPolicy?: boolean
}

export interface SocialReplyPolicyDecision {
  liveAllowed: boolean
  reason: SocialReplyPolicyReason
  sourceTier: SocialReplySourceTier
  supportedProvider: boolean
  approvalRequired: boolean
  draftOnly: boolean
  openOriginalRequired: boolean
  forbiddenReason: string | null
  message: string
}

const LIVE_REPLY_PLATFORMS = new Set(["twitter", "facebook", "instagram", "youtube"])
const OFFICIAL_PROVIDERS = new Set(["native", "official_api", "poller", "webhook"])

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function sourceTier(input: SocialReplyPolicyInput): SocialReplySourceTier {
  const metadata = asRecord(input.sourceMetadata)
  const provider = input.sourceProvider || stringValue(metadata.provider)
  const collectionMode = stringValue(metadata.collectionMode) || stringValue(metadata.monitoringCollectionMode) || provider

  if (collectionMode === "provider_api" || provider === "provider_api") return "provider_api"
  if (collectionMode === "search_index" || provider === "search_index") return "search_index"
  if (collectionMode === "notification_inbox" || provider === "notification_inbox") return "notification_inbox"
  if (collectionMode === "browser_capture" || provider === "browser_capture") return "browser_capture"
  if (provider === "manual" || collectionMode === "manual") return "manual"
  if (provider && OFFICIAL_PROVIDERS.has(provider)) return "official_owned"
  if (input.hasConnectedAccount && !provider) return "official_owned"
  return "unknown"
}

function triageApprovalRequired(sourceMetadata: unknown): boolean {
  const triage = asRecord(asRecord(sourceMetadata).socialTriage)
  return booleanValue(triage.approvalRequired) || stringValue(triage.prRisk) === "high" || stringValue(triage.urgency) === "critical"
}

export function evaluateSocialReplyPolicy(
  input: SocialReplyPolicyInput,
  options: SocialReplyPolicyOptions,
): SocialReplyPolicyDecision {
  const metadata = asRecord(input.sourceMetadata)
  const tier = sourceTier(input)
  const providerReplyCapable = tier === "provider_api" && hasApprovedProviderReplyCapability(input.sourceMetadata)
  const supportedProvider = LIVE_REPLY_PLATFORMS.has(input.platform) || providerReplyCapable
  const topic = classifySocialAiTopic(input.text)
  const approvalRequired = topic.blocked || triageApprovalRequired(input.sourceMetadata)
  const manualOnlyCapture = booleanValue(metadata.manualOnly) || booleanValue(metadata.noAutomation)

  const base = {
    sourceTier: tier,
    supportedProvider,
    approvalRequired,
    forbiddenReason: topic.reason,
  }

  if (manualOnlyCapture) {
    return {
      ...base,
      liveAllowed: false,
      reason: "manual_only_capture",
      draftOnly: true,
      openOriginalRequired: true,
      message: "This mention was captured manually/browser-side and requires human action in the original channel.",
    }
  }

  if (tier !== "official_owned" && tier !== "unknown" && !providerReplyCapable) {
    return {
      ...base,
      liveAllowed: false,
      reason: "source_requires_human_action",
      draftOnly: true,
      openOriginalRequired: true,
      message: "This source is not an owned official reply channel. Use AI draft and open the original link.",
    }
  }

  if (!supportedProvider) {
    return {
      ...base,
      liveAllowed: false,
      reason: "unsupported_provider",
      draftOnly: true,
      openOriginalRequired: true,
      message: `Live replies are not supported for ${input.platform}. Use AI draft or open the original channel.`,
    }
  }

  if (tier === "official_owned" && !input.hasConnectedAccount) {
    return {
      ...base,
      liveAllowed: false,
      reason: "no_connected_account",
      draftOnly: true,
      openOriginalRequired: true,
      message: "No connected owned account is available for this reply.",
    }
  }

  if (!options.liveRepliesEnabled) {
    return {
      ...base,
      liveAllowed: false,
      reason: "live_reply_disabled",
      draftOnly: true,
      openOriginalRequired: true,
      message: "Live social replies are disabled for this tenant. Save an AI draft or reply in the original channel.",
    }
  }

  if (approvalRequired && !options.approvedPolicy) {
    return {
      ...base,
      liveAllowed: false,
      reason: "approval_required",
      draftOnly: true,
      openOriginalRequired: true,
      message: "This mention requires approval before any live reply.",
    }
  }

  return {
    ...base,
    liveAllowed: true,
    reason: "allowed",
    draftOnly: false,
    openOriginalRequired: false,
    message: "Live reply allowed.",
  }
}
