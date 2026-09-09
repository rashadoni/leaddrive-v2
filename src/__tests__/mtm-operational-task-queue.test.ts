import { describe, expect, it } from "vitest"
import {
  buildOperationalTaskQueue,
  type OperationalTaskQueueSource,
} from "@/lib/mtm/operational-task-queue"

const GENERATED_AT = new Date("2026-07-15T08:00:00.000Z")

function task(
  id: string,
  overrides: Partial<OperationalTaskQueueSource> = {},
): OperationalTaskQueueSource {
  return {
    id,
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    dueDate: null,
    scheduledStartAt: null,
    returnReason: null,
    createdAt: new Date("2026-07-01T08:00:00.000Z"),
    ...overrides,
  }
}

describe("buildOperationalTaskQueue", () => {
  it("orders overdue, returned and active work by next action, priority and stable id", () => {
    const queue = buildOperationalTaskQueue([
      task("active-created", { priority: "URGENT", createdAt: new Date("2026-07-13T08:00:00.000Z") }),
      task("returned-low", {
        priority: "LOW",
        returnReason: "Add the missing result",
        scheduledStartAt: new Date("2026-07-14T06:00:00.000Z"),
      }),
      task("overdue-status", {
        status: "OVERDUE",
        priority: "LOW",
        dueDate: new Date("2026-07-20T08:00:00.000Z"),
      }),
      task("overdue-by-date", {
        priority: "LOW",
        dueDate: new Date("2026-07-14T08:00:00.000Z"),
      }),
      task("returned-urgent-b", {
        priority: "URGENT",
        returnReason: "Correct the attachment",
        scheduledStartAt: new Date("2026-07-14T07:00:00.000Z"),
      }),
      task("returned-low-same-time", {
        priority: "LOW",
        returnReason: "Correct the attachment",
        scheduledStartAt: new Date("2026-07-14T07:00:00.000Z"),
      }),
      task("returned-urgent-a", {
        priority: "URGENT",
        returnReason: "Correct the attachment",
        scheduledStartAt: new Date("2026-07-14T07:00:00.000Z"),
      }),
      task("completed", { status: "COMPLETED" }),
      task("cancelled", { status: "CANCELLED" }),
    ], GENERATED_AT)

    expect(queue.map(({ id, attention }) => [id, attention])).toEqual([
      ["overdue-by-date", "OVERDUE"],
      ["overdue-status", "OVERDUE"],
      ["returned-low", "RETURNED"],
      ["returned-urgent-a", "RETURNED"],
      ["returned-urgent-b", "RETURNED"],
      ["returned-low-same-time", "RETURNED"],
      ["active-created", "ACTIVE"],
    ])
  })

  it("uses a strict overdue boundary and preserves the actual task status", () => {
    const queue = buildOperationalTaskQueue([
      task("one-ms-before", { dueDate: new Date(GENERATED_AT.getTime() - 1) }),
      task("at-boundary", { dueDate: new Date(GENERATED_AT), status: "PENDING" }),
      task("future-explicit-overdue", {
        dueDate: new Date(GENERATED_AT.getTime() + 1),
        status: "OVERDUE",
      }),
      task("whitespace-reason", { returnReason: "   " }),
    ], GENERATED_AT)

    expect(queue.map(({ id, attention, status }) => ({ id, attention, status }))).toEqual([
      { id: "one-ms-before", attention: "OVERDUE", status: "IN_PROGRESS" },
      { id: "future-explicit-overdue", attention: "OVERDUE", status: "OVERDUE" },
      { id: "whitespace-reason", attention: "ACTIVE", status: "IN_PROGRESS" },
      { id: "at-boundary", attention: "ACTIVE", status: "PENDING" },
    ])
  })
})
