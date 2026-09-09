/**
 * Media state machine — R11 slice 1.
 *
 * Four lifecycles (mirrors R2/R6/R7/R8 pattern):
 *   • Subscriber — trial → active → paused / churned / banned
 *   • Content    — draft → scheduled → published → unpublished / archived
 *   • Campaign   — draft → scheduled → running → paused / completed / cancelled
 *   • Placement  — pending → live → paused / completed / cancelled
 *
 * Pure synchronous.
 */
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TRANSITIONS,
  CONTENT_STATUSES,
  CONTENT_TRANSITIONS,
  PLACEMENT_STATUSES,
  PLACEMENT_TRANSITIONS,
  SUBSCRIBER_STATUSES,
  SUBSCRIBER_TRANSITIONS,
  type CampaignStatus,
  type ContentStatus,
  type PlacementStatus,
  type SubscriberStatus,
  type TransitionResult,
} from "./types"

function isSubscriberStatus(v: unknown): v is SubscriberStatus {
  return (
    typeof v === "string" &&
    (SUBSCRIBER_STATUSES as readonly string[]).includes(v)
  )
}

function isContentStatus(v: unknown): v is ContentStatus {
  return (
    typeof v === "string" &&
    (CONTENT_STATUSES as readonly string[]).includes(v)
  )
}

function isCampaignStatus(v: unknown): v is CampaignStatus {
  return (
    typeof v === "string" &&
    (CAMPAIGN_STATUSES as readonly string[]).includes(v)
  )
}

function isPlacementStatus(v: unknown): v is PlacementStatus {
  return (
    typeof v === "string" &&
    (PLACEMENT_STATUSES as readonly string[]).includes(v)
  )
}

/* ─── Subscriber lifecycle ───────────────────────────────────────────── */

export function transitionSubscriber(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isSubscriberStatus(from))
    return { ok: false, error: `unknown subscriber status "${String(from)}"` }
  if (!isSubscriberStatus(to))
    return {
      ok: false,
      error: `unknown subscriber target status "${String(to)}"`,
    }
  if (from === to)
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  if (!SUBSCRIBER_TRANSITIONS[from].includes(to))
    return { ok: false, error: `illegal subscriber transition: ${from} → ${to}` }
  return { ok: true }
}

export function isSubscriberTerminal(status: SubscriberStatus): boolean {
  return SUBSCRIBER_TRANSITIONS[status].length === 0
}

export function allowedNextSubscriber(
  from: SubscriberStatus
): readonly SubscriberStatus[] {
  return SUBSCRIBER_TRANSITIONS[from]
}

/* ─── Content lifecycle ──────────────────────────────────────────────── */

export function transitionContent(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isContentStatus(from))
    return { ok: false, error: `unknown content status "${String(from)}"` }
  if (!isContentStatus(to))
    return {
      ok: false,
      error: `unknown content target status "${String(to)}"`,
    }
  if (from === to)
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  if (!CONTENT_TRANSITIONS[from].includes(to))
    return { ok: false, error: `illegal content transition: ${from} → ${to}` }
  return { ok: true }
}

export function isContentTerminal(status: ContentStatus): boolean {
  return CONTENT_TRANSITIONS[status].length === 0
}

export function allowedNextContent(
  from: ContentStatus
): readonly ContentStatus[] {
  return CONTENT_TRANSITIONS[from]
}

/* ─── Campaign lifecycle ─────────────────────────────────────────────── */

export function transitionCampaign(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isCampaignStatus(from))
    return { ok: false, error: `unknown campaign status "${String(from)}"` }
  if (!isCampaignStatus(to))
    return {
      ok: false,
      error: `unknown campaign target status "${String(to)}"`,
    }
  if (from === to)
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  if (!CAMPAIGN_TRANSITIONS[from].includes(to))
    return { ok: false, error: `illegal campaign transition: ${from} → ${to}` }
  return { ok: true }
}

export function isCampaignTerminal(status: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[status].length === 0
}

export function allowedNextCampaign(
  from: CampaignStatus
): readonly CampaignStatus[] {
  return CAMPAIGN_TRANSITIONS[from]
}

/* ─── Placement lifecycle ────────────────────────────────────────────── */

export function transitionPlacement(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isPlacementStatus(from))
    return { ok: false, error: `unknown placement status "${String(from)}"` }
  if (!isPlacementStatus(to))
    return {
      ok: false,
      error: `unknown placement target status "${String(to)}"`,
    }
  if (from === to)
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  if (!PLACEMENT_TRANSITIONS[from].includes(to))
    return { ok: false, error: `illegal placement transition: ${from} → ${to}` }
  return { ok: true }
}

export function isPlacementTerminal(status: PlacementStatus): boolean {
  return PLACEMENT_TRANSITIONS[status].length === 0
}

export function allowedNextPlacement(
  from: PlacementStatus
): readonly PlacementStatus[] {
  return PLACEMENT_TRANSITIONS[from]
}
