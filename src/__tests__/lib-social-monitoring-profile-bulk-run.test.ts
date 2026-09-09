import { describe, expect, it, vi } from "vitest"
import {
  createMonitoringProfileBulkPlan,
  runMonitoringProfileBulkPlan,
} from "@/lib/social/monitoring-profile-bulk-run"

describe("createMonitoringProfileBulkPlan", () => {
  it("keeps shared sources scoped per profile and excludes unrunnable profiles", () => {
    const plan = createMonitoringProfileBulkPlan([
      {
        id: "profile-1",
        subjectId: "subject-1",
        scenarioId: "scenario-1",
        status: "active",
        sources: [
          { id: "shared", isActive: true, paid: true, sharedAcrossMonitorings: true },
          { id: "shared", isActive: true, paid: true, sharedAcrossMonitorings: true },
        ],
      },
      {
        id: "profile-2",
        subjectId: "subject-2",
        scenarioId: "scenario-2",
        status: "active",
        sources: [
          { id: "shared", isActive: true, paid: true, sharedAcrossMonitorings: true },
        ],
      },
      {
        id: "paused",
        subjectId: "subject-3",
        scenarioId: "scenario-3",
        status: "paused",
        sources: [{ id: "source-3", isActive: true }],
      },
    ])

    expect(plan).toMatchObject({
      totalProfiles: 2,
      totalSources: 2,
      paidSources: 2,
      sharedSources: 2,
    })
    expect(plan.items.map(item => item.profileId)).toEqual(["profile-1", "profile-2"])
  })
})

describe("runMonitoringProfileBulkPlan", () => {
  it("runs profiles strictly in sequence and reports completion", async () => {
    const order: string[] = []
    const result = await runMonitoringProfileBulkPlan({
      items: [
        { profileId: "one", sourceCount: 1, paidSourceCount: 0, sharedSourceCount: 0 },
        { profileId: "two", sourceCount: 2, paidSourceCount: 0, sharedSourceCount: 0 },
      ],
      runProfile: async item => {
        order.push(`start:${item.profileId}`)
        await Promise.resolve()
        order.push(`finish:${item.profileId}`)
        return "completed"
      },
    })

    expect(order).toEqual(["start:one", "finish:one", "start:two", "finish:two"])
    expect(result).toMatchObject({
      phase: "completed",
      processedProfiles: 2,
      outcomes: { one: "completed", two: "completed" },
    })
  })

  it("halts before the next profile when provider completion is unresolved", async () => {
    const runProfile = vi.fn()
      .mockResolvedValueOnce("completed_with_pending")
      .mockResolvedValueOnce("completed")

    const result = await runMonitoringProfileBulkPlan({
      items: [
        { profileId: "one", sourceCount: 1, paidSourceCount: 1, sharedSourceCount: 0 },
        { profileId: "two", sourceCount: 1, paidSourceCount: 1, sharedSourceCount: 0 },
      ],
      runProfile,
    })

    expect(runProfile).toHaveBeenCalledTimes(1)
    expect(result.phase).toBe("stopped")
    expect(result.processedProfiles).toBe(1)
  })

  it("records an ordinary failure and continues with the remaining profile", async () => {
    const runProfile = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("completed")

    const result = await runMonitoringProfileBulkPlan({
      items: [
        { profileId: "one", sourceCount: 1, paidSourceCount: 0, sharedSourceCount: 0 },
        { profileId: "two", sourceCount: 1, paidSourceCount: 0, sharedSourceCount: 0 },
      ],
      runProfile,
    })

    expect(runProfile).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      phase: "completed_with_issues",
      outcomes: { one: "failed_to_start", two: "completed" },
    })
  })

  it("honors a cooperative stop before dispatching another profile", async () => {
    let stop = false
    const runProfile = vi.fn(async () => {
      stop = true
      return "completed" as const
    })

    const result = await runMonitoringProfileBulkPlan({
      items: [
        { profileId: "one", sourceCount: 1, paidSourceCount: 0, sharedSourceCount: 0 },
        { profileId: "two", sourceCount: 1, paidSourceCount: 0, sharedSourceCount: 0 },
      ],
      runProfile,
      shouldStop: () => stop,
    })

    expect(runProfile).toHaveBeenCalledTimes(1)
    expect(result.phase).toBe("stopped")
  })
})
