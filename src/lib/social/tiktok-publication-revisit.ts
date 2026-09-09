export const TIKTOK_PUBLICATION_REVISIT_VERSION = "tiktok-publication-revisit-v1"
const DAY_MS = 86_400_000

export type TikTokPublicationRevisitState = {
  approvedAt: Date
  lastActivityAt: Date
  lastCheckedAt: Date | null
  status: "ACTIVE" | "INACTIVE"
  reactivationGeneration: number
}

export type TikTokPublicationRevisitPlan = {
  status: "ACTIVE" | "INACTIVE"
  cadenceDays: 1 | 3 | null
  nextDueAt: Date | null
  due: boolean
  reason: "FIRST_SEVEN_DAYS" | "ACTIVE_THREE_DAY_CADENCE" | "THIRTY_DAYS_QUIET" | "REACTIVATED"
  reactivationGeneration: number
}

export function planTikTokPublicationRevisit(input: {
  state: TikTokPublicationRevisitState
  now: Date
  reactivatedAt?: Date | null
}): TikTokPublicationRevisitPlan {
  const { state, now } = input
  for (const date of [state.approvedAt, state.lastActivityAt, state.lastCheckedAt, input.reactivatedAt]) {
    if (date && !Number.isFinite(date.getTime())) throw new Error("TikTok revisit dates must be valid")
  }
  const reactivated = Boolean(input.reactivatedAt
    && input.reactivatedAt.getTime() <= now.getTime()
    && (state.status === "INACTIVE" || input.reactivatedAt.getTime() > (state.lastCheckedAt?.getTime() ?? 0)))
  if (reactivated) {
    return {
      status: "ACTIVE", cadenceDays: 1, nextDueAt: now, due: true, reason: "REACTIVATED",
      reactivationGeneration: state.reactivationGeneration + 1,
    }
  }
  if (now.getTime() - state.lastActivityAt.getTime() >= 30 * DAY_MS) {
    return {
      status: "INACTIVE", cadenceDays: null, nextDueAt: null, due: false, reason: "THIRTY_DAYS_QUIET",
      reactivationGeneration: state.reactivationGeneration,
    }
  }
  const cadenceDays: 1 | 3 = now.getTime() - state.approvedAt.getTime() < 7 * DAY_MS ? 1 : 3
  const base = state.lastCheckedAt ?? state.approvedAt
  const nextDueAt = new Date(base.getTime() + cadenceDays * DAY_MS)
  return {
    status: "ACTIVE", cadenceDays, nextDueAt, due: now.getTime() >= nextDueAt.getTime(),
    reason: cadenceDays === 1 ? "FIRST_SEVEN_DAYS" : "ACTIVE_THREE_DAY_CADENCE",
    reactivationGeneration: state.reactivationGeneration,
  }
}
