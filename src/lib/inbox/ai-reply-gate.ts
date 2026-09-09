/**
 * A2 (Creatio 10X gap roadmap) — send-or-draft gate for AI auto-replies.
 *
 * Per-channel policy lives in ChannelConfig.settings (managed by /api/v1/settings/channel-reply):
 *   draftMode    boolean — AI never auto-sends on this channel; every reply becomes a draft.
 *   aiThreshold  0..1    — auto-send only when the A1 judge total ≥ threshold; below → draft.
 *                          UNSET (null) = gating off → send everything (exact pre-A2 behavior),
 *                          deliberately, so live tenants see zero change until they opt in.
 *
 * Draft reasons mirror Creatio's Smart auto-reply: clarifying questions are always drafted when
 * gating is armed, and a scoring failure fails CLOSED (draft) — an org that opted into thresholds
 * asked us not to auto-send unvetted text.
 *
 * Escalation replies bypass the gate: the customer must hear the "передаю менеджеру" hand-off
 * immediately (the team is notified in the same breath), otherwise the promise dies in a draft.
 */
import type { AiQualityMetadata } from "@/lib/ai/response-scorer"

export type AiReplyPolicy = {
  draftMode: boolean
  /** null = threshold gating off. */
  aiThreshold: number | null
  /** A3 — share of inbound conversations the AI handles (0..100); null = everyone (pre-A3 behavior). */
  aiRolloutPercent: number | null
}

export type AiDraftReason =
  | "draft_mode"
  | "below_threshold"
  | "clarifying_question"
  | "scoring_failed"
  | "commitment_guard"

export type AiReplyGateDecision = { action: "send" } | { action: "draft"; reason: AiDraftReason }

/** Parse the reply policy out of a ChannelConfig.settings blob (defaults = gating off). */
export function readAiReplyPolicy(settings: unknown): AiReplyPolicy {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>
  return {
    draftMode: s.draftMode === true,
    aiThreshold:
      typeof s.aiThreshold === "number" && s.aiThreshold >= 0 && s.aiThreshold <= 1 ? s.aiThreshold : null,
    aiRolloutPercent:
      typeof s.aiRolloutPercent === "number" && Number.isInteger(s.aiRolloutPercent) && s.aiRolloutPercent >= 0 && s.aiRolloutPercent <= 100
        ? s.aiRolloutPercent
        : null,
  }
}

/**
 * A3 — deterministic audience-rollout check, evaluated BEFORE the LLM call (an excluded
 * conversation must not burn tokens). FNV-1a over the conversation id keyed to a 0..99
 * bucket, so a conversation never "flickers" between AI and human as messages arrive:
 * the same id always lands in the same bucket, and raising the percentage only ADDS
 * conversations (bucket < percent is monotonic in percent).
 * null / ≥100 → everyone (pre-A3 behavior); ≤0 → no one.
 */
export function isInAiRollout(conversationId: string, rolloutPercent: number | null): boolean {
  if (rolloutPercent === null || rolloutPercent >= 100) return true
  if (rolloutPercent <= 0) return false
  let h = 0x811c9dc5
  for (let i = 0; i < conversationId.length; i++) {
    h ^= conversationId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 100 < rolloutPercent
}

/** Pure decision: send the generated reply now, or park it as an operator draft. */
export function decideAiReplyAction(
  policy: AiReplyPolicy,
  quality: AiQualityMetadata | undefined,
  opts?: { escalate?: boolean },
): AiReplyGateDecision {
  if (opts?.escalate) return { action: "send" }
  if (policy.draftMode) return { action: "draft", reason: "draft_mode" }
  if (policy.aiThreshold === null) return { action: "send" }
  if (!quality || "scoringFailed" in quality) return { action: "draft", reason: "scoring_failed" }
  if (quality.isClarifyingQuestion) return { action: "draft", reason: "clarifying_question" }
  if (quality.total < policy.aiThreshold) return { action: "draft", reason: "below_threshold" }
  return { action: "send" }
}
