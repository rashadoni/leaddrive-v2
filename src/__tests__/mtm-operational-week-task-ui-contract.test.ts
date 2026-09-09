import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const operationalWeekPath = "src/components/mtm/operational-week-home.tsx"
const taskActionsPath = "src/components/mtm/task-actions-panel.tsx"
const taskWorkspacePath = "src/components/mtm/task-workspace.tsx"
const taskFormPath = "src/components/mtm/task-form.tsx"
const taskListPath = "src/app/(dashboard)/mtm/tasks/page.tsx"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => leafPaths(entry, prefix ? `${prefix}.${key}` : key))
}

function taskListSource(ui: string): string {
  const start = ui.indexOf("activeTasks.slice(0, 5).map")
  const end = ui.indexOf('t("noActiveTasks")', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return ui.slice(start, end)
}

describe("SWM-15C operational-week task UI contract", () => {
  it("shows actionable task identity, state, schedule, return reason, and attention", () => {
    const ui = source(operationalWeekPath)
    const taskList = taskListSource(ui)

    for (const projection of [
      't("taskId"',
      "taskStatusLabel(task.status)",
      "taskPriorityLabel(task.priority)",
      't("taskScheduledStart")',
      "task.scheduledStartAt",
      't("taskDue")',
      "task.dueAt",
      "task.returnReason",
      't("taskReturnedReason"',
      "taskAttentionPresentation(task.attention)",
    ]) {
      expect(taskList, `missing task projection ${projection}`).toContain(projection)
    }

    expect(ui).toContain('useTranslations("mtmTasksPage")')
    expect(ui).toContain('taskT(`statuses.${status}` as never)')
    expect(ui).toContain('taskT(`priorities.${priority}` as never)')
    expect(ui).toContain('case "OVERDUE": return { label: t("taskAttentionOverdue")')
    expect(ui).toContain('case "RETURNED": return { label: t("taskAttentionReturned")')
    expect(ui).toContain('label: t("taskAttentionActive")')
  })

  it("preserves the operational-week return path and a phone-sized task link target", () => {
    const taskList = taskListSource(source(operationalWeekPath))
    const ui = source(operationalWeekPath)

    expect(taskList).toContain("href={withReturnTo(")
    expect(taskList).toContain("`/mtm/tasks/${encodeURIComponent(task.id)}`")
    expect(taskList).toContain("returnPath(query, effectiveAgentId")
    expect(taskList).toMatch(/<Link[\s\S]*?className="[^"]*\bmin-h-11\b[^"]*"/)
    expect(taskList).not.toContain("md:min-h-0")
    expect(taskList).toContain('t("activeTasksShown", { shown: shownActiveTaskCount, total: activeTasks.length })')
    expect(taskList).toContain('t("viewAllTasks")')
    expect(ui).toContain('`/mtm/tasks?agentId=${encodeURIComponent(effectiveAgentId)}`')
  })

  it("aligns visual and DOM focus order across compact and desktop layouts", () => {
    const ui = source(operationalWeekPath)
    const compactRail = ui.indexOf('<aside className="md:grid md:grid-cols-2 min-[1600px]:hidden"')
    const agenda = ui.indexOf('<div className="min-w-0 border-t border-zinc-200 dark:border-zinc-700 min-[1600px]:border-t-0">', compactRail)
    const desktopRail = ui.indexOf('<aside className="hidden min-[1600px]:sticky min-[1600px]:top-4 min-[1600px]:block', agenda)

    expect(ui).toContain('function renderAttentionRailContent(railId: "compact" | "desktop")')
    expect(ui).toContain('{renderAttentionRailContent("compact")}')
    expect(ui).toContain('{renderAttentionRailContent("desktop")}')
    expect(compactRail).toBeGreaterThan(-1)
    expect(agenda).toBeGreaterThan(compactRail)
    expect(desktopRail).toBeGreaterThan(agenda)
  })

  it("keeps the five-day agenda full-width until the attention rail fits", () => {
    const ui = source(operationalWeekPath)

    expect(ui).toContain("min-[1600px]:grid-cols-[minmax(0,1fr)_20rem]")
    expect(ui).toContain("md:grid md:grid-cols-2 min-[1600px]:hidden")
    expect(ui).toContain("hidden min-[1600px]:sticky")
    expect(ui).toContain('query?.days === 5 ? "min-w-[900px] grid-cols-5"')
    expect(ui).not.toContain("xl:grid-cols-[minmax(0,1fr)_20rem]")
  })

  it("re-presents cached active and returned tasks at due boundaries and on visibility", () => {
    const ui = source(operationalWeekPath)

    expect(ui).toContain("operationalWeekTaskPresentationAttention(task.attention, task.dueAt, taskPresentationNow)")
    expect(ui).toContain("OPERATIONAL_TASK_ATTENTION_RANK[left.attention] - OPERATIONAL_TASK_ATTENTION_RANK[right.attention]")
    expect(ui).toContain("nextOperationalWeekTaskAttentionBoundary(facts.tasks, nowMs)")
    expect(ui).toContain("setFreshnessEpoch(Date.now())")
    expect(ui).toContain('document.addEventListener("visibilitychange", refreshOnVisible)')
  })

  it("invalidates cached dashboard queues after successful task mutations", () => {
    const actions = source(taskActionsPath)
    const workspace = source(taskWorkspacePath)
    const form = source(taskFormPath)
    const taskList = source(taskListPath)
    const actionInvalidations = actions.match(/invalidateOperationalWeekSnapshotsAfterTaskMutation\(\)/g) || []
    const workspaceInvalidations = workspace.match(/invalidateOperationalWeekSnapshotsAfterTaskMutation\(\)/g) || []
    const formInvalidations = form.match(/invalidateOperationalWeekSnapshotsAfterTaskMutation\(\)/g) || []
    const listInvalidations = taskList.match(/invalidateOperationalWeekSnapshotsAfterTaskMutation\(\)/g) || []

    expect(actions).toContain('from "@/lib/mtm/operational-week-cache"')
    expect(workspace).toContain('from "@/lib/mtm/operational-week-cache"')
    expect(form).toContain('from "@/lib/mtm/operational-week-cache"')
    expect(taskList).toContain('from "@/lib/mtm/operational-week-cache"')
    expect(actionInvalidations).toHaveLength(3)
    expect(workspaceInvalidations).toHaveLength(2)
    expect(formInvalidations).toHaveLength(1)
    expect(listInvalidations).toHaveLength(1)
  })

  it("keeps RU, AZ, and EN operational-week locale leaves aligned", () => {
    const locales = ["ru", "az", "en"]
    const messages = locales.map((locale) => JSON.parse(source(`messages/${locale}.json`)))
    const operationalWeekMessages = messages.map((message) => (
      message.mtmDashboardPage.operationalWeek as Record<string, unknown>
    ))
    const baseline = leafPaths(operationalWeekMessages[0]).sort()

    expect(leafPaths(operationalWeekMessages[1]).sort()).toEqual(baseline)
    expect(leafPaths(operationalWeekMessages[2]).sort()).toEqual(baseline)

    for (const [index, namespace] of operationalWeekMessages.entries()) {
      for (const key of [
        "taskId",
        "taskScheduledStart",
        "taskDue",
        "taskAttentionOverdue",
        "taskAttentionReturned",
        "taskAttentionActive",
        "taskReturnedReason",
        "taskValueUnavailable",
        "taskAttentionSummary",
        "overdueTasksCount",
        "returnedTasksCount",
        "activeTasksShown",
        "viewAllTasks",
        "baseCoverageTitle",
        "baseCoverageUnsigned",
        "baseCoverageNoSnapshot",
        "baseCoverageIncomplete",
        "baseCoverageRequired",
        "baseCoverageActualMoi",
        "baseCoverageActual",
        "baseCoverageUncovered",
      ]) {
        expect(namespace[key], `${locales[index]} is missing ${key}`).toEqual(expect.any(String))
        expect((namespace[key] as string).trim(), `${locales[index]}.${key} is empty`).not.toBe("")
      }
    }
  })
})
