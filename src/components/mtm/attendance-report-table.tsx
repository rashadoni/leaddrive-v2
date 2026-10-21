"use client"

import type { AttendanceTable } from "@/lib/mtm/attendance-table"

const isDayKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key)
/**
 * A month grid on screen (owner, 2026-10-15: «Forma N-1t» ran off the page).
 * Excel and PDF keep every column as built; the screen only regroups them:
 * position and department go under the name, a day shows its code with the
 * hours beneath (hours only from 85rem — below that the code alone fits, the
 * hours stay in the cell's tooltip), and an empty notes column is not drawn.
 */
function screenColumns(table: AttendanceTable) {
  const index = (key: string) => table.columns.findIndex(column => column.key === key)
  const monthGrid = table.columns.some(column => isDayKey(column.key)) && index("employee") >= 0
  const folded = monthGrid ? ["position", "team"].map(index).filter(at => at >= 0) : []
  const notes = index("notes"), emptyNotes = monthGrid && notes >= 0 && table.rows.every(row => !String(row.cells[notes] ?? "").trim())
  return { monthGrid, employee: index("employee"), folded, shown: table.columns.map((column, at) => ({ column, at })).filter(({ at }) => !folded.includes(at) && !(emptyNotes && at === notes)) }
}
/** Every day the same shape — code on one line, hours (or nothing) beneath — so codes line up across the row. */
function DayCell({ text }: { text: string }) {
  const parts = text.includes(" / ") ? [text] : text.split(" · ")
  const [code, ...rest] = parts
  return <span className="block text-center leading-tight" title={text}><span className={`block pt-0.5 text-[11px] font-medium min-[85rem]:pt-0 min-[85rem]:text-[13px] ${code === "·" || code === "—" ? "text-muted-foreground" : ""}`}>{code}</span>
    <span className="hidden min-h-3 text-[9px] font-normal text-muted-foreground min-[85rem]:block">{rest.join(" · ")}</span></span>
}
/** Equal day columns: narrower while the hours are hidden (below 85rem). */
const DAY_WIDTH = "w-5 min-w-5 min-[85rem]:w-6 min-[85rem]:min-w-6"
const totalColumn = (key: string) => ["workedDays", "hours", "worked", "late", "absent", "days"].includes(key)

/**
 * One report table as Personnel → Reports draws it. The live N-1t, the N-1t a
 * close is about to freeze and a closed month's frozen N-1t are the same
 * picture, so the owner sees one form before and after «Bu tabeli bağla».
 * Cells are printed verbatim: a frozen table is never rebuilt from today's data.
 */
export function AttendanceReportTable({ table, testId = "attendance-report-table" }: { table: AttendanceTable; testId?: string }) {
  const layout = screenColumns(table)
  return <div className="overflow-x-auto" role="region" aria-label={table.title} tabIndex={0}><table className="w-full border-collapse text-sm" data-testid={testId}>
    {/* Headers wrap and cells stay tight: a wide report fits the page instead of scrolling inside the card. */}
    <thead><tr>{layout.shown.map(({ column }) => <th key={column.key} scope="col" className={`border-b py-2 align-bottom text-[11px] font-medium leading-tight text-muted-foreground ${isDayKey(column.key) ? `${DAY_WIDTH} px-0 text-center` : layout.monthGrid && totalColumn(column.key) ? "w-16 px-1 text-right" : "px-2 text-left"}`}>{isDayKey(column.key) ? Number(column.key.slice(8)) : column.label}</th>)}</tr></thead>
    <tbody>{table.rows.map(row => <tr key={row.key} className="border-b last:border-0" data-testid="attendance-report-row">{layout.shown.map(({ column, at }) => {
      const cell = row.cells[at], day = isDayKey(column.key), name = at === layout.employee
      const under = name ? layout.folded.map(index => String(row.cells[index] ?? "")).filter(text => text && text !== "—") : []
      // A month grid reads along the first line: number, name, codes and totals share it.
      return <td key={column.key} className={`py-2 text-[13px] tabular-nums ${layout.monthGrid ? "align-top leading-tight" : ""} ${day ? `${DAY_WIDTH} px-0` : layout.monthGrid && totalColumn(column.key) ? "px-1 text-right" : "px-2"} ${name ? "min-w-28 font-semibold" : ""}`}>
        {day ? <DayCell text={String(cell ?? "")} /> : cell}
        {under.length ? <span className="block text-[11px] font-normal leading-tight text-muted-foreground" data-testid="attendance-report-employee-details">{under.join(" · ")}</span> : null}</td>
    })}</tr>)}</tbody>
  </table></div>
}

/** The lines under a table: its period, then its totals without their heading line (as the live report prints them). */
export function AttendanceReportTotals({ period, totals }: { period: string | null; totals: readonly string[] }) {
  return <div className="mt-4 space-y-1 text-xs text-muted-foreground">
    {period ? <p>{period}</p> : null}
    {totals.slice(1).map((line, index) => <p key={index} className="font-medium text-foreground">{line}</p>)}
  </div>
}
