/**
 * BullMQ worker process bootstrap. Spawns one Worker per registered queue,
 * dispatches jobs to handlers, gracefully shuts down on SIGTERM/SIGINT.
 *
 * NOTE — slice 1 deferral: the standalone PM2 worker app, `scripts/worker.mjs`
 * entry, and `outputFileTracingIncludes` mapping for `.next/standalone/`
 * bundling all land in Q4 slice 2 together with Redis provisioning on prod.
 * Slice 1 ships only the foundation primitives so the HTTP cron routes can
 * delegate to the same extracted handlers (e.g. `runOtpCleanup`) without
 * code duplication. Workers themselves are dormant until slice 2.
 *
 * Adding a new job handler:
 *   1. Add a queue to `src/lib/queue/queues.ts` (`QueueName` + `QUEUE_CONFIG`)
 *   2. Implement a handler in `src/lib/queue/jobs/<name>.ts`
 *   3. Register it below in `JOB_HANDLERS`
 *
 * Part of Q4 BullMQ job queue.
 */
import { Worker, type Job } from "bullmq"
import { prisma } from "@/lib/prisma"
import { getRedisConnection } from "./connection"
import { ALL_QUEUE_NAMES, type QueueName } from "./queues"
import { runOtpCleanup } from "./jobs/otp-cleanup"
import { runMtmImport } from "./jobs/mtm-import"

type JobHandler = (job: Job) => Promise<unknown>

/**
 * Map queue name → handler. Queues without a handler here will still
 * receive jobs (enqueue is independent), but those jobs will sit stalled
 * until a handler is registered. Slice 1 only wires `otp-cleanup`; the
 * remaining 13 queues land in slice 2/3.
 */
export const JOB_HANDLERS: Partial<Record<QueueName, JobHandler>> = {
  "otp-cleanup": async () => runOtpCleanup(prisma),
  "mtm-import": runMtmImport,
  // TODO slice 2: scheduled-reports, sla-escalation, lead-scoring, engagement-decay
  // TODO slice 3: ai-anomaly-detection, ai-auto-actions, ai-daily-briefing, ai-renewal,
  //               ab-test-winner, mtm-cleanup, purge-tenants, run-scheduled-actions, social-poll
}

const activeWorkers: Worker[] = []

/**
 * Start a Worker for every queue that has a handler registered. Returns
 * the list of created Workers (mostly for tests / graceful shutdown).
 */
export function startWorkers(): Worker[] {
  const connection = getRedisConnection()
  if (!connection) {
    console.error("[worker] REDIS_URL unavailable — refusing to start workers")
    return []
  }

  for (const name of ALL_QUEUE_NAMES) {
    const handler = JOB_HANDLERS[name]
    if (!handler) continue
    const worker = new Worker(name, handler, { connection, concurrency: 1 })
    worker.on("completed", (job) => {
      console.log(`[worker:${name}] job ${job.id} completed`)
    })
    worker.on("failed", (job, err) => {
      console.error(`[worker:${name}] job ${job?.id} failed:`, err.message)
    })
    activeWorkers.push(worker)
    console.log(`[worker:${name}] started`)
  }
  return activeWorkers
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(activeWorkers.map(w => w.close()))
  activeWorkers.length = 0
}

/**
 * Install SIGTERM/SIGINT handlers for graceful shutdown. Idempotent.
 */
let signalsInstalled = false
export function installSignalHandlers(): void {
  if (signalsInstalled) return
  signalsInstalled = true
  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received — closing workers`)
    await stopWorkers()
    process.exit(0)
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}
