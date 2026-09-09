import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { taskReturnPath } from "@/app/(dashboard)/mtm/tasks/page"
import {
  buildMtmTaskEditChanges,
  taskEditRecurrencePreview,
  type TaskEditDraft,
} from "@/components/mtm/task-edit-form"
import { localRecurrencePreview } from "@/components/mtm/task-form"
import {
  type MtmTaskDetail,
  normalizeTaskRecurrencePreview,
  safeTaskReturnHref,
} from "@/components/mtm/task-workspace"

describe("SWM-14 task UI navigation contract", () => {
  it("retains filters, contact context, sort, page and view in the task return path", () => {
    const params = new URLSearchParams({
      search: "visit",
      teamId: "team-1",
      agentId: "agent-1",
      contactId: "contact-1",
      sort: "priority",
      view: "kanban",
      page: "3",
    })

    expect(taskReturnPath("/mtm/tasks", params)).toBe(
      "/mtm/tasks?search=visit&teamId=team-1&agentId=agent-1&contactId=contact-1&sort=priority&view=kanban&page=3",
    )
  })

  it("keeps primary actions ahead of long content on narrow screens and gates versioned delete", () => {
    const workspace = readFileSync(resolve("src/components/mtm/task-workspace.tsx"), "utf8")
    const actions = readFileSync(resolve("src/components/mtm/task-actions-panel.tsx"), "utf8")

    expect(workspace).toContain('className="order-2 min-w-0')
    expect(workspace).toContain('className="order-1 space-y-6 print:hidden lg:order-2')
    expect(workspace).toContain("capabilities.canDelete === true")
    expect(workspace).toContain("expectedVersion=${encodeURIComponent(String(task.version))}")
    expect(actions).toContain("print:hidden lg:hidden")
  })

  it("allows an operational-week return but rejects external navigation", () => {
    expect(safeTaskReturnHref("/mtm?weekDate=2026-08-01&weekAgentId=agent-1"))
      .toBe("/mtm?weekDate=2026-08-01&weekAgentId=agent-1")
    expect(safeTaskReturnHref("https://attacker.example/mtm")).toBe("/mtm/tasks")
    expect(safeTaskReturnHref("//attacker.example/mtm")).toBe("/mtm/tasks")
  })
})

describe("SWM-14 recurrence preview presentation contract", () => {
  it("retains server DST shift and ambiguity evidence", () => {
    const preview = normalizeTaskRecurrencePreview({
      occurrences: [
        {
          dueDate: "2026-03-29T01:30:00.000Z",
          dst: { dueDate: { kind: "SHIFTED_FORWARD", shiftedMinutes: 60 } },
        },
        {
          scheduledStartAt: "2026-10-25T00:30:00.000Z",
          dst: { scheduledStartAt: { kind: "AMBIGUOUS_EARLIER", shiftedMinutes: 0 } },
        },
        {
          scheduledStartAt: "2026-03-29T01:00:00.000Z",
          dueDate: "2026-03-29T02:00:00.000Z",
          dst: {
            scheduledStartAt: { kind: "SHIFTED_FORWARD", shiftedMinutes: 30 },
            dueDate: { kind: "EXACT", shiftedMinutes: 0 },
          },
        },
      ],
    })

    expect(preview).toEqual([
      expect.objectContaining({ dstAdjusted: true, dstKind: "SHIFTED_FORWARD", dstShiftedMinutes: 60 }),
      expect.objectContaining({ dstAdjusted: true, dstKind: "AMBIGUOUS_EARLIER", dstShiftedMinutes: 0 }),
      expect.objectContaining({ dstAdjusted: true, dstKind: "SHIFTED_FORWARD", dstShiftedMinutes: 30 }),
    ])
  })

  it("authors and previews with the same explicit DST policy as the server", () => {
    const springGap = localRecurrencePreview(
      "",
      "2026-03-08T02:30",
      "DAILY",
      "1",
      "America/New_York",
      "America/New_York",
    )
    const fallAmbiguity = localRecurrencePreview(
      "",
      "2026-11-01T01:30",
      "WEEKLY",
      "1",
      "America/New_York",
      "America/New_York",
    )

    expect(springGap.authoringDst).toEqual([
      { field: "dueAt", resolution: { kind: "SHIFTED_FORWARD", shiftedMinutes: 30 } },
    ])
    expect(fallAmbiguity.authoringDst).toEqual([
      { field: "dueAt", resolution: { kind: "AMBIGUOUS_EARLIER", shiftedMinutes: 0 } },
    ])
  })

  it("sends a sparse edit-future mutation and preserves unrelated future context", () => {
    const task = {
      id: "task-feb",
      title: "Original",
      description: "Keep",
      status: "PENDING",
      priority: "MEDIUM",
      scheduledStartAt: "2026-02-28T08:00:00.000Z",
      dueDate: "2026-02-28T09:00:00.000Z",
      version: 4,
      agentId: "agent-1",
      customerId: "customer-1",
      visitId: "visit-1",
      recurrenceRule: "MONTHLY",
      recurrenceInterval: 1,
      recurrenceUntil: "2026-12-31T09:00:00.000Z",
      recurrenceTimezone: "UTC",
    } satisfies MtmTaskDetail
    const form: TaskEditDraft = {
      title: "Changed",
      description: "Keep",
      agentId: "agent-1",
      customerId: "customer-1",
      visitId: "visit-1",
      taskGroupCode: "",
      priority: "MEDIUM",
      scheduledStartAt: "2026-02-28T08:00",
      dueDate: "2026-02-28T09:00",
      recurrenceRule: "MONTHLY",
      recurrenceInterval: "1",
      recurrenceUntil: "2026-12-31T09:00",
      recurrenceTimezone: "UTC",
      editScope: "THIS_AND_FUTURE",
    }

    expect(buildMtmTaskEditChanges(form, task, "UTC")).toEqual({ title: "Changed" })
  })

  it("previews the immutable series for THIS and the edited schedule for THIS_AND_FUTURE", () => {
    const task = {
      id: "task-exception",
      title: "Exception",
      status: "PENDING",
      priority: "MEDIUM",
      scheduledStartAt: null,
      dueDate: "2026-08-05T09:00:00.000Z",
      recurrenceCursorScheduledStartAt: null,
      recurrenceCursorDueDate: "2026-08-01T09:00:00.000Z",
      recurrenceRule: "DAILY",
      recurrenceInterval: 1,
      recurrenceUntil: null,
      recurrenceTimezone: "UTC",
      version: 3,
      agentId: "agent-1",
    } satisfies MtmTaskDetail
    const form: TaskEditDraft = {
      title: "Exception",
      description: "",
      agentId: "agent-1",
      customerId: "",
      visitId: "",
      taskGroupCode: "",
      priority: "MEDIUM",
      scheduledStartAt: "",
      dueDate: "2026-08-06T09:00",
      recurrenceRule: "DAILY",
      recurrenceInterval: "1",
      recurrenceUntil: "",
      recurrenceTimezone: "UTC",
      editScope: "THIS",
    }

    expect(taskEditRecurrencePreview(form, task, "UTC").occurrences[0]?.dueDate)
      .toBe("2026-08-02T09:00:00.000Z")
    expect(taskEditRecurrencePreview({ ...form, editScope: "THIS_AND_FUTURE" }, task, "UTC").occurrences[0]?.dueDate)
      .toBe("2026-08-07T09:00:00.000Z")
  })
})
