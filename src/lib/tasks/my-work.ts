/**
 * «Mənim işlərim» — a person's own tasks from every board, on one screen
 * (owner, 2026-11-10: «Давай, по макету»; Bordio's «My work»).
 *
 * Own = the assignee or a co-assignee (the board's «Mənə təyin olunan» pill,
 * across all boards). Only tasks on a live board: a task without a board
 * belongs to the CRM's /tasks, one on an archived board is gone from the boards.
 */
import { resolveLaneKey } from "@/lib/tasks/board-columns"

/** A task in one of these is finished: the board's last stage, or legacy CRM closes. */
export const CLOSED_TASK_STATUSES = ["done", "completed", "cancelled"] as const

/** Prisma `where` part for «tasks that are mine, on a live board». */
export function myBoardTasksWhere(userId: string, open: boolean) {
  return {
    division: { is: { isActive: true } },
    OR: [{ assignedTo: userId }, { collaborators: { some: { userId } } }],
    ...(open ? { status: { notIn: [...CLOSED_TASK_STATUSES] } } : {}),
  }
}

export type MyWorkGroup = "overdue" | "today" | "tomorrow" | "week" | "later" | "none"
export const MY_WORK_GROUPS: readonly MyWorkGroup[] = ["overdue", "today", "tomorrow", "week", "later", "none"]

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/**
 * Which group a due date falls in, by the person's own calendar day. A due
 * date is the end of its day (endOfDayIso), so a task due today is «today»
 * until midnight, not overdue at its 23:59:59 instant's morning. «This week»
 * runs to Sunday; Monday on is «later».
 */
export function myWorkGroup(dueDate: string | Date | null | undefined, now: Date = new Date()): MyWorkGroup {
  if (!dueDate) return "none"
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return "none"
  const today = dayStart(now)
  const dueDay = dayStart(due)
  if (dueDay < today) return "overdue"
  if (dueDay.getTime() === today.getTime()) return "today"
  if (dueDay.getTime() === addDays(today, 1).getTime()) return "tomorrow"
  const daysToSunday = (7 - today.getDay()) % 7
  if (dueDay <= addDays(today, daysToSunday)) return "week"
  return "later"
}

export interface MyWorkColumn { key: string; label: string; mapsToStatus: string; sortOrder?: number }

/** Where «done» puts a task on its board: its stage-«done» column, else its last one. */
export function doneColumnOf(columns: readonly MyWorkColumn[]): MyWorkColumn | null {
  if (!columns.length) return null
  const sorted = [...columns].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  return sorted.find((c) => c.mapsToStatus === "done") ?? sorted[sorted.length - 1]
}

/** The column a task stands in on its board — the same lane the board draws it in. */
export function columnOfTask(
  task: { status: string; boardColumnKey?: string | null },
  columns: readonly MyWorkColumn[],
): MyWorkColumn | null {
  const sorted = [...columns].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const key = resolveLaneKey(task, sorted)
  return sorted.find((c) => c.key === key) ?? null
}

/**
 * The board's name on a row; «Folder · Board» only when another board the
 * person sees has the same name (Zeytun under Digital and under Traditional).
 */
export function boardLabel(
  board: { id: string; name: string; parentDivisionId?: string | null },
  all: readonly { id: string; name: string; parentDivisionId?: string | null; isDepartment?: boolean }[],
): string {
  const twin = all.some((d) => d.id !== board.id && !d.isDepartment && d.name.trim().toLowerCase() === board.name.trim().toLowerCase())
  if (!twin) return board.name
  const folder = all.find((d) => d.id === board.parentDivisionId)?.name
  return folder ? `${folder} · ${board.name}` : board.name
}

/**
 * A column's name as the reader should see it: a board's own name for it, or —
 * when the column still carries one of the stock English names (Bordio's «New
 * task», «In progress», the seed «TO DO») — the stage in the reader's language.
 * Returns the stage key to translate, or null to show the label as it is.
 */
const STOCK_COLUMN_NAMES = new Set([
  "new task", "to do", "todo", "in progress", "testing", "review", "in review", "done", "completed", "backlog", "canceled", "cancelled",
])
export function stockColumnStage(column: { label: string; mapsToStatus: string } | null | undefined): string | null {
  if (!column) return null
  return STOCK_COLUMN_NAMES.has(column.label.trim().toLowerCase()) ? column.mapsToStatus : null
}
