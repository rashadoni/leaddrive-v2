import { getSocialReplyPublisher } from "@/lib/social/publishers"
import {
  isSocialBrandProtectionOnly,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
} from "@/lib/social/brand-protection"
import { sendProviderReply } from "@/lib/social/provider-reply"

export type OutboundPublishRecord = {
  id: string
  organizationId: string
  platform: string
  adapterType: string
  targetExternalId: string
  replyText: string
  idempotencyKey: string
  providerRequestId: string | null
  externalReplyId: string | null
  mention: {
    id: string
    organizationId: string
    platform: string
    externalId: string
    sourceType: string
    sourceProvider: string
    sourceMetadata: unknown
  }
  senderAccount: {
    id: string
    platform: string
    handle: string
    displayName: string | null
    accessToken: string | null
    tokenExpiresAt: Date | null
  }
}

export type OutboundPublishResult =
  | { outcome: "SENT"; externalReplyId: string | null; provider: string }
  | { outcome: "DEFINITE_FAILURE"; error: string; retriable: boolean; provider: string }
  | { outcome: "UNKNOWN"; error: string; provider: string }

export type OutboundReconcileResult =
  | { outcome: "SENT"; externalReplyId: string; evidence: Record<string, unknown> }
  | { outcome: "NOT_SENT"; evidence: Record<string, unknown> }
  | { outcome: "UNKNOWN"; evidence: Record<string, unknown> }

export interface OutboundPublisherAdapter {
  publish(record: OutboundPublishRecord): Promise<OutboundPublishResult>
  reconcile(record: OutboundPublishRecord): Promise<OutboundReconcileResult>
}

const defaultAdapter: OutboundPublisherAdapter = {
  async publish(record) {
    if (await isSocialBrandProtectionOnly(record.organizationId)) {
      return {
        outcome: "DEFINITE_FAILURE",
        error: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
        retriable: false,
        provider: "brand_protection",
      }
    }
    if (record.adapterType === "PROVIDER") {
      try {
        const result = await sendProviderReply(record.mention, record.replyText, {
          idempotencyKey: record.idempotencyKey,
          providerRequestId: record.providerRequestId,
        })
        if (result.ok) {
          return { outcome: "SENT", externalReplyId: result.replyId ?? null, provider: result.provider ?? "provider_api" }
        }
        if (result.code === "provider_reply_fetch_failed") {
          return { outcome: "UNKNOWN", error: result.error ?? result.code, provider: result.provider ?? "provider_api" }
        }
        return {
          outcome: "DEFINITE_FAILURE",
          error: result.error ?? result.code ?? "provider_reply_failed",
          retriable: result.status === 429 || result.status >= 500,
          provider: result.provider ?? "provider_api",
        }
      } catch (error) {
        return { outcome: "UNKNOWN", error: errorMessage(error), provider: "provider_api" }
      }
    }

    const publisher = getSocialReplyPublisher(record.platform)
    if (!publisher) {
      return { outcome: "DEFINITE_FAILURE", error: "direct_publisher_unavailable", retriable: false, provider: "direct" }
    }
    try {
      const result = await publisher.publishReply({
        externalId: record.targetExternalId,
        sourceType: record.mention.sourceType,
        sourceMetadata: record.mention.sourceMetadata,
        replyText: record.replyText,
        senderAccount: record.senderAccount,
      })
      if (result.ok) {
        return { outcome: "SENT", externalReplyId: result.externalReplyId ?? null, provider: record.platform }
      }
      if (result.error === "network_error") {
        return { outcome: "UNKNOWN", error: result.error, provider: record.platform }
      }
      return {
        outcome: "DEFINITE_FAILURE",
        error: result.error ?? "direct_publish_failed",
        retriable: result.retriable === true,
        provider: record.platform,
      }
    } catch (error) {
      return { outcome: "UNKNOWN", error: errorMessage(error), provider: record.platform }
    }
  },

  async reconcile(record) {
    // A provider/platform id is conclusive. Without one, neither Meta nor the
    // generic engagement-provider contract currently offers a trustworthy
    // idempotency lookup. Stay UNKNOWN instead of risking a duplicate retry.
    if (record.externalReplyId) {
      return { outcome: "SENT", externalReplyId: record.externalReplyId, evidence: { source: "stored_external_reply_id" } }
    }
    return {
      outcome: "UNKNOWN",
      evidence: { source: "no_contract_tested_readback", automaticRetryAllowed: false },
    }
  },
}

export function getOutboundPublisherAdapter(): OutboundPublisherAdapter {
  return defaultAdapter
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000)
}
