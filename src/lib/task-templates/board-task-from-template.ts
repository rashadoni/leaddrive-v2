/**
 * What a task template puts into the board's «Yeni Tapşırıq» dialog.
 *
 * The CRM task form (src/components/task-form.tsx) has applied templates since
 * Roadmap #21; the board dialog had no picker, so a person who has only the
 * boards could create templates and never use one (found 2026-11-09 while
 * recording the Boards video guide).
 */
import { substituteTemplateVars, type SubstituteContext } from "./substitute"

export interface BoardTaskTemplate {
  id: string
  name: string
  taskTitle: string
  taskDescription: string | null
  priority: string
  dueDateOffsetDays: number | null
  assignedTo: string | null
  checklist: { title: string; sortOrder?: number }[] | null
}

/** The board dialog offers these; a template's «urgent» is the board's «critical». */
const BOARD_PRIORITY: Record<string, string> = {
  critical: "critical",
  urgent: "critical",
  high: "high",
  medium: "medium",
  low: "low",
}

/** yyyy-mm-dd of the person's own calendar day — not UTC's, which in Baku is a day behind after midnight. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function boardTaskFromTemplate(tpl: BoardTaskTemplate, ctx: SubstituteContext = {}) {
  const now = ctx.now ?? new Date()
  let dueDate = ""
  if (tpl.dueDateOffsetDays !== null && tpl.dueDateOffsetDays !== undefined) {
    const d = new Date(now)
    d.setDate(d.getDate() + tpl.dueDateOffsetDays)
    dueDate = localDay(d)
  }
  return {
    title: substituteTemplateVars(tpl.taskTitle, { ...ctx, now }).slice(0, 200),
    description: tpl.taskDescription ? substituteTemplateVars(tpl.taskDescription, { ...ctx, now }) : "",
    priority: BOARD_PRIORITY[tpl.priority] ?? null,
    assignedTo: tpl.assignedTo ?? "",
    dueDate,
    checklist: Array.isArray(tpl.checklist) ? tpl.checklist.filter((item) => item?.title?.trim()) : [],
  }
}
