/**
 * BullMQ queue registry. Lazy-initialised, single Queue per name, sharing
 * the same Redis connection (`src/lib/queue/connection.ts`).
 *
 * To add a queue:
 *   1. Add a key to `QueueName`.
 *   2. Add an entry to `QUEUE_CONFIG` with default JobsOptions.
 *   3. Register the handler in the worker entry (`src/lib/queue/worker.ts`).
 *
 * Part of Q4 BullMQ job queue.
 */
import { Queue, type JobsOptions } from "bullmq"
import { getRedisConnection } from "./connection"

export type QueueName =
  | "otp-cleanup"
  | "scheduled-reports"
  | "sla-escalation"
  | "lead-scoring"
  | "engagement-decay"
  | "ai-anomaly-detection"
  | "ai-auto-actions"
  | "ai-daily-briefing"
  | "ai-renewal"
  | "ab-test-winner"
  | "mtm-cleanup"
  | "mtm-import"
  | "purge-tenants"
  | "run-scheduled-actions"
  | "social-poll"

interface QueueDef {
  /** Default job options applied at enqueue (caller can override). */
  defaultJobOptions: JobsOptions
}

/**
 * Per-queue defaults — retry strategy and result retention. Tuned so that
 * a healthy queue keeps last 100 completions and 1000 failures for debugging.
 */
export const QUEUE_CONFIG: Record<QueueName, QueueDef> = {
  "otp-cleanup": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 500 },
    },
  },
  "scheduled-reports": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "sla-escalation": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "lead-scoring": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  },
  "engagement-decay": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 500 },
    },
  },
  "ai-anomaly-detection": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 120_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "ai-auto-actions": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "ai-daily-briefing": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 300_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 500 },
    },
  },
  "ai-renewal": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 120_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  },
  "ab-test-winner": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 500 },
    },
  },
  "mtm-cleanup": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 500 },
    },
  },
  "mtm-import": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "purge-tenants": {
    defaultJobOptions: {
      attempts: 1, // destructive — don't auto-retry
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "run-scheduled-actions": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    },
  },
  "social-poll": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 120_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 500 },
    },
  },
}

const queueInstances = new Map<QueueName, Queue>()

/**
 * Return a Queue handle, lazy-initialised. Returns null if Redis is
 * unreachable — callers should detect this and fall through to inline
 * execution during the migration window.
 */
export function getQueue(name: QueueName): Queue | null {
  if (queueInstances.has(name)) return queueInstances.get(name)!
  const connection = getRedisConnection()
  if (!connection) return null

  const cfg = QUEUE_CONFIG[name]
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: cfg.defaultJobOptions,
  })
  queueInstances.set(name, queue)
  return queue
}

/**
 * Test-only — clear registry. The `q.close()` rejection is intentionally
 * swallowed because tests typically shut down without a live Redis; in
 * production code, never silently swallow queue.close errors.
 */
export function _resetQueueRegistry(): void {
  for (const q of queueInstances.values()) {
    q.close().catch(() => {})
  }
  queueInstances.clear()
}

/** All queue names — for the worker entry's bulk-registration. */
export const ALL_QUEUE_NAMES: readonly QueueName[] = Object.keys(QUEUE_CONFIG) as QueueName[]
