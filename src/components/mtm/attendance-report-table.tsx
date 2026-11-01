"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { HomePill, type HomeTone } from "@/components/mtm/home-parts"
import type { AttendanceDayMeta, AttendanceTable } from "@/lib/mtm/attendance-table"

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
/**
 * A day report on screen (owner, 2026-11-01: «нет департамента, нет
 * должности… строки расширяются… не юзабилити»). Every row keeps to one line:
 * position, department and team go under the name; status and short tags
 * stand in for the long note, whose lines open under the row with «Ətraflı»;
 * times drop their seconds; lateness is a pill. Excel and PDF keep every column.
 */
function dayColumns(table: AttendanceTable) {
  const index = (key: string) => table.columns.findIndex(column => column.key === key)
  const folded = ["position", "department", "team"].map(index).filter(at => at >= 0)
  const hidden = [...folded, index("status")]
  return { employee: index("employee"), folded, shown: table.columns.map((column, at) => ({ column, at })).filter(({ at }) => !hidden.includes(at)) }
}
const dayTone = (row: AttendanceTable["rows"][number], meta: AttendanceDayMeta): HomeTone => row.kind === "INVALID_FACTS" || row.kind === "ABSENT" ? "red"
  : row.kind === "MISSING_FINISH" || meta.late ? "amber" : row.kind === "OPEN" || row.kind === "HOLIDAY" ? "blue" : row.kind === "WORKED" ? "green" : "zinc"
const withoutSeconds = (text: string) => text.replace(/^(\d{1,2}:\d{2}):\d{2}$/, "$1")
/** «12:14:37» → «12:14»: seconds are noise on screen; the file keeps them. */
const durationWithoutSeconds = (text: string) => text.replace(/^(\d+:\d{2}):\d{2}/, "$1")
const noTime = (text: string) => text === "0:00" || text === "—" || text === ""

/** HR asks for an explanation of a day from the report (owner, 2026-11-01); the answer is decided on «Bu gün». */
export type AttendanceDayExplain = {
  /** Whether this day may still be asked: in the company's window, and this user may ask. */
  askable: (meta: AttendanceDayMeta) => boolean
  sent: ReadonlySet<string>
  busy: string | null
  onAsk: (meta: AttendanceDayMeta) => void
}
export const attendanceDayExplainKey = (meta: Pick<AttendanceDayMeta, "employeeId" | "date">) => `${meta.employeeId}|${meta.date}`

function ExplainCell({ meta, explain }: { meta: AttendanceDayMeta; explain: AttendanceDayExplain }) {
  const t = useTranslations("mtmAttendance")
  const key = attendanceDayExplainKey(meta)
  if (meta.explanation === "ANSWERED") return <Link prefetch={false} href="/mtm/attendance" className="text-xs font-semibold text-primary hover:underline">{t("reportExplainAnswered")}</Link>
  if (meta.explanation) return <HomePill tone={meta.explanation === "REQUESTED" ? "amber" : meta.explanation === "ACCEPTED" ? "green" : "red"}>
    {t(meta.explanation === "REQUESTED" ? "reportExplainWaiting" : meta.explanation === "ACCEPTED" ? "reportExplainAccepted" : "reportExplainRejected")}</HomePill>
  if (explain.sent.has(key)) return <HomePill tone="amber">{t("reportExplainSent")}</HomePill>
  if (!meta.explainKind || !explain.askable(meta)) return <span className="text-muted-foreground">—</span>
  return <Hint text={t("reportExplainAskHint")}><Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" data-testid="attendance-report-explain-ask"
    disabled={explain.busy !== null} onClick={() => explain.onAsk(meta)}>{t("reportExplainAsk")}</Button></Hint>
}

