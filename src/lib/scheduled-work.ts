import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Whether the work running now was started by the scheduler (a request that
 * carried the cron secret) rather than by someone waiting for its answer: a
 * user, a provider's webhook, an inbound e-mail. requireCronAuth marks the rest
 * of the request. Shared code reads the mark where scheduled work can wait and
 * interactive work should not; the social-monitoring fence keeps one of its
 * slots out of the scheduler's reach (`monitoring-import-fence.ts`).
 */
// One store per process even when the bundle copies this module into several
// route chunks (see rls-context.ts).
const globalForScheduledWork = globalThis as unknown as { __scheduledWorkStorage?: AsyncLocalStorage<true> }
const scheduledWorkStorage: AsyncLocalStorage<true> =
  (globalForScheduledWork.__scheduledWorkStorage ??= new AsyncLocalStorage<true>())

/** Marks the remainder of the current request as scheduled work. requireCronAuth only, like enterRlsBypass. */
export function enterScheduledWork(): void {
  scheduledWorkStorage.enterWith(true)
}

/** `work` as scheduled work, for scheduled code that does not come in as a cron request. */
export function runAsScheduledWork<T>(work: () => Promise<T>): Promise<T> {
  return scheduledWorkStorage.run(true, work)
}

export function isScheduledWork(): boolean {
  return scheduledWorkStorage.getStore() === true
}
