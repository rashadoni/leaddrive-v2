import { describe, expect, it } from "vitest"
import {
  canApplyMobileTaskTransition,
  nextRecurrenceDueDate,
  parseMobileTaskCreate,
  parseMobileTaskEvent,
  parseMobileTaskUpdate,
  taskEventTypeForUpdate,
} from "@/lib/mtm/mobile-task"

describe("mobile task workflow", () => {
  it("validates a self-created recurring task", () => {
    const parsed = parseMobileTaskCreate({
      id: "mobile-task-1",
      title: "Visit the new clinic",
      description: null,
      customerId: "customer-1",
      priority: "HIGH",
      dueDate: "2026-07-16T05:00:00.000Z",
      recurrence: { rule: "WEEKLY", interval: 2, until: "2026-10-01T00:00:00.000Z" },
    })
    expect(parsed.error).toBeNull()
    expect(parsed.input?.recurrence).toEqual({
      rule: "WEEKLY",
      interval: 2,
      until: "2026-10-01T00:00:00.000Z",
    })
  })

  it("rejects unsafe ids and incomplete comments", () => {
    expect(parseMobileTaskCreate({ id: "../../task", title: "x" }).input).toBeNull()
    expect(parseMobileTaskEvent({
      taskId: "task-1",
      type: "COMMENTED",
      occurredAt: "2026-07-15T05:00:00.000Z",
    }).input).toBeNull()
  })

  it("keeps duplicates one-off and rejects future-dated task events", () => {
    expect(parseMobileTaskCreate({
      id: "mobile-copy-1",
      title: "Copy",
      copiedFromId: "task-1",
      dueDate: "2026-08-10T09:00:00.000Z",
      recurrence: { rule: "WEEKLY", interval: 1 },
    }).input).toBeNull()
    expect(parseMobileTaskEvent({
      taskId: "task-1",
      type: "COMMENTED",
      occurredAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      comment: "future",
    }).input).toBeNull()
  })

  it("allows forward work but keeps terminal states terminal", () => {
    expect(canApplyMobileTaskTransition("PENDING", "IN_PROGRESS")).toBe(true)
    expect(canApplyMobileTaskTransition("OVERDUE", "COMPLETED")).toBe(true)
    expect(canApplyMobileTaskTransition("COMPLETED", "IN_PROGRESS")).toBe(false)
    expect(canApplyMobileTaskTransition("CANCELLED", "PENDING")).toBe(false)
  })

  it("classifies updates and computes the next recurrence in UTC", () => {
    const input = parseMobileTaskUpdate({
      id: "task-1",
      expectedVersion: 2,
      dueDate: "2026-07-20T09:00:00.000Z",
    }).input!
    expect(taskEventTypeForUpdate(input, {
      status: "PENDING",
      dueDate: new Date("2026-07-18T09:00:00.000Z"),
      acceptedAt: null,
    })).toBe("RESCHEDULED")
    expect(nextRecurrenceDueDate(new Date("2026-01-31T09:00:00.000Z"), "DAILY", 1).toISOString())
      .toBe("2026-02-01T09:00:00.000Z")
    expect(nextRecurrenceDueDate(new Date("2026-07-15T09:00:00.000Z"), "WEEKLY", 2).toISOString())
      .toBe("2026-07-29T09:00:00.000Z")
    expect(nextRecurrenceDueDate(new Date("2026-01-31T09:00:00.000Z"), "MONTHLY", 1).toISOString())
      .toBe("2026-02-28T09:00:00.000Z")
  })
})
