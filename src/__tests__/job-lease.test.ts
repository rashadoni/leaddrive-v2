import { describe, expect, it, vi } from "vitest"
import { withJobLease, type JobLeaseStore } from "@/lib/cron/job-lease"

function store(acquired = true): JobLeaseStore {
  return {
    acquire: vi.fn().mockResolvedValue(acquired),
    renew: vi.fn().mockResolvedValue(true),
    recordSkipped: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  }
}

describe("withJobLease", () => {
  it("runs and releases an acquired lease", async () => {
    const leaseStore = store()
    const job = vi.fn().mockResolvedValue({ processed: 2 })

    const result = await withJobLease(
      { name: "journeys-process", ttlMs: 5_000, heartbeatMs: 0 },
      job,
      leaseStore,
    )

    expect(result).toEqual({ status: "completed", value: { processed: 2 } })
    expect(job).toHaveBeenCalledOnce()
    expect(leaseStore.complete).toHaveBeenCalledWith(
      "journeys-process",
      expect.any(String),
      expect.any(Number),
    )
    expect(leaseStore.fail).not.toHaveBeenCalled()
  })

  it("skips when another worker owns the lease", async () => {
    const leaseStore = store(false)
    const job = vi.fn()

    const result = await withJobLease(
      { name: "social-poll-all", ttlMs: 5_000, heartbeatMs: 0 },
      job,
      leaseStore,
    )

    expect(result).toEqual({ status: "skipped", reason: "already_running" })
    expect(job).not.toHaveBeenCalled()
    expect(leaseStore.recordSkipped).toHaveBeenCalledWith("social-poll-all")
    expect(leaseStore.complete).not.toHaveBeenCalled()
  })

  it("releases the lease when the job throws", async () => {
    const leaseStore = store()

    await expect(
      withJobLease(
        { name: "finance-deadlines", ttlMs: 5_000, heartbeatMs: 0 },
        async () => {
          throw new Error("boom")
        },
        leaseStore,
      ),
    ).rejects.toThrow("boom")

    expect(leaseStore.fail).toHaveBeenCalledWith(
      "finance-deadlines",
      expect.any(String),
      expect.any(Number),
      "Error: boom",
    )
    expect(leaseStore.complete).not.toHaveBeenCalled()
  })
})
