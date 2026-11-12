/**
 * A list that came in as text, turned into subtasks (Elvira, 2026-11-12: an
 * order of «45 ədəd vinil» arrives as one numbered list in the description;
 * the owner: «клиент хочет задачи который как список пришёл могу делить на
 * подзадачи» → mockup → «Да, делай»).
 */

/** Most subtasks one list may make — a pasted page of text is not a list. */
export const MAX_LIST_LINES = 200
const MAX_TITLE = 500

// «1. », «12) », «3 - », «•», «-», «*», «–», «—», «▪», «◦» at the start of a line.
// A number needs a space after its dot: «28.11.2026 Yuxu…» opens a line with a date, not an item.
const MARKER = /^\s*(?:\d{1,4}[.)]\s+(?:-\s*)?|\d{1,4}\s+-\s+|[•\-*–—▪◦·]\s+)/u

function clean(line: string): string {
  return line.replace(MARKER, "").replace(/\s+/gu, " ").trim().slice(0, MAX_TITLE)
}

/**
 * The list in a description: the lines that start with a number or a bullet.
 * Fewer than two such lines is not a list — the button is not offered.
 */
export function listLinesOf(description: string | null | undefined): string[] {
  if (!description) return []
  const items = description
    .split(/\r?\n/u)
    .filter((line) => MARKER.test(line))
    .map(clean)
    .filter(Boolean)
  return items.length >= 2 ? items.slice(0, MAX_LIST_LINES) : []
}

/**
 * Text pasted into «add a subtask»: every non-empty line is a subtask, its
 * number or bullet dropped. One line is an ordinary paste (null).
 */
export function pastedLines(text: string): string[] | null {
  const items = text.split(/\r?\n/u).map(clean).filter(Boolean)
  return items.length >= 2 ? items.slice(0, MAX_LIST_LINES) : null
}

/**
 * What a list would add to the subtasks already there: a line already a
 * subtask is skipped, so pressing the button again adds nothing. Two equal
 * lines in one list stay two — an order may hold the same item twice.
 */
export function newSubtaskTitles(lines: readonly string[], existing: readonly string[]): string[] {
  const there = new Set(existing.map((title) => title.trim().toLowerCase()))
  return lines.filter((line) => !there.has(line.toLowerCase()))
}
