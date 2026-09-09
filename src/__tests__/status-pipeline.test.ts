import { describe, it, expect } from "vitest"
import { pipeStatusBucket } from "@/lib/tasks/status-pipeline"

// The legacy task-detail pipeline (non-board tasks) renders these 4 stages.
const LEGACY_STAGES = ["pending", "in_progress", "completed", "cancelled"]
// Every status a task can hold.
const STATUSES = ["pending", "todo", "in_progress", "completed", "cancelled", "backlog", "testing", "review", "done"]

describe("pipeStatusBucket — legacy pipeline parity", () => {
  // Regression guard for the bug where completed+cancelled both bucketed to
  // "done", lighting up two segments on /tasks/[id].
  it("completed and cancelled bucket to DISTINCT values", () => {
    expect(pipeStatusBucket("completed")).toBe("done")
    expect(pipeStatusBucket("cancelled")).toBe("cancelled")
    expect(pipeStatusBucket("completed")).not.toBe(pipeStatusBucket("cancelled"))
  })

  it("pending and todo share a bucket (both highlight 'To do')", () => {
    expect(pipeStatusBucket("pending")).toBe("todo")
    expect(pipeStatusBucket("todo")).toBe("todo")
  })

  // The core invariant: in legacy mode each status highlights EXACTLY ONE stage.
  it("every legacy-relevant status maps to exactly one legacy stage", () => {
    for (const status of ["pending", "todo", "in_progress", "completed", "cancelled"]) {
      const matches = LEGACY_STAGES.filter((s) => pipeStatusBucket(s) === pipeStatusBucket(status))
      expect(matches.length, `status "${status}" should match one stage`).toBe(1)
    }
  })

  it("identity for the board stage keys", () => {
    for (const k of ["backlog", "in_progress", "testing", "review", "done"]) {
      expect(pipeStatusBucket(k)).toBe(k)
    }
    // and STATUSES is exercised so the import isn't dead
    expect(STATUSES.length).toBeGreaterThan(0)
  })
})