function DayReportTable({ table, testId, explain }: { table: AttendanceTable; testId: string; explain?: AttendanceDayExplain }) {
  const t = useTranslations("mtmAttendance")
  const layout = dayColumns(table)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) => setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const width = layout.shown.length + (explain ? 1 : 0) + 1
  return <div className="overflow-x-auto" role="region" aria-label={table.title} tabIndex={0}><table className="w-full border-collapse text-sm" data-testid={testId}>
    <thead><tr>{layout.shown.map(({ column }) => <th key={column.key} scope="col" className="whitespace-nowrap border-b px-2 py-2.5 text-left text-xs font-medium text-muted-foreground">{column.label}</th>)}
      {explain ? <th scope="col" className="whitespace-nowrap border-b px-2 py-2.5 text-left text-xs font-medium text-muted-foreground">{t("reportExplain")}</th> : null}
      <th scope="col" className="border-b px-3 py-2.5"><span className="sr-only">{t("reportDetails")}</span></th></tr></thead>
    <tbody>{table.rows.map(row => {
      const meta = row.day!, expanded = open.has(row.key)
      return <Fragment key={row.key}><tr className="border-b last:border-0" data-testid="attendance-report-row">{layout.shown.map(({ column, at }) => {
        const cell = String(row.cells[at] ?? "")
        if (at === layout.employee) {
          // «No team» says nothing under a name: only what the card has.
          const under = layout.folded.map(index => String(row.cells[index] ?? "")).filter(text => text && text !== "—" && text !== t("reportNoTeam"))
          return <th key={column.key} scope="row" className="whitespace-nowrap px-2 py-2.5 text-left align-middle">
            <span className="block font-semibold">{cell}</span>
            {under.length ? <span className="block max-w-[16rem] truncate text-xs font-normal text-muted-foreground" title={under.join(" · ")} data-testid="attendance-report-employee-details">{under.join(" · ")}</span> : null}</th>
        }
        const body = column.key === "notes" ? <span className="flex items-center gap-1.5" data-testid="attendance-report-tags">
            <HomePill tone={dayTone(row, meta)}>{meta.statusColor ? <span aria-hidden="true" data-testid="attendance-kind-color" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.statusColor }} /> : null}{meta.status}</HomePill>
            {meta.tags.map(tag => <HomePill key={tag} tone={tag === t("reportTagCorrection") ? "blue" : "zinc"}>{tag}</HomePill>)}</span>
          : column.key === "startedAt" || column.key === "completedAt" ? withoutSeconds(cell)
          : column.key === "late" || column.key === "early" ? noTime(cell) ? <span className="text-muted-foreground">—</span> : <HomePill tone="amber">{durationWithoutSeconds(cell)}</HomePill>
          : column.key === "worked" || column.key === "paused" ? durationWithoutSeconds(cell)
          : cell
        return <td key={column.key} className="whitespace-nowrap px-2 py-2.5 align-middle tabular-nums">{body}</td>
      })}
        {explain ? <td className="whitespace-nowrap px-2 py-2.5 align-middle"><ExplainCell meta={meta} explain={explain} /></td> : null}
        <td className="whitespace-nowrap px-2 py-2.5 text-right align-middle">{meta.lines.length ? <button type="button" aria-expanded={expanded} data-testid="attendance-report-details-toggle"
          className="text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => toggle(row.key)}>{t(expanded ? "reportDetailsHide" : "reportDetails")}</button> : null}</td></tr>
        {expanded ? <tr className="border-b bg-muted/40" data-testid="attendance-report-row-details"><td colSpan={width} className="px-3 py-3">
          <ul className="grid gap-1.5 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">{meta.lines.map((line, index) => <li key={index}>{line}</li>)}</ul></td></tr> : null}
      </Fragment>
    })}</tbody>
  </table></div>
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
export function AttendanceReportTable({ table, testId = "attendance-report-table", explain }: { table: AttendanceTable; testId?: string; explain?: AttendanceDayExplain }) {
  if (table.rows.length && table.rows.every(row => row.day)) return <DayReportTable table={table} testId={testId} explain={explain} />
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

/** The lines under a table: its period, then its totals without their heading line (as the live report prints them).
 * `minutes` drops the seconds the way a day report's rows do; the file keeps them. */
export function AttendanceReportTotals({ period, totals, minutes = false }: { period: string | null; totals: readonly string[]; minutes?: boolean }) {
  return <div className="mt-4 space-y-1 text-xs text-muted-foreground">
    {period ? <p>{period}</p> : null}
    {totals.slice(1).map((line, index) => <p key={index} className="font-medium text-foreground">{minutes ? line.replace(/\b(\d+:\d{2}):\d{2}\b/g, "$1") : line}</p>)}
  </div>
}
