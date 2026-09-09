export const SOCIAL_COMMENT_CHECKPOINT_VERSION = "social-comment-checkpoint-v1"

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type SocialCommentCheckpointState = {
  discoveredAt: Date
  lastActivityAt: Date
  lastSuccessfulAt: Date | null
  consecutiveNoChange: number
  status: "ACTIVE" | "INACTIVE"
}

export type SocialCommentCheckpointPlan = {
  status: "ACTIVE" | "INACTIVE"
  nextDueAt: Date | null
  cadenceHours: 1 | 6 | 24 | null
  reason: "FIRST_SCAN" | "YOUNG_POST" | "RECENT_POST" | "OLDER_POST" | "THIRTY_DAYS_QUIET"
}

export function planSocialCommentCheckpoint(input: {
  state: SocialCommentCheckpointState
  now: Date
}): SocialCommentCheckpointPlan {
  const { state, now } = input
  for (const date of [state.discoveredAt, state.lastActivityAt, state.lastSuccessfulAt]) {
    if (date && !Number.isFinite(date.getTime())) throw new Error("Comment checkpoint dates must be valid")
  }
  if (!Number.isInteger(state.consecutiveNoChange) || state.consecutiveNoChange < 0) {
    throw new Error("Comment checkpoint consecutiveNoChange must be a non-negative integer")
  }
  if (!state.lastSuccessfulAt) {
    return { status: "ACTIVE", nextDueAt: now, cadenceHours: 1, reason: "FIRST_SCAN" }
  }

  const ageMs = Math.max(0, now.getTime() - state.discoveredAt.getTime())
  const quietMs = Math.max(0, now.getTime() - state.lastActivityAt.getTime())
  if (ageMs >= 30 * DAY_MS && quietMs >= 30 * DAY_MS) {
    return { status: "INACTIVE", nextDueAt: null, cadenceHours: null, reason: "THIRTY_DAYS_QUIET" }
  }

  const cadenceHours: 1 | 6 | 24 = ageMs < DAY_MS ? 1 : ageMs < 7 * DAY_MS ? 6 : 24
  return {
    status: "ACTIVE",
    nextDueAt: new Date(state.lastSuccessfulAt.getTime() + cadenceHours * HOUR_MS),
    cadenceHours,
    reason: cadenceHours === 1 ? "YOUNG_POST" : cadenceHours === 6 ? "RECENT_POST" : "OLDER_POST",
  }
}
