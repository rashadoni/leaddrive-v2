/**
 * Campaign + Delivery state machines — C2 slice 1.
 *
 * Application-layer transition guards. DB CHECKs enforce enum
 * membership; helper enforces transition allow-list.
 *
 * Pure synchronous.
 */
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TRANSITIONS,
  DELIVERY_STATUSES,
  DELIVERY_TRANSITIONS,
  type CampaignStatus,
  type DeliveryStatus,
  type TransitionResult,
} from "./types"

export function isCampaignStatus(s: unknown): s is CampaignStatus {
  return typeof s === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(s)
}

export function isDeliveryStatus(s: unknown): s is DeliveryStatus {
  return typeof s === "string" && (DELIVERY_STATUSES as readonly string[]).includes(s)
}

function check<T extends string>(
  from: T,
  to: T,
  table: Readonly<Record<T, readonly T[]>>,
  kind: string
): TransitionResult {
  if (from === to) {
    return { ok: false, error: `${kind}: cannot transition from "${from}" to itself` }
  }
  const allowed = table[from]
  if (!allowed) {
    return { ok: false, error: `${kind}: unknown from-status "${String(from)}"` }
  }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `${kind}: "${from}" is a terminal status — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canCampaignTransition(
  from: CampaignStatus,
  to: CampaignStatus
): TransitionResult {
  if (!isCampaignStatus(from)) {
    return { ok: false, error: `campaign: from "${String(from)}" is not a known status` }
  }
  if (!isCampaignStatus(to)) {
    return { ok: false, error: `campaign: to "${String(to)}" is not a known status` }
  }
  return check(from, to, CAMPAIGN_TRANSITIONS, "campaign")
}

export function canDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus
): TransitionResult {
  if (!isDeliveryStatus(from)) {
    return { ok: false, error: `delivery: from "${String(from)}" is not a known status` }
  }
  if (!isDeliveryStatus(to)) {
    return { ok: false, error: `delivery: to "${String(to)}" is not a known status` }
  }
  return check(from, to, DELIVERY_TRANSITIONS, "delivery")
}

export function campaignAllowedNext(s: CampaignStatus): readonly CampaignStatus[] {
  return CAMPAIGN_TRANSITIONS[s] ?? []
}
export function deliveryAllowedNext(s: DeliveryStatus): readonly DeliveryStatus[] {
  return DELIVERY_TRANSITIONS[s] ?? []
}

export function isCampaignTerminal(s: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[s].length === 0
}
export function isDeliveryTerminal(s: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[s].length === 0
}
