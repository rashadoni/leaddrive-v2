import { describe, expect, it } from "vitest"
import {
  canResumeMonitoringProfileRun,
  createMonitoringProfileRunResumeContext,
  type MonitoringProfileRunProgress,
} from "@/lib/social/monitoring-profile-runner"
import {
  MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION,
  restoreMonitoringProfileWorkflowState,
  serializeMonitoringProfileWorkflowState,
} from "@/lib/social/monitoring-profile-workflow-state"

function progress(
  overrides: Partial<MonitoringProfileRunProgress> = {},
): MonitoringProfileRunProgress {
  return {
    phase: "running",
    total: 36,
    attempted: 1,
    succeeded: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    found: 1,
    accepted: 0,
    review: 0,
    rejected: 1,
    duplicates: 0,
    sourceResults: [],
    current: {
      id: "source-current",
      platform: "facebook",
      label: "Facebook",
      index: 2,
      stage: "provider_wait",
      preview: {
        found: 0,
        accepted: 0,
        review: 0,
        rejected: 0,
        duplicates: 0,
      },
      providerWait: {
        providerRunIds: ["provider-run-1"],
        collectorResult: {
          status: "pending",
          foundCount: 0,
          newCount: 0,
          duplicateCount: 0,
        },
      },
    },
    lastIssue: null,
    resumeContext: createMonitoringProfileRunResumeContext({
      scenarioId: "scenario-baku",
      profileRevision: "revision-1",
      sourceIds: ["source-current", "source-next"],
      now: new Date("2026-07-28T08:00:00.000Z"),
    }),
    ...overrides,
  }
}

describe("monitoring profile workflow storage", () => {
  it("drops unversioned stale run counters while preserving navigation state", () => {
    const restored = restoreMonitoringProfileWorkflowState(JSON.stringify({
      selectedProfileId: "baku-electronics",
      activeStage: "collection",
      runProgress: {
        "baku-electronics": progress({
          phase: "stopped",
          attempted: 6,
          found: 1003,
          accepted: 974,
        }),
      },
    }))

    expect(restored).toEqual({
      selectedProfileId: "baku-electronics",
      activeStage: "collection",
      runProgress: {},
    })
  })

  it("drops version 2 provider checkpoints after a monitoring reset", () => {
    expect(MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION).toBe(3)
    const restored = restoreMonitoringProfileWorkflowState(JSON.stringify({
      version: 2,
      selectedProfileId: "baku-electronics",
      activeStage: "review",
      runProgress: {
        "baku-electronics": progress({
          current: {
            ...progress().current!,
            providerWait: {
              providerRunIds: ["deleted-provider-run"],
              collectorResult: {
                status: "pending",
                foundCount: 0,
                newCount: 0,
                duplicateCount: 0,
              },
            },
          },
        }),
      },
    }))

    expect(restored).toEqual({
      selectedProfileId: "baku-electronics",
      activeStage: "review",
      runProgress: {},
    })
  })

  it("restores current version progress for a safe resume after reload", () => {
    const current = progress()
    const serialized = serializeMonitoringProfileWorkflowState({
      selectedProfileId: "baku-electronics",
      activeStage: "collection",
      runProgress: { "baku-electronics": current },
    })
    const restored = restoreMonitoringProfileWorkflowState(serialized)

    expect(JSON.parse(serialized).version).toBe(
      MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION,
    )
    expect(restored.runProgress["baku-electronics"]).toMatchObject({
      phase: "stopped",
      attempted: 1,
      found: 1,
      accepted: 0,
      rejected: 1,
      current: {
        id: "source-current",
        stage: "provider_wait",
        providerWait: {
          providerRunIds: ["provider-run-1"],
        },
      },
    })
  })

  it("does not redispatch a source when reload happened before its provider identity was known", () => {
    const current = progress({
      current: {
        id: "source-current",
        platform: "facebook",
        label: "Facebook",
        index: 2,
        stage: "starting",
        preview: {
          found: 0,
          accepted: 0,
          review: 0,
          rejected: 0,
          duplicates: 0,
        },
      },
    })
    const restored = restoreMonitoringProfileWorkflowState(
      serializeMonitoringProfileWorkflowState({
        selectedProfileId: "baku-electronics",
        activeStage: "collection",
        runProgress: { "baku-electronics": current },
      }),
    )

    expect(restored.runProgress["baku-electronics"]).toMatchObject({
      phase: "completed_with_pending",
      current: null,
      attempted: 1,
    })
  })

  it("reopens only the remaining queue from a legacy pending terminal state", () => {
    const pendingSource = {
      sourceId: "source-current",
      platform: "facebook",
      label: "Facebook",
      status: "pending",
      found: 0,
      accepted: 0,
      review: 0,
      rejected: 0,
      duplicates: 0,
      limitations: ["bright_data_snapshot_pending"],
    }
    const restored = restoreMonitoringProfileWorkflowState(
      serializeMonitoringProfileWorkflowState({
        selectedProfileId: "baku-electronics",
        activeStage: "collection",
        runProgress: {
          "baku-electronics": progress({
            phase: "completed_with_pending",
            total: 2,
            attempted: 1,
            pending: 1,
            sourceResults: [pendingSource],
            current: null,
          }),
        },
      }),
    )

    expect(restored.runProgress["baku-electronics"]).toMatchObject({
      phase: "stopped",
      total: 2,
      attempted: 1,
      pending: 1,
      sourceResults: [pendingSource],
      current: null,
    })
    expect(canResumeMonitoringProfileRun({
      progress: restored.runProgress["baku-electronics"],
      scenarioId: "scenario-baku",
      profileRevision: "revision-1",
      sourceIds: ["source-current", "source-next"],
      now: new Date("2026-07-28T08:05:00.000Z"),
    })).toBe(true)
  })

  it("ignores malformed progress without discarding valid profile progress", () => {
    const restored = restoreMonitoringProfileWorkflowState(JSON.stringify({
      version: MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION,
      selectedProfileId: "baku-electronics",
      activeStage: "review",
      runProgress: {
        invalid: { phase: "running", total: "36" },
        valid: progress({ phase: "completed_with_pending", current: null }),
      },
    }))

    expect(restored.activeStage).toBe("review")
    expect(restored.runProgress).toEqual({
      valid: progress({ phase: "completed_with_pending", current: null }),
    })
  })

  it("drops current-version unfinished progress that has no run identity", () => {
    const stale = progress({ phase: "stopped" })
    delete stale.resumeContext
    const restored = restoreMonitoringProfileWorkflowState(JSON.stringify({
      version: MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION,
      selectedProfileId: "baku-electronics",
      activeStage: "collection",
      runProgress: { "baku-electronics": stale },
    }))

    expect(restored.runProgress).toEqual({})
  })
})
