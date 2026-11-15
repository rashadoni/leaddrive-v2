/**
 * Where a channel keeps when its training started: `learningStartedAt` in its ChannelConfig.settings,
 * set when «Обучение» is chosen in «Кто отвечает на каждом канале» (api/v1/settings/channel-reply).
 * Training reads LEARNING_BACKFILL_DAYS of history before it, so a channel shows what it learned on
 * the first day rather than a week later.
 */
export const LEARNING_STARTED_KEY = "learningStartedAt"

export function readLearningStart(settings: unknown): Date | null {
  const value = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[LEARNING_STARTED_KEY] : null
  if (typeof value !== "string") return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

export const LEARNING_RUN_KEY = "learningRun"

/** The training run's own stamp on the channel (lib/inbox/learning/run markRun). */
export function readLearningRun(settings: unknown): { at: Date; stopped: string | null } | null {
  const value = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[LEARNING_RUN_KEY] : null
  if (!value || typeof value !== "object") return null
  const run = value as Record<string, unknown>
  const at = typeof run.at === "string" ? new Date(run.at) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { at, stopped: typeof run.stopped === "string" ? run.stopped : null }
}
