import { attendanceCatalogueLegend } from "@/lib/mtm/attendance-presentation"
import { filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { attendanceTotalLines, type AttendanceTable, type AttendanceText } from "@/lib/mtm/attendance-table"
import { AttendanceViewConfigSchema, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import type { AttendanceN1tParts } from "@/lib/mtm/attendance-month-contract"

/**
 * One N-1t for accounting, whatever its size (owner, 2026-10-20).
 *
 * A close freezes at most 100 people, and that limit stays: measured on PostgreSQL 16 with the
 * shipped triggers (2026-10-21, 500 people, a full month), one close of 500 took 82 s — 74 s of
 * it in the guard that checks each frozen day against the whole snapshot, which grows with the
 * square of the people — and every attendance write in the company waited the whole 82 s for the
 * snapshot fence. It would also exceed the 20 s transaction limit, PostgreSQL's 32 767
 * parameters per statement (15 000 frozen days × 5) and the 2 MB snapshot limit. Five closes of
 * 100 took 5 s each. So a month is still frozen in blocks of 100, and the blocks are read back
 * as one form: their lines in close order, numbered 1..N, and one set of totals.
 *
 * The join reproduces exactly what the N-1t report builds for all those people at once
 * (`buildAttendanceTable`, MONTH mode with the № column): its details are, in order, the period,
 * the moment of the figures, the time zones, the duration format, the legend, the provisional
 * note (never in a closable month), then — when any day was corrected — the correction legend
 * and one line per correction, then one line per approved request. `AttendanceN1tParts` holds
 * the counts and figures that layout needs; each frozen line and note is kept verbatim. Only the
 * totals (and the time zone line when blocks differ) are worded again from the frozen figures.
 */
export function attendanceN1tParts(report: MtmAttendanceReport, value: AttendanceViewConfig): AttendanceN1tParts {
  const config = AttendanceViewConfigSchema.parse(value)
  // The rows buildAttendanceTable reads for a month form, and nothing else.
  const rows = filterMtmAttendanceRows(report.accountingRows ?? report.rows, config.filters)
  const totals = summarizeMtmAttendanceRows(rows)
  return {
    totals: { workedSeconds: totals.workedSeconds, pausedSeconds: totals.pausedSeconds, lateSeconds: totals.lateSeconds, earlyLeaveSeconds: totals.earlyLeaveSeconds,
      rowCount: totals.rowCount, employeeCount: totals.employeeCount, annualLeaveDays: totals.annualLeaveDays, unknownWorkedCount: totals.unknownWorkedCount, unknownPausedCount: totals.unknownPausedCount },
    zones: [...new Set(rows.map(row => row.timezone))],
    legendKinds: attendanceCatalogueLegend(rows, "en").length,
    provisional: rows.some(row => row.kind === "OPEN"),
    correctionLines: rows.reduce((total, row) => total + (row.corrections?.length ?? 0), 0),
  }
}

/** One frozen N-1t: its cells, its parts and the moment its figures were taken. */
export type AttendanceN1tBlock = { table: AttendanceTable; parts: AttendanceN1tParts; asOf: string }
const LEGEND_SEPARATOR = " · "

/** A block's details cut along the layout its parts describe; a table that does not fit them is damaged. */
function sections(block: AttendanceN1tBlock) {
  const { details } = block.table, { provisional, correctionLines } = block.parts
  const notesFrom = 5 + (provisional ? 1 : 0), approvedFrom = notesFrom + (correctionLines ? 1 + correctionLines : 0)
  if (details.length < approvedFrom) throw new Error("MTM_ATTENDANCE_MONTH_DAMAGED")
  return { period: details[0], snapshot: details[1], zones: details[2], duration: details[3], legend: details[4],
    provisional: provisional ? details[5] : null, correctionLegend: correctionLines ? details[notesFrom] : null,
    corrections: details.slice(notesFrom + 1, notesFrom + 1 + correctionLines), approved: details.slice(approvedFrom) }
}

/**
 * Frozen (or about to be frozen) N-1t blocks of one month as one form. `firstIndex` numbers the
 * first line: 1 for a whole month, or the line after the part already closed when the rest of
 * the month is about to follow it. A single block from line 1 is returned exactly as stored.
 */
export function joinAttendanceN1t(blocks: readonly AttendanceN1tBlock[], t: AttendanceText, firstIndex = 1): AttendanceTable {
  if (!blocks.length) throw new Error("MTM_ATTENDANCE_MONTH_EMPTY")
  const [first] = blocks
  const index = first.table.columns.findIndex(column => column.key === "index")
  let next = firstIndex
  const rows = blocks.flatMap(block => block.table.rows.map(row => index < 0 ? row : { ...row, cells: row.cells.map((cell, at) => at === index ? next++ : cell) }))
  if (blocks.length === 1) return firstIndex === 1 ? first.table : { ...first.table, rows }
  const parts = blocks.map(sections), head = parts[0]
  const unique = (lines: readonly string[]) => [...new Set(lines)]
  const zones = unique(blocks.flatMap(block => block.parts.zones))
  const sameZones = zones.length === first.parts.zones.length
  // The legend lists each day kind once, in order of first appearance — as one table over all lines lists it.
  const catalogued = blocks.flatMap((block, at) => block.parts.legendKinds ? [parts[at].legend] : [])
  const legend = catalogued.length ? unique(catalogued.flatMap(line => line.split(LEGEND_SEPARATOR))).join(LEGEND_SEPARATOR) : head.legend
  const provisional = parts.find(part => part.provisional !== null)?.provisional ?? null
  const correctionLegend = parts.find(part => part.correctionLegend !== null)?.correctionLegend ?? null
  const sum = (key: keyof AttendanceN1tParts["totals"]) => blocks.reduce((total, block) => total + block.parts.totals[key], 0)
  return {
    title: first.table.title, columns: first.table.columns, rows,
    // One press freezes every block at one moment: one line for it. Blocks closed at different
    // moments keep a line for each moment.
    details: [head.period, ...parts.flatMap((part, at) => blocks.findIndex(block => block.asOf === blocks[at].asOf) === at ? [part.snapshot] : []), sameZones ? head.zones : t("reportTimezones", { zones: zones.join(", ") || "—" }), head.duration, legend,
      ...(provisional ? [provisional] : []), ...(correctionLegend ? [correctionLegend, ...parts.flatMap(part => part.corrections)] : []), ...parts.flatMap(part => part.approved)],
    totals: attendanceTotalLines({ workedSeconds: sum("workedSeconds"), pausedSeconds: sum("pausedSeconds"), lateSeconds: sum("lateSeconds"), earlyLeaveSeconds: sum("earlyLeaveSeconds"),
      rowCount: sum("rowCount"), employeeCount: sum("employeeCount"), annualLeaveDays: sum("annualLeaveDays"), unknownWorkedCount: sum("unknownWorkedCount"), unknownPausedCount: sum("unknownPausedCount") }, t),
  }
}
