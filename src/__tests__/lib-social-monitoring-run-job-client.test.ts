import { describe, expect, it } from "vitest"
import {
  socialMonitoringRunJobCanResume,
  socialMonitoringRunJobIsActive,
  socialMonitoringRunJobItemIsExecuting,
  socialMonitoringRunJobProfileCounts,
  socialMonitoringRunJobProfileQueueState,
  type SocialMonitoringRunJob,
} from "@/lib/social/monitoring-run-job-client"

function job(
  overrides: Partial<SocialMonitoringRunJob> = {},
): SocialMonitoringRunJob {
  return {
    id: "job-1",
    kind: "PROFILE_FULL",
    sourceScope: null,
    status: "RUNNING",
    totalItems: 3,
    processedItems: 1,
    foundCount: 4,
    newCount: 2,
    currentItem: { profileName: "Beta", sourceLabel: "Beta TikTok" },
    items: [
      {
        id: "item-1",
        position: 0,
        subjectId: "subject-alpha",
        profileName: "Alpha",
        sourceId: "source-alpha",
        sourceLabel: "Alpha Facebook",
        sourcePlatform: "facebook",
        status: "SUCCEEDED",
        foundCount: 2,
        newCount: 1,
        error: null,
      },
      {
        id: "item-2",
        position: 1,
        subjectId: "subject-beta",
        profileName: "Beta",
        sourceId: "source-beta-tiktok",
        sourceLabel: "Beta TikTok",
        sourcePlatform: "tiktok",
        status: "WAITING_PROVIDER",
        foundCount: 2,
        newCount: 1,
        error: null,
      },
      {
        id: "item-3",
        position: 2,
        subjectId: "subject-beta",
        profileName: "Beta",
        sourceId: "source-beta-web",
        sourceLabel: "Beta WEB",
        sourcePlatform: "web",
        status: "QUEUED",
        foundCount: 0,
        newCount: 0,
        error: null,
      },
    ],
    createdAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:01.000Z",
    finishedAt: null,
    ...overrides,
  }
}

describe("social monitoring run-job client mapping", () => {
  it("treats every durable in-flight job state as active", () => {
    for (const status of ["QUEUED", "RUNNING", "WAITING_PROVIDER", "CANCEL_REQUESTED"] as const) {
      expect(socialMonitoringRunJobIsActive(job({ status }))).toBe(true)
    }
    expect(socialMonitoringRunJobIsActive(job({ status: "COMPLETED" }))).toBe(false)
    expect(socialMonitoringRunJobItemIsExecuting(job().items[1])).toBe(true)
    expect(socialMonitoringRunJobItemIsExecuting(job().items[2])).toBe(false)
  })

  it("aggregates source items into profile-card states and progress", () => {
    const running = job()
    expect(socialMonitoringRunJobProfileQueueState(running, {
      subjectId: "subject-alpha",
      name: "Alpha",
    })).toBe("completed")
    expect(socialMonitoringRunJobProfileQueueState(running, {
      subjectId: "subject-beta",
      name: "Beta",
    })).toBe("running")
    expect(socialMonitoringRunJobProfileCounts(running)).toEqual({ total: 2, processed: 1 })
  })

  it("shows partial and timed-out terminal items as issues and allows failed jobs to resume", () => {
    const failed = job({
      status: "FAILED",
      currentItem: null,
      items: job().items.map((item, index) => ({
        ...item,
        status: index === 0 ? "PARTIAL" : "TIMED_OUT",
      })),
    })
    expect(socialMonitoringRunJobProfileQueueState(failed, {
      subjectId: "subject-beta",
      name: "Beta",
    })).toBe("issue")
    expect(socialMonitoringRunJobCanResume(failed)).toBe(true)
    expect(socialMonitoringRunJobCanResume(job({ status: "COMPLETED_WITH_ISSUES" }))).toBe(false)

    const canceled = job({ status: "CANCELED" })
    expect(socialMonitoringRunJobProfileQueueState(canceled, {
      subjectId: "subject-beta",
      name: "Beta",
    })).toBe("issue")
  })
})
