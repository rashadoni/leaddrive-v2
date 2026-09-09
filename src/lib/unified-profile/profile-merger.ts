/**
 * Profile merger — G1 Phase 6 Block B slice 1.
 *
 * Given a candidate source record (already normalized via
 * identity-keys.ts) + a list of existing UnifiedProfile rows in the
 * same tenant, decide:
 *
 *   merge_into  — exact-match on email OR phone; merge candidate
 *                 into the matched profile
 *   create_new  — no existing profile matches; mint a new one
 *   ambiguous   — email matches profile A AND phone matches profile B
 *                 (different profiles) — slice-1 returns this discriminant;
 *                 slice-2 admin queue routes to operator review
 *   reject      — candidate has no matchable identity (no email/phone)
 *
 * Pure synchronous. Caller (slice-2 merge route / cron) pre-fetches
 * the existing profiles with at least one identity key matching the
 * candidate, OR passes the full tenant set for slice-1 testability.
 *
 * Match precedence:
 *   1. Email-exact match wins (when the candidate has an email)
 *   2. Phone-exact match (when email doesn't match anything)
 *   3. Email + Phone matching DIFFERENT existing profiles → ambiguous
 */
import type {
  ExistingProfileRow,
  MergeDecision,
  MergeInput,
} from "./types"

export function decideMerge(input: MergeInput): MergeDecision {
  const { candidate, existing } = input

  if (!candidate.identity.hasMatchableKey) {
    return {
      action: "reject",
      reason: `Source ${candidate.sourceType}/${candidate.sourceId} has no email and no phone — cannot be merged into a UnifiedProfile`,
    }
  }

  const candEmail = candidate.identity.emailNormalized
  const candPhone = candidate.identity.phoneNormalized

  let emailMatch: ExistingProfileRow | null = null
  let phoneMatch: ExistingProfileRow | null = null

  for (const row of existing) {
    if (candEmail !== null && row.emailNormalized === candEmail) {
      // Multiple existing profiles with the same email shouldn't
      // happen (partial UNIQUE on (org, email) at DB), but if it
      // does, first-found wins deterministically.
      if (emailMatch === null) emailMatch = row
    }
    if (candPhone !== null && row.phoneNormalized === candPhone) {
      if (phoneMatch === null) phoneMatch = row
    }
  }

  // Both keys present and they match the SAME profile — clean merge.
  if (emailMatch && phoneMatch && emailMatch.id === phoneMatch.id) {
    return {
      action: "merge_into",
      targetProfileId: emailMatch.id,
      reason: `Email + phone both match profile ${emailMatch.id}`,
    }
  }

  // Email matches one profile, phone matches a different profile.
  // Slice-1 doesn't auto-resolve; surfaces ambiguity to the operator.
  if (emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id) {
    return {
      action: "ambiguous",
      candidateProfileIds: [emailMatch.id, phoneMatch.id],
      reason: `Email matches profile ${emailMatch.id}, phone matches profile ${phoneMatch.id} — needs operator review or G2 fuzzy resolution`,
    }
  }

  // Only one match (the other key is either absent on candidate or
  // doesn't match any existing profile).
  if (emailMatch) {
    return {
      action: "merge_into",
      targetProfileId: emailMatch.id,
      reason: `Email exact match → profile ${emailMatch.id}`,
    }
  }
  if (phoneMatch) {
    return {
      action: "merge_into",
      targetProfileId: phoneMatch.id,
      reason: `Phone exact match → profile ${phoneMatch.id}`,
    }
  }

  // No existing profile matches — mint a new one.
  return {
    action: "create_new",
    reason: "No existing profile matches the candidate's identity keys",
  }
}
