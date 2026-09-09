import { describe, it, expect } from "vitest"
import { reportGroupValue, aggregateTasksByGroup, aggregateTasksOverTime, REPORT_GROUP_LABELS } from "@/lib/tasks/report-aggregate"

const TL = new Map([["seo", "SEO"], ["bug", "Bug"]])
const EL = new Map([["914_line", "914 LINE"], ["social_media", "SOCIAL MEDIA"]])
const T = (over: Partial<Record<string, unknown>>) =>
  ({ type: null, eventType: null, status: "todo", assignee: null, project: null, division: null, ...over }) as any

describe("reportGroupValue", () => {
  it("resolves each dimension (with fallbacks)", () => {
    expect(reportGroupValue(T({ type: "seo" }), "type", TL, EL)).toBe("SEO")
    expect(reportGroupValue(T({ type: "x" }), "type", TL, EL)).toBe("x") // unknown → raw name
    expect(reportGroupValue(T({ division: { name: "Marketing" } }), "division", TL, EL)).toBe("Marketing")
    expect(reportGroupValue(T({ division: null }), "division", TL, EL)).toBe("— (no board)")
    expect(reportGroupValue(T({ assignee: { name: "Alice" } }), "assignee", TL, EL)).toBe("Alice")
    expect(reportGroupValue(T({ assignee: null }), "assignee", TL, EL)).toBe("Unassigned")
    expect(reportGroupValue(T({ project: null }), "project", TL, EL)).toBe("— (no project)")
    expect(reportGroupValue(T({ status: "in_progress" }), "status", TL, EL)).toBe("in_progress")
    expect(reportGroupValue(T({ status: "in_progress" }), "bucket", TL, EL)).toBe("Ongoing")
    expect(reportGroupValue(T({ status: "cancelled" }), "bucket", TL, EL)).toBe("Cancelled")
    expect(reportGroupValue(T({ eventType: "914_line" }), "eventType", TL, EL)).toBe("914 LINE")
    expect(reportGroupValue(T({ eventType: null }), "eventType", TL, EL)).toBe("— (no event type)")
  })
})

describe("aggregateTasksByGroup", () => {
  it("groups by assignee with the bucket split + a TOTAL row, sorted by label", () => {
    const tasks = [
      T({ assignee: { name: "Alice" }, status: "todo" }),        // planned
      T({ assignee: { name: "Alice" }, status: "in_progress" }), // ongoing
      T({ assignee: { name: "Alice" }, status: "done" }),        // completed
      T({ assignee: { name: "Bob" }, status: "cancelled" }),     // cancelled
      T({ assignee: null, status: "backlog" }),                  // planned, Unassigned
    ]
    const { rows, totals } = aggregateTasksByGroup(tasks, "assignee", TL, EL)
    expect(rows.map((r) => r.group)).toEqual(["Alice", "Bob", "Unassigned"])
    expect(rows.find((r) => r.group === "Alice")).toMatchObject({ total: 3, planned: 1, ongoing: 1, completed: 1, cancelled: 0 })
    expect(rows.find((r) => r.group === "Bob")).toMatchObject({ total: 1, cancelled: 1 })
    expect(totals).toMatchObject({ group: "TOTAL", total: 5, planned: 2, ongoing: 1, completed: 1, cancelled: 1 })
  })

  it("groups by type via the label map", () => {
    const tasks = [T({ type: "seo", status: "done" }), T({ type: "seo", status: "todo" }), T({ type: "bug", status: "done" })]
    const { rows } = aggregateTasksByGroup(tasks, "type", TL, EL)
    expect(rows.find((r) => r.group === "SEO")).toMatchObject({ total: 2, completed: 1, planned: 1 })
    expect(rows.find((r) => r.group === "Bug")).toMatchObject({ total: 1, completed: 1 })
  })

  it("exposes a label for every dimension", () => {
    expect(REPORT_GROUP_LABELS.division).toBe("Board / Department")
    expect(REPORT_GROUP_LABELS.bucket).toBe("Stage")
  })
})

describe("aggregateTasksOverTime", () => {
  const TT = (over: Partial<Record<string, unknown>>) =>
    ({ type: null, eventType: null, status: "done", assignee: null, project: null, division: null, completedAt: null, ...over }) as any

  it("pivots COMPLETED tasks by month × group, ignoring incomplete/malformed", () => {
    const tasks = [
      TT({ assignee: { name: "Alice" }, completedAt: "2026-05-10" }),
      TT({ assignee: { name: "Alice" }, completedAt: "2026-06-02" }),
      TT({ assignee: { name: "Alice" }, completedAt: "2026-06-20" }),
      TT({ assignee: { name: "Bob" }, completedAt: "2026-06-15" }),
      TT({ assignee: { name: "Bob" }, completedAt: null }), // incomplete → ignored
      TT({ assignee: null, completedAt: "bad-date" }),       // malformed → ignored
    ]
    const { periods, rows, totalsByPeriod } = aggregateTasksOverTime(tasks, "assignee", TL, EL)
    expect(periods).toEqual(["2026-05", "2026-06"])
    expect(rows[0].group).toBe("Alice") // sorted by total desc
    expect(rows.find((r) => r.group === "Alice")!.byPeriod).toEqual([1, 2])
    expect(rows.find((r) => r.group === "Alice")!.total).toBe(3)
    expect(rows.find((r) => r.group === "Bob")!.byPeriod).toEqual([0, 1])
    expect(totalsByPeriod).toEqual([1, 3])
  })

  it("returns empty when no task is completed", () => {
    const { periods, rows } = aggregateTasksOverTime([TT({ completedAt: null })], "division", TL, EL)
    expect(periods).toEqual([])
    expect(rows).toEqual([])
  })
})
