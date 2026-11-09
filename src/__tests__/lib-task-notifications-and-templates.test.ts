import { describe, expect, it } from "vitest"
import { taskNotificationLocale, taskNotificationText } from "@/lib/tasks/task-notification-text"
import { boardTaskFromTemplate, type BoardTaskTemplate } from "@/lib/task-templates/board-task-from-template"

describe("task notifications speak the reader's language (2026-11-09: English pop-ups on an Azerbaijani screen)", () => {
  it("takes the recipient's language, else the screen it was done in, else the app default", () => {
    expect(taskNotificationLocale("en", "az")).toBe("en")
    expect(taskNotificationLocale(null, "az")).toBe("az")
    expect(taskNotificationLocale("xx", "ru")).toBe("ru")
    expect(taskNotificationLocale(null, null)).toBe("ru")
  })

  it("writes each notice in that language — no English or Russian left on an Azerbaijani screen", () => {
    expect(taskNotificationText("created", "az", { title: "Banner", priority: "critical" })).toEqual({
      title: "Yeni tapşırıq", message: "Tapşırıq yaradıldı: «Banner» (Kritik)",
    })
    expect(taskNotificationText("created", "az", { title: "Banner", priority: "medium" }).message).toBe("Tapşırıq yaradıldı: «Banner»")
    expect(taskNotificationText("assigned", "az", { title: "Banner" })).toEqual({ title: "Sizə tapşırıq təyin olundu", message: "Banner" })
    expect(taskNotificationText("completed", "az", { title: "Banner" })).toEqual({ title: "Tapşırıq tamamlandı", message: "Tamamlandı: «Banner»" })
    expect(taskNotificationText("assigned", "ru", { title: "Banner" }).title).toBe("Вам назначена задача")
    expect(taskNotificationText("completed", "en", { title: "Banner" }).title).toBe("Task completed")
  })
})

describe("a task template fills the board's «Yeni Tapşırıq» dialog", () => {
  const tpl: BoardTaskTemplate = {
    id: "tpl1",
    name: "Həftəlik story",
    taskTitle: "Story: {{week}}-ci həftə, {{user}}",
    taskDescription: "{{user}} hazırlayır",
    priority: "urgent",
    dueDateOffsetDays: 2,
    assignedTo: "u-aysel",
    checklist: [{ title: "Mətn" }, { title: "  " }, { title: "Dizayn", sortOrder: 5 }],
  }

  it("fills title and description with the variables, priority, assignee, due date and the subtasks", () => {
    // 23:30 on a Monday in the person's own day — the due date is counted from it, not from UTC's.
    const now = new Date(2026, 10, 9, 23, 30)
    const filled = boardTaskFromTemplate(tpl, { userName: "Leyla", now })
    expect(filled.title).toBe("Story: 46-ci həftə, Leyla")
    expect(filled.description).toBe("Leyla hazırlayır")
    expect(filled.priority).toBe("critical")
    expect(filled.assignedTo).toBe("u-aysel")
    expect(filled.dueDate).toBe("2026-11-11")
    expect(filled.checklist).toEqual([{ title: "Mətn" }, { title: "Dizayn", sortOrder: 5 }])
  })

  it("leaves what the template does not set", () => {
    const filled = boardTaskFromTemplate({ ...tpl, priority: "someday", dueDateOffsetDays: null, assignedTo: null, checklist: null, taskDescription: null })
    expect(filled.priority).toBeNull()
    expect(filled.dueDate).toBe("")
    expect(filled.assignedTo).toBe("")
    expect(filled.description).toBe("")
    expect(filled.checklist).toEqual([])
  })
})
