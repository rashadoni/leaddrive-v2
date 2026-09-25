import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmOverdueTaskWhere, mtmTaskOverdueDays } from "@/lib/mtm/task-overdue"

/**
 * Tasks audit 2026-09-24: «Overdue» on /mtm/tasks showed 0 while all 243 open
 * tasks were past their due date — the list filtered on a stored status that
 * nobody writes, while the phone and «Today» derive it from the due date.
 */
const now = Date.parse("2026-09-24T09:00:00.000Z")

describe("a late field task", () => {
  it("is an open task whose due date has passed, counted in whole days", () => {
    expect(mtmTaskOverdueDays({ status: "PENDING", dueDate: "2026-08-24T09:00:00.000Z" }, now)).toBe(31)
    expect(mtmTaskOverdueDays({ status: "IN_PROGRESS", dueDate: new Date("2026-09-24T08:00:00.000Z") }, now)).toBe(1)
    expect(mtmTaskOverdueDays({ status: "PENDING", dueDate: "2026-09-25T09:00:00.000Z" }, now)).toBeNull()
    expect(mtmTaskOverdueDays({ status: "COMPLETED", dueDate: "2026-08-24T09:00:00.000Z" }, now)).toBeNull()
    expect(mtmTaskOverdueDays({ status: "CANCELLED", dueDate: "2026-08-24T09:00:00.000Z" }, now)).toBeNull()
    expect(mtmTaskOverdueDays({ status: "PENDING", dueDate: null }, now)).toBeNull()
  })

  it("is filtered by due date, not by a stored status", () => {
    expect(mtmOverdueTaskWhere(new Date(now))).toEqual({
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      dueDate: { lt: new Date(now) },
    })
    const route = readFileSync("src/app/api/v1/mtm/tasks/route.ts", "utf8")
    expect(route).toContain('...(status === "OVERDUE" ? [mtmOverdueTaskWhere(now)] : [])')
    expect(route).toContain('...(status && status !== "OVERDUE" && status !== "OPEN" && status !== "AWAITING_REVIEW" ? {')
    expect(route).toContain("OVERDUE: overdueCount,")
    const page = readFileSync("src/app/(dashboard)/mtm/tasks/page.tsx", "utf8")
    expect(page).toContain('data-testid="mtm-task-status-chips"')
    expect(page).toContain('t("overdueBy", { count: task.overdueDays })')
  })
})

describe("the task list opens on work, not on the archive", () => {
  // Tasks audit 2026-09-24: 41 of the first 50 rows were completed, the first
  // a test task; open tasks were five pages further.
  it("defaults to open tasks, the longest overdue first", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/tasks/page.tsx", "utf8")
    expect(page).toContain('const DEFAULT_TASK_STATUS = "OPEN"')
    expect(page).toContain('useState(searchParams.get("status") || DEFAULT_TASK_STATUS)')
    expect(page).toContain('["COMPLETED", "CANCELLED", ALL_TASK_STATUSES].includes(status) ? "due_desc" : "due_asc"')
    expect(page).toContain('if (status && status !== ALL_TASK_STATUSES) query.set("status", status)')
    expect(page).toContain('status === DEFAULT_TASK_STATUS ? "" : status')
    const route = readFileSync("src/app/api/v1/mtm/tasks/route.ts", "utf8")
    expect(route).toContain('...(status === "OPEN" ? [{ status: { in: [...MTM_OPEN_TASK_STATUSES] } }] : [])')
  })
})

describe("a task row on a computer", () => {
  // Tasks audit 2026-09-24: only the title letters and a bare chevron opened
  // a task; finished rows carried a grey checkbox explained only to a screen
  // reader; the table scrolled sideways inside its frame; «Asia/Baku» raw.
  it("opens on a click anywhere, has no dead checkbox and no inner sideways scroll", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/tasks/page.tsx", "utf8")
    expect(page).toContain('onClick={() => router.push(href(task.id))}')
    expect(page).toContain('onClick={(event) => event.stopPropagation()}')
    expect(page).not.toContain('t("openTaskNamed"')
    expect(page).not.toContain('t("taskNotReassignable"')
    expect(page).not.toContain("min-w-[58rem]")
    expect(page).not.toContain('t("timezoneLabel"')
  })
})

describe("tasks awaiting the manager's review", () => {
  // Tasks audit 2026-09-24 and owner decision 2026-09-25: completed before the
  // review step started counts as accepted; from then on a completed task
  // waits until accepted or returned — no auto-accept.
  it("are completed since the start, with no review event since the start", async () => {
    const { MTM_TASK_REVIEW_SINCE, mtmAwaitingReviewTaskWhere } = await import("@/lib/mtm/task-review-queue")
    expect(MTM_TASK_REVIEW_SINCE.toISOString()).toBe("2026-09-25T00:00:00.000Z")
    expect(mtmAwaitingReviewTaskWhere()).toEqual({
      status: "COMPLETED",
      completedAt: { gte: MTM_TASK_REVIEW_SINCE },
      events: { none: { type: "EDITED", occurredAt: { gte: MTM_TASK_REVIEW_SINCE }, evidence: { path: ["kind"], equals: "MTM_TASK_REVIEW" } } },
    })
    // The review route writes exactly that event.
    const review = readFileSync("src/app/api/v1/mtm/tasks/[id]/review/route.ts", "utf8")
    expect(review).toContain('kind: "MTM_TASK_REVIEW"')
    expect(review).toContain('type: "EDITED"')
  })

  it("are one number and one badge from the same rule", () => {
    const route = readFileSync("src/app/api/v1/mtm/tasks/route.ts", "utf8")
    expect(route).toContain("AWAITING_REVIEW: awaitingReviewCount,")
    expect(route).toContain("...mtmAwaitingReviewTaskWhere() },")
    expect(route).toContain("awaitingReview: awaitingIds.has(task.id),")
    const page = readFileSync("src/app/(dashboard)/mtm/tasks/page.tsx", "utf8")
    expect(page).toContain('task.awaitingReview ? <Badge variant="warning">{t("statuses.AWAITING_REVIEW")}</Badge>')
    expect(page).toContain('{ value: "AWAITING_REVIEW", label: t("statuses.AWAITING_REVIEW")')
  })
})

describe("task search", () => {
  // Tasks audit 2026-09-24: searching an agent's surname found nothing.
  it("also finds tasks by the agent's name", () => {
    const route = readFileSync("src/app/api/v1/mtm/tasks/route.ts", "utf8")
    expect(route).toContain('{ agent: { name: { contains: search, mode: "insensitive" as const } } },')
  })
})
