/**
 * C12 channel-priority-resolver — slice-1 pure helper.
 *
 * Given a contact's channel preferences + policy default priority,
 * produce an ordered chain of channels to try. Per-contact priority
 * supersedes policy default; policy default fills gaps.
 *
 * Pure function: no DB.
 *
 * Resolution algorithm:
 *   1. Start with policy.channelPriority (the org default order).
 *   2. Filter to only channels the contact has NOT opted out of.
 *   3. Override ordering with per-contact channel.priority where set
 *      (lower number = earlier in chain).
 *   4. Append any opted-in channels not in policy.channelPriority at
 *      the end (newly-added channels never seen by policy).
 *
 * Tiebreaker for equal priorities: stable iteration order from
 * policy.channelPriority.
 */

import {
  CHANNELS,
  type Channel,
  type ChannelPreferenceInput,
  type ResolvedChannelChain,
} from "./types"

export interface ResolveInput {
  contactId: string
  preferences: ReadonlyArray<ChannelPreferenceInput>
  /** Policy default channel priority — index 0 = highest priority. */
  policyPriority: ReadonlyArray<Channel>
}

/**
 * Resolve the channel chain for a contact.
 *
 * Returns ResolvedChannelChain with ordered channels[] (opted-in only)
 * and a hasAnyOptIn boolean (false → orchestrator emits
 * outcome=no_channel_available).
 */
export function resolveChannelChain(
  input: ResolveInput,
): ResolvedChannelChain {
  // Build a quick lookup of contact preferences.
  const prefByChannel = new Map<Channel, ChannelPreferenceInput>()
  for (const pref of input.preferences) {
    if (!CHANNELS.includes(pref.channel)) continue
    prefByChannel.set(pref.channel, pref)
  }

  // Collect candidate channels: union of policyPriority + preferences.
  const candidates = new Set<Channel>()
  for (const c of input.policyPriority) {
    if (CHANNELS.includes(c)) candidates.add(c)
  }
  for (const pref of input.preferences) {
    if (CHANNELS.includes(pref.channel)) candidates.add(pref.channel)
  }

  // Filter out opted-out channels. If a channel has no preference row,
  // it's treated as opted-in by default (matches DB default).
  const optedIn: Channel[] = []
  for (const c of candidates) {
    const pref = prefByChannel.get(c)
    if (pref && !pref.isOptedIn) continue
    optedIn.push(c)
  }

  if (optedIn.length === 0) {
    return { contactId: input.contactId, channels: [], hasAnyOptIn: false }
  }

  // Sort: per-contact priority first (lower wins), then policy order.
  // Channels with NULL per-contact priority fall back to policy index.
  const policyIndex = new Map<Channel, number>()
  for (let i = 0; i < input.policyPriority.length; i++) {
    policyIndex.set(input.policyPriority[i], i)
  }

  const scored = optedIn.map((channel) => {
    const pref = prefByChannel.get(channel)
    const contactPri = pref?.priority ?? null
    const policyIdx = policyIndex.get(channel)
    // Effective sort key tuple: (hasContactPri, contactPri, policyIdx ?? big)
    // hasContactPri=0 (set) sorts before hasContactPri=1 (unset) so contact-
    // preferred channels lead.
    return {
      channel,
      hasContactPri: contactPri === null ? 1 : 0,
      contactPri: contactPri ?? Number.MAX_SAFE_INTEGER,
      policyIdx: policyIdx ?? Number.MAX_SAFE_INTEGER,
    }
  })

  scored.sort((a, b) => {
    if (a.hasContactPri !== b.hasContactPri) return a.hasContactPri - b.hasContactPri
    if (a.contactPri !== b.contactPri) return a.contactPri - b.contactPri
    return a.policyIdx - b.policyIdx
  })

  return {
    contactId: input.contactId,
    channels: scored.map((s) => s.channel),
    hasAnyOptIn: true,
  }
}

/**
 * Pure type guard.
 */
export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && CHANNELS.includes(value as Channel)
}
