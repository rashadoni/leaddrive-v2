/**
 * Member diff calculator — G5 slice 1.
 *
 * Given previous + current membership sets, returns added/removed/
 * unchanged member-id arrays. Slice-2 worker reads this diff to:
 *   • Push ADDs to external audience (FB Custom Audience add-members)
 *   • Push REMOVEs (FB Custom Audience remove-members)
 *   • Skip dispatch entirely if diff is empty (idempotent re-run)
 *
 * Defensive max-members cap defends slice-2 dispatcher against
 * accidental tenant-wide bombing (e.g. tenant with 1M contacts +
 * misconfigured segment matching everyone). Default 100K — slice-2
 * may parameterise per tenant.
 *
 * Pure synchronous. O(n+m) using Set lookups.
 */
import {
  DEFAULT_MAX_MEMBERS_PER_RUN,
  type DiffMembersInput,
  type DiffMembersResult,
  type MemberDiff,
} from "./types"

export function diffMembers(input: DiffMembersInput): DiffMembersResult {
  if (!Array.isArray(input.previousMembers)) {
    return { ok: false, error: "previousMembers must be an array" }
  }
  if (!Array.isArray(input.currentMembers)) {
    return { ok: false, error: "currentMembers must be an array" }
  }

  const maxMembers = input.maxMembers ?? DEFAULT_MAX_MEMBERS_PER_RUN
  if (typeof maxMembers !== "number" || !Number.isInteger(maxMembers) || maxMembers <= 0) {
    return { ok: false, error: "maxMembers must be a positive integer" }
  }

  if (input.currentMembers.length > maxMembers) {
    return {
      ok: false,
      error: `currentMembers count ${input.currentMembers.length} exceeds maxMembers ${maxMembers}`,
    }
  }
  if (input.previousMembers.length > maxMembers) {
    return {
      ok: false,
      error: `previousMembers count ${input.previousMembers.length} exceeds maxMembers ${maxMembers}`,
    }
  }

  // Validate elements are non-empty strings — defensive against caller bugs.
  for (let i = 0; i < input.currentMembers.length; i++) {
    const m = input.currentMembers[i]
    if (typeof m !== "string" || m.length === 0) {
      return {
        ok: false,
        error: `currentMembers[${i}] must be a non-empty string`,
      }
    }
  }
  for (let i = 0; i < input.previousMembers.length; i++) {
    const m = input.previousMembers[i]
    if (typeof m !== "string" || m.length === 0) {
      return {
        ok: false,
        error: `previousMembers[${i}] must be a non-empty string`,
      }
    }
  }

  const prevSet = new Set(input.previousMembers)
  const currentSet = new Set(input.currentMembers)

  const added: string[] = []
  const unchanged: string[] = []
  for (const m of currentSet) {
    if (prevSet.has(m)) unchanged.push(m)
    else added.push(m)
  }

  const removed: string[] = []
  for (const m of prevSet) {
    if (!currentSet.has(m)) removed.push(m)
  }

  // Sort for determinism — slice-2 caller may snapshot the diff +
  // re-run analytics later; deterministic output simplifies golden-
  // file testing.
  added.sort()
  removed.sort()
  unchanged.sort()

  const diff: MemberDiff = {
    added,
    removed,
    unchanged,
    currentCount: currentSet.size,
  }
  return { ok: true, diff }
}
