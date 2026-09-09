/**
 * C12 frequency-cap-checker — slice-1 pure helper.
 *
 * Given a contact's recent delivery history + policy.frequencyCaps,
 * decide if another delivery (on a given candidate channel) is allowed.
 *
 * Two cap tiers checked:
 *   • Overall (cross-channel): max sends per day / per week across all
 *     channels.
 *   • Per-channel: per-channel max sends per day / per week.
 *
 * Both tiers are AND-ed — exceeding any cap blocks the delivery.
 *
 * Pure function: no DB.
 */

import {
  type Channel,
  type FrequencyCapConfig,
  type FrequencyCapCheckResult,
  type PerChannelFrequencyCap,
} from "./types"

export interface FrequencyCheckInput {
  /** All deliveries (any channel, any campaign) for this contact. */
  priorDeliveries: ReadonlyArray<{
    channel: Channel
    /** Only "attempted" deliveries count toward caps (skipped/deduped don't). */
    countTowardCaps: boolean
    decidedAt: Date
  }>
  asOf: Date
  config: FrequencyCapConfig
  /** The channel we're considering sending on now. */
  candidateChannel: Channel
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * Returns { allowed, reason?, capsHit[] }.
 *
 * Empty config or all-null limits → allowed.
 */
export function checkFrequencyCap(
  input: FrequencyCheckInput,
): FrequencyCapCheckResult {
  const { priorDeliveries, asOf, config, candidateChannel } = input
  const cutoffDay = new Date(asOf.getTime() - MS_PER_DAY)
  const cutoffWeek = new Date(asOf.getTime() - MS_PER_WEEK)

  // Filter to deliveries that COUNT (attempted) and within last week.
  // Within-day deliveries are a subset of within-week — single pass.
  let overallDay = 0
  let overallWeek = 0
  const perChannelDay = new Map<Channel, number>()
  const perChannelWeek = new Map<Channel, number>()

  for (const d of priorDeliveries) {
    if (!d.countTowardCaps) continue
    if (d.decidedAt.getTime() < cutoffWeek.getTime()) continue
    overallWeek += 1
    perChannelWeek.set(d.channel, (perChannelWeek.get(d.channel) ?? 0) + 1)
    if (d.decidedAt.getTime() >= cutoffDay.getTime()) {
      overallDay += 1
      perChannelDay.set(d.channel, (perChannelDay.get(d.channel) ?? 0) + 1)
    }
  }

  // Including the candidate (we're checking if "one more" is allowed).
  const capsHit: string[] = []

  // Overall.
  if (config.overall) {
    const o = config.overall
    if (
      o.maxPerDay !== undefined &&
      o.maxPerDay !== null &&
      overallDay + 1 > o.maxPerDay
    ) {
      capsHit.push(
        `overall:perDay ${overallDay + 1}/${o.maxPerDay}`,
      )
    }
    if (
      o.maxPerWeek !== undefined &&
      o.maxPerWeek !== null &&
      overallWeek + 1 > o.maxPerWeek
    ) {
      capsHit.push(
        `overall:perWeek ${overallWeek + 1}/${o.maxPerWeek}`,
      )
    }
  }

  // Per-channel — only the candidate channel matters.
  const perChannelCfg = findChannelCap(config.perChannel, candidateChannel)
  if (perChannelCfg) {
    const todayCount = perChannelDay.get(candidateChannel) ?? 0
    const weekCount = perChannelWeek.get(candidateChannel) ?? 0
    if (
      perChannelCfg.maxPerDay !== undefined &&
      perChannelCfg.maxPerDay !== null &&
      todayCount + 1 > perChannelCfg.maxPerDay
    ) {
      capsHit.push(
        `${candidateChannel}:perDay ${todayCount + 1}/${perChannelCfg.maxPerDay}`,
      )
    }
    if (
      perChannelCfg.maxPerWeek !== undefined &&
      perChannelCfg.maxPerWeek !== null &&
      weekCount + 1 > perChannelCfg.maxPerWeek
    ) {
      capsHit.push(
        `${candidateChannel}:perWeek ${weekCount + 1}/${perChannelCfg.maxPerWeek}`,
      )
    }
  }

  if (capsHit.length > 0) {
    return {
      allowed: false,
      reason: capsHit.join("; "),
      capsHit,
    }
  }
  return { allowed: true, capsHit: [] }
}

function findChannelCap(
  caps: PerChannelFrequencyCap[] | undefined,
  channel: Channel,
): PerChannelFrequencyCap | undefined {
  if (!caps) return undefined
  for (const cap of caps) {
    if (cap.channel === channel) return cap
  }
  return undefined
}
