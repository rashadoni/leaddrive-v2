import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"

export interface JobLeaseStore {
  acquire(name: string, ownerToken: string, ttlMs: number): Promise<boolean>
  renew(name: string, ownerToken: string, ttlMs: number): Promise<boolean>
  recordSkipped(name: string): Promise<void>
  complete(name: string, ownerToken: string, durationMs: number): Promise<boolean>
  fail(name: string, ownerToken: string, durationMs: number, error: string): Promise<boolean>
}

type LeaseRow = { ownerToken: string }

export const prismaJobLeaseStore: JobLeaseStore = {
  async acquire(name, ownerToken, ttlMs) {
    const rows = (await prisma.$queryRaw`
      INSERT INTO "system_job_leases" (
        "name", "ownerToken", "leaseUntil", "status", "lastStartedAt",
        "claimedCount", "completedCount", "skippedCount", "failedCount", "updatedAt"
      )
      VALUES (
        ${name}, ${ownerToken}, CURRENT_TIMESTAMP + (${ttlMs} * INTERVAL '1 millisecond'),
        'running', CURRENT_TIMESTAMP, 1, 0, 0, 0, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("name") DO UPDATE
      SET "ownerToken" = EXCLUDED."ownerToken",
          "leaseUntil" = EXCLUDED."leaseUntil",
          "status" = 'running',
          "lastStartedAt" = CURRENT_TIMESTAMP,
          "lastError" = NULL,
          "claimedCount" = "system_job_leases"."claimedCount" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "system_job_leases"."leaseUntil" IS NULL
         OR "system_job_leases"."leaseUntil" <= CURRENT_TIMESTAMP
      RETURNING "ownerToken"
    `) as LeaseRow[]
    return rows.some((row) => row.ownerToken === ownerToken)
  },

  async renew(name, ownerToken, ttlMs) {
    const changed = await prisma.$executeRaw`
      UPDATE "system_job_leases"
      SET "leaseUntil" = CURRENT_TIMESTAMP + (${ttlMs} * INTERVAL '1 millisecond'),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "name" = ${name} AND "ownerToken" = ${ownerToken}
    `
    return changed === 1
  },

  async recordSkipped(name) {
    await prisma.$executeRaw`
      UPDATE "system_job_leases"
      SET "lastSkippedAt" = CURRENT_TIMESTAMP,
          "skippedCount" = "skippedCount" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "name" = ${name}
    `
  },

  async complete(name, ownerToken, durationMs) {
    const changed = await prisma.$executeRaw`
      UPDATE "system_job_leases"
      SET "ownerToken" = NULL,
          "leaseUntil" = NULL,
          "status" = 'completed',
          "lastCompletedAt" = CURRENT_TIMESTAMP,
          "lastDurationMs" = ${durationMs},
          "lastError" = NULL,
          "completedCount" = "completedCount" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "name" = ${name} AND "ownerToken" = ${ownerToken}
    `
    return changed === 1
  },

  async fail(name, ownerToken, durationMs, error) {
    const changed = await prisma.$executeRaw`
      UPDATE "system_job_leases"
      SET "ownerToken" = NULL,
          "leaseUntil" = NULL,
          "status" = 'failed',
          "lastFailedAt" = CURRENT_TIMESTAMP,
          "lastDurationMs" = ${durationMs},
          "lastError" = ${error},
          "failedCount" = "failedCount" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "name" = ${name} AND "ownerToken" = ${ownerToken}
    `
    return changed === 1
  },
}

export type JobLeaseResult<T> =
  | { status: "completed"; value: T }
  | { status: "skipped"; reason: "already_running" }

interface JobLeaseOptions {
  name: string
  ttlMs: number
  /** Set to 0 only in deterministic tests. Defaults to one third of ttlMs. */
  heartbeatMs?: number
}

/**
 * Run a scheduled job under a DB-backed, expiring singleton lease.
 *
 * The owner-token compare-and-set rules make stale workers unable to renew or
 * release a lease acquired by a newer worker. A heartbeat keeps long-running
 * jobs protected; after a process crash the lease expires and a later tick can
 * recover without operator intervention.
 */
export async function withJobLease<T>(
  options: JobLeaseOptions,
  job: () => Promise<T>,
  store: JobLeaseStore = prismaJobLeaseStore,
): Promise<JobLeaseResult<T>> {
  const { name, ttlMs } = options
  if (!name || ttlMs < 3_000) throw new Error("job lease requires a name and ttlMs >= 3000")

  const ownerToken = randomUUID()
  const acquired = await store.acquire(name, ownerToken, ttlMs)
  if (!acquired) {
    await store.recordSkipped(name).catch((error) => {
      console.error(`[Cron Lease] Failed to record skipped ${name}:`, error)
    })
    return { status: "skipped", reason: "already_running" }
  }

  const startedAt = Date.now()

  const heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(ttlMs / 3))
  let heartbeat: ReturnType<typeof setInterval> | undefined
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      void store
        .renew(name, ownerToken, ttlMs)
        .then((renewed) => {
          if (!renewed) console.error(`[Cron Lease] Lost ownership of ${name}`)
        })
        .catch((error) => console.error(`[Cron Lease] Failed to renew ${name}:`, error))
    }, heartbeatMs)
    heartbeat.unref?.()
  }

  try {
    const value = await job()
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    const completed = await store.complete(name, ownerToken, Date.now() - startedAt).catch((error) => {
      console.error(`[Cron Lease] Failed to record completed ${name}:`, error)
      return false
    })
    if (!completed) console.error(`[Cron Lease] Lost ownership before completing ${name}`)
    return { status: "completed", value }
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    const failed = await store
      .fail(name, ownerToken, Date.now() - startedAt, message.slice(0, 2_000))
      .catch((recordError) => {
        console.error(`[Cron Lease] Failed to record failed ${name}:`, recordError)
        return false
      })
    if (!failed) console.error(`[Cron Lease] Lost ownership before failing ${name}`)
    throw error
  }
}
