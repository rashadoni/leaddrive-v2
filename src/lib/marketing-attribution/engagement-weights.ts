/**
 * C9 #12 — touchpoint engagement weighting + de-dup policy.
 *
 * The positional models (first/last/linear/time_decay/u_shaped) weight a deal's
 * touchpoints purely by ORDER, so a campaign that merely generated many recorded
 * events (e.g. one email logged as sent + opened + clicked + re-opened) would
 * out-credit a campaign with a single high-intent touch, purely on count. This
 * module corrects that in two pure steps the worker applies around the
 * positional evaluation:
 *
 *   1. dedupeTouchpoints — collapse repeats of the SAME (campaign, type) within
 *      a deal to a single representative (latest occurrence), so re-recorded
 *      events of one engagement don't inflate a campaign. Distinct engagement
 *      types of the same campaign (opened vs clicked) are kept — they're genuine
 *      multi-touch signal. Untyped touchpoints are never collapsed.
 *   2. applyEngagementWeighting — scale each touchpoint's positional weight by
 *      its engagement strength (a click counts more than a passive open more
 *      than a bare send), then renormalize so the set still sums to 1.0.
 *
 * Pure functions — no DB, no clock.
 */

import type { TouchpointForAttribution, TouchpointWeight } from "./types"

/**
 * Relative engagement strength per touchpoint type (higher = stronger intent).
 * Live writers today emit: deal_campaign_link, email_clicked, email_opened,
 * event_registered (+ email_sent / sms_sent on the send path). The rest
 * (event_attended, form_submitted, ad_click, sms_clicked) are FORWARD-DECLARED —
 * their recorders land with #15/#16 (forms, ad/SMS) and attended-event; until
 * then they simply never appear, so the map is harmlessly ahead of the writers.
 */
export const ENGAGEMENT_WEIGHTS: Readonly<Record<string, number>> = {
  deal_campaign_link: 1.0, // explicit deal↔campaign link — strongest signal
  event_attended: 1.0,
  email_clicked: 1.0,
  form_submitted: 0.9,
  event_registered: 0.8,
  email_opened: 0.5,
  email_sent: 0.2, // delivery only, no engagement
  ad_click: 1.0,
  sms_clicked: 1.0,
  sms_sent: 0.2,
}

/** Engagement strength for an unknown / absent type — neutral middle. */
export const DEFAULT_ENGAGEMENT_WEIGHT = 0.5

export function engagementWeight(type?: string): number {
  if (!type) return DEFAULT_ENGAGEMENT_WEIGHT
  return ENGAGEMENT_WEIGHTS[type] ?? DEFAULT_ENGAGEMENT_WEIGHT
}

/**
 * Collapse repeats of the same (campaignId, touchpointType) to a single
 * representative — the LATEST occurrence (so time_decay sees the most recent
 * engagement). Touchpoints WITHOUT a type are left untouched (each kept): with
 * no type we can't tell a genuine repeat from a distinct event, and collapsing
 * them would wrongly flatten legacy/untyped multi-touch. Returns a fresh array
 * sorted by occurredAt ascending.
 */
export function dedupeTouchpoints(
  touchpoints: ReadonlyArray<TouchpointForAttribution>,
): TouchpointForAttribution[] {
  const keep = new Map<string, TouchpointForAttribution>()
  const untyped: TouchpointForAttribution[] = []
  for (const tp of touchpoints) {
    if (!tp.touchpointType) {
      untyped.push(tp)
      continue
    }
    const key = `${tp.campaignId} ${tp.touchpointType}`
    const existing = keep.get(key)
    // Strict `>` → on equal occurredAt the first-seen representative wins. Benign:
    // same campaign + same type, so any representative carries identical credit.
    if (!existing || tp.occurredAt.getTime() > existing.occurredAt.getTime()) {
      keep.set(key, tp)
    }
  }
  return [...keep.values(), ...untyped].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )
}

/**
 * Scale each per-touchpoint positional weight by its engagement strength, then
 * renormalize so the result sums to 1.0 (preserving the allocator's contract).
 * `typeById` maps touchpointId → its type. Degenerate input (all-zero scaled
 * weights) is returned unchanged.
 */
export function applyEngagementWeighting(
  weights: ReadonlyArray<TouchpointWeight>,
  typeById: ReadonlyMap<string, string | undefined>,
): TouchpointWeight[] {
  const scaled = weights.map(
    (w) => w.weight * engagementWeight(typeById.get(w.touchpointId)),
  )
  const total = scaled.reduce((s, x) => s + x, 0)
  if (!(total > 0) || !Number.isFinite(total)) {
    return weights.map((w) => ({ ...w }))
  }
  return weights.map((w, i) => ({
    touchpointId: w.touchpointId,
    campaignId: w.campaignId,
    weight: scaled[i] / total,
  }))
}
